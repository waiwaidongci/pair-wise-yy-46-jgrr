import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatIconModule } from '@angular/material/icon'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import { combineLatest, Observable } from 'rxjs'
import type { ClaimCase, RoleLedger } from '../core/models'
import { LedgerService } from '../core/ledger.service'
import { currentAssignees, getDuty, getPerson } from '../core/authorization'
import { selectSelectedClaim, saveDraft, type AppState } from '../core/claims.store'
import { StatusChipComponent } from '../shared/status-chip.component'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule, StatusChipComponent],
  template: `
    <ng-container *ngIf="vm$ | async as vm">
    <section class="page" *ngIf="vm.claim as claim">
      <div class="page-head">
        <div>
          <p class="eyebrow">AUDIT & EVIDENCE / 审计与证据</p>
          <h1>附件版本、授权依据与权限台账</h1>
          <p class="muted">报价版本、会签依据和审批动作全部冻结在当时台账版本上；台账任命只增不删。</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="restoreDraft()"><mat-icon>restore</mat-icon> 恢复未提交草稿</button>
          <button mat-flat-button color="primary" (click)="exportAudit(claim)"><mat-icon>download</mat-icon> 导出审计包</button>
        </div>
      </div>

      <div class="audit-grid">
        <section class="panel">
          <div class="panel-head"><h3>案件操作时间线</h3><span class="muted">{{ claim.audit.length }} 条记录</span></div>
          <div class="timeline">
            <article *ngFor="let event of claim.audit.slice().reverse(); let first = first">
              <div class="time">{{ event.at }}</div>
              <div class="rail"><i></i><b *ngIf="!first"></b></div>
              <div class="event">
                <strong>{{ event.action }}</strong>
                <p>{{ event.detail }}</p>
                <small>{{ event.operator }} · 记录编号 {{ event.id }}</small>
              </div>
            </article>
          </div>
        </section>

        <aside>
          <section class="panel">
            <div class="panel-head"><h3>角色权限台账</h3><span class="muted">当前 v{{ vm.ledger.version }}</span></div>
            <div class="ledger">
              <div class="ledger-section" *ngFor="let duty of vm.ledger.duties">
                <div class="duty-head">
                  <strong>{{ duty.name }}</strong>
                  <app-status-chip [label]="dutyChip(duty)" />
                </div>
                <p>{{ duty.description }}</p>
                <small>当前责任人：{{ holderName(vm.ledger, duty.id) }}</small>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>任命事件流</h3><span class="muted">只增 · 可追溯换岗</span></div>
            <div class="assignments">
              <article *ngFor="let asg of vm.ledger.assignments.slice().reverse()">
                <mat-icon>swap_horiz</mat-icon>
                <div>
                  <strong>{{ dutyName(vm.ledger, asg.dutyId) }} → {{ personName(vm.ledger, asg.personId) }}</strong>
                  <p>{{ asg.reason }}</p>
                  <small>{{ asg.assignedAt }} · 台账 v{{ asg.ledgerVersion }}</small>
                </div>
              </article>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>附件版本</h3><span class="muted">只增不删</span></div>
            <div class="file-list">
              <div *ngFor="let item of claim.lossItems">
                <strong>{{ item.category }}</strong>
                <article *ngFor="let file of item.attachments">
                  <mat-icon>{{ file.category === '现场照片' ? 'photo_camera' : 'description' }}</mat-icon>
                  <div><span>{{ file.name }}</span><small>V{{ file.version }} · {{ file.uploadedBy }} · {{ file.uploadedAt }}</small></div>
                  <app-status-chip [label]="file.category" />
                </article>
                <small *ngIf="item.attachments.length === 0">暂无附件</small>
              </div>
            </div>
          </section>

          <mat-card appearance="outlined" class="draft-card">
            <div><mat-icon>cloud_sync</mat-icon><strong>未提交编辑可恢复</strong></div>
            <p>草稿写入口会同时保存到浏览器本地，不覆盖案件正式版本；写操作凭请求号幂等恢复。</p>
            <button mat-stroked-button (click)="saveNewDraft()">模拟保存新草稿</button>
          </mat-card>
        </aside>
      </div>
    </section>
    </ng-container>
  `,
  styles: [`
    .audit-grid { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 92px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    aside { display: grid; gap: 14px; }
    .ledger { padding: 8px 14px 14px; display: grid; gap: 10px; }
    .ledger-section { padding: 10px; border: 1px solid #e4eaec; border-radius: 7px; background: #f8fafb; }
    .duty-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .duty-head strong { font-size: 13px; color: #184855; }
    .ledger-section p { margin: 6px 0 4px; color: #66757d; font-size: 11px; line-height: 1.5; }
    .ledger-section small { color: #2f6b77; font-size: 11px; font-weight: 600; }
    .assignments { padding: 6px 14px 14px; max-height: 260px; overflow: auto; }
    .assignments article { display: grid; grid-template-columns: 26px minmax(0,1fr); gap: 8px; padding: 9px 0; border-bottom: 1px solid #edf0f2; }
    .assignments mat-icon { color: #4a8aa8; }
    .assignments strong { font-size: 12px; color: #244e5c; }
    .assignments p { margin: 3px 0; color: #65737c; font-size: 11px; }
    .assignments small { color: #8b969d; font-size: 10px; }
    .file-list { padding: 8px 14px 16px; }
    .file-list > div { padding: 10px 0; border-bottom: 1px solid #edf0f2; }
    .file-list article { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px; margin-top: 6px; background: #f5f7f7; border-radius: 6px; }
    .file-list article span, .file-list article small { display: block; }
    .file-list article span { font-size: 12px; }
    .file-list article small { margin-top: 3px; color: #7b878f; font-size: 10px; }
    .draft-card { padding: 16px; }
    .draft-card > div { display: flex; align-items: center; gap: 8px; }
    .draft-card p { margin: 9px 0 12px; color: #69767f; font-size: 12px; line-height: 1.55; }
    @media (max-width: 1050px) { .audit-grid { grid-template-columns: 1fr; } }
  `],
})
export class AuditPageComponent {
  vm$: Observable<{ claim: ClaimCase; ledger: RoleLedger }>

