import { addEarConfusion, getEarCombos, removeEarConfusion, setEarCombo } from '../store'
import { adjustStat } from './adapt'

/** What a trial wrote to the stats, so it can be undone later. */
export interface TrialRecord {
  key: string
  /** "expected>chosen" confusions the trial added. */
  conf: string[]
}

/** Count a trial as correct (or back as wrong) after the fact. */
export function overrule(rec: TrialRecord, later: number, toCorrect: boolean) {
  const stat = getEarCombos()[rec.key]
  if (stat) setEarCombo(rec.key, adjustStat(stat, later, toCorrect))
  rec.conf.forEach(toCorrect ? removeEarConfusion : addEarConfusion)
}
