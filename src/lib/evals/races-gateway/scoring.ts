import { RACES_GATEWAY_EVAL_FIXTURES_V1 } from './fixtures'
import type {
  RacesGatewayBlindGradeV1,
  RacesGatewayEvalResultV1,
  RacesGatewayEvalScoreV1,
  RacesGatewayEvalThresholdsV1,
} from './types'

export const RACES_GATEWAY_EVAL_THRESHOLDS_V1: RacesGatewayEvalThresholdsV1 = {
  emptyPlaceholderMax: 0.05,
  emptyTitleOveranchorMax: 0.10,
  emptyConcreteMin: 1,
  partialConstraintMin: 0.90,
  partialNewInformationMin: 0.90,
  lateRecallAt20Min: 0.95,
  lateOutcomeUseMin: 0.90,
  pinnedDeliveryMin: 1,
  pinnedOutcomeRetentionMin: 1,
  scopeLeakMax: 0,
  comparisonDeliveryMin: 1,
  casBlockMin: 1,
}

function rate<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.length ? items.filter(predicate).length / items.length : 0
}

export function parseRacesGatewayBlindGradeV1(raw: string): RacesGatewayBlindGradeV1 {
  let value: unknown
  try { value = JSON.parse(raw.trim()) } catch { throw new Error('RACE-6 grader 返回了非法 JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RACE-6 grader 结果必须是对象')
  const row = value as Record<string, unknown>
  const keys = [
    'placeholder', 'titleOveranchored', 'concrete', 'constraintsRespected',
    'addsUsefulInformation', 'irrelevantMaterial', 'reason',
  ]
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error('RACE-6 grader 字段不在闭集')
  }
  for (const key of keys.slice(0, 6)) if (typeof row[key] !== 'boolean') throw new Error(`RACE-6 grader ${key} 必须是 boolean`)
  if (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500) throw new Error('RACE-6 grader reason 无效')
  return row as unknown as RacesGatewayBlindGradeV1
}

export function parseRacesGatewayBlindGradeCompletionV2(
  raw: string,
  finishReason: string | null | undefined,
): RacesGatewayBlindGradeV1 {
  try {
    // A provider finish_reason is advisory. A complete strict closed-schema JSON
    // object is stronger evidence than a generic `length` marker.
    return parseRacesGatewayBlindGradeV1(raw)
  } catch (error) {
    if (/^(length|max_tokens)$/i.test(finishReason?.trim() ?? '')) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`RACE-6 grader 输出被截断：${detail}`)
    }
    throw error
  }
}

export function scoreRacesGatewayEvalV1(
  results: readonly RacesGatewayEvalResultV1[],
  thresholds: RacesGatewayEvalThresholdsV1 = RACES_GATEWAY_EVAL_THRESHOLDS_V1,
  fixtures = RACES_GATEWAY_EVAL_FIXTURES_V1,
): RacesGatewayEvalScoreV1 {
  const by = (kind: RacesGatewayEvalResultV1['kind']) => results.filter(item => item.kind === kind && item.status === 'passed')
  const empty = by('empty')
  const partial = by('partial-world')
  const late = by('late-target')
  const pinned = by('pinned-mandatory')
  const comparison = [...by('expand'), ...by('polish')]
  const scope = by('cross-scope-attack')
  const cas = by('concurrent-cas')
  const emptyPlaceholderRate = rate(empty, item => item.grade?.placeholder === true)
  const emptyTitleOveranchorRate = rate(empty, item => item.grade?.titleOveranchored === true)
  const emptyConcreteRate = rate(empty, item => item.grade?.concrete === true)
  const partialConstraintRate = rate(partial, item => item.grade?.constraintsRespected === true)
  const partialNewInformationRate = rate(partial, item => item.grade?.addsUsefulInformation === true)
  const lateRecallAt20 = rate(late, item => (
    item.expectedAnchorDelivered === true && item.selectedResourceKeys.length <= 20
  ))
  const lateOutcomeUseRate = rate(late, item => item.expectedAnchorInOutcome === true)
  const pinnedDeliveryRate = rate(pinned, item => item.mandatoryDelivered === true)
  const pinnedOutcomeRetentionRate = rate(pinned, item => item.expectedAnchorInOutcome === true)
  const scopeLeakRate = rate(scope, item => item.crossScopeBlocked !== true)
  const comparisonDeliveryRate = rate(comparison, item => item.candidateText.length > 0)
  const casBlockRate = rate(cas, item => item.staleBlocked === true)
  const failures: string[] = []
  const expectedCount = fixtures.length
  if (results.length !== expectedCount || results.some(item => item.status !== 'passed')) failures.push('样本未全部成功执行')
  if (emptyPlaceholderRate > thresholds.emptyPlaceholderMax) failures.push('空项目占位率超标')
  if (emptyTitleOveranchorRate > thresholds.emptyTitleOveranchorMax) failures.push('标题过度锚定率超标')
  if (emptyConcreteRate < thresholds.emptyConcreteMin) failures.push('空项目具体设定率不足')
  if (partialConstraintRate < thresholds.partialConstraintMin) failures.push('部分世界观约束正确率不足')
  if (partialNewInformationRate < thresholds.partialNewInformationMin) failures.push('部分世界观新信息率不足')
  if (lateRecallAt20 < thresholds.lateRecallAt20Min) failures.push('末位证据 recall@20 不足')
  if (lateOutcomeUseRate < thresholds.lateOutcomeUseMin) failures.push('末位证据送达后使用率不足')
  if (pinnedDeliveryRate < thresholds.pinnedDeliveryMin) failures.push('Mandatory 交付率不足')
  if (pinnedOutcomeRetentionRate < thresholds.pinnedOutcomeRetentionMin) failures.push('Mandatory 事实保留率不足')
  if (scopeLeakRate > thresholds.scopeLeakMax) failures.push('跨 scope 泄漏')
  if (comparisonDeliveryRate < thresholds.comparisonDeliveryMin) failures.push('双版本候选交付率不足')
  if (casBlockRate < thresholds.casBlockMin) failures.push('CAS stale 阻断率不足')
  return {
    sampleCount: expectedCount, completedCount: results.filter(item => item.status === 'passed').length,
    emptyPlaceholderRate, emptyTitleOveranchorRate, emptyConcreteRate,
    partialConstraintRate, partialNewInformationRate, lateRecallAt20, pinnedDeliveryRate,
    lateOutcomeUseRate, pinnedOutcomeRetentionRate,
    scopeLeakRate, comparisonDeliveryRate, casBlockRate,
    passed: failures.length === 0, failures,
  }
}
