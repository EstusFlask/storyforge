import type {
  TtrpgDegreeV2,
  TtrpgResolutionOutcomeV2,
  TtrpgResolutionRequestV2,
} from '../types'
import { assertTtrpgDieSidesV2 } from './dice'

const DEGREE_RANK_V2: Record<TtrpgDegreeV2, number> = {
  'critical-failure': 0,
  failure: 1,
  'partial-success': 2,
  success: 3,
  'hard-success': 4,
  'extreme-success': 5,
  'critical-success': 6,
}

function fail(message: string): never {
  throw new Error(`[ttrpg-resolution] ${message}`)
}

function finite(value: unknown, label: string, minimum = -1_000_000, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} 数值无效`)
  }
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label} 必须是整数`)
  return result
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim().normalize('NFC')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail(`${label} 不是稳定引用`)
  return result
}

function succeeded(degree: TtrpgDegreeV2): boolean {
  return DEGREE_RANK_V2[degree] >= DEGREE_RANK_V2['partial-success']
}

function outcome(input: Omit<TtrpgResolutionOutcomeV2, 'schema' | 'version' | 'succeeded'>): TtrpgResolutionOutcomeV2 {
  return {
    schema: 'storyforge.ttrpg-resolution-outcome',
    version: 2,
    ...input,
    succeeded: succeeded(input.degree),
  }
}

function resolveTotalVsTarget(
  request: Extract<TtrpgResolutionRequestV2, { mode: 'total-vs-target' }>,
): TtrpgResolutionOutcomeV2 {
  const total = finite(request.total, 'total')
  const target = finite(request.target, 'target')
  const criticalSuccessMargin = finite(request.criticalSuccessMargin, 'criticalSuccessMargin', 0)
  const criticalFailureMargin = finite(request.criticalFailureMargin, 'criticalFailureMargin', 0)
  const partialSuccessWindow = finite(request.partialSuccessWindow, 'partialSuccessWindow', 0)
  const margin = total - target
  const degree: TtrpgDegreeV2 = margin >= criticalSuccessMargin
    ? 'critical-success'
    : margin >= 0
      ? 'success'
      : margin >= -partialSuccessWindow && partialSuccessWindow > 0
        ? 'partial-success'
        : margin <= -criticalFailureMargin
          ? 'critical-failure'
          : 'failure'
  return outcome({
    mode: request.mode, degree, rolled: true, total, target, margin,
    successes: null, winnerRef: null, tiedRefs: [],
    calculationTrace: [
      `total=${total}`,
      `target=${target}`,
      `margin=${margin}`,
      `degree=${degree}`,
    ],
  })
}

function resolveRollUnder(
  request: Extract<TtrpgResolutionRequestV2, { mode: 'roll-under' }>,
): TtrpgResolutionOutcomeV2 {
  const roll = integer(request.roll, 'roll', 1, 100)
  const successMaximum = integer(request.successMaximum, 'successMaximum', 1, 100)
  const hardSuccessMaximum = integer(request.hardSuccessMaximum, 'hardSuccessMaximum', 1, successMaximum)
  const extremeSuccessMaximum = integer(request.extremeSuccessMaximum, 'extremeSuccessMaximum', 1, hardSuccessMaximum)
  const criticalSuccessMaximum = integer(request.criticalSuccessMaximum, 'criticalSuccessMaximum', 1, extremeSuccessMaximum)
  const criticalFailureMinimum = integer(request.criticalFailureMinimum, 'criticalFailureMinimum', successMaximum, 100)
  const degree: TtrpgDegreeV2 = roll <= criticalSuccessMaximum
    ? 'critical-success'
    : roll <= extremeSuccessMaximum
      ? 'extreme-success'
      : roll <= hardSuccessMaximum
        ? 'hard-success'
        : roll <= successMaximum
          ? 'success'
          : roll >= criticalFailureMinimum
            ? 'critical-failure'
            : 'failure'
  const margin = successMaximum - roll
  return outcome({
    mode: request.mode, degree, rolled: true, total: roll, target: successMaximum, margin,
    successes: null, winnerRef: null, tiedRefs: [],
    calculationTrace: [
      `roll=${roll}`,
      `thresholds=${criticalSuccessMaximum}/${extremeSuccessMaximum}/${hardSuccessMaximum}/${successMaximum}/${criticalFailureMinimum}`,
      `margin=${margin}`,
      `degree=${degree}`,
    ],
  })
}

