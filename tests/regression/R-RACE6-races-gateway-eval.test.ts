import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { RACES_GATEWAY_EVAL_FIXTURES_V1 } from '../../src/lib/evals/races-gateway/fixtures'
import {
  parseRacesGatewayBlindGradeCompletionV2,
  parseRacesGatewayBlindGradeV1,
  scoreRacesGatewayEvalV1,
} from '../../src/lib/evals/races-gateway/scoring'
import {
  cleanupRacesGatewayEvalProjectsV1,
  runRacesGatewayEvalV1,
  verifyRacesGatewayEvalCheckpointV1,
} from '../../src/lib/evals/races-gateway/runner'
import type { RacesGatewayEvalResultV1 } from '../../src/lib/evals/races-gateway/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

function passingResult(index: number): RacesGatewayEvalResultV1 {
  const fixture = RACES_GATEWAY_EVAL_FIXTURES_V1[index]
  return {
    fixtureId: fixture.id,
    kind: fixture.kind,
    status: 'passed',
    projectId: index + 1,
    runId: index + 1,
    candidateEventId: index + 1,
    candidateText: '具体候选',
    contextManifestHash: 'a'.repeat(64),
    transcriptArchive: null,
    selectedResourceKeys: [],
    mandatoryDelivered: fixture.kind === 'pinned-mandatory' ? true : null,
    expectedAnchorDelivered: fixture.kind === 'late-target' ? true : null,
    expectedAnchorInOutcome: fixture.kind === 'late-target' || fixture.kind === 'pinned-mandatory' ? true : null,
    staleBlocked: fixture.kind === 'concurrent-cas' ? true : null,
    crossScopeBlocked: fixture.kind === 'cross-scope-attack' ? true : null,
    grade: fixture.kind === 'empty' || fixture.kind === 'partial-world' ? {
      placeholder: false,
      titleOveranchored: false,
      concrete: true,
      constraintsRespected: true,
      addsUsefulInformation: true,
      irrelevantMaterial: false,
      reason: '满足冻结标准。',
    } : null,
    gradeEvidence: null,
    error: null,
    durationMs: 1,
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  localStorage.clear()
  sessionStorage.clear()
  useAIConfigStore.setState({
    config: {
      provider: 'deepseek', apiKey: 'test-key', baseUrl: 'https://example.invalid/v1',
      model: 'deepseek-chat', temperature: 0.7, maxTokens: 0,
    },
    presets: [],
    taskRoutes: {},
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('RACE-6 · races transcript + outcome eval', () => {
  it('冻结 100 例互异矩阵并以全部门槛计算 sealed score', () => {
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1).toHaveLength(100)
    expect(new Set(RACES_GATEWAY_EVAL_FIXTURES_V1.map(item => item.id)).size).toBe(100)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'empty')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'partial-world')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'late-target')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'pinned-mandatory')).toHaveLength(10)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'cross-scope-attack')).toHaveLength(10)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'concurrent-cas')).toHaveLength(10)
    const score = scoreRacesGatewayEvalV1(RACES_GATEWAY_EVAL_FIXTURES_V1.map((_, index) => passingResult(index)))
    expect(score).toMatchObject({ sampleCount: 100, completedCount: 100, passed: true, failures: [] })
  })

  it('盲评 JSON 使用严格闭集合同', () => {
    const valid = JSON.stringify({
      placeholder: false, titleOveranchored: false, concrete: true,
      constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
      reason: '给出了两个族群、组织与冲突。',
    })
    expect(parseRacesGatewayBlindGradeV1(valid).concrete).toBe(true)
    expect(() => parseRacesGatewayBlindGradeV1(valid.slice(0, -1))).toThrow('非法 JSON')
    expect(() => parseRacesGatewayBlindGradeV1(JSON.stringify({ ...JSON.parse(valid), extra: true })))
      .toThrow('字段不在闭集')
    expect(parseRacesGatewayBlindGradeCompletionV2(valid, 'length').concrete).toBe(true)
    expect(() => parseRacesGatewayBlindGradeCompletionV2(valid.slice(0, -1), 'length'))
      .toThrow('grader 输出被截断')
  })

  it('runner 拒绝生成模型自评，不能依赖 UI 约束', async () => {
    await expect(runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      graderIdentity: { provider: 'deepseek', model: 'deepseek-chat', promptVersion: 'test-grader-v1' },
      fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
      grade: vi.fn(),
    })).rejects.toThrow('必须使用不同模型身份')
  })

  it('真实 grader 失败时签名失败 checkpoint，并立即清理当前隔离项目', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races',
        value: '潮岸民以盐誓登记亲属，钟港民以师徒谱继承身份；双方共享航道，却长期争夺司法证言权。',
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    await expect(runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      graderIdentity: { provider: 'deepseek', model: 'deepseek-reasoner', promptVersion: 'test-grader-v2' },
      fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
      grade: async () => { throw new Error('grader 输出被截断') },
    })).rejects.toThrow('empty-01 执行失败')
    expect(await db.projects.count()).toBe(0)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('通过正式 durable races Harness 生成、保存 exact manifest，并拒绝 checkpoint 篡改', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races',
        value: '雾港人以潮声确认亲缘，塔城迁民以钟谱登记身份；两群共享盐路，却因船籍继承长期冲突。',
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    const fixtures = [RACES_GATEWAY_EVAL_FIXTURES_V1[0]]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      graderIdentity: { provider: 'deepseek', model: 'deepseek-reasoner', promptVersion: 'test-grader-v1' },
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '有可用于故事的族群差异和冲突。',
        },
        evidence: {
          provider: 'deepseek', model: 'deepseek-reasoner', promptVersion: 'test-grader-v1',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.results[0]).toMatchObject({ status: 'passed', kind: 'empty' })
    expect(checkpoint.results[0].contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await verifyRacesGatewayEvalCheckpointV1(checkpoint, fixtures)).toBe(true)
    expect(await verifyRacesGatewayEvalCheckpointV1({
      ...checkpoint,
      results: [{ ...checkpoint.results[0], candidateText: '篡改' }],
    }, fixtures)).toBe(false)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('在同一冻结运行中以错误 scope 与并发 Canon 修改攻击真实候选', async () => {
    const responses = [
      '雾港人以潮声确认亲缘，塔城迁民以钟谱登记身份；两群因船籍继承长期冲突。',
      '海水保存死者遗言，因此听潮族负责司法取证，封耳族拒绝亡者证言；双方围绕港口审判权冲突。',
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races', value: responses.shift(),
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    const fixtures = [
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'empty-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'partial-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'scope-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'cas-01')!,
    ]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      graderIdentity: { provider: 'deepseek', model: 'deepseek-reasoner', promptVersion: 'test-grader-v1' },
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '满足约束。',
        },
        evidence: {
          provider: 'deepseek', model: 'deepseek-reasoner', promptVersion: 'test-grader-v1',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.results.map(item => item.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
    expect(checkpoint.results[2].crossScopeBlocked).toBe(true)
    expect(checkpoint.results[3].staleBlocked).toBe(true)
    expect(await db.worldviews.toArray()).toSatisfy((rows: Array<{ races?: string }>) => (
      rows.every(row => !row.races?.trim())
    ))
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('以确定性模型替身覆盖八类编排，并在自包含证据落盘后清理隔离项目', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const prompt = body.messages.map(message => message.content).join('\n')
      const late = /末位航契守卫\d+/.exec(prompt)?.[0]
      const pinned = /已确认成年仪式\d+/.exec(prompt)?.[0]
      const retreat = /潮民以第\s*\d+\s*次退潮为成年界线，与钟民共用一座港口。/.exec(prompt)?.[0]
      const partial = [
        '这个世界的海水会记住死者最后一句话。',
        '大陆每五十年会失去一种颜色。',
        '城市依靠借来的影子供暖。',
        '魔法只能改变已经被人记录的事物。',
        '所有河流都从内陆流向天空。',
      ].find(item => prompt.includes(item))
      const anchor = late ?? pinned ?? retreat ?? partial ?? ''
      const value = `${anchor}${anchor ? ' ' : ''}潮岸民以航季区分共同体，钟塔迁民以师徒谱登记身份；两群共享盐港，却因通行权、继承与司法证言形成可推动人物选择的长期冲突。`
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ field: 'races', value }) } }],
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      }), { status: 200 })
    }))
    const fixtures = [
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'empty-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'partial-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'late-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'pinned-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'compare-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'compare-02')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'scope-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'cas-01')!,
    ]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      graderIdentity: { provider: 'fixture', model: 'deterministic', promptVersion: 'test-grader-v1' },
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '确定性替身用于验证矩阵，不作为模型质量结论。',
        },
        evidence: {
          provider: 'fixture', model: 'deterministic', promptVersion: 'test-grader-v1',
          inputHash: 'd'.repeat(64), outputHash: 'e'.repeat(64),
          inputTokens: 1, outputTokens: 1, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.results).toHaveLength(8)
    expect(checkpoint.score).toMatchObject({ passed: true, completedCount: 8 })
    expect(checkpoint.results.filter(item => item.kind === 'late-target' && item.expectedAnchorDelivered)).toHaveLength(1)
    expect(checkpoint.results.filter(item => item.kind === 'late-target')
      .every(item => item.selectedResourceKeys.length <= 20)).toBe(true)
    expect(checkpoint.results.filter(item => item.kind === 'cross-scope-attack' && item.crossScopeBlocked)).toHaveLength(1)
    expect(checkpoint.results.filter(item => item.kind === 'concurrent-cas' && item.staleBlocked)).toHaveLength(1)
    expect(JSON.stringify(checkpoint).length).toBeLessThan(4_500_000)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  }, 30_000)
})
