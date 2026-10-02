import type { Person, RoleLedger } from './models'

/**
 * 角色权限台账（授权事实来源）。
 * - 职责定义：报价/会签权限与阈值挂在职责上，而不是显示名称。
 * - 任命是只增的授予(grant)/撤销(revoke)事件流；同一职责可多人同时在岗，
 *   当前在岗 = 已授予且未被撤销。换岗 = 撤销旧人 + 授予新人（两条事件）。
 * - 每次任命变化 version + 1，报价与会签记录冻结当时的版本号作为依据。
 */
export const seedLedger: RoleLedger = {
  version: 7,
  duties: [
    { id: 'DUTY-SURVEYOR', name: '查勘员', threshold: 0, canQuote: true, canApprove: false, description: '现场查勘、报价录入、提交准备金会签' },
    { id: 'DUTY-ADJUSTER', name: '公估核价', threshold: 0, canQuote: true, canApprove: false, description: '公估报价与修复价格核定' },
    { id: 'DUTY-EXPERT', name: '设备/结构专家', threshold: 0, canQuote: true, canApprove: false, description: '专家报价与技术意见' },
    { id: 'DUTY-SR-ADJUSTER', name: '高级核赔员', threshold: 500000, canQuote: false, canApprove: true, description: '50 万以上准备金第一级会签' },
    { id: 'DUTY-CLAIMS-MGR', name: '理赔经理', threshold: 1000000, canQuote: false, canApprove: true, description: '100 万以上准备金会签' },
    { id: 'DUTY-REGION-HEAD', name: '区域负责人', threshold: 1500000, canQuote: false, canApprove: true, description: '150 万以上准备金最终会签' },
  ],
  persons: [
    { id: 'P-LUJIA', name: '陆嘉', title: '华东财产险' },
    { id: 'P-LINCHE', name: '林澈', title: '浙江财产险' },
    { id: 'P-CHENLI', name: '陈立', title: '第三方公估' },
    { id: 'P-ZHOUYAN', name: '周岩', title: '设备专家 / 前高级核赔员' },
    { id: 'P-HANQING', name: '韩青', title: '总公司核赔' },
    { id: 'P-WEIMIN', name: '魏敏', title: '理赔管理部' },
    { id: 'P-FANGLEI', name: '方磊', title: '华东大区' },
  ] satisfies Person[],
  assignments: [
    { id: 'ASG-01', dutyId: 'DUTY-SURVEYOR', personId: 'P-LUJIA', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '岗位任命', ledgerVersion: 1 },
    { id: 'ASG-02', dutyId: 'DUTY-SURVEYOR', personId: 'P-LINCHE', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '岗位任命', ledgerVersion: 1 },
    { id: 'ASG-03', dutyId: 'DUTY-ADJUSTER', personId: 'P-CHENLI', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '公估合作签约', ledgerVersion: 1 },
    { id: 'ASG-04', dutyId: 'DUTY-SR-ADJUSTER', personId: 'P-ZHOUYAN', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '岗位任命', ledgerVersion: 1 },
    { id: 'ASG-05', dutyId: 'DUTY-EXPERT', personId: 'P-ZHOUYAN', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '兼任设备专家', ledgerVersion: 1 },
    { id: 'ASG-06', dutyId: 'DUTY-CLAIMS-MGR', personId: 'P-WEIMIN', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '岗位任命', ledgerVersion: 1 },
    { id: 'ASG-07', dutyId: 'DUTY-REGION-HEAD', personId: 'P-FANGLEI', type: 'grant', assignedAt: '2026-06-01 09:00', reason: '岗位任命', ledgerVersion: 1 },
    // 换岗事件（v7）：周岩自 10-01 起不再担任高级核赔员——撤销其授予，同时授予韩青；专家职责保留。
    { id: 'ASG-08', dutyId: 'DUTY-SR-ADJUSTER', personId: 'P-ZHOUYAN', type: 'revoke', assignedAt: '2026-10-01 08:30', reason: '周岩转任专家岗，撤销高级核赔职责', ledgerVersion: 7 },
    { id: 'ASG-09', dutyId: 'DUTY-SR-ADJUSTER', personId: 'P-HANQING', type: 'grant', assignedAt: '2026-10-01 08:30', reason: '高级核赔职责移交韩青', ledgerVersion: 7 },
  ],
}
