export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

/** 记录完整度：旧数据升级时缺少职责依据的记录标记为「待补录」 */
export type RecordStatus = '完整' | '待补录'

/**
 * 角色权限台账：一条任命即一个授权事实。
 * until 为空表示当前仍在任；职责变化（调岗）即封存旧记录、新开记录。
 */
export type RoleLedgerEntry = {
  id: string
  operator: string
  role: string
  since: string
  until?: string
  basis: string
}

/** 职责快照：操作发生时刻本人在任的全部职责，随报价/会签记录封存，事后不随台账变化。 */
export type DutySnapshot = {
  operator: string
  roles: string[]
  at: string
}

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type QuoteVersion = {
  version: number
  amount: number
  reason: string
  operator: string
  /** 提交报价时操作者的在任职责（当时职责） */
  operatorDuties: string[]
  createdAt: string
  recordStatus: RecordStatus
  /** 写入请求号，失败后按请求号恢复，不重复生成版本 */
  requestNo?: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: QuoteVersion[]
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

export type ApprovalStep = {
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回'
  operator?: string
  /** 签署时操作者的在任职责（当时依据）；已签步骤保留封存，不随台账重算 */
  operatorDuties?: string[]
  comment?: string
  completedAt?: string
  recordStatus?: RecordStatus
  /** 以下为服务端按当前台账重算的授权事实（仅对待处理步骤） */
  eligible?: boolean
  blockedReason?: string
}

export type ClaimCase = {
  id: string
  policyNo: string
  insured: string
  lossAddress: string
  accidentDate: string
  reportedAt: string
  adjuster: string
  status: ClaimStatus
  /** 乐观并发版本：两个终端提交同一档位时先到结果生效，后到者 409 */
  version: number
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: Array<{ id: string; at: string; operator: string; action: string; detail: string }>
}

export type ClaimFilters = {
  query: string
  status: string
  risk: string
  page: number
  pageSize: number
}

export type PagedClaims = {
  items: ClaimCase[]
  total: number
  page: number
  pageSize: number
}
