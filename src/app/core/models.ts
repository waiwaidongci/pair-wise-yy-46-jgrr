export type ClaimStatus = '查勘中' | '待复核' | '退回补件' | '审批中' | '待支付' | '已结案'

/** 职责快照：任何写入动作发生时，把当时的职责依据冻结下来，职责台账随后变化也不影响。 */
export type DutySnapshot = {
  personId: string
  personName: string
  dutyId: string
  dutyName: string
  ledgerVersion: number
  capturedAt: string
}

export type Attachment = {
  id: string
  name: string
  category: '现场照片' | '修复报告' | '专家意见' | '保单摘录'
  version: number
  uploadedBy: string
  uploadedAt: string
}

export type RepairQuote = {
  version: number
  amount: number
  reason: string
  /** 历史字段，仅作展示；授权判断一律使用 basis。 */
  operator: string
  createdAt: string
  /**
   * 提交报价时冻结的授权事实（操作者 + 当时职责）。
   * 旧数据升级时缺失，dutyMissing 置真，等待补录，期间不能作为会签依据。
   */
  basis?: DutySnapshot
  dutyMissing?: boolean
  backfilled?: boolean
  /** 幂等请求号（写入恢复用）。 */
  requestId?: string
}

export type LossItem = {
  id: string
  category: string
  description: string
  damage: string
  repairQuotes: RepairQuote[]
  salvage: number
  liability: number
  disputed: boolean
  attachments: Attachment[]
  expertNotes: string[]
}

/** 会签依据：该步骤签署时所基于的事实集合（报价版本、提交人、当时台账版本）。 */
export type SignBasis = {
  ledgerVersion: number
  reserve: number
  quoteRefs: Array<{ itemId: string; itemCategory: string; quoteVersion: number; quoteAmount: number; submittedBy: string }>
  submittedBy: string[]
  capturedAt: string
}

export type ApprovalStep = {
  /** 会签级别（职责）标识，授权判断不再依赖 role 名称字符串。 */
  dutyId: string
  /** 展示用名称，取自当时台账；职责改名不影响在途步骤。 */
  role: string
  threshold: number
  status: '待处理' | '已通过' | '已退回'
  operator?: string
  comment?: string
  completedAt?: string
  /** 已签署步骤冻结的签署人职责依据；职责变化后历史签署照样保留。 */
  basis?: DutySnapshot
  /** 已签署步骤冻结的事实依据（引用了哪些报价版本）。 */
  signBasis?: SignBasis
  /** 旧数据升级时缺少职责记录，待补录。 */
  basisMissing?: boolean
  backfilled?: boolean
  /** 最近一次职责变化重算的说明。 */
  recalcNote?: string
  /** 幂等请求号。 */
  requestId?: string
}

export type AuditEvent = {
  id: string
  at: string
  operator: string
  action: string
  detail: string
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
  riskLevel: '低' | '中' | '高'
  reserve: number
  paid: number
  deductible: number
  lossItems: LossItem[]
  approvals: ApprovalStep[]
  audit: AuditEvent[]
  /** 提交准备金会签时冻结的职责与台账版本。 */
  submitBasis?: DutySnapshot
  ledgerVersionAtSubmit?: number
  /** 旧数据升级标记：是否存在缺少职责记录、等待补录的事实。 */
  factsIncomplete?: boolean
  schemaVersion?: number
}

/** 职责定义（角色权限台账中的角色条目）。 */
export type DutyDef = {
  id: string
  name: string
  threshold: number
  /** 是否可以提交/调整报价。 */
  canQuote: boolean
  /** 是否可以参与准备金会签。 */
  canApprove: boolean
  description: string
}

/** 职责任命记录：台账是只增的授予/撤销事件流，同一职责可多人同时在岗。 */
export type DutyAssignment = {
  id: string
  dutyId: string
  personId: string
  type: 'grant' | 'revoke'
  assignedAt: string
  reason: string
  ledgerVersion: number
}

export type Person = {
  id: string
  name: string
  title: string
}

export type RoleLedger = {
  version: number
  duties: DutyDef[]
  persons: Person[]
  assignments: DutyAssignment[]
}

/** 授权检查结论。 */
export type Eligibility = {
  eligible: boolean
  reasons: string[]
  currentDuty?: DutySnapshot
}

/** 写接口统一返回体。 */
export type MutationResult<T = ClaimCase> = {
  claim: T
  replayed?: boolean
  requestId: string
  conflict?: boolean
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
