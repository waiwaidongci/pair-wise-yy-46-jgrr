import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { retry, timer } from 'rxjs'
import { map } from 'rxjs/operators'
import type { Observable } from 'rxjs'
import type { ClaimCase, ClaimFilters, PagedClaims, RoleLedgerEntry } from './models'

export type WriteResult<T> = { body: T; replayed: boolean }

const newRequestNo = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  getLedger() {
    return this.http.get<RoleLedgerEntry[]>('/api/ledger')
  }

  /** 角色权限台账变更（调岗）；服务端会立即重算未完成会签 */
  rotateDuties() {
    return this.http.post<{ ledger: RoleLedgerEntry[] }>('/api/ledger/rotate', {})
  }

  /**
   * 写入恢复：每次写入携带请求号（requestNo）。
   * 网络错误或 5xx 时按同一请求号重试——服务端对已处理请求号幂等回放，
   * 因此「先到的结果」不会被重复应用，失败后可安全恢复。
   */
  private postWithRecovery<T>(url: string, body: Record<string, unknown>): Observable<WriteResult<T>> {
    const requestNo = (body['requestNo'] as string | undefined) ?? newRequestNo()
    return this.http
      .post<T>(url, { ...body, requestNo }, { observe: 'response' })
      .pipe(
        retry({
          count: 3,
          delay: (error, retryCount) => {
            // 仅对网络错误 / 5xx 重试；409（先到生效）、403（无权）不重试
            if (error instanceof HttpErrorResponse && (error.status === 0 || (error.status >= 500 && error.status < 600))) {
              return timer(350 * retryCount)
            }
            throw error
          },
        }),
        map((response: HttpResponse<T>) => ({
          body: response.body as T,
          replayed: response.headers.get('X-Idempotent-Replay') === 'true',
        })),
      )
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.postWithRecovery<ClaimCase>(`/api/claims/${claimId}/quotes`, body)
  }

  /** 审批须携带客户端见到的档位版本号（claim.version），先到提交生效 */
  approve(claimId: string, body: { role: string; result: string; comment: string; version: number }) {
    return this.postWithRecovery<ClaimCase>(`/api/claims/${claimId}/approvals`, body)
  }
}
