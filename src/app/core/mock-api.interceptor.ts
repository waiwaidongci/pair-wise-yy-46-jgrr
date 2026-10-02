import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { inject } from '@angular/core'
import { Observable } from 'rxjs'
import { seedClaims } from './seed'
import { LedgerService } from './ledger.service'
import {
  currentAssignees,
  evaluateApprover,
  evaluateQuoteSubmitter,
  getDuty,
  getPerson,
  hasMissingFacts,
  migrateClaim,
  nowText,
  recalcPendingApprovals,
  snapshotDuty,
} from './authorization'
import type { ApprovalStep, AuditEvent, ClaimCase, MutationResult, RepairQuote } from './models'

let claims: ClaimCase[] = seedClaims.map(migrateClaim)

/** 已落盘写请求日志：同请求号重试时直接回放结果（写入失败不记录，可凭请求号恢复）。 */
const requestJournal = new Map<string, { response: MutationResult; at: string }>()
/** 在途处理锁：同一档位/同一报价位只允许一个写请求，先到先得。 */
const inflight = new Set<string>()

let auditSeq = 100
const nextAuditId = () => `A-${Date.now()}-${++auditSeq}`

function addAudit(claim: ClaimCase, operator: string, action: string, detail: string) {
  const event: AuditEvent = { id: nextAuditId(), at: nowText(), operator, action, detail }
  claim.audit.push(event)
  return event
}

function json<T>(status: number, body: T, delayMs: number): Observable<HttpResponse<T>> {
  return new Observable((subscriber) => {
    const timer = setTimeout(() => {
      subscriber.next(new HttpResponse({ status, body }))
      subscriber.complete()
    }, delayMs)
    return () => clearTimeout(timer)
  })
}

function failure(status: number, message: string, extra: Record<string, unknown> = {}): Observable<never> {
  return new Observable((subscriber) => {
    const timer = setTimeout(() => {
      subscriber.error(new HttpErrorResponse({ status, error: { message, ...extra } }))
      subscriber.complete()
    }, 120 + Math.round(Math.random() * 140))
    return () => clearTimeout(timer)
  })
}

type WriteSpec = {
  requestId?: string
  injectFailure?: boolean
  lockKey: string
  apply: () => { status: number; body: MutationResult }
}

/**
 * 写请求统一管道：
 * 1) 同请求号已成功 → 幂等回放（按请求号恢复）；
 * 2) 到达提交时刻同档位/同位仍在途 → 409，先到请求生效（网络延迟决定先后）；
 * 3) 模拟写入失败 → 503，不登记结果，客户端凭同一请求号重试，不会产生重复事实；
 * 4) 成功后登记请求日志。
 */
function runWrite(spec: WriteSpec): Observable<HttpResponse<MutationResult>> | Observable<never> {
  const requestId = spec.requestId?.trim()
  if (!requestId) return failure(400, '缺少请求号（requestId），写操作必须可幂等恢复。')

  const journaled = requestJournal.get(requestId)
  if (journaled) {
    return json(200, { ...journaled.response, replayed: true, requestId }, 90)
  }

  return new Observable((subscriber) => {
    const timer = setTimeout(() => {
      // 提交时刻才判定竞争：随机延迟模拟两终端不同的网络到达顺序
      if (inflight.has(spec.lockKey)) {
        subscriber.error(
          new HttpErrorResponse({ status: 409, error: { message: '该档位已有在途会签/报价请求，按先到结果生效，本请求拒绝。', requestId, lockKey: spec.lockKey } }),
        )
        subscriber.complete()
        return
      }
      inflight.add(spec.lockKey)
      if (spec.injectFailure) {
        inflight.delete(spec.lockKey)
        subscriber.error(
          new HttpErrorResponse({
            status: 503,
            error: { message: '写入失败（模拟存储不可用），请凭请求号重试恢复。', requestId, retriable: true },
          }),
        )
        subscriber.complete()
        return
      }
      const { status, body } = spec.apply()
      inflight.delete(spec.lockKey)
      requestJournal.set(requestId, { response: body, at: nowText() })
      subscriber.next(new HttpResponse({ status, body: { ...body, requestId, replayed: false } }))
      subscriber.complete()
    }, 150 + Math.round(Math.random() * 160))
    return () => clearTimeout(timer)
  })
}

type QuoteRequestBody = {
  itemId: string
  amount: number
  reason: string
  requestId?: string
  personId?: string
  injectFailure?: boolean
}

type ApprovalRequestBody = {
  dutyId: string
  result: string
  comment: string
  requestId?: string
  personId?: string
  injectFailure?: boolean
}