function resolveSuccessPool(
  request: Extract<TtrpgResolutionRequestV2, { mode: 'success-pool' }>,
): TtrpgResolutionOutcomeV2 {
  const sides = assertTtrpgDieSidesV2(request.sides, 'success-pool.sides')
  if (!Array.isArray(request.dice) || request.dice.length < 1 || request.dice.length > 100) {
    fail('success-pool.dice 必须包含 1～100 颗骰子')
  }
  const dice = request.dice.map((die, index) => integer(die, `dice[${index}]`, 1, sides))
  const successAtOrAbove = integer(request.successAtOrAbove, 'successAtOrAbove', 1, sides)
  const criticalAtOrAbove = request.criticalAtOrAbove == null
    ? null
    : integer(request.criticalAtOrAbove, 'criticalAtOrAbove', successAtOrAbove, sides)
  const botchAtOrBelow = request.botchAtOrBelow == null
    ? null
    : integer(request.botchAtOrBelow, 'botchAtOrBelow', 1, successAtOrAbove - 1)
  const criticalBonusSuccesses = integer(request.criticalBonusSuccesses, 'criticalBonusSuccesses', 0, 100)
  const requiredSuccesses = integer(request.requiredSuccesses, 'requiredSuccesses', 1, 100)
  const criticalSuccesses = integer(request.criticalSuccesses, 'criticalSuccesses', requiredSuccesses, 200)
  const criticalFailureBotches = integer(request.criticalFailureBotches, 'criticalFailureBotches', 1, 100)
  const baseSuccesses = dice.filter(die => die >= successAtOrAbove).length
  const criticals = criticalAtOrAbove == null ? 0 : dice.filter(die => die >= criticalAtOrAbove).length
  const botches = botchAtOrBelow == null ? 0 : dice.filter(die => die <= botchAtOrBelow).length
  const successes = Math.max(0, baseSuccesses + criticals * criticalBonusSuccesses - (request.botchesCancel ? botches : 0))
  const degree: TtrpgDegreeV2 = successes >= criticalSuccesses
    ? 'critical-success'
    : successes >= requiredSuccesses
      ? 'success'
      : successes > 0
        ? 'partial-success'
        : botches >= criticalFailureBotches
          ? 'critical-failure'
          : 'failure'
  return outcome({
    mode: request.mode, degree, rolled: true, total: null, target: requiredSuccesses,
    margin: successes - requiredSuccesses, successes, winnerRef: null, tiedRefs: [],
    calculationTrace: [
      `dice=${dice.join(',')}`,
      `base-successes=${baseSuccesses}`,
      `criticals=${criticals}*${criticalBonusSuccesses}`,
      `botches=${botches}${request.botchesCancel ? '-cancel' : '-record-only'}`,
      `net-successes=${successes}/${requiredSuccesses}`,
      `degree=${degree}`,
    ],
  })
}

