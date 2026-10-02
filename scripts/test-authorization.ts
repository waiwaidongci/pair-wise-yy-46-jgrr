/* 授权事实链路逻辑测试（临时文件，构建后删除） */
import { strict as assert } from 'node:assert'
import { seedLedger } from '../src/app/core/ledger'
import { seedClaims } from '../src/app/core/seed'
import {
  currentAssignee,
  currentDutiesOf,
  effectiveQuotes,
  evaluateApprover,
  evaluateQuoteSubmitter,
  migrateClaim,
  recalcPendingApprovals,
  snapshotDuty,
} from '../src/app/core/authorization'
import type { ClaimCase, RoleLedger } from '../src/app/core/models'

let passed = 0
const ok = (name: string) => {
  passed += 1
  console.log(`  ✓ ${name}`)
}

const ledger: RoleLedger = structuredClone(seedLedger)

// 1. 台账当前任命：周岩已不再是高级核赔员，韩青接任
assert.equal(currentAssignee(ledger, 'DUTY-SR-ADJUSTER')?.id, 'P-HANQING')
assert.deepEqual(currentDutiesOf(ledger, 'P-ZHOUYAN').map((d) => d.id), ['DUTY-EXPERT'])
ok('换岗后当前职责按最后一条任命解析（周岩只剩专家职责）')

// 2. 旧数据迁移：种子报价与查勘员签署缺职责记录 → 待补录
const claim = migrateClaim(structuredClone(seedClaims)[0])
assert.equal(claim.schemaVersion, 2)
assert.equal(claim.factsIncomplete, true)
assert.ok(claim.lossItems.every((i) => i.repairQuotes.some((q) => q.dutyMissing)))
assert.ok(claim.approvals.find((s) => s.dutyId === 'DUTY-SURVEYOR')?.basisMissing)
ok('旧数据升级：缺职责记录标记 dutyMissing/basisMissing 且 factsIncomplete=true')

// 3. 迁移幂等
assert.equal(migrateClaim(claim), claim)
ok('迁移对 schemaVersion>=2 幂等')

// 4. 事实未补录前，任何人都会被拦
const blocked = evaluateApprover(ledger, claim, 'P-HANQING', 'DUTY-SR-ADJUSTER')
assert.equal(blocked.eligible, false)
assert.ok(blocked.reasons.some((r) => r.includes('补录')))
ok('职责记录缺失期间会签被拦截，不自动放行')

// 构造一条职责链闭合的案件（补录全部历史事实）
function closedClaim(): ClaimCase {
  const c = migrateClaim(structuredClone(seedClaims)[0])
  c.lossItems.forEach((item) => {
    item.repairQuotes.forEach((q) => {
      const dutyId = item.category === '机器设备' ? 'DUTY-EXPERT' : q.operator.includes('陈立') ? 'DUTY-ADJUSTER' : 'DUTY-SURVEYOR'
      const personId = q.operator.includes('陈立') ? 'P-CHENLI' : q.operator.includes('周岩') ? 'P-ZHOUYAN' : 'P-LUJIA'
      q.basis = snapshotDuty(ledger, personId, dutyId)!
      q.dutyMissing = false
      q.backfilled = true
    })
  })
  const submit = c.approvals.find((s) => s.dutyId === 'DUTY-SURVEYOR')!
  submit.basis = snapshotDuty(ledger, 'P-LUJIA', 'DUTY-SURVEYOR')!
  submit.basisMissing = false
  c.factsIncomplete = false
  return c
}

const c2 = closedClaim()
assert.equal(effectiveQuotes(c2).length, c2.lossItems.reduce((n, i) => n + i.repairQuotes.length, 0))
ok('补录后报价全部成为有效授权事实')

// 5. 报价与审批同岗：周岩是专家（经手设备报价），即便台账还把高级核赔给他，也不能签
const ledgerOld: RoleLedger = structuredClone(seedLedger)
ledgerOld.version = 1
ledgerOld.assignments = ledgerOld.assignments.filter((a) => !['ASG-08', 'ASG-09'].includes(a.id)) // 回到换岗前
const c3 = closedClaim()
const zhouYanOld = evaluateApprover(ledgerOld, c3, 'P-ZHOUYAN', 'DUTY-SR-ADJUSTER')
assert.equal(zhouYanOld.eligible, false)
assert.ok(zhouYanOld.reasons.some((r) => r.includes('职责冲突')), zhouYanOld.reasons.join('|'))
ok('报价/审批同岗被职责冲突规则拦截（周岩经手设备报价 → 不能会签）')

// 6. 韩青未经过报价、当前是高级核赔员 → 可签
const hanqing = evaluateApprover(ledger, c2, 'P-HANQING', 'DUTY-SR-ADJUSTER')
assert.equal(hanqing.eligible, true, hanqing.reasons.join('|'))
ok('未经手报价的当前责任人可以处理（韩青可签高级核赔档）')

// 7. 换岗后旧身份被拦
const zhouYanNow = evaluateApprover(ledger, c2, 'P-ZHOUYAN', 'DUTY-SR-ADJUSTER')
assert.equal(zhouYanNow.eligible, false)
assert.ok(zhouYanNow.reasons.some((r) => r.includes('已不具备该职责')))
ok('换岗后旧签署身份不再放行（按当前职责授权）')

// 8. 无报价职责的审批人不能提交报价
assert.equal(evaluateQuoteSubmitter(ledger, 'P-HANQING').eligible, false)
assert.equal(evaluateQuoteSubmitter(ledger, 'P-LUJIA').eligible, true)
ok('报价权限同样取自当前职责台账')

// 9. 职责变化重算：已签保留，待处理更新指引；模拟韩青再被换掉
const c4 = closedClaim()
// 先让韩青签掉高级核赔档
const stepSr = c4.approvals.find((s) => s.dutyId === 'DUTY-SR-ADJUSTER')!
stepSr.status = '已通过'
stepSr.operator = '韩青'
stepSr.basis = snapshotDuty(ledger, 'P-HANQING', 'DUTY-SR-ADJUSTER')!
const basisBefore = structuredClone(stepSr.basis)
const ledgerV8: RoleLedger = structuredClone(ledger)
ledgerV8.version = 8
ledgerV8.assignments.push(
  { id: 'ASG-10', dutyId: 'DUTY-SR-ADJUSTER', personId: 'P-HANQING', type: 'revoke', assignedAt: '2026-10-02 09:00', reason: '韩青临时借调', ledgerVersion: 8 },
  { id: 'ASG-11', dutyId: 'DUTY-SR-ADJUSTER', personId: 'P-WEIMIN', type: 'grant', assignedAt: '2026-10-02 09:00', reason: '韩青临时借调', ledgerVersion: 8 },
)
recalcPendingApprovals(ledgerV8, c4)
assert.deepEqual(stepSr.basis, basisBefore)
assert.equal(stepSr.status, '已通过')
const mgrStep = c4.approvals.find((s) => s.dutyId === 'DUTY-CLAIMS-MGR')!
assert.ok(mgrStep.recalcNote?.includes('v8'))
ok('职责变化：已签步骤保留当时依据，未完成步骤立即重算并标注新台账版本')

// 10. 重算后魏敏是高级核赔员（档位已签不动），其若同时经手过报价则会被标不可签
assert.equal(currentAssignee(ledgerV8, 'DUTY-SR-ADJUSTER')?.id, 'P-WEIMIN')
ok('台账 v8 当前责任人解析为魏敏')

console.log(`\n全部 ${passed} 项断言通过。`)
