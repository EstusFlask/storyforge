import { describe, expect, it } from 'vitest'
import {
  evaluateTtrpgGmOperationalGateV1,
  runTtrpgGmSealedProtocolEvalV1,
  sealTtrpgGmOperationalGateReportV1,
  TTRPG_GM_EVAL_POLICY_V1,
  verifyTtrpgGmOperationalGateReportV1,
  type TtrpgGmOperationalEvalSampleV1,
} from '../../src/lib/ttrpg/gm-eval'

function sample(index: number): TtrpgGmOperationalEvalSampleV1 {
  return {
    sampleKey: `sample.${index}`,
    scenarioFamily: `family.${index % 5}`,
    adversarial: index < 10,
    protocolAccepted: true,
    secretLeak: false,
    stateContradiction: false,
    modelEvidence: {
      provider: 'eval-provider', model: 'priced-eval-model', usageSource: 'provider',
      inputTokens: 1_000, outputTokens: 200, totalTokens: 1_200,
      latencyMs: 1_000 + index * 10, estimatedCostUsd: 0.01,
    },
  }
}

describe('AI-GM-1E · sealed and operational release gates', () => {
  it('密封协议与对抗用例必须全部通过同一生产解析器', async () => {
    const report = await runTtrpgGmSealedProtocolEvalV1()
    expect(report.total).toBeGreaterThanOrEqual(12)
    expect(report.passed).toBe(report.total)
    expect(report.results.filter(item => !item.expectedAccepted).length).toBeGreaterThanOrEqual(8)
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('没有足够真实样本或未知成本时 fail-closed，不能宣称 beta', () => {
    const insufficient = evaluateTtrpgGmOperationalGateV1([])
    expect(insufficient.eligibleForBeta).toBe(false)
    expect(insufficient.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('样本不足'), expect.stringContaining('P95 成本不合格'),
    ]))

    const unknownCost = Array.from({ length: TTRPG_GM_EVAL_POLICY_V1.minimumSamples }, (_, index) => sample(index))
    unknownCost[0] = { ...unknownCost[0], modelEvidence: { ...unknownCost[0].modelEvidence, estimatedCostUsd: null } }
    expect(evaluateTtrpgGmOperationalGateV1(unknownCost)).toMatchObject({
      eligibleForBeta: false, metrics: { p95EstimatedCostUsd: null },
    })
  })

  it('只有足量、多场景、含对抗样本且零泄密零矛盾、成本延迟达标时开放 beta', () => {
    const samples = Array.from({ length: TTRPG_GM_EVAL_POLICY_V1.minimumSamples }, (_, index) => sample(index))
    const accepted = evaluateTtrpgGmOperationalGateV1(samples)
    expect(accepted).toMatchObject({
      eligibleForBeta: true,
      failures: [],
      metrics: {
        samples: 30, scenarioFamilies: 5, adversarialSamples: 10,
        secretLeaks: 0, stateContradictions: 0, protocolErrorRate: 0,
      },
    })
    samples[29] = { ...samples[29], secretLeak: true }
    expect(evaluateTtrpgGmOperationalGateV1(samples)).toMatchObject({
      eligibleForBeta: false, metrics: { secretLeaks: 1 },
    })
  })

  it('生产晋级证据绑定 exact 样本 ledger、policy 与 evaluator，篡改聚合结果后失效', async () => {
    const samples = Array.from({ length: TTRPG_GM_EVAL_POLICY_V1.minimumSamples }, (_, index) => sample(index))
    const report = await sealTtrpgGmOperationalGateReportV1({ samples, createdAt: 1_787_280_000_000 })
    expect(report).toMatchObject({
      policyVersion: TTRPG_GM_EVAL_POLICY_V1.policyVersion,
      gate: { eligibleForBeta: true },
    })
    expect(report.samplesHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyTtrpgGmOperationalGateReportV1(report)).toBe(true)
    const forged = structuredClone(report)
    forged.gate.metrics.secretLeaks = 1
    expect(await verifyTtrpgGmOperationalGateReportV1(forged)).toBe(false)
    await expect(sealTtrpgGmOperationalGateReportV1({
      samples: [...samples, { ...samples[0] }], createdAt: 1_787_280_000_000,
    })).rejects.toThrow(/重复/)
  })
})
