import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'

/**
 * 当前登录终端：操作者身份 + 终端标识。
 * 所有写接口必须携带操作者；演示中通过侧栏切换模拟不同终端/人员。
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly personKey = 'property-claims-session-person-v2'
  private readonly terminalKey = 'property-claims-session-terminal-v2'

  readonly personId$ = new BehaviorSubject<string>(localStorage.getItem(this.personKey) ?? 'P-HANQING')
  readonly terminalId$ = new BehaviorSubject<string>(localStorage.getItem(this.terminalKey) ?? `终端-${Math.floor(100 + Math.random() * 900)}`)

  get personId() {
    return this.personId$.value
  }

  get terminalId() {
    return this.terminalId$.value
  }

  switchPerson(personId: string) {
    localStorage.setItem(this.personKey, personId)
    this.personId$.next(personId)
  }

  switchTerminal(terminalId: string) {
    localStorage.setItem(this.terminalKey, terminalId)
    this.terminalId$.next(terminalId)
  }
}
