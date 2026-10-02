import type { ClaimCase, DutyDef, DutySnapshot, Eligibility, Person, RoleLedger } from './models'

export const nowText = () => new Date().toLocaleString('zh-CN')

export function getDuty(ledger: RoleLedger, dutyId: string): DutyDef | undefined {
  return ledger.duties.find((duty) => duty.id === dutyId)
}

export function getPerson(ledger: RoleLedger, personId: string): Person | undefined {
  return ledger.persons.find((person) => person.id === personId)
}

/** 某职责当前在岗的全部责任人：已授予且未被撤销（事件按数组顺序结算）。 */
export function currentAssignees(ledger: RoleLedger, dutyId: string): Person[] {
  const active = new Set<string>()
  for (const assignment of ledger.assignments) {
    if (assignment.dutyId !== dutyId) continue
    if (assignment.type === 'grant') active.add(assignment.personId)
    else active.delete(assignment.personId)
  }
  return [...active].map((id) => getPerson(ledger, id)).filter((person): person is Person => Boolean(person))
}

/** 展示用：当前责任人名称列表。 */
export function currentAssignee(ledger: RoleLedger, dutyId: string): Person | undefined {
  return currentAssignees(ledger, dutyId)[0]
}

/** 某人当前承担的全部职责（在授予后未被撤销）。 */
export function currentDutiesOf(ledger: RoleLedger, personId: string): DutyDef[] {
  return ledger.duties.filter((duty) => personHoldsDuty(ledger, personId, duty.id))
}

/** 某人当前是否承担指定职责。 */
export function personHoldsDuty(ledger: RoleLedger, personId: string, dutyId: string): boolean {
  return currentAssignees(ledger, dutyId).some((person) => person.id === personId)
}

/** 冻结授权事实：操作者 + 当时职责 + 台账版本。 */
export function snapshotDuty(ledger: RoleLedger, personId: string, dutyId: string, at: string = nowText()): DutySnapshot | undefined {
  const person = getPerson(ledger, personId)
  const duty = getDuty(ledger, dutyId)
  if (!person || !duty) return undefined
  return { personId: person.id, personName: person.name, dutyId: duty.id, dutyName: duty.name, ledgerVersion: ledger.version, capturedAt: at }
}

/** 案件全部有效（已补录职责的）报价版本；旧数据未补录前不作为授权依据。 */
export function effectiveQuotes(claim: ClaimCase) {
  return claim.lossItems.flatMap((item) =>
    item.repairQuotes
      .filter((quote) => quote.basis && !quote.dutyMissing)
      .map((quote) => ({ item, quote })),
  )
}

/** 该准备金案件下，提交/经手过任意损失科目报价的人员（依据冻结在报价版本上的职责快照）。 */
export function quoteHandlers(claim: ClaimCase): Set<string> {
  const ids = new Set<string>()
  for (const { quote } of effectiveQuotes(claim)) {
    if (quote.basis) ids.add(quote.basis.personId)
  }
  return ids
}

/** 是否存在旧数据升级后缺失职责记录、等待补录的事实。 */
export function hasMissingFacts(claim: ClaimCase): boolean {
  if (claim.lossItems.some((item) => item.repairQuotes.some((quote) => quote.dutyMissing))) return true
  if (claim.approvals.some((step) => step.status !== '待处理' && step.basisMissing)) return true
  return false
}

export type SignBasisInput = {
  reserve: number
  ledgerVersion: number
  capturedAt: string
  submittedBy: string[]
  quoteRefs: Array<{ itemId: string; itemCategory: string; quoteVersion: number; quoteAmount: number; submittedBy: string }>
}

