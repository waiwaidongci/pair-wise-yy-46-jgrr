import { Component } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import { combineLatest, Observable } from 'rxjs'
import { ClaimsService, newRequestId } from '../core/claims.service'
import { LedgerService } from '../core/ledger.service'
import { SessionService } from '../core/session.service'
import { currentAssignees, evaluateApprover, getDuty, getPerson, personHoldsDuty } from '../core/authorization'
import type { ApprovalStep, ClaimCase, Eligibility, Person, RoleLedger } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

type MissingQuote = { itemId: string; itemCategory: string; version: number; operator: string }

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatStepperModule,
    StatusChipComponent,
  ],
  template: `
    <ng-container *ngIf="vm$ | async as vm">
    <section class="page" *ngIf="vm.claim as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">授权依据 = 报价版本 + 会签记录 + 角色权限台账（当前台账 v{{ vm.ledger.version }}）；审批人按当前职责处理，且未经手该准备金下损失科目报价。</p>
        </div>
        <span class="reserve">申请准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="auth-banner" *ngIf="currentPerson as person">
        <mat-icon>account_circle</mat-icon>
        <div>
          <strong>当前审批终端：{{ person.name }} · {{ person.title }}</strong>
          <p>会签动作以该人员当前承担的职责授权；切换侧栏人员即模拟换岗后的新终端。</p>
        </div>
      </div>

      <div class="backfill-banner" *ngIf="claim.factsIncomplete">
        <mat-icon>rule_folder</mat-icon>
        <div>
          <strong>旧数据升级：存在缺少职责记录的事实，须先补录</strong>
          <p>以下报价/会签来自旧版本，未记录当时职责，系统不猜测、不放行；补录完成后授权事实链才闭合。</p>
          <div class="backfill-list">
            <div class="backfill-row" *ngFor="let m of missingQuotes(claim)">
              <span>{{ m.itemCategory }} · 报价 V{{ m.version }}（历史操作人 {{ m.operator }}）</span>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>补录当时人员</mat-label>
                <mat-select [value]="bfQuote(m.itemId, m.version).personId" (selectionChange)="bfQuote(m.itemId, m.version).personId = $event.value">
                  <mat-option *ngFor="let p of vm.ledger.persons" [value]="p.id">{{ p.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>当时职责</mat-label>
                <mat-select [value]="bfQuote(m.itemId, m.version).dutyId" (selectionChange)="bfQuote(m.itemId, m.version).dutyId = $event.value">
                  <mat-option *ngFor="let d of quoteDuties(vm.ledger)" [value]="d.id">{{ d.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button color="primary" (click)="backfillQuote(claim, m)">补录</button>
            </div>
            <div class="backfill-row" *ngFor="let step of missingSteps(claim)">
              <span>{{ step.role }} 已签记录（{{ step.operator }}）缺签署职责依据</span>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>补录当时人员</mat-label>
                <mat-select [value]="bfStep(step.dutyId).personId" (selectionChange)="bfStep(step.dutyId).personId = $event.value">
                  <mat-option *ngFor="let p of vm.ledger.persons" [value]="p.id">{{ p.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>当时职责</mat-label>
                <mat-select [value]="bfStep(step.dutyId).dutyId" (selectionChange)="bfStep(step.dutyId).dutyId = $event.value">
                  <mat-option *ngFor="let d of vm.ledger.duties" [value]="d.id">{{ d.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <button mat-stroked-button color="primary" (click)="backfillStep(claim, step)">补录</button>
            </div>
          </div>
        </div>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }} · 当前责任人：{{ holderName(vm.ledger, step) }}</span>
              </ng-template>
              <div class="step-body">
                <p>{{ step.comment || (step.status === '待处理' ? '等待当前审核人处理。' : step.status + '。') }}</p>

                <div class="basis signed" *ngIf="step.status !== '待处理' && step.basis">
                  <mat-icon>history</mat-icon>
                  <div>
                    <strong>历史签署依据（保留当时事实，职责变化不回滚）</strong>
                    <small>{{ step.basis.personName }} 以「{{ step.basis.dutyName }}」签署 · 台账 v{{ step.basis.ledgerVersion }} · {{ step.basis.capturedAt }}<em *ngIf="step.backfilled">（旧数据补录）</em></small>
                    <small *ngIf="step.signBasis as sb">
                      引用报价：<ng-container *ngFor="let ref of sb.quoteRefs">{{ ref.itemCategory }} V{{ ref.quoteVersion }}（{{ ref.submittedBy }}）；</ng-container>
                    </small>
                  </div>
                </div>
                <div class="basis signed missing" *ngIf="step.status !== '待处理' && step.basisMissing">
                  <mat-icon>warning</mat-icon>
                  <small>旧数据：该签署缺少职责记录，已在上方待补录区列出。</small>
                </div>

                <div class="recalc" *ngIf="step.status === '待处理' && step.recalcNote">
                  <mat-icon>autorenew</mat-icon><small>{{ step.recalcNote }}</small>
                </div>

                <ng-container *ngIf="step.status === '待处理'">
                  <div class="eligible" [class.blocked]="!elig(vm, step).eligible">
                    <mat-icon>{{ elig(vm, step).eligible ? 'verified' : 'block' }}</mat-icon>
                    <div>
                      <strong>{{ elig(vm, step).eligible ? '当前终端可处理该档位' : '当前终端不可处理' }}</strong>
                      <p *ngFor="let reason of elig(vm, step).reasons">{{ reason }}</p>
                      <p *ngIf="elig(vm, step).eligible">按现行职责授权，且系统已核验未经手该准备金下任何损失科目报价。</p>
                    </div>
                  </div>
                  <div class="step-actions" *ngIf="elig(vm, step).eligible">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                    <label class="fault-toggle"><input type="checkbox" [(ngModel)]="faultFlags[index]" /> 模拟写入失败（凭请求号恢复）</label>
                    <div class="btn-row">
                      <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step, '已通过', index)">通过</button>
                      <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step, '退回补件', index)">退回补件</button>
                      <button mat-stroked-button color="accent" (click)="decideConcurrent(vm, claim, step, index)">
                        <mat-icon>devices</mat-icon> 两终端同时提交此档位
                      </button>
                    </div>
                    <small class="reqno" *ngIf="requestIds[index]">请求号 {{ requestIds[index] }}</small>
                  </div>
                </ng-container>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新有效报价，全额计入存货库龄风险。</p>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
              </mat-card>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>职责变更演练</h3><span class="muted">立即重算在途会签</span></div>
            <div class="reassign">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>选择职责</mat-label>
                <mat-select [(value)]="reassignDutyId">
                  <mat-option *ngFor="let d of vm.ledger.duties" [value]="d.id">{{ d.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>移交给</mat-label>
                <mat-select [(value)]="reassignPersonId">
                  <mat-option *ngFor="let p of vm.ledger.persons" [value]="p.id">{{ p.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>变更原因</mat-label><input matInput [(ngModel)]="reassignReason" placeholder="如：轮岗 / 离职交接" /></mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!reassignDutyId || !reassignPersonId" (click)="reassign()">执行换岗并重算</button>
              <small>换岗后：未完成会签立即按新台账重算；已签步骤保留当时依据。</small>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>争议项定位</h3><span class="muted">{{ disputedCount(claim) }} 项</span></div>
            <div class="disputes">
              <div *ngFor="let item of claim.lossItems" [class.disputed]="item.disputed">
                <mat-icon>{{ item.disputed ? 'report_problem' : 'check_circle' }}</mat-icon>
                <div><strong>{{ item.category }} · {{ item.description }}</strong><p>{{ item.disputed ? '存在证据差异，审批意见不能覆盖原始查勘记录。' : '材料一致，可纳入当前方案。' }}</p></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
    </ng-container>
  `,
  styles: [`
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .auth-banner { display: flex; gap: 10px; align-items: center; margin: 12px 0; padding: 10px 14px; border-left: 3px solid #39828b; border-radius: 6px; background: #f0f8f8; color: #175866; }
    .auth-banner p { margin: 2px 0 0; font-size: 12px; color: #42696f; }
    .backfill-banner { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; padding: 12px 14px; border-left: 3px solid #ce743e; border-radius: 6px; background: #fff5ec; color: #7a4116; }
    .backfill-banner p { margin: 3px 0 8px; font-size: 12px; }
    .backfill-list { display: grid; gap: 8px; }
    .backfill-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid #f0d3bd; border-radius: 6px; background: #fff; }
    .backfill-row > span { flex: 1; min-width: 220px; font-size: 12px; font-weight: 600; color: #5d3717; }
    .backfill-row mat-form-field { width: 150px; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body > p { margin: 0 0 6px; color: #58666f; }
    .basis { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #eef4f5; }
    .basis small { display: block; color: #687981; font-size: 10px; line-height: 1.6; }
    .basis.signed { color: #385962; }
    .basis.signed strong { display: block; font-size: 11px; }
    .basis.signed em { color: #8a6d2f; font-style: normal; }
    .basis.missing { background: #fff0e4; color: #a3511f; }
    .recalc { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0; padding: 7px 10px; border-left: 3px solid #4a8aa8; background: #eef6fb; color: #2f6078; }
    .recalc small { font-size: 11px; line-height: 1.5; }
    .eligible { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; padding: 8px 10px; border-left: 3px solid #3f9269; background: #eef8f2; color: #2c6b4f; border-radius: 6px; }
    .eligible.blocked { border-left-color: #c05b3a; background: #fdeee8; color: #93401f; }
    .eligible p { margin: 3px 0 0; font-size: 11px; line-height: 1.5; }
    .step-actions { margin-top: 12px; }
    .step-actions mat-form-field.mat-mdc-form-field { display: block; width: 100%; }
    .fault-toggle { display: inline-flex; align-items: center; gap: 5px; margin: 6px 0; color: #7a5218; font-size: 11px; }
    .btn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .reqno { display: block; margin-top: 6px; color: #5a7079; font-family: monospace; }
    aside { display: grid; gap: 14px; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .reassign { display: grid; gap: 8px; padding: 14px; }
    .reassign mat-form-field { width: 100%; }
    .reassign small { color: #7d8991; font-size: 10px; line-height: 1.5; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent {
  vm$: Observable<{ claim: ClaimCase; ledger: RoleLedger }>
  currentPerson: Person | undefined
  comments: Record<number, string> = {}
  faultFlags: Record<number, boolean> = {}
  requestIds: Record<number, string> = {}
  backfillSelection: Record<string, { personId: string; dutyId: string }> = {}
  reassignDutyId = 'DUTY-SR-ADJUSTER'
  reassignPersonId = ''
  reassignReason = ''

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly ledgerStore: LedgerService,
    readonly session: SessionService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.vm$ = combineLatest({
      claim: this.store.select(selectSelectedClaim),
      ledger: this.ledgerStore.ledger$,
    })
    combineLatest([this.ledgerStore.ledger$, this.session.personId$]).subscribe(([ledger, personId]) => {
      this.currentPerson = getPerson(ledger, personId)
    })
  }

  // ---------- 模板辅助 ----------
  getDutyName(ledger: RoleLedger, dutyId: string) {
    return getDuty(ledger, dutyId)?.name ?? dutyId
  }

  holderName(ledger: RoleLedger, step: ApprovalStep) {
    const holders = currentAssignees(ledger, step.dutyId)
    return holders.length ? holders.map((person) => person.name).join('、') : '（空缺）'
  }

  elig(vm: { claim: ClaimCase; ledger: RoleLedger }, step: ApprovalStep): Eligibility {
    return evaluateApprover(vm.ledger, vm.claim, this.session.personId, step.dutyId)
  }

  quoteDuties(ledger: RoleLedger) {
    return ledger.duties.filter((duty) => duty.canQuote)
  }

  quoteKey(itemId: string, version: number) {
    return `q:${itemId}:${version}`
  }

  stepKey(dutyId: string) {
    return `s:${dutyId}`
  }

  private selection(key: string) {
    if (!this.backfillSelection[key]) this.backfillSelection[key] = { personId: '', dutyId: '' }
    return this.backfillSelection[key]
  }

  bfQuote(itemId: string, version: number) {
    return this.selection(this.quoteKey(itemId, version))
  }

  bfStep(dutyId: string) {
    return this.selection(this.stepKey(dutyId))
  }

  missingQuotes(claim: ClaimCase): MissingQuote[] {
    return claim.lossItems.flatMap((item) =>
      item.repairQuotes
        .filter((quote) => quote.dutyMissing)
        .map((quote) => ({ itemId: item.id, itemCategory: item.category, version: quote.version, operator: quote.operator })),
    )
  }

  missingSteps(claim: ClaimCase): ApprovalStep[] {
    return claim.approvals.filter((step) => step.basisMissing)
  }

  // ---------- 金额试算（只计职责依据齐全的有效报价） ----------
  latestValid(item: ClaimCase['lossItems'][number]) {
    return [...item.repairQuotes].reverse().find((quote) => quote.basis && !quote.dutyMissing)?.amount ?? 0
  }

  planA(claim: ClaimCase) {
    return claim.lossItems.reduce((sum, item) => sum + Math.max(0, this.latestValid(item) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: ClaimCase) {
    return this.planA(claim) - claim.lossItems.filter((item) => item.disputed).length * 72000
  }

  disputedCount(claim: ClaimCase) {
    return claim.lossItems.filter((item) => item.disputed).length
  }

  // ---------- 会签处理 ----------
  private apply(claim: ClaimCase) {
    this.store.dispatch(updateClaim({ claim: structuredClone(claim) }))
  }

  decide(claim: ClaimCase, step: ApprovalStep, result: string, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    const requestId = newRequestId('AP')
    this.requestIds[index] = requestId
    this.callApprove(claim.id, step.dutyId, result, comment, requestId, this.faultFlags[index], 1, index)
  }

  private callApprove(
    claimId: string,
    dutyId: string,
    result: string,
    comment: string,
    requestId: string,
    injectFailure: boolean,
    attempt: number,
    index: number,
    onDone?: () => void,
  ) {
    this.service
      .approve(claimId, { dutyId, result, comment, requestId, personId: this.session.personId, injectFailure: injectFailure && attempt === 1 })
      .subscribe({
        next: (res) => {
          this.apply(res.claim)
          this.snackBar.open(
            res.replayed
              ? `按请求号 ${requestId} 回放成功，未重复会签`
              : result === '已通过'
                ? '会签通过，授权依据已冻结并流转至下一级'
                : '案件已退回补件，原始记录未修改',
            '关闭',
            { duration: 2400 },
          )
          this.comments[index] = ''
          onDone?.()
        },
        error: (err) => {
          if (err?.status === 409) {
            this.snackBar.open(err.error?.message ?? '该档位已被先到请求处理', '关闭', { duration: 2400 })
            onDone?.()
          } else if (err?.status === 403) {
            this.snackBar.open(err.error?.message ?? '当前职责无权处理该档位', '关闭', { duration: 3000 })
          } else if (err?.status === 503) {
            this.snackBar.open(`写入失败，1.5 秒后凭请求号 ${requestId} 自动重试…`, '关闭', { duration: 1800 })
            setTimeout(() => this.callApprove(claimId, dutyId, result, comment, requestId, false, attempt + 1, index, onDone), 1500)
          } else {
            this.snackBar.open(err?.error?.message ?? '请求失败', '关闭', { duration: 2200 })
            onDone?.()
          }
        },
      })
  }

  /** 两终端同时提交同一档位：洗牌真实到达顺序，服务端在途锁保证先到结果生效。 */
  decideConcurrent(vm: { claim: ClaimCase; ledger: RoleLedger }, claim: ClaimCase, step: ApprovalStep, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) {
      this.snackBar.open('请先填写审批意见', '关闭', { duration: 1600 })
      return
    }
    // 选择两个当前满足授权的不同人员作为两个终端（第二终端必须也未经手报价）
    const candidates = vm.ledger.persons.filter(
      (person) => person.id !== this.session.personId && evaluateApprover(vm.ledger, claim, person.id, step.dutyId).eligible,
    )
    if (candidates.length === 0) {
      this.snackBar.open('没有第二个同时满足职责与职责冲突约束的终端，无法演练同档竞争', '关闭', { duration: 3000 })
      return
    }
    const terminalA = this.session.personId
    const terminalB = candidates[0].id
    const reqA = newRequestId('AP')
    const reqB = newRequestId('AP')
    this.requestIds[index] = `${reqA} / ${reqB}`

    const outcomes: Record<string, 'win' | 'conflict'> = {}
    const finish = (label: string) => {
      if (outcomes[terminalA] && outcomes[terminalB]) {
        const winId = outcomes[terminalA] === 'win' ? terminalA : terminalB
        const winner = getPerson(vm.ledger, winId)
        this.snackBar.open(
          `同档并发结束：${getPerson(vm.ledger, terminalA)?.name} 与 ${getPerson(vm.ledger, terminalB)?.name} 同时提交，${winner?.name} 的请求先到并生效，另一请求 409 拒绝`,
          '关闭',
          { duration: 3600 },
        )
        this.comments[index] = ''
      }
    }

    const call = (label: string, personId: string, requestId: string) => {
      this.service.approve(claim.id, { dutyId: step.dutyId, result: '已通过', comment, requestId, personId }).subscribe({
        next: (res) => {
          this.apply(res.claim)
          outcomes[label] = res.replayed ? 'conflict' : 'win'
          finish(label)
        },
        error: (err) => {
          if (err?.status === 409) {
            outcomes[label] = 'conflict'
            finish(label)
          } else {
            this.snackBar.open(`终端 ${getPerson(vm.ledger, personId)?.name}：${err?.error?.message ?? '失败'}`, '关闭', { duration: 2200 })
          }
        },
      })
    }

    if (Math.random() > 0.5) {
      call(terminalA, terminalA, reqA)
      call(terminalB, terminalB, reqB)
    } else {
      call(terminalB, terminalB, reqB)
      call(terminalA, terminalA, reqA)
    }
  }

  // ---------- 旧数据职责补录 ----------
  backfillQuote(claim: ClaimCase, missing: MissingQuote) {
    const sel = this.bfQuote(missing.itemId, missing.version)
    if (!sel?.personId || !sel?.dutyId) {
      this.snackBar.open('请选择补录的当时人员与职责', '关闭', { duration: 1800 })
      return
    }
    const requestId = newRequestId('BF')
    this.service
      .backfill(claim.id, {
        kind: 'quote',
        itemId: missing.itemId,
        quoteVersion: missing.version,
        personId: sel.personId,
        dutyId: sel.dutyId,
        requestId,
      })
      .subscribe({
        next: (res) => {
          this.apply(res.claim)
          this.snackBar.open(res.claim.factsIncomplete ? '补录成功，仍有其他事实待补录' : '补录完成，授权事实链已闭合，可以继续会签', '关闭', { duration: 2400 })
        },
        error: (err) => this.snackBar.open(err?.error?.message ?? '补录失败', '关闭', { duration: 2200 }),
      })
  }

  backfillStep(claim: ClaimCase, step: ApprovalStep) {
    const sel = this.bfStep(step.dutyId)
    if (!sel?.personId || !sel?.dutyId) {
      this.snackBar.open('请选择补录的当时人员与职责', '关闭', { duration: 1800 })
      return
    }
    const requestId = newRequestId('BF')
    this.service
      .backfill(claim.id, { kind: 'approval', stepDutyId: step.dutyId, personId: sel.personId, dutyId: sel.dutyId, requestId })
      .subscribe({
        next: (res) => {
          this.apply(res.claim)
          this.snackBar.open(res.claim.factsIncomplete ? '补录成功，仍有其他事实待补录' : '补录完成，授权事实链已闭合', '关闭', { duration: 2400 })
        },
        error: (err) => this.snackBar.open(err?.error?.message ?? '补录失败', '关闭', { duration: 2200 }),
      })
  }

  // ---------- 换岗：立即重算在途会签 ----------
  reassign() {
    if (!this.reassignDutyId || !this.reassignPersonId) return
    const ledger = this.ledgerStore.ledger
    const duty = getDuty(ledger, this.reassignDutyId)
    const person = getPerson(ledger, this.reassignPersonId)
    if (personHoldsDuty(ledger, this.reassignPersonId, this.reassignDutyId)) {
      this.snackBar.open(`${person?.name} 当前已承担「${duty?.name}」，无需换岗`, '关闭', { duration: 2000 })
      return
    }
    this.service
      .reassignDuty({ dutyId: this.reassignDutyId, personId: this.reassignPersonId, reason: this.reassignReason || '职责变更演练' })
      .subscribe({
        next: (res) => {
          // 重算发生在服务端：重新拉取受影响案件并更新本地
          const ids = res.affectedClaimIds
          if (ids.length === 0) {
            this.snackBar.open(`台账升级至 v${res.version}，当前无在途会签需要重算`, '关闭', { duration: 2200 })
            return
          }
          let loaded = 0
          ids.forEach((id) => {
            this.service.get(id).subscribe((updated) => {
              this.apply(updated)
              loaded += 1
              if (loaded === ids.length) {
                this.snackBar.open(`台账升级至 v${res.version}：${ids.length} 个案件的未完成会签已立即重算，已签记录保留当时依据`, '关闭', { duration: 3200 })
              }
            })
          })
        },
        error: (err) => this.snackBar.open(err?.error?.message ?? '换岗失败', '关闭', { duration: 2200 }),
      })
  }
}