  constructor(
    private readonly store: Store<AppState>,
    private readonly ledgerStore: LedgerService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.vm$ = combineLatest({
      claim: this.store.select(selectSelectedClaim),
      ledger: this.ledgerStore.ledger$,
    })
  }

  holderName(ledger: RoleLedger, dutyId: string) {
    const holders = currentAssignees(ledger, dutyId)
    return holders.length ? holders.map((person) => `${person.name}（${person.title}）`).join('、') : '空缺，待任命'
  }

  dutyChip(duty: RoleLedger['duties'][number]) {
    return duty.canApprove ? `会签 ≥ ${duty.threshold}` : duty.canQuote ? '报价职责' : '其他'
  }

  dutyName(ledger: RoleLedger, dutyId: string) {
    return getDuty(ledger, dutyId)?.name ?? dutyId
  }

  personName(ledger: RoleLedger, personId: string) {
    return getPerson(ledger, personId)?.name ?? personId
  }

  restoreDraft() {
    const draft = localStorage.getItem('claims-assessment-draft') ?? '待补充房屋檩条第三方复测依据。'
    this.store.dispatch(saveDraft({ draft }))
    this.snackBar.open('已恢复本地未提交草稿', '关闭', { duration: 1800 })
  }

  saveNewDraft() {
    this.store.dispatch(saveDraft({ draft: `草稿更新于 ${new Date().toLocaleString('zh-CN')}` }))
  }

  exportAudit(claim: ClaimCase) {
    const lines = ['时间,操作者,动作,说明', ...claim.audit.map((event) => [event.at, event.operator, event.action, event.detail].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))]
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${claim.id}-审计记录.csv`
    link.click()
    URL.revokeObjectURL(url)
    this.snackBar.open('审计包已导出', '关闭', { duration: 1600 })
  }
}
