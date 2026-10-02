import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { Observable } from 'rxjs'
import { ClaimsService, newRequestId } from '../core/claims.service'
import { LedgerService } from '../core/ledger.service'
import { SessionService } from '../core/session.service'
import { evaluateQuoteSubmitter } from '../core/authorization'
import type { ClaimCase, Eligibility, RoleLedger } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-assessment-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">ASSESSMENT / 查勘定损</p>
          <h1>{{ claim.id }} · {{ claim.insured }}</h1>
          <p class="muted">{{ claim.lossAddress }} · 事故日 {{ claim.accidentDate }} · 查勘员 {{ claim.adjuster }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button><mat-icon>upload_file</mat-icon> 上传查勘材料</button>
          <button mat-flat-button color="primary" (click)="saveAll(claim)">保存本次查勘</button>
        </div>
      </div>

      <div class="auth-banner" *ngIf="submitEligibility as auth">
        <mat-icon>{{ auth.eligible ? 'verified_user' : 'gpp_bad' }}</mat-icon>
        <div>
          <strong>{{ auth.eligible ? '可提交报价版本' : '当前操作者不能提交报价' }}</strong>
          <p>{{ auth.eligible ? ('将以「' + auth.currentDuty!.dutyName + '」职责写入，并冻结台账 v' + auth.currentDuty!.ledgerVersion + ' 作为授权依据。') : auth.reasons.join('；') }}</p>
        </div>
      </div>

      <div class="summary-grid">
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ claim.lossItems.length }}</strong><small>{{ disputedCount(claim) }} 项存在争议</small></mat-card>
        <mat-card appearance="outlined"><span>修复报价合计</span><strong>{{ quoteTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>取各科目最新有效报价</small></mat-card>
        <mat-card appearance="outlined"><span>残值合计</span><strong>{{ salvageTotal(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>待扣减</small></mat-card>
        <mat-card appearance="outlined"><span>建议准备金</span><strong>{{ suggestedReserve(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>责任比例后计入免赔</small></mat-card>
      </div>

      <div class="assessment-grid">
        <section class="panel">
          <div class="panel-head"><h3>损失科目与报价版本</h3><span class="muted">每次调整冻结操作者与当时职责</span></div>
          <mat-accordion multi>
            <mat-expansion-panel *ngFor="let item of claim.lossItems; let itemIndex = index" [expanded]="itemIndex === activeIndex" (opened)="activeIndex = itemIndex">
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <strong>{{ item.category }}</strong>
                  <span>{{ item.description }}</span>
                </mat-panel-title>
                <mat-panel-description>
                  <app-status-chip [label]="item.disputed ? '争议项' : '已确认'" [tone]="item.disputed ? 'warn' : 'good'" />
                  <span class="quote">{{ latestQuote(item) | currency:'CNY':'symbol':'1.0-0' }}</span>
                </mat-panel-description>
              </mat-expansion-panel-header>
              <div class="loss-body">
                <div class="facts">
                  <label>损失事实</label>
                  <textarea [(ngModel)]="item.damage" rows="3"></textarea>
                  <div class="inline-fields">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>残值</mat-label><input matInput type="number" [(ngModel)]="item.salvage" /></mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>责任比例</mat-label><input matInput type="number" step="0.05" [(ngModel)]="item.liability" /></mat-form-field>
                  </div>
                </div>
                <div class="quote-history">
                  <h4>报价版本与授权依据</h4>
                  <table mat-table [dataSource]="item.repairQuotes">
                    <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let quote">V{{ quote.version }}</td></ng-container>
                    <ng-container matColumnDef="amount"><th mat-header-cell *matHeaderCellDef>金额</th><td mat-cell *matCellDef="let quote">{{ quote.amount | currency:'CNY':'symbol':'1.0-0' }}</td></ng-container>
                    <ng-container matColumnDef="reason">
                      <th mat-header-cell *matHeaderCellDef>理由 / 授权依据</th>
                      <td mat-cell *matCellDef="let quote">
                        {{ quote.reason }}
                        <small *ngIf="quote.basis && !quote.dutyMissing">
                          {{ quote.basis.personName }} / {{ quote.basis.dutyName }} · 台账 v{{ quote.basis.ledgerVersion }} · {{ quote.createdAt }}
                          <em *ngIf="quote.backfilled">（旧数据补录）</em>
                        </small>
                        <small class="missing" *ngIf="quote.dutyMissing">
                          <mat-icon>warning</mat-icon>{{ quote.operator }} · {{ quote.createdAt }} · 旧数据缺少职责记录，待补录后才能作为会签依据
                        </small>
                      </td>
                    </ng-container>
                    <tr mat-header-row *matHeaderRowDef="quoteColumns"></tr>
                    <tr mat-row *matHeaderRowDef="let row; columns: quoteColumns"></tr>
                  </table>
                </div>
                <div class="attachment-row">
                  <strong>关联材料</strong>
                  <span *ngFor="let file of item.attachments"><mat-icon>attach_file</mat-icon>{{ file.name }} · V{{ file.version }}</span>
                </div>
                <button mat-stroked-button color="primary" (click)="startQuote(item)"><mat-icon>edit_road</mat-icon> 调整最新报价</button>
                <div class="quote-form" *ngIf="quotingItemId === item.id">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>新报价</mat-label><input matInput type="number" [(ngModel)]="quoteAmount" /></mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason-field"><mat-label>调整理由（必填）</mat-label><input matInput [(ngModel)]="quoteReason" /></mat-form-field>
                  <label class="fault-toggle"><input type="checkbox" [(ngModel)]="injectFailure" /> 模拟写入失败（重试时按请求号恢复）</label>
                  <div class="form-actions">
                    <button mat-flat-button color="primary" [disabled]="!canSubmit()" (click)="submitQuote(claim.id, item.id, false)">
                      生成新版本
                    </button>
                    <button mat-stroked-button color="accent" [disabled]="!canSubmit()" (click)="submitQuote(claim.id, item.id, true)">
                      <mat-icon>devices</mat-icon> 两终端同时提交
                    </button>
                  </div>
                  <small class="reqno" *ngIf="lastRequestId">请求号 {{ lastRequestId }}</small>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>专家记录</h3><span class="muted">不可覆盖</span></div>
            <div class="expert-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <p *ngFor="let note of item.expertNotes">{{ note }}</p>
                <small *ngIf="item.expertNotes.length === 0">暂无专家补充说明</small>
              </div>
            </div>
          </section>
          <section class="panel draft-panel">
            <div class="panel-head"><h3>查勘草稿</h3><mat-icon>cloud_done</mat-icon></div>
            <textarea rows="7" [(ngModel)]="draft" (blur)="saveDraft(claim)"></textarea>
            <small>离开页面后仍可恢复到本地草稿。</small>
          </section>
        </aside>
      </div>
    </section>
  `,
  styles: [`
    .auth-banner { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; padding: 12px 14px; border-left: 3px solid #2f8191; border-radius: 6px; background: #eaf4f5; color: #175866; }
    .auth-banner mat-icon { margin-top: 1px; }
    .auth-banner p { margin: 3px 0 0; font-size: 12px; color: #42696f; }
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .assessment-grid { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 14px; align-items: start; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .quote { color: #1d6670; font-weight: 800; }
    .loss-body { display: grid; gap: 16px; padding-top: 10px; }
    .facts > label { display: block; margin-bottom: 6px; color: #53636d; font-size: 12px; font-weight: 700; }
    textarea { width: 100%; padding: 10px; border: 1px solid #cbd5da; border-radius: 8px; resize: vertical; font: inherit; }
    .inline-fields, .quote-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .inline-fields mat-form-field { width: 150px; }
    .quote-history h4 { margin: 0 0 8px; font-size: 13px; }
    table { width: 100%; }
    td small { display: block; margin-top: 4px; color: #7a858c; }
    td small em { color: #8a6d2f; font-style: normal; }
    td small.missing { color: #a3511f; }
    td small.missing mat-icon { width: 14px; height: 14px; font-size: 14px; vertical-align: -2px; }
    .attachment-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .attachment-row span { display: inline-flex; align-items: center; gap: 3px; padding: 5px 7px; color: #4f626d; background: #f0f4f5; border-radius: 5px; font-size: 11px; }
    .quote-form { padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .reason-field { flex: 1; min-width: 220px; }
    .fault-toggle { display: inline-flex; align-items: center; gap: 5px; color: #7a5218; font-size: 11px; }
    .form-actions { display: flex; gap: 8px; }
    .reqno { color: #5a7079; font-family: monospace; }
    aside { display: grid; gap: 14px; }
    .expert-list { padding: 8px 16px 16px; }
    .expert-list div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .expert-list p { margin: 6px 0 0; color: #65737c; font-size: 11px; line-height: 1.5; }
    .draft-panel { padding-bottom: 14px; }
    .draft-panel textarea { width: calc(100% - 28px); margin: 14px; }
    .draft-panel small { display: block; margin: -6px 14px 0; color: #7d8991; }
    @media (max-width: 1050px) { .assessment-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class AssessmentPageComponent {
  claim$: Observable<ClaimCase>
  ledger$: Observable<RoleLedger>
  quoteColumns = ['version', 'amount', 'reason']
  activeIndex = 0
  quotingItemId = ''
  quoteAmount = 0
  quoteReason = ''
  injectFailure = false
  lastRequestId = ''
  submitEligibility: Eligibility | null = null
  draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据，并核对存货库龄核减。'

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly ledgerStore: LedgerService,
    readonly session: SessionService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
    this.ledger$ = this.ledgerStore.ledger$
    this.ledgerStore.ledger$.subscribe((ledger) => {
      this.submitEligibility = evaluateQuoteSubmitter(ledger, this.session.personId)
    })
    this.session.personId$.subscribe((personId) => {
      this.submitEligibility = evaluateQuoteSubmitter(this.ledgerStore.ledger, personId)
    })
    this.store.select((state) => state.claims.draft).subscribe((draft) => (this.draft = draft))
  }

  latestQuote(item: { repairQuotes: Array<{ amount: number; basis?: unknown; dutyMissing?: boolean }> }) {
    const valid = [...item.repairQuotes].reverse().find((quote) => quote.basis && !quote.dutyMissing)
    return valid?.amount ?? item.repairQuotes.at(-1)?.amount ?? 0
  }

  quoteTotal(claim: { lossItems: Array<{ repairQuotes: Array<{ amount: number; basis?: unknown; dutyMissing?: boolean }> }> }) {
    return claim.lossItems.reduce((sum, item) => sum + this.latestQuote(item), 0)
  }

  salvageTotal(claim: { lossItems: Array<{ salvage: number }> }) {
    return claim.lossItems.reduce((sum, item) => sum + item.salvage, 0)
  }

  suggestedReserve(claim: any) {
    const net = claim.lossItems.reduce((sum: number, item: any) => sum + (this.latestQuote(item) - item.salvage) * item.liability, 0)
    return Math.max(0, net - claim.deductible)
  }

  disputedCount(claim: { lossItems: Array<{ disputed: boolean }> }) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  canSubmit() {
    return this.quoteReason.trim() && this.quoteAmount > 0 && this.submitEligibility?.eligible
  }

  startQuote(item: any) {
    this.quotingItemId = item.id
    this.quoteAmount = this.latestQuote(item)
    this.quoteReason = ''
    this.injectFailure = false
    this.lastRequestId = ''
  }

  private applyResult(result: { claim: ClaimCase; replayed?: boolean }) {
    this.store.dispatch(updateClaim({ claim: structuredClone(result.claim) }))
    return result.replayed
  }

  outcomeText(outcome: 'win' | 'conflict' | 'fail') {
    return outcome === 'win' ? '先生效' : outcome === 'conflict' ? '被拒（先到已生效）' : '失败'
  }

  submitQuote(claimId: string, itemId: string, concurrent: boolean) {
    if (!this.canSubmit()) return
    // 两终端"同一档位"：两个请求号绑定同一报价位；一个请求带故障验证按请求号恢复
    const requestA = newRequestId('Q')
    const payload = {
      itemId,
      amount: Number(this.quoteAmount),
      reason: this.quoteReason,
      personId: this.session.personId,
    }

    if (concurrent) {
      const requestB = newRequestId('Q')
      this.lastRequestId = `${requestA} / ${requestB}`
      // 结果按请求号归位；服务端在途锁保证先到者唯一生效，后来者收到 409
      const outcomes: { A: 'win' | 'conflict' | 'fail'; B: 'win' | 'conflict' | 'fail' } = { A: 'fail', B: 'fail' }
      const finish = (label: 'A' | 'B') => {
        if (outcomes.A !== 'fail' && outcomes.B !== 'fail') {
          const winner = outcomes.A === 'win' ? 'A' : outcomes.B === 'win' ? 'B' : '无'
          this.snackBar.open(
            `两终端同时提交完成：终端 ${winner === '无' ? '均未成功' : winner} 先到，报价版本生效` +
              `（A：${this.outcomeText(outcomes.A)}；B：${this.outcomeText(outcomes.B)}）`,
            '关闭',
            { duration: 3200 },
          )
        }
      }
      const call = (label: 'A' | 'B', requestId: string, attempt: number) => {
        this.service
          .addQuote(claimId, { ...payload, requestId, injectFailure: attempt === 1 && label === 'A' && this.injectFailure })
          .subscribe({
            next: (res) => {
              this.applyResult(res)
              outcomes[label] = res.replayed ? 'conflict' : 'win'
              finish(label)
            },
            error: (err) => {
              if (err?.status === 409) {
                outcomes[label] = 'conflict'
                finish(label)
              } else if (err?.status === 503) {
                setTimeout(() => call(label, requestId, attempt + 1), 1200)
              } else {
                this.snackBar.open(err?.error?.message ?? `终端 ${label} 处理失败`, '关闭', { duration: 2200 })
                finish(label)
              }
            },
          })
      }
      // 洗牌决定真实到达顺序
      if (Math.random() > 0.5) {
        call('A', requestA, 1)
        call('B', requestB, 1)
      } else {
        call('B', requestB, 1)
        call('A', requestA, 1)
      }
      this.quotingItemId = ''
      return
    }

    this.lastRequestId = requestA
    this.service.addQuote(claimId, { ...payload, requestId: requestA, injectFailure: this.injectFailure }).subscribe({
      next: (res) => {
        const replayed = this.applyResult(res)
        this.snackBar.open(replayed ? '按请求号回放成功，未产生重复版本' : '新报价版本已生成，原记录保持可追溯', '关闭', { duration: 2200 })
        this.quotingItemId = ''
      },
      error: (err) => this.handleQuoteError(err, claimId, () => this.submitQuoteRetry(claimId, requestA, payload), undefined),
    })
  }

  private submitQuoteRetry(claimId: string, requestId: string, payload: { itemId: string; amount: number; reason: string; personId: string }) {
    this.service.addQuote(claimId, { ...payload, requestId, injectFailure: false }).subscribe({
      next: (res) => {
        this.applyResult(res)
        this.snackBar.open(res.replayed ? '按请求号恢复成功，未产生重复版本' : '重试成功，新版本已生成', '关闭', { duration: 2400 })
        this.quotingItemId = ''
      },
      error: (err) => this.snackBar.open(err?.error?.message ?? '写入失败', '关闭', { duration: 2600 }),
    })
  }

  private handleQuoteError(err: any, _claimId: string, retry: () => void, terminal?: string) {
    const status = err?.status
    if (status === 409) {
      this.snackBar.open(`${terminal ? `终端 ${terminal}：` : ''}该报价位已有在途请求，先到结果生效，本请求拒绝`, '关闭', { duration: 2400 })
      this.quotingItemId = ''
    } else if (status === 403) {
      this.snackBar.open(err?.error?.message ?? '无报价权限', '关闭', { duration: 2600 })
    } else if (status === 503) {
      this.snackBar.open(`写入失败，3 秒后凭请求号 ${this.lastRequestId} 自动重试恢复…`, '关闭', { duration: 2600 })
      setTimeout(retry, 3000)
    } else {
      this.snackBar.open(err?.error?.message ?? '请求失败', '关闭', { duration: 2200 })
    }
  }

  saveAll(claim: any) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
    this.snackBar.open('查勘数据和草稿已保存', '关闭', { duration: 1800 })
  }

  saveDraft(claim: any) {
    localStorage.setItem('claims-assessment-draft', this.draft)
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
  }
}
