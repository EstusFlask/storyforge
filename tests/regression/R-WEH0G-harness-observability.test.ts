import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError } from '../../src/lib/types'
import { AgentTeamBudgetExceededError } from '../../src/lib/agent/team-budget'
import {
  HARNESS_FAILURE_CLASSES_V1,
  classifyHarnessFailureV1,
  type HarnessFailureClassV1,
} from '../../src/lib/agent/run/harness-failure'
import {
  HARNESS_FAULT_POINTS_V1,
  configureHarnessFaultInjectionV1,
  maybeInjectHarnessFaultV1,
  resetHarnessFaultInjectionV1,
} from '../../src/lib/agent/dev-fault-injection'
import {
  buildPendingHarnessLifecycleEvidenceV1,
  buildSettledHarnessLifecycleEvidenceV1,
} from '../../src/lib/agent/harness-evidence'
import {
  flushPendingEditsV1,
  registerPendingDraftFlusherV1,
  resetPendingEditCoordinatorForTestsV1,
} from '../../src/lib/authoring/pending-edit-coordinator'
import { assembleContext } from '../../src/lib/registry/assemble-context'

const HASH = 'a'.repeat(64)

describe('R-WEH0G · Harness 证据、错误分类与开发态故障注入', () => {
  afterEach(() => {
    resetHarnessFaultInjectionV1()
    resetPendingEditCoordinatorForTestsV1()
  })

  it('十二类正式错误得到闭集分类，相同故障跨调用保持同一 fingerprint', async () => {
    const samples: Array<[HarnessFailureClassV1, unknown]> = [
      ['save', new Error('作者编辑保存失败，已阻止正式生成')],
      ['scope', new Error('记录不属于当前 Work')],
      ['context', new Error('[assembleContext] 上下文转换证据无效')],
      ['budget', new AgentTeamBudgetExceededError('本轮调用预算已耗尽')],
      ['provider', new AIError(503, 'service unavailable')],
      ['parse', new SyntaxError('JSON 解析失败')],
      ['schema', new Error('结构化字段 schema 无效')],
      ['gate', new Error('Canon 硬门违反约束')],
      ['candidate', new Error('候选持久化失败')],
      ['stale', new Error('候选已过期，内容修订向量发生变化')],
      ['adoption', new Error('正式采纳提交失败')],
      ['terminal', new Error('终态 verification receipt 不匹配')],
    ]
    const results = await Promise.all(samples.map(([, error]) => classifyHarnessFailureV1(error)))
    expect(results.map(result => result.failureClass)).toEqual(samples.map(([failureClass]) => failureClass))
    expect(new Set(results.map(result => result.failureClass))).toEqual(new Set(HARNESS_FAILURE_CLASSES_V1))

    const first = await classifyHarnessFailureV1(samples[8][1], { stage: 'candidate' })
    const second = await classifyHarnessFailureV1(samples[8][1], { stage: 'candidate' })
    expect(second).toEqual(first)
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('五段证据不会把待采纳候选或未完成多任务 Run 伪装成终态完成', () => {
    const pending = buildPendingHarnessLifecycleEvidenceV1({
      runId: 7,
      candidateEventId: 11,
      contentRevision: { version: 1, entries: [], vectorHash: HASH },
      contextManifestHash: HASH,
      candidateHash: HASH,
      contextEvidence: {
        profile: 'balanced',
        included: ['worldview'],
        omitted: [],
        trimmed: [],
        estimatedInputTokens: 10,
        inputBudgetTokens: 100,
      },
    })
    expect(pending.stages.map(item => [item.id, item.status])).toEqual([
      ['author-edits-saved', 'passed'],
      ['context-frozen', 'passed'],
      ['candidate-persisted', 'passed'],
      ['adoptable', 'passed'],
      ['terminal-verified', 'pending'],
    ])

    const partial = buildSettledHarnessLifecycleEvidenceV1({
      pending,
      adoptionHash: HASH,
      terminal: 'pending',
      terminalDetail: '等待本轮其余候选完成确认',
    })
    expect(partial.stages.at(-1)).toMatchObject({ status: 'pending' })
    expect(partial.terminalReceiptHash).toBeUndefined()

    const complete = buildSettledHarnessLifecycleEvidenceV1({
      pending,
      adoptionHash: HASH,
      terminal: 'passed',
      terminalReceiptHash: HASH,
      terminalDetail: '确定性终验已签发回执',
    })
    expect(complete.stages.at(-1)).toMatchObject({ status: 'passed' })
    expect(complete.terminalReceiptHash).toBe(HASH)
  })

  it('所有标准故障点只在显式启用时触发，并携带对应阶段类别', async () => {
    for (const point of HARNESS_FAULT_POINTS_V1) {
      expect(() => maybeInjectHarnessFaultV1(point)).not.toThrow()
      configureHarnessFaultInjectionV1([point])
      try {
        maybeInjectHarnessFaultV1(point)
        throw new Error('故障点没有触发')
      } catch (error) {
        const classified = await classifyHarnessFailureV1(error)
        expect(classified.code).toMatch(/_fault_injected$/)
      }
      resetHarnessFaultInjectionV1()
    }
  })

  it('保存前故障不调用草稿 flusher，保存后故障只中断后续生成', async () => {
    const flusher = vi.fn()
    const unregister = registerPendingDraftFlusherV1(flusher)
    configureHarnessFaultInjectionV1(['save.before-flush'])
    await expect(flushPendingEditsV1()).rejects.toThrow('save.before-flush')
    expect(flusher).not.toHaveBeenCalled()

    configureHarnessFaultInjectionV1(['save.after-flush'])
    await expect(flushPendingEditsV1()).rejects.toThrow('save.after-flush')
    expect(flusher).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('上下文装配前故障先于任何 scope/read 行为发生', async () => {
    configureHarnessFaultInjectionV1(['context.before-assemble'])
    await expect(assembleContext({
      projectId: -1,
      sourceKeys: ['worldview'],
    })).rejects.toThrow('context.before-assemble')
  })
})
