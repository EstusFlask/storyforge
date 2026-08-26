import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeGameProductionCommand } from '../../src/lib/game-production/commands'
import { suggestGameStartingPoints } from '../../src/lib/game-production/consultation'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { readGameProductionDetailsV1 } from '../../src/lib/game-production/service'
import type { GameProductionBriefV3 } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function fixture() {
  const now = 1_700_000_100_000
  const projectId = await db.projects.add({
    name: 'GAMEPROD commands', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 1000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const manifestJson = JSON.stringify({
    schema: 'storyforge.world-package', version: 2, worldCode: 'command-world', worldName: '命令世界',
    workTitle: '命令作品', selectedTables: ['narrativeModules'],
    selectedNarrativeModules: [{ exportId: 0, kind: 'main', title: '主线' }],
    dependencies: [], records: {
      narrativeModules: [{ id: 'portable-main' }],
      storyArcs: [{ _exportId: 0, title: '山门支线', summary: '日落前寻找失踪的守门人' }],
    }, portableProject: {},
  })
  const worldContentHash = await hashGameProductionValueV2(JSON.parse(manifestJson))
  const revisionId = await db.worldRevisions.add({
    projectId, worldId: owned.scope.worldId, parentRevisionId: null, revision: 1, label: 'v1',
    manifestJson, contentHash: worldContentHash, createdAt: now, updatedAt: now,
  }) as number
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId: owned.scope.worldId, revisionId, version: 1, label: 'v1', manifestJson,
    contentHash: worldContentHash, sourceWorldCode: 'command-world', createdAt: now,
  }) as number
  const brief: GameProductionBriefV3 = {
    schema: 'storyforge.game-production-brief', version: 3,
    source: {
      worldReleaseId, worldContentHash,
      selection: {
        schema: 'storyforge.world-game-source', version: 2, productType: 'storygame', worldContentHash,
        narrativeModuleExportIds: [0], characterExportIds: [0], characterRelationExportIds: [],
        importantLocationExportIds: [], artifactExportIds: [], codexEntryExportIds: [], storyArcExportIds: [],
        avgMediaAssetExportIds: [], productSource: { kind: 'storygame', narrativeModuleExportIds: [0] },
      },
      startingPoint: {
        kind: 'mainline', title: '主线开场', summary: '从当前主线开始', sourceRefs: ['narrative:0'],
        protagonistRefs: ['character:0'], openingConflict: '山门即将关闭',
      },
    },
    intent: {
      productType: 'storygame', playerRole: '主角', protagonistRefs: ['character:0'],
      openingSituation: '在山门关闭前作出选择', coreExperience: ['选择与后果'], requiredFacts: ['山门日落关闭'],
      forbiddenChanges: ['不得改变主角身份'], contentBoundaries: ['不含露骨内容'], tone: ['克制', '紧张'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 20, targetWordCount: 3000, targetEndingCount: 2 },
    media: {
      visualLevel: 'key-scenes', audioLevel: 'music-sfx', imageCount: 2, musicTrackCount: 1,
      sfxCount: 2, voiceLineCount: 0, requiredMediaKinds: ['background', 'bgm', 'sfx'],
    },
    consultationBudget: { maximumModelCalls: 2, maximumInputTokens: 20_000, maximumOutputTokens: 5000, maximumCostUsd: null },
    productionBudget: {
      maximumModelCalls: 10, maximumInputTokens: 100_000, maximumOutputTokens: 30_000, maximumCostUsd: null,
      maximumMediaCalls: 5, maximumDurationMs: 3_600_000, maximumStorageBytes: 100_000_000,
    },
    qualityProfile: 'prototype',
    capabilityRequirements: [{
      requirementKey: 'text.main', mediaClass: 'text', operation: 'generate', adapterFamily: 'openai-compatible',
      minimumCapabilityVersion: '1', allowedDataClasses: ['world-selection'], maximumRequestCost: null,
      maximumTotalCost: null, rightsPolicyVersion: 'rights-v1', capabilityHash: 'b'.repeat(64), required: true,
    }],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: true, allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true, requiredGateIds: ['runtime.playable'],
      minimumMediaCoverage: 0.5, allowSoftWaivers: true,
    },
    unresolvedDecisionKeys: [],
  }
  return { ...owned, worldReleaseId, brief }
}