type BackfillRequestBody = {
  kind: 'quote' | 'approval'
  itemId?: string
  quoteVersion?: number
  stepDutyId?: string
  personId?: string
  dutyId?: string
  requestId?: string
  injectFailure?: boolean
}

type ReassignRequestBody = {
  dutyId: string
  personId: string
  reason: string
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  const ledgerService = inject(LedgerService)
  if (!request.url.startsWith('/api/')) return next(request)

  // ---------- 只读 ----------
  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims.filter(
      (item) =>
        (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
        (!status || item.status === status) &&
        (!risk || item.riskLevel === risk),
    )
    const start = (page - 1) * pageSize
    return json(200, { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize }, 180)
  }

  if (request.method === 'GET' && request.url === '/api/ledger') {
    return json(200, ledgerService.ledger, 90)
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = claims.find((claim) => claim.id === id)
    return item ? json(200, item, 100) : failure(404, '案件不存在')
  }

  // ---------- 角色权限台账：换岗 ----------
  if (request.method === 'POST' && request.url === '/api/ledger/reassign') {
    const body = request.body as ReassignRequestBody
    const duty = getDuty(ledgerService.ledger, body.dutyId)
    const person = getPerson(ledgerService.ledger, body.personId)
    if (!duty || !person) return failure(400, '职责或人员不在台账中。')
    const previous = currentAssignees(ledgerService.ledger, body.dutyId).map((person) => person.name).join('、') || '空缺'
    const version = ledgerService.reassign(body.dutyId, body.personId, body.reason)
    // 职责变化后，所有案件未完成的会签立即按新台账重算（已签步骤不动）
    const affected: string[] = []
    for (const claim of claims) {
      const hasPending = claim.approvals.some((step) => step.status === '待处理')
      if (!hasPending) continue
      recalcPendingApprovals(ledgerService.ledger, claim)
      affected.push(claim.id)
      addAudit(
        claim,
        '系统',
        '职责变化触发会签重算',
        `职责「${duty.name}」由 ${previous} 移交 ${person.name}；台账升级至 v${version}，未完成会签已按当前职责重算，历史签署保留当时依据。`,
      )
    }
    return json(200, { ledger: ledgerService.ledger, version, affectedClaimIds: affected }, 160)
  }

  // ---------- 报价版本提交 ----------
  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as QuoteRequestBody
    const claim = claims.find((entry) => entry.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return failure(404, '案件或损失科目不存在')

    const personId = body.personId ?? ''
    const submitter = evaluateQuoteSubmitter(ledgerService.ledger, personId)
    if (!submitter.eligible || !submitter.currentDuty) return failure(403, submitter.reasons.join('；'), { requestId: body.requestId })

    const lockKey = `quote:${claim.id}:${item.id}`
    return runWrite({
      requestId: body.requestId,
      injectFailure: body.injectFailure,
      lockKey,
      apply: () => {
        const basis = snapshotDuty(ledgerService.ledger, personId, submitter.currentDuty!.dutyId)!
        const version = item.repairQuotes.length + 1
        const quote: RepairQuote = {
          version,
          amount: body.amount,
          reason: body.reason,
          operator: basis.personName,
          createdAt: nowText(),
          basis,
          requestId: body.requestId,
        }
        item.repairQuotes.push(quote)
        addAudit(
          claim,
          basis.personName,
          '报价版本提交',
          `${item.category} 生成报价 V${version}：${body.amount} 元；依据：${basis.dutyName}（台账 v${basis.ledgerVersion}），请求号 ${body.requestId}。`,
        )
        return { status: 201, body: { claim, requestId: body.requestId! } }
      },
    })
  }

  // ---------- 会签处理 ----------
  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as ApprovalRequestBody
    const claim = claims.find((entry) => entry.id === id)
    const step = claim?.approvals.find((approval) => approval.dutyId === body.dutyId)
    if (!claim || !step) return failure(404, '案件或会签档位不存在')
    if (step.status !== '待处理') return failure(409, '该档位已处理，结果以先到请求为准。', { requestId: body.requestId })

    const personId = body.personId ?? ''
    const eligibility = evaluateApprover(ledgerService.ledger, claim, personId, body.dutyId)
    if (!eligibility.eligible || !eligibility.currentDuty) {
      return failure(403, eligibility.reasons.join('；'), { requestId: body.requestId })
    }

    const lockKey = `approval:${claim.id}:${body.dutyId}`
    return runWrite({
      requestId: body.requestId,
      injectFailure: body.injectFailure,
      lockKey,
      apply: () => {
        const approved = body.result === '已通过'
        const basis = eligibility.currentDuty!
        step.status = approved ? '已通过' : '已退回'
        step.operator = basis.personName
        step.comment = body.comment
        step.completedAt = nowText()
        step.basis = basis
        step.requestId = body.requestId
        step.recalcNote = undefined
        step.signBasis = {
          ledgerVersion: ledgerService.ledger.version,
          reserve: claim.reserve,
          capturedAt: nowText(),
          submittedBy: [...new Set(claim.lossItems.flatMap((loss) => loss.repairQuotes.map((q) => q.basis?.personName).filter(Boolean)))] as string[],
          quoteRefs: claim.lossItems.map((loss) => {
            const latest = loss.repairQuotes.filter((q) => q.basis && !q.dutyMissing).at(-1)
            return {
              itemId: loss.id,
              itemCategory: loss.category,
              quoteVersion: latest?.version ?? 0,
              quoteAmount: latest?.amount ?? 0,
              submittedBy: latest?.basis?.personName ?? '待补录',
            }
          }),
        }
        addAudit(
          claim,
          basis.personName,
          `会签${step.status}`,
          `${step.role}（台账 v${basis.ledgerVersion}）${step.status}：${body.comment}；签署人未经手该准备金下损失科目报价。请求号 ${body.requestId}。`,
        )
        claim.status = approved ? '审批中' : '退回补件'
        return { status: 200, body: { claim, requestId: body.requestId! } }
      },
    })
  }

  // ---------- 旧数据职责补录 ----------
  if (request.method === 'POST' && request.url.endsWith('/backfill')) {
    const id = request.url.split('/').at(-2)
    const body = request.body as BackfillRequestBody
    const claim = claims.find((entry) => entry.id === id)
    if (!claim) return failure(404, '案件不存在')
    const person = getPerson(ledgerService.ledger, body.personId ?? '')
    const duty = getDuty(ledgerService.ledger, body.dutyId ?? '')
    if (!person || !duty) return failure(400, '补录的人员或职责不在角色权限台账中。', { requestId: body.requestId })

    let target: RepairQuote | ApprovalStep | undefined
    let targetName = ''
    if (body.kind === 'quote') {
      const item = claim.lossItems.find((loss) => loss.id === body.itemId)
      target = item?.repairQuotes.find((quote) => quote.version === body.quoteVersion)
      targetName = item ? `${item.category}报价 V${body.quoteVersion}` : ''
    } else {
      target = claim.approvals.find((approval) => approval.dutyId === body.stepDutyId)
      targetName = target ? target.role : ''
    }
    if (!target) return failure(404, '待补录记录不存在')
    if (body.kind === 'quote' ? !(target as RepairQuote).dutyMissing : !(target as ApprovalStep).basisMissing) {
      return failure(409, '该记录职责依据齐全，无需补录。')
    }

    const lockKey = `backfill:${claim.id}:${body.kind}:${body.itemId ?? body.stepDutyId}:${body.quoteVersion ?? ''}`
    return runWrite({
      requestId: body.requestId,
      injectFailure: body.injectFailure,
      lockKey,
      apply: () => {
        const basis = snapshotDuty(ledgerService.ledger, person!.id, duty!.id)!
        if (body.kind === 'quote') {
          const quote = target as RepairQuote
          quote.basis = basis
          quote.dutyMissing = false
          quote.backfilled = true
          quote.requestId = body.requestId
        } else {
          const step = target as ApprovalStep
          step.basis = basis
          step.basisMissing = false
          step.backfilled = true
          step.requestId = body.requestId
        }
        claim.factsIncomplete = hasMissingFacts(claim)
        addAudit(
          claim,
          person.name,
          '旧数据职责补录',
          `${targetName}补录当时职责：${person.name} / ${duty.name}（按台账 v${basis.ledgerVersion}登记）；补录${claim.factsIncomplete ? '后仍有其他事实待补录' : '完成，授权事实链已闭合'}。请求号 ${body.requestId}。`,
        )
        return { status: 200, body: { claim, requestId: body.requestId! } }
      },
    })
  }

  // ---------- 演示环境重置 ----------
  if (request.method === 'POST' && request.url === '/api/admin/reset') {
    return new Observable((subscriber) => {
      const timer = setTimeout(() => {
        claims = seedClaims.map(migrateClaim)
        requestJournal.clear()
        inflight.clear()
        ledgerService.reset()
        subscriber.next(new HttpResponse({ status: 200, body: { reset: true } }))
        subscriber.complete()
      }, 120)
      return () => clearTimeout(timer)
    })
  }

  return next(request)
}
