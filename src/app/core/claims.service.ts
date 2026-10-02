import { HttpClient, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { Observable } from 'rxjs'
import type { ClaimCase, ClaimFilters, MutationResult, PagedClaims, RoleLedger } from './models'

let requestSeq = 0
/** 生成请求号：写入失败后凭同一请求号重试即恢复（幂等）。 */
export function newRequestId(prefix: string): string {
  requestSeq += 1
  return `REQ-${prefix}-${Date.now().toString(36).toUpperCase()}-${requestSeq}`
}

export type QuoteRequest = {
  itemId: string
  amount: number
  reason: string
  requestId: string
  personId: string
  injectFailure?: boolean
}

export type ApprovalRequest = {
  dutyId: string
  result: string
  comment: string
  requestId: string
  personId: string
  injectFailure?: boolean
}

export type BackfillRequest = {
  kind: 'quote' | 'approval'
  itemId?: string
  quoteVersion?: number
  stepDutyId?: string
  personId: string
  dutyId: string
  requestId: string
  injectFailure?: boolean
}

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters): Observable<PagedClaims> {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string): Observable<ClaimCase> {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  ledger(): Observable<RoleLedger> {
    return this.http.get<RoleLedger>('/api/ledger')
  }

  addQuote(claimId: string, body: QuoteRequest): Observable<MutationResult> {
    return this.http.post<MutationResult>(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: ApprovalRequest): Observable<MutationResult> {
    return this.http.post<MutationResult>(`/api/claims/${claimId}/approvals`, body)
  }

  backfill(claimId: string, body: BackfillRequest): Observable<MutationResult> {
    return this.http.post<MutationResult>(`/api/claims/${claimId}/backfill`, body)
  }

  reassignDuty(body: { dutyId: string; personId: string; reason: string }): Observable<{ ledger: RoleLedger; version: number; affectedClaimIds: string[] }> {
    return this.http.post<{ ledger: RoleLedger; version: number; affectedClaimIds: string[] }>('/api/ledger/reassign', body)
  }

  resetDemo(): Observable<{ reset: boolean }> {
    return this.http.post<{ reset: boolean }>('/api/admin/reset', {})
  }
}
