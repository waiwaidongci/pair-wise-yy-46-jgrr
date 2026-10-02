import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { delay, of, throwError } from 'rxjs'
import { seedClaims } from './seed'
import type { ApprovalStep, ClaimCase, RoleLedgerEntry } from './models'

/** 登录操作者（单用户工作台模拟） */
const CURRENT_OPERATOR = '当前用户'

let claims: ClaimCase[] = structuredClone(seedClaims)

/**
 * 角色权限台账：授权事实的唯一来源。
 * 每条记录是一项任命：operator 在 since~until 期间担任 role；until 为空表示当前在任。
 * 调岗不修改历史记录，而是封存旧记录（置 until）并新开记录——已签会签保留签署时职责依据。
 */
let ledger: RoleLedgerEntry[] = [
  { id: 'RL-01', operator: '陆嘉', role: '查勘员', since: '2026-01-01', basis: '劳动合同·查勘岗' },
  { id: 'RL-02', operator: '陈立', role: '公估', since: '2026-01-01', basis: '公估执业登记' },
  { id: 'RL-03', operator: '周岩', role: '专家', since: '2026-03-01', basis: '专家库聘任协议' },
  { id: 'RL-04', operator: '赵岚', role: '高级核赔员', since: '2025-06-01', basis: '核赔授权书 2025-06' },
  { id: 'RL-05', operator: '钱进', role: '理赔经理', since: '2025-06-01', basis: '核赔授权书 2025-06' },
  { id: 'RL-06', operator: '孙磊', role: '区域负责人', since: '2024-01-01', basis: '转授权书 2024-01' },
  { id: 'RL-07', operator: CURRENT_OPERATOR, role: '查勘员', since: '2026-09-01', basis: '顶岗登记 2026-09' },
  { id: 'RL-08', operator: CURRENT_OPERATOR, role: '高级核赔员', since: '2026-09-01', basis: '顶岗登记 2026-09' },
]

/** 已处理写入的请求号 → 响应结果：失败后按请求号恢复，不重复应用 */
const processedWrites = new Map<string, { status: number; body: unknown }>()

/** 演示「响应丢失」：每类写入首次提交时服务端已落库但响应丢失，客户端按请求号恢复 */
const lostResponse = { quotes: true, approvals: true }

const now = () => new Date().toLocaleString('zh-CN', { hour12: false })
const isoNow = () => new Date().toISOString()

function activeRoles(operator: string): string[] {
  return ledger.filter((entry) => entry.operator === operator && !entry.until).map((entry) => entry.role)
}

/** 经手人集合：在任一损失科目下提交过报价的操作者（职责分离判定依据） */
function handlersOf(claim: ClaimCase): Set<string> {
  const handlers = new Set<string>()
  for (const item of claim.lossItems) for (const quote of item.repairQuotes) handlers.add(quote.operator)
  return handlers
}

/**
 * 旧数据升级：缺少职责记录的报价/会签标记为「待补录」，不得按完整授权事实放行。
 */
function migrateLegacy(claim: ClaimCase): ClaimCase {
  claim.version ??= 1
  for (const item of claim.lossItems) {
    for (const quote of item.repairQuotes) {
      quote.recordStatus = quote.operatorDuties?.length ? '完整' : '待补录'
    }
  }
  for (const step of claim.approvals) {
    if (step.status === '待处理') {
      step.recordStatus = undefined
    } else {
      step.recordStatus = step.operatorDuties?.length ? '完整' : '待补录'
    }
  }
  return claim
}

/**
 * 会签重算：职责变化后，未完成的会签立即按当前台账重算——
 * 审批人须持有该档位要求的当前职责，且未经手该损失科目（职责分离）。
 * 已签步骤保持原样（operatorDuties 为签署时封存的当时依据）。
 */
function recalcApprovals(claim: ClaimCase): ClaimCase {
  const roles = activeRoles(CURRENT_OPERATOR)
  const handlers = handlersOf(claim)
  for (const step of claim.approvals) {
    if (step.status !== '待处理') {
      step.eligible = undefined
      step.blockedReason = undefined
      continue
    }
    if (!roles.includes(step.role)) {
      step.eligible = false
      step.blockedReason = `当前职责不含「${step.role}」，职责变化后该档位已重算`
    } else if (handlers.has(CURRENT_OPERATOR)) {
      step.eligible = false
      step.blockedReason = '该损失科目经本人经手，按职责分离要求不可审批'
    } else {
      step.eligible = true
      step.blockedReason = undefined
    }
  }
  return claim
}

