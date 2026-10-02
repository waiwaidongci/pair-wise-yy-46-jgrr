import { Component, OnInit } from '@angular/core'
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatStepperModule } from '@angular/material/stepper'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { take } from 'rxjs'
import { HttpErrorResponse } from '@angular/common/http'
import { ClaimsService } from '../core/claims.service'
import type { ApprovalStep, ClaimCase, RoleLedgerEntry } from '../core/models'
import { selectSelectedClaim, updateClaim, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-review-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatStepperModule, StatusChipComponent],
  template: `
    <section class="page" *ngIf="claim$ | async as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">RESERVE APPROVAL / 准备金审批</p>
          <h1>多级会签与赔付方案比较</h1>
          <p class="muted">按金额、科目和当前职责逐级审批；审批人须未经手该损失科目。档位版本 V{{ claim.version }}，先到提交生效。</p>
        </div>
        <span class="reserve">申请准备金 {{ claim.reserve | currency:'CNY':'symbol':'1.0-0' }}</span>
      </div>

      <div class="review-grid">
        <section class="panel">
          <div class="panel-head"><h3>会签流程</h3><app-status-chip [label]="claim.status" [tone]="claim.status === '退回补件' ? 'warn' : 'good'" /></div>
          <mat-stepper orientation="vertical" [linear]="false" class="approval-stepper">
            <mat-step *ngFor="let step of claim.approvals; let index = index" [completed]="step.status === '已通过'">
              <ng-template matStepLabel>
                <strong>{{ step.role }}</strong>
                <span class="threshold">触发阈值 {{ step.threshold | currency:'CNY':'symbol':'1.0-0' }}</span>
              </ng-template>
              <div class="step-body">
                <!-- 已签步骤：保留签署时封存的职责依据，不随台账变化 -->
                <ng-container *ngIf="step.status !== '待处理'">
                  <p>{{ step.comment || step.status + '。' }}</p>
                  <small>{{ step.operator }} · {{ step.completedAt }}</small>
                  <small *ngIf="step.operatorDuties?.length">签署依据：当时职责 {{ step.operatorDuties?.join('、') }}</small>
                  <app-status-chip *ngIf="step.recordStatus === '待补录'" label="职责记录待补录" tone="warn" />
                </ng-container>

                <!-- 待处理步骤：按当前台账重算的授权事实 -->
                <ng-container *ngIf="step.status === '待处理'">
                  <p *ngIf="step.eligible === false" class="blocked"><mat-icon>block</mat-icon> {{ step.blockedReason }}</p>
                  <ng-container *ngIf="step.eligible !== false">
                    <p class="eligible"><mat-icon>verified_user</mat-icon> 当前在任职责可处理该档位。</p>
                    <div class="step-actions">
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批意见</mat-label><input matInput [(ngModel)]="comments[index]" /></mat-form-field>
                      <button mat-flat-button color="primary" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step, '已通过', index)">通过</button>
                      <button mat-stroked-button color="warn" [disabled]="!comments[index]?.trim()" (click)="decide(claim, step, '退回补件', index)">退回补件</button>
                    </div>
                  </ng-container>
                </ng-container>
              </div>
            </mat-step>
          </mat-stepper>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>角色权限台账</h3><button mat-stroked-button (click)="rotate()">模拟调岗</button></div>
            <div class="ledger">
              <div *ngFor="let entry of ledger">
                <strong>{{ entry.operator }}</strong>
                <app-status-chip [label]="entry.role" [tone]="entry.until ? 'default' : 'good'" />
                <small>{{ entry.since | date:'yyyy-MM-dd' }} → {{ entry.until ? (entry.until | date:'yyyy-MM-dd') : '在任' }} · {{ entry.basis }}</small>
              </div>
            </div>
            <p class="muted">调岗后未完成会签立即按当前职责重算；已签步骤保留签署时职责依据。</p>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>赔付方案对比</h3><span class="muted">自动试算</span></div>
            <div class="plans">
              <mat-card appearance="outlined">
                <span>方案 A · 现状评估</span>
                <strong>{{ planA(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>采用最新报价，全额计入存货库龄风险。</p>
                <button mat-button>设为审批方案</button>
              </mat-card>
              <mat-card appearance="outlined" class="recommended">
                <span>方案 B · 核减待证部分</span>
                <strong>{{ planB(claim) | currency:'CNY':'symbol':'1.0-0' }}</strong>
                <p>暂扣第三方复测与库龄核减争议金额，通过后追加。</p>
                <button mat-flat-button color="primary">推荐方案</button>
              </mat-card>
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
  `,
  styles: [`
    .reserve { padding: 10px 14px; border-left: 3px solid #2f8191; background: #eaf4f5; color: #175866; font-weight: 800; }
    .review-grid { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
    .approval-stepper { padding: 18px 22px 22px 8px; background: transparent; }
    mat-step strong, mat-step .threshold { display: block; }
    .threshold { margin-top: 3px; color: #78858d; font-size: 10px; }
    .step-body { padding: 4px 0 16px; }
    .step-body p { margin: 0 0 6px; color: #58666f; }
    .step-body small { display: block; margin-top: 3px; color: #869198; }
    .step-body app-status-chip { margin-top: 6px; }
    .blocked { display: flex; align-items: center; gap: 6px; color: #b55a2e !important; font-weight: 600; }
    .blocked mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .eligible { display: flex; align-items: center; gap: 6px; color: #246d55 !important; font-weight: 600; }
    .eligible mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .step-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .step-actions mat-form-field { flex: 1; min-width: 240px; }
    aside { display: grid; gap: 14px; }
    .ledger { padding: 6px 14px 10px; }
    .ledger > div { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid #edf0f2; }
    .ledger strong { font-size: 12px; }
    .ledger small { color: #7b8790; font-size: 10px; }
    .ledger + .muted { margin-top: 10px; }
    .plans { display: grid; gap: 10px; padding: 14px; }
    .plans mat-card { padding: 14px; }
    .plans .recommended { border-color: #39828b; background: #f0f8f8; }
    .plans span, .plans p { display: block; color: #69767e; font-size: 12px; }
    .plans strong { display: block; margin: 7px 0; color: #184855; font-size: 22px; }
    .disputes { padding: 6px 14px 14px; }
    .disputes > div { display: flex; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0f2; color: #437360; }
    .disputes > div.disputed { color: #b55a2e; }
    .disputes strong { font-size: 12px; }
    .disputes p { margin: 5px 0 0; color: #6d7981; font-size: 11px; line-height: 1.5; }
    @media (max-width: 1050px) { .review-grid { grid-template-columns: 1fr; } }
  `],
})
export class ReviewPageComponent implements OnInit {
  claim$: Observable<ClaimCase>
  comments: Record<number, string> = {}
  ledger: RoleLedgerEntry[] = []

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.claim$ = this.store.select(selectSelectedClaim)
  }

  ngOnInit() {
    this.loadLedger()
  }

  loadLedger() {
    this.service.getLedger().subscribe((entries) => (this.ledger = entries))
  }

  planA(claim: any) {
    return claim.lossItems.reduce((sum: number, item: any) => sum + Math.max(0, (item.repairQuotes.at(-1)?.amount ?? 0) - item.salvage) * item.liability, 0) - claim.deductible
  }

  planB(claim: any) {
    return this.planA(claim) - (claim.lossItems.filter((item: any) => item.disputed).length * 72000)
  }

  disputedCount(claim: any) {
    return claim.lossItems.filter((item: any) => item.disputed).length
  }

  /** 调岗：服务端立即重算未完成会签；已签步骤保留当时依据 */
  rotate() {
    this.service.rotateDuties().subscribe({
      next: () => {
        this.loadLedger()
        this.store
          .select(selectSelectedClaim)
          .pipe(take(1))
          .subscribe((claim) => {
            this.service.get(claim.id).subscribe((updated) => this.store.dispatch(updateClaim({ claim: structuredClone(updated) })))
          })
        this.snackBar.open('职责已调整，未完成会签已按当前台账重算', '关闭', { duration: 2400 })
      },
    })
  }

  decide(claim: ClaimCase, step: ApprovalStep, result: string, index: number) {
    const comment = this.comments[index]?.trim()
    if (!comment) return
    this.service.approve(claim.id, { role: step.role, result, comment, version: claim.version }).subscribe({
      next: ({ body, replayed }) => {
        this.store.dispatch(updateClaim({ claim: structuredClone(body) }))
        this.snackBar.open(
          replayed ? '写入结果丢失，已按请求号恢复（未重复提交）' : result === '已通过' ? '会签通过，已流转至下一级' : '案件已退回补件，原始记录未修改',
          '关闭',
          { duration: 2600 },
        )
        this.comments[index] = ''
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 409) {
          this.snackBar.open('其他终端已先提交该档位，已刷新为最新结果', '关闭', { duration: 2600 })
          this.service.get(claim.id).subscribe((updated) => this.store.dispatch(updateClaim({ claim: structuredClone(updated) })))
        } else if (err.status === 403) {
          this.snackBar.open(err.error?.message || '当前职责无权处理该档位', '关闭', { duration: 2600 })
        } else {
          this.snackBar.open('提交失败，请重试（将按请求号恢复，不会重复提交）', '关闭', { duration: 2600 })
        }
      },
    })
  }
}