describe('GAMEPROD-1B · user command control plane', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('offers explainable registered-source options without starting production', async () => {
    const f = await fixture()
    const suggestions = await suggestGameStartingPoints({ scope: f.scope, worldReleaseId: f.worldReleaseId })
    expect(suggestions.suggestions.length).toBeGreaterThanOrEqual(3)
    expect(suggestions.suggestions.length).toBeLessThanOrEqual(6)
    expect(suggestions.suggestions.map(item => item.kind)).toEqual(expect.arrayContaining(['mainline', 'branch', 'custom']))
    expect(suggestions.suggestionSetHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.gameProductions.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    expect(await db.gameBuilds.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  })

  it('keeps consultation non-producing, authorizes once, then pause/resume/stop invalidates old epochs', async () => {
    const f = await fixture()
    const created = await executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-1', productionKey: 'gate-story', worldReleaseId: f.worldReleaseId, userText: '把山门主线做成游戏' },
    })
    expect(created).toMatchObject({ ok: true, stateRevision: 0, replayed: false })
    const replay = await executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-1', productionKey: 'gate-story', worldReleaseId: f.worldReleaseId, userText: '把山门主线做成游戏' },
    })
    expect(replay).toMatchObject({ ok: true, productionId: created.productionId, replayed: true })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).count()).toBe(0)
    expect(await db.agentRuns.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    expect(await db.gameDefinitions.where('workId').equals(f.scope.workId).count()).toBe(0)

    const saved = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'save-brief-revision', commandId: 'brief-1', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
    })
    expect(saved).toMatchObject({ ok: true, stateRevision: 1, result: { briefRevision: 1, status: 'brief-ready' } })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).count()).toBe(0)

    const authorized = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'start-1', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author-click-1',
      },
    })
    expect(authorized).toMatchObject({ ok: true, stateRevision: 2, result: { buildNumber: 1 } })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).count()).toBe(1)

    const paused = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'pause', commandId: 'pause-1', expectedStateRevision: 2, reason: '用户检查预算' },
    })
    expect(paused).toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).first()).toMatchObject({ status: 'paused', controlEpoch: 1 })

    const resumed = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'resume', commandId: 'resume-1', expectedStateRevision: 3 },
    })
    expect(resumed).toMatchObject({ ok: true, stateRevision: 4, result: { controlEpoch: 2, restored: 'authorized' } })

    const stopped = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'stop', commandId: 'stop-1', expectedStateRevision: 4, retention: 'keep-build' },
    })
    expect(stopped).toMatchObject({ ok: true, stateRevision: 5, result: { controlEpoch: 3 } })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).first()).toMatchObject({ status: 'cancelled', controlEpoch: 3 })
    const archived = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive-1', expectedStateRevision: 5, reason: '作者整理版本列表' },
    })
    expect(archived).toMatchObject({ ok: true, stateRevision: 6, result: { previousStatus: 'stopped' } })
    expect(await db.gameProductions.get(created.productionId)).toMatchObject({ status: 'archived' })
    const restored = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'restore-1', expectedStateRevision: 6 },
    })
    expect(restored).toMatchObject({ ok: true, stateRevision: 7, result: { restoredStatus: 'stopped' } })
    expect(await db.gameProductions.get(created.productionId)).toMatchObject({ status: 'stopped' })
    expect(await db.gameBuilds.where('productionId').equals(created.productionId).count()).toBe(1)
    const details = await readGameProductionDetailsV1(f.scope, created.productionId)
    expect(details.recentCommands.map(row => [row.type, row.status])).toEqual([
      ['restore', 'succeeded'], ['archive', 'succeeded'], ['stop', 'succeeded'], ['resume', 'succeeded'], ['pause', 'succeeded'],
      ['authorize-start', 'succeeded'], ['save-brief-revision', 'succeeded'], ['create-intent', 'succeeded'],
    ])
    expect(details.briefHistory.map(row => row.revision)).toEqual([1])
    expect(details.buildHistory.map(row => row.buildNumber)).toEqual([1])
  })

  it('uses command payload hashes and revision CAS to make double-submit deterministic', async () => {
    const f = await fixture()
    const created = await executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-cas', productionKey: 'cas-story', worldReleaseId: f.worldReleaseId, userText: 'CAS 游戏' },
    })
    const [left, right] = await Promise.all([
      executeGameProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: { type: 'save-brief-revision', commandId: 'brief-left', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
      }),
      executeGameProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: { type: 'save-brief-revision', commandId: 'brief-right', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
      }),
    ])
    expect([left, right].filter(item => item.ok)).toHaveLength(1)
    expect([left, right].find(item => !item.ok)).toMatchObject({ errorCode: 'production-state-conflict' })
    expect(await db.gameProductionBriefs.where('productionId').equals(created.productionId).count()).toBe(1)

    await expect(executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-cas', productionKey: 'cas-story', worldReleaseId: f.worldReleaseId, userText: '不同 payload' },
    })).rejects.toThrow('payload')
    expect(await db.gameProductions.where('workId').equals(f.scope.workId).count()).toBe(1)
  })

  it('可恢复归档 Preview Build，不删除 lineage、receipt 或冻结状态', async () => {
    const f = await fixture()
    const created = await executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'archive.intent', productionKey: 'archive-preview', worldReleaseId: f.worldReleaseId, userText: '归档预览' },
    })
    const saved = await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'save-brief-revision', commandId: 'archive.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
    })
    await executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'authorize-start', commandId: 'archive.start', expectedStateRevision: 1, briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'archive.click' },
    })
    const build = (await db.gameBuilds.where('productionId').equals(created.productionId).first())!
    await db.gameProductions.update(created.productionId, { status: 'preview-ready' })
    await db.gameBuilds.update(build.id!, { status: 'release-ready' })
    await expect(executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive.preview', expectedStateRevision: 2, reason: '稍后继续' },
    })).resolves.toMatchObject({ ok: true, result: { previousStatus: 'preview-ready' } })
    expect(await db.gameBuilds.get(build.id!)).toMatchObject({ status: 'archived', resumeState: 'release-ready' })
    await expect(executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'archive.restore', expectedStateRevision: 3 },
    })).resolves.toMatchObject({ ok: true, result: { restoredStatus: 'preview-ready', restoredBuildStatus: 'release-ready' } })
    expect(await db.gameBuilds.get(build.id!)).toMatchObject({ status: 'release-ready', resumeState: null })
    expect(await db.gameProductionBriefs.where('productionId').equals(created.productionId).count()).toBe(1)
    expect(await db.gameProductionCommands.where('productionId').equals(created.productionId).count()).toBe(5)
  })

  it('归档失败态后恢复原错误证据，不让版本整理覆盖诊断', async () => {
    const f = await fixture()
    const created = await executeGameProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'archive.failed.intent', productionKey: 'archive-failed', worldReleaseId: f.worldReleaseId, userText: '失败态归档' },
    })
    const failureEvidence = JSON.stringify({ code: 'provider-failed', taskKey: 'visual.hero', retryable: false })
    await db.gameProductions.update(created.productionId, { status: 'failed', lastErrorJson: failureEvidence })
    await expect(executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive.failed', expectedStateRevision: 0, reason: '收起失败版本' },
    })).resolves.toMatchObject({ ok: true, result: { previousStatus: 'failed' } })
    await expect(executeGameProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'archive.failed.restore', expectedStateRevision: 1 },
    })).resolves.toMatchObject({ ok: true, result: { restoredStatus: 'failed' } })
    expect(await db.gameProductions.get(created.productionId)).toMatchObject({
      status: 'failed', lastErrorJson: failureEvidence,
    })
  })
})