function loadClaim(id: string): ClaimCase | undefined {
  const claim = claims.find((item) => item.id === id)
  return claim ? recalcApprovals(migrateLegacy(claim)) : undefined
}

function replay(requestNo: string) {
  const hit = processedWrites.get(requestNo)!
  return of(
    new HttpResponse({
      status: hit.status,
      body: hit.body,
      headers: new HttpHeaders({ 'X-Request-No': requestNo, 'X-Idempotent-Replay': 'true' }),
    }),
  ).pipe(delay(120))
}

export const mockApiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request)

  if (request.method === 'GET' && request.url === '/api/ledger') {
    return of(new HttpResponse({ status: 200, body: ledger })).pipe(delay(120))
  }

  if (request.method === 'POST' && request.url === '/api/ledger/rotate') {
    // 模拟调岗：当前用户在 高级核赔员 <-> 理赔经理 之间轮换；历史任命封存保留
    const senior = ledger.find((entry) => entry.operator === CURRENT_OPERATOR && entry.role === '高级核赔员' && !entry.until)
    const manager = ledger.find((entry) => entry.operator === CURRENT_OPERATOR && entry.role === '理赔经理' && !entry.until)
    if (senior) {
      senior.until = isoNow()
      ledger.push({ id: `RL-${Date.now()}`, operator: CURRENT_OPERATOR, role: '理赔经理', since: isoNow(), basis: '模拟调岗' })
    } else if (manager) {
      manager.until = isoNow()
      ledger.push({ id: `RL-${Date.now()}`, operator: CURRENT_OPERATOR, role: '高级核赔员', since: isoNow(), basis: '模拟调岗' })
    }
    for (const claim of claims) {
      recalcApprovals(claim)
      claim.audit.push({
        id: `A-${Date.now()}-${claim.id}`,
        at: now(),
        operator: '系统',
        action: '职责重算',
        detail: '角色权限台账变更：未完成会签按当前职责立即重算，已签步骤保留签署时职责依据。',
      })
    }
    return of(new HttpResponse({ status: 200, body: { ledger } })).pipe(delay(160))
  }

  if (request.method === 'GET' && request.url === '/api/claims') {
    const query = request.params.get('query')?.toLowerCase() ?? ''
    const status = request.params.get('status') ?? ''
    const risk = request.params.get('risk') ?? ''
    const page = Number(request.params.get('page') ?? 1)
    const pageSize = Number(request.params.get('pageSize') ?? 10)
    const filtered = claims
      .map((item) => recalcApprovals(migrateLegacy(structuredClone(item))))
      .filter(
        (item) =>
          (!query || `${item.id}${item.insured}${item.policyNo}`.toLowerCase().includes(query)) &&
          (!status || item.status === status) &&
          (!risk || item.riskLevel === risk),
      )
    const start = (page - 1) * pageSize
    return of(new HttpResponse({ status: 200, body: { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize } })).pipe(delay(220))
  }

  if (request.method === 'GET' && request.url.startsWith('/api/claims/')) {
    const id = request.url.split('/').pop()
    const item = loadClaim(id!)
    return item ? of(new HttpResponse({ status: 200, body: item })).pipe(delay(120)) : throwError(() => new HttpErrorResponse({ status: 404 }))
  }

  if (request.method === 'POST' && request.url.endsWith('/quotes')) {
    const body = request.body as { itemId: string; amount: number; reason: string; requestNo?: string }
    if (!body.requestNo) {
      return throwError(() => new HttpErrorResponse({ status: 400, error: { message: '缺少请求号，无法保证写入幂等' } }))
    }
    if (processedWrites.has(body.requestNo)) return replay(body.requestNo)

    const id = request.url.split('/').at(-2)
    const claim = claims.find((item) => item.id === id)
    const item = claim?.lossItems.find((loss) => loss.id === body.itemId)
    if (!claim || !item) return throwError(() => new HttpErrorResponse({ status: 404 }))

    const duties = activeRoles(CURRENT_OPERATOR)
    item.repairQuotes.push({
      version: item.repairQuotes.length + 1,
      amount: body.amount,
      reason: body.reason,
      operator: CURRENT_OPERATOR,
      operatorDuties: duties,
      createdAt: now(),
      recordStatus: '完整',
      requestNo: body.requestNo,
    })
    claim.version += 1
    claim.audit.push({
      id: `A-${Date.now()}`,
      at: now(),
      operator: CURRENT_OPERATOR,
      action: '报价调整',
      detail: `报价版本 V${item.repairQuotes.length}：${body.amount.toLocaleString('zh-CN')} 元；操作者当时职责：${duties.join('、')}；原因：${body.reason}`,
    })
    // 经手人变化会影响职责分离判定，立即重算未完成会签
    recalcApprovals(claim)

    processedWrites.set(body.requestNo, { status: 201, body: claim })
    if (lostResponse.quotes) {
      // 模拟服务端已落库但响应丢失：客户端按同一请求号重试时应拿到已存结果
      lostResponse.quotes = false
      return throwError(() => new HttpErrorResponse({ status: 503, error: { message: '写入响应丢失' } }))
    }
    return of(new HttpResponse({ status: 201, body: claim })).pipe(delay(180))
  }

  if (request.method === 'POST' && request.url.endsWith('/approvals')) {
    const body = request.body as { role: string; result: string; comment: string; version?: number; requestNo?: string }
    if (!body.requestNo) {
      return throwError(() => new HttpErrorResponse({ status: 400, error: { message: '缺少请求号，无法保证写入幂等' } }))
    }
    if (processedWrites.has(body.requestNo)) return replay(body.requestNo)

    const id = request.url.split('/').at(-2)
    const claim = claims.find((item) => item.id === id)
    const step = claim?.approvals.find((approval) => approval.role === body.role)
    if (!claim || !step) return throwError(() => new HttpErrorResponse({ status: 404 }))

    // 先到生效：档位已有签署结果，或客户端基于旧版本提交，均拒绝
    if (step.status !== '待处理') {
      return throwError(() => new HttpErrorResponse({ status: 409, error: { message: '该档位已有签署结果，先到提交生效' } }))
    }
    if (body.version !== claim.version) {
      return throwError(() => new HttpErrorResponse({ status: 409, error: { message: '数据已被其他终端更新，请刷新后重试' } }))
    }

    // 授权事实：当前职责 + 职责分离（未经手该损失科目）
    const duties = activeRoles(CURRENT_OPERATOR)
    if (!duties.includes(step.role)) {
      return throwError(() => new HttpErrorResponse({ status: 403, error: { message: `当前职责不含「${step.role}」，无权处理该档位` } }))
    }
    if (handlersOf(claim).has(CURRENT_OPERATOR)) {
      return throwError(() => new HttpErrorResponse({ status: 403, error: { message: '该损失科目经本人经手，按职责分离要求不可审批' } }))
    }

    const passed = body.result === '已通过'
    step.status = passed ? '已通过' : '已退回'
    step.operator = CURRENT_OPERATOR
    step.operatorDuties = duties
    step.comment = body.comment
    step.completedAt = now()
    step.recordStatus = '完整'
    claim.version += 1
    claim.audit.push({
      id: `A-${Date.now()}`,
      at: now(),
      operator: CURRENT_OPERATOR,
      action: `会签${step.status}`,
      detail: `${step.role}（档位 V${claim.version}）：${body.comment}；签署时职责：${duties.join('、')}`,
    })
    claim.status = passed ? '审批中' : '退回补件'
    recalcApprovals(claim)

    processedWrites.set(body.requestNo, { status: 200, body: claim })
    if (lostResponse.approvals) {
      // 模拟服务端已落库但响应丢失：客户端按同一请求号重试时应拿到已存结果
      lostResponse.approvals = false
      return throwError(() => new HttpErrorResponse({ status: 503, error: { message: '写入响应丢失' } }))
    }
    return of(new HttpResponse({ status: 200, body: claim })).pipe(delay(180))
  }

  return next(request)
}
