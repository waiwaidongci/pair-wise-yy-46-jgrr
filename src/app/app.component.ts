import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatListModule } from '@angular/material/list'
import { MatChipsModule } from '@angular/material/chips'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import { combineLatest } from 'rxjs'
import { ClaimsService } from './core/claims.service'
import { LedgerService } from './core/ledger.service'
import { SessionService } from './core/session.service'
import { currentDutiesOf } from './core/authorization'
import { loadClaimsSuccess, updateClaim, type AppState } from './core/claims.store'
import type { Person, RoleLedger } from './core/models'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatChipsModule,
    MatSelectModule,
  ],
  template: `
    <mat-sidenav-container class="shell">
      <mat-sidenav mode="side" opened class="sidebar" [class.mobile-hidden]="false">
        <div class="brand">
          <div class="brand-mark">财险</div>
          <div>
            <strong>查勘定损中心</strong>
            <small>华东财产险 · 专业工作台</small>
          </div>
        </div>
        <mat-nav-list>
          <a mat-list-item routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <mat-icon matListItemIcon>dashboard</mat-icon>
            <span matListItemTitle>案件总览</span>
          </a>
          <a mat-list-item routerLink="/assessment" routerLinkActive="active">
            <mat-icon matListItemIcon>fact_check</mat-icon>
            <span matListItemTitle>查勘定损</span>
          </a>
          <a mat-list-item routerLink="/review" routerLinkActive="active">
            <mat-icon matListItemIcon>approval</mat-icon>
            <span matListItemTitle>准备金审批</span>
          </a>
          <a mat-list-item routerLink="/audit" routerLinkActive="active">
            <mat-icon matListItemIcon>history</mat-icon>
            <span matListItemTitle>审计与权限台账</span>
          </a>
        </mat-nav-list>
        <div class="session">
          <label>当前操作者（模拟终端登录）</label>
          <mat-select [value]="session.personId" (selectionChange)="switchPerson($event.value)" panelClass="session-panel">
            <mat-option *ngFor="let person of persons" [value]="person.id">
              {{ person.name }} · {{ person.title }}
            </mat-option>
          </mat-select>
          <div class="duties" *ngIf="currentDutyNames as names">
            <span *ngFor="let name of names" class="duty-chip">{{ name }}</span>
            <span *ngIf="names.length === 0" class="duty-chip empty">当前无职责</span>
          </div>
          <small class="terminal">
            <mat-icon>computer</mat-icon>{{ session.terminalId }} · 台账 v{{ ledger?.version ?? '-' }}
          </small>
          <button class="reset-btn" (click)="resetDemo()"><mat-icon>restart_alt</mat-icon> 重置演示数据</button>
        </div>
      </mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="mobile-bar">
          <button mat-icon-button (click)="mobileOpen = !mobileOpen"><mat-icon>menu</mat-icon></button>
          <strong>查勘定损中心</strong>
        </mat-toolbar>
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .shell { min-height: 100vh; background: #edf1f3; }
    .sidebar { width: 244px; border: 0; color: #e8f0f3; background: #143443; }
    .brand { display: flex; align-items: center; gap: 11px; padding: 20px 16px; border-bottom: 1px solid rgba(255,255,255,.1); }
    .brand-mark { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #67a8b5; border-radius: 9px; color: #a6d8df; font-size: 13px; font-weight: 800; }
    .brand strong, .brand small { display: block; }
    .brand strong { font-size: 14px; }
    .brand small { margin-top: 4px; color: #8da5b1; font-size: 10px; }
    mat-nav-list { padding: 16px 10px; }
    mat-nav-list a { margin-bottom: 4px; border-radius: 7px; color: #b9cbd4; }
    mat-nav-list a.active { color: #fff; background: #235062; box-shadow: inset 3px 0 #66b6c2; }
    .session { position: absolute; right: 12px; bottom: 14px; left: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(255,255,255,.05); }
    .session label { display: block; margin-bottom: 6px; color: #9db3bd; font-size: 10px; }
    .session mat-select { width: 100%; height: 34px; margin: 0; padding: 4px 8px; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; color: #e8f0f3; font-size: 12px; background: rgba(255,255,255,.06); }
    ::ng-deep .session .mat-mdc-select-value, ::ng-deep .session .mat-mdc-select-arrow { color: #e8f0f3; }
    .duties { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .duty-chip { padding: 2px 7px; border-radius: 9px; color: #9fd8e0; background: rgba(102,182,194,.18); font-size: 10px; }
    .duty-chip.empty { color: #e0a98f; background: rgba(206,116,62,.18); }
    .terminal { display: flex; align-items: center; gap: 4px; margin-top: 8px; color: #92a8b3; font-size: 9px; }
    .terminal mat-icon { width: 12px; height: 12px; font-size: 12px; }
    .reset-btn { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 4px 8px; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; color: #b9cbd4; background: transparent; font-size: 10px; cursor: pointer; }
    .reset-btn:hover { color: #fff; border-color: #66b6c2; }
    .reset-btn mat-icon { width: 13px; height: 13px; font-size: 13px; }
    .mobile-bar { display: none; }
    mat-sidenav-content { min-width: 0; }
    @media (max-width: 820px) {
      .sidebar { display: none; }
      .mobile-bar { display: flex; gap: 8px; background: #143443; color: white; }
    }
  `],
})
export class AppComponent implements OnInit {
  mobileOpen = false
  ledger: RoleLedger | null = null
  persons: Person[] = []
  currentDutyNames: string[] = []

  constructor(
    readonly session: SessionService,
    private readonly service: ClaimsService,
    private readonly ledgerStore: LedgerService,
    private readonly store: Store<AppState>,
    private readonly snackBar: MatSnackBar,
  ) {}

  ngOnInit() {
    this.service.list({ query: '', status: '', risk: '', page: 1, pageSize: 10 }).subscribe((result) => {
      this.store.dispatch(loadClaimsSuccess({ items: result.items, total: result.total }))
    })
    combineLatest([this.ledgerStore.ledger$, this.session.personId$]).subscribe(([ledger, personId]) => {
      this.ledger = ledger
      this.persons = ledger.persons
      this.currentDutyNames = currentDutiesOf(ledger, personId).map((duty) => duty.name)
    })
  }

  switchPerson(personId: string) {
    this.session.switchPerson(personId)
    this.snackBar.open(`已切换操作者，会签与报价将按其当前职责重新授权`, '关闭', { duration: 1600 })
  }

  resetDemo() {
    this.service.resetDemo().subscribe(() => {
      this.service.list({ query: '', status: '', risk: '', page: 1, pageSize: 10 }).subscribe((result) => {
        this.store.dispatch(loadClaimsSuccess({ items: result.items, total: result.total }))
        result.items.forEach((claim) => this.store.dispatch(updateClaim({ claim })))
      })
      this.snackBar.open('演示数据、角色台账与会签状态已重置', '关闭', { duration: 1800 })
    })
  }
}