function resolveOpposed(
  request: Extract<TtrpgResolutionRequestV2, { mode: 'opposed' }>,
): TtrpgResolutionOutcomeV2 {
  if (!Array.isArray(request.contestants) || request.contestants.length < 2 || request.contestants.length > 20) {
    fail('opposed.contestants 必须包含 2～20 名参与者')
  }
  if (!['higher-total', 'higher-margin', 'reroll', 'stalemate'].includes(request.tieBreak)) {
    fail('opposed.tieBreak 无效')
  }
  const refs = new Set<string>()
  const contestants = request.contestants.map((contestant, index) => {
    const contestantRef = key(contestant.contestantRef, `contestants[${index}].contestantRef`)
    if (refs.has(contestantRef)) fail('opposed.contestants 不允许重复引用')
    refs.add(contestantRef)
    if (!(contestant.degree in DEGREE_RANK_V2)) fail(`contestants[${index}].degree 无效`)
    return {
      contestantRef,
      degree: contestant.degree,
      total: finite(contestant.total, `contestants[${index}].total`),
      margin: finite(contestant.margin, `contestants[${index}].margin`),
    }
  })
  const bestRank = Math.max(...contestants.map(item => DEGREE_RANK_V2[item.degree]))
  let leaders = contestants.filter(item => DEGREE_RANK_V2[item.degree] === bestRank)
  if (leaders.length > 1 && request.tieBreak === 'higher-total') {
    const bestTotal = Math.max(...leaders.map(item => item.total))
    leaders = leaders.filter(item => item.total === bestTotal)
  }
  if (leaders.length > 1 && request.tieBreak === 'higher-margin') {
    const bestMargin = Math.max(...leaders.map(item => item.margin))
    leaders = leaders.filter(item => item.margin === bestMargin)
  }
  const winner = leaders.length === 1 ? leaders[0] : null
  const degree = winner?.degree ?? (request.tieBreak === 'stalemate' ? 'partial-success' : 'failure')
  return outcome({
    mode: request.mode, degree, rolled: true,
    total: winner?.total ?? null, target: null, margin: winner?.margin ?? null,
    successes: null, winnerRef: winner?.contestantRef ?? null,
    tiedRefs: winner ? [] : leaders.map(item => item.contestantRef).sort(),
    calculationTrace: [
      ...contestants.map(item => `${item.contestantRef}:${item.degree}:total=${item.total}:margin=${item.margin}`),
      `tie-break=${request.tieBreak}`,
      winner ? `winner=${winner.contestantRef}` : `tie=${leaders.map(item => item.contestantRef).sort().join(',')}`,
    ],
  })
}

function resolveFixed(
  request: Extract<TtrpgResolutionRequestV2, { mode: 'fixed/no-roll' }>,
): TtrpgResolutionOutcomeV2 {
  if (!(request.degree in DEGREE_RANK_V2)) fail('fixed/no-roll.degree 无效')
  if (typeof request.reason !== 'string' || !request.reason.trim() || request.reason.trim().length > 2_000) {
    fail('fixed/no-roll.reason 无效')
  }
  return outcome({
    mode: request.mode, degree: request.degree, rolled: false,
    total: null, target: null, margin: null, successes: null, winnerRef: null, tiedRefs: [],
    calculationTrace: [`no-roll=${request.reason.trim().normalize('NFC')}`, `degree=${request.degree}`],
  })
}

export function resolveTtrpgResolutionV2(request: TtrpgResolutionRequestV2): TtrpgResolutionOutcomeV2 {
  if (!request || typeof request !== 'object') fail('裁决请求必须是对象')
  if (request.mode === 'total-vs-target') return resolveTotalVsTarget(request)
  if (request.mode === 'roll-under') return resolveRollUnder(request)
  if (request.mode === 'success-pool') return resolveSuccessPool(request)
  if (request.mode === 'opposed') return resolveOpposed(request)
  if (request.mode === 'fixed/no-roll') return resolveFixed(request)
  fail('裁决模式无效')
}

export function compareTtrpgDegreesV2(left: TtrpgDegreeV2, right: TtrpgDegreeV2): number {
  if (!(left in DEGREE_RANK_V2) || !(right in DEGREE_RANK_V2)) fail('成功等级无效')
  return DEGREE_RANK_V2[left] - DEGREE_RANK_V2[right]
}