/** 签署人按"当前职责"处理，且未经手该准备金下任一损失科目；缺一不可。 */
export function evaluateApprover(
  ledger: RoleLedger,
  claim: ClaimCase,
  personId: string,
  dutyId: string,
  at: string = nowText(),
): Eligibility {
  const reasons: string[] = []
  const person = getPerson(ledger, personId)
  const duty = getDuty(ledger, dutyId)

  if (!person) return { eligible: false, reasons: ['人员不在角色权限台账中。'] }
  if (!duty) return { eligible: false, reasons: ['职责已不在角色权限台账中。'] }
  if (!duty.canApprove) reasons.push(`「${duty.name}」无会签权限。`)
  if (!personHoldsDuty(ledger, personId, dutyId)) {
    const holders = currentAssignees(ledger, dutyId)
    const holderText = holders.length ? holders.map((person) => `${person.name}（${person.id}）`).join('、') : '空缺'
    reasons.push(`当前职责由 ${holderText} 承担，${person.name}已不具备该职责，需按新台账处理。`)
  }
  if (claim.reserve < duty.threshold) reasons.push(`准备金未达到该级阈值 ${duty.threshold} 元。`)
  if (quoteHandlers(claim).has(personId)) {
    const touched = claim.lossItems
      .filter((item) => item.repairQuotes.some((quote) => quote.basis?.personId === personId))
      .map((item) => item.category)
      .join('、')
    reasons.push(`职责冲突：${person.name}经手过 ${touched || '该案件'} 的报价，不能对同一准备金会签（报价与会签必须分人）。`)
  }
  if (hasMissingFacts(claim)) reasons.push('案件存在旧数据缺少职责记录，须先补录职责事实后才能继续会签。')

  return { eligible: reasons.length === 0, reasons, currentDuty: snapshotDuty(ledger, personId, dutyId, at) }
}

/** 报价提交资格：当前承担一个具备报价权限的职责。 */
export function evaluateQuoteSubmitter(ledger: RoleLedger, personId: string): Eligibility {
  const person = getPerson(ledger, personId)
  if (!person) return { eligible: false, reasons: ['人员不在角色权限台账中。'] }
  const quoteDuty = currentDutiesOf(ledger, personId).find((duty) => duty.canQuote)
  if (!quoteDuty) return { eligible: false, reasons: [`${person.name} 当前没有可提交报价的职责。`] }
  return { eligible: true, reasons: [], currentDuty: snapshotDuty(ledger, personId, quoteDuty.id) }
}

/**
 * 职责变化后，对仍未完成的会签立即重算：
 * - 已签过的步骤保留当时依据，不回滚、不改写；
 * - 待处理步骤按当前台账给出新的处理指引（谁能签 / 为何被拦）。
 */
export function recalcPendingApprovals(ledger: RoleLedger, claim: ClaimCase, at: string = nowText()) {
  for (const step of claim.approvals) {
    if (step.status !== '待处理') continue
    const holders = currentAssignees(ledger, step.dutyId)
    if (holders.length === 0) {
      step.recalcNote = `台账 v${ledger.version} 重算：职责「${step.role}」暂无在岗责任人，等待任命。`
      continue
    }
    step.role = getDuty(ledger, step.dutyId)?.name ?? step.role
    const eligibleHolders = holders.filter((holder) => evaluateApprover(ledger, claim, holder.id, step.dutyId, at).eligible)
    if (eligibleHolders.length > 0) {
      step.recalcNote = `台账 v${ledger.version} 重算：当前可由 ${eligibleHolders.map((person) => person.name).join('、')} 依据现行职责处理。`
    } else {
      const blocked = evaluateApprover(ledger, claim, holders[0].id, step.dutyId, at)
      step.recalcNote = `台账 v${ledger.version} 重算：在岗责任人 ${holders.map((person) => person.name).join('、')} 暂不可签——${blocked.reasons.join('；')}`
    }
  }
}

/**
 * 旧数据升级：历史报价/已签会签缺少职责记录的，标记为待补录；
 * 不猜测、不自动放行。补录前案件 factsIncomplete=true。
 */
export function migrateClaim(raw: ClaimCase): ClaimCase {
  if ((raw.schemaVersion ?? 1) >= 2) return raw
  const claim = structuredClone(raw)
  for (const item of claim.lossItems) {
    for (const quote of item.repairQuotes) {
      if (!quote.basis) quote.dutyMissing = true
    }
  }
  for (const step of claim.approvals) {
    if (step.status !== '待处理' && !step.basis) step.basisMissing = true
  }
  if (!claim.submitBasis) {
    // 提交时职责缺失：会签链的起点依据同样待补录
    const submitStep = claim.approvals.find((step) => step.dutyId === 'DUTY-SURVEYOR' || step.role.includes('查勘员'))
    if (submitStep && submitStep.status !== '待处理' && !submitStep.basis) submitStep.basisMissing = true
  }
  claim.factsIncomplete = hasMissingFacts(claim)
  claim.schemaVersion = 2
  return claim
}

/** 终端顺序洗牌后，第一个获取处理权的请求生效（模拟两终端同档竞争的真实到达顺序）。 */
export function shuffleOrder<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
