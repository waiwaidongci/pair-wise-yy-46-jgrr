import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import { seedLedger } from './ledger'
import { currentAssignees, nowText } from './authorization'
import type { DutyAssignment, RoleLedger } from './models'

const STORAGE_KEY = 'property-claims-role-ledger-v2'

function loadLedger(): RoleLedger {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      return JSON.parse(saved) as RoleLedger
    } catch {
      // 损坏的本地台账回退到种子
    }
  }
  return structuredClone(seedLedger)
}

/**
 * 角色权限台账存储。任命变化 = 追加一条任命记录并提升台账版本；
 * 旧任命永不删除，使历史签署能追溯当时依据。
 */
@Injectable({ providedIn: 'root' })
export class LedgerService {
  readonly ledger$ = new BehaviorSubject<RoleLedger>(loadLedger())

  get ledger(): RoleLedger {
    return this.ledger$.value
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ledger$.value))
    this.ledger$.next(this.ledger$.value)
  }

  reset() {
    localStorage.removeItem(STORAGE_KEY)
    this.ledger$.next(structuredClone(seedLedger))
  }

  /**
   * 换岗：撤销该职责当前全部在岗者，再授予新人；事件只增。
   * 若新人已在岗则不动台账，返回当前版本。
   */
  reassign(dutyId: string, personId: string, reason: string): number {
    const current = this.ledger$.value
    const holders = currentAssignees(current, dutyId)
    if (holders.some((holder) => holder.id === personId)) return current.version
    const version = current.version + 1
    let seq = current.assignments.length
    const events: DutyAssignment[] = holders.map((holder) => ({
      id: `ASG-${String(++seq).padStart(2, '0')}`,
      dutyId,
      personId: holder.id,
      type: 'revoke',
      assignedAt: nowText(),
      reason: `换岗：撤销 ${holder.name} 的该职责（${reason}）`,
      ledgerVersion: version,
    }))
    events.push({
      id: `ASG-${String(++seq).padStart(2, '0')}`,
      dutyId,
      personId,
      type: 'grant',
      assignedAt: nowText(),
      reason: `换岗：职责移交（${reason}）`,
      ledgerVersion: version,
    })
    const next: RoleLedger = { ...current, version, assignments: [...current.assignments, ...events] }
    this.ledger$.next(next)
    this.persist()
    return version
  }
}
