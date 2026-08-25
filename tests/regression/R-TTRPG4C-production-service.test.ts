import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  acceptTtrpgAuthorPreviewV1,
  buildTtrpgProductionPreviewV1,
  confirmTtrpgProductionBriefV1,
  createTtrpgDevelopmentProductionV1,
  publishTtrpgProductReleaseV1,
  readTtrpgProductionDetailsV1,
  recoverInterruptedTtrpgProductionsV1,
} from '../../src/lib/ttrpg/production-service'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import type { WorkspaceScope } from '../../src/lib/types'

async function createScope(name: string): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as never) as number
  return (await ensureWorkspaceOwnership(projectId)).scope
}

describe('R-TTRPG-4C · durable product-owned production service', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('冻结开发来源→确认 Brief→可恢复 Build→作者预览，刷新后完整保留谱系', async () => {
    const scope = await createScope('跑团生产谱系')
    const created = await createTtrpgDevelopmentProductionV1({
      scope, fixtureKey: 'd100-investigation-archive',
      productionKey: 'six-testimonies', title: '六证词调查团',
    })
    expect(created.production).toMatchObject({ status: 'source-frozen', activeSourceSelectionId: expect.any(Number) })
    expect(created.sourceSelections[0]).toMatchObject({
      sourceKind: 'development-fixture', developmentOnly: true, sourceWorldReleaseId: null, status: 'frozen',
    })
    expect(created.steps.map(step => step.stepKey)).toEqual(['source-frozen'])

    const brief = await confirmTtrpgProductionBriefV1({
      scope, productionId: created.production.id!, title: '六证词调查团',
      premise: '在压力失控前找出被改写的证词。', tone: ['调查', '克制'],
      scale: { scope: 'short-arc', targetPlayMinutes: 180, targetEndingCount: 2 },
      contentBoundaries: ['不生成未授权的露骨内容'], confirmDefaultMappings: true,
      draft: {
        gmMode: 'ai',
        information: { hiddenDice: 'gm-only', characterPrivateChannels: true },
        media: {
          visualStyle: '潮湿档案馆调查插画', sceneImages: true, characterPortraits: true,
          characterExpressions: true, itemIcons: true, handouts: true, maps: true, tokens: true,
          generationTiming: 'hybrid', backgroundGeneration: true, textFallback: true,
          maximumGeneratedAssets: 32,
        },
      },
    })
    expect(brief).toMatchObject({ revision: 1, status: 'confirmed', briefHash: expect.stringMatching(/^[a-f0-9]{64}$/) })

    const build = await buildTtrpgProductionPreviewV1({ scope, productionId: created.production.id! })
    expect(build).toMatchObject({ buildNumber: 1, status: 'preview-ready', developmentOnly: true })
    expect(JSON.parse(build.validationJson)).toMatchObject({ valid: true })
    const campaign = JSON.parse(build.campaignJson) as { scenes: unknown[]; characterTemplates: unknown[]; mediaManifest?: { slots: unknown[] } }
    expect(campaign.scenes.length).toBeGreaterThanOrEqual(7)
    expect(campaign.characterTemplates.length).toBeGreaterThanOrEqual(2)
    expect(campaign.mediaManifest?.slots.length).toBeGreaterThan(0)

    const beforeAcceptance = await readTtrpgProductionDetailsV1(scope, created.production.id!)
    expect(beforeAcceptance.steps.find(step => step.buildId === build.id && step.stepKey === 'author-preview')?.status).toBe('pending')
    expect(beforeAcceptance.steps.filter(step => step.buildId === build.id && step.stepKey !== 'author-preview').every(step => step.status === 'completed')).toBe(true)

    const accepted = await acceptTtrpgAuthorPreviewV1({ scope, productionId: created.production.id!, buildId: build.id! })
    expect(accepted.status).toBe('validated')
    const reloaded = await readTtrpgProductionDetailsV1(scope, created.production.id!)
    expect(reloaded.production).toMatchObject({ status: 'preview-ready', currentBuildId: build.id })
    expect(reloaded.briefs).toHaveLength(1)
    expect(reloaded.builds).toHaveLength(1)
    expect(reloaded.steps.find(step => step.buildId === build.id && step.stepKey === 'author-preview')).toMatchObject({ status: 'completed' })
    expect(reloaded.releases).toHaveLength(0)
    await expect(publishTtrpgProductReleaseV1({ scope, productionId: created.production.id!, buildId: build.id! }))
      .rejects.toThrow(/开发测试来源.*不能正式发布/)
    expect(await db.ttrpgProductReleases.count()).toBe(0)
  })

  it('新 Brief 只追加 revision，使旧 Build 和下游步骤显式 stale/superseded', async () => {
    const scope = await createScope('跑团重新生产')
    const created = await createTtrpgDevelopmentProductionV1({
      scope, fixtureKey: 'rank-lite-mist-harbor', productionKey: 'mist-revision',
    })
    const base = {
      scope, productionId: created.production.id!, title: '雾港团', tone: ['悬疑'],
      scale: { scope: 'short-arc', targetPlayMinutes: 120, targetEndingCount: 2 },
      contentBoundaries: ['安全'], confirmDefaultMappings: true,
    }
    const firstBrief = await confirmTtrpgProductionBriefV1({ ...base, premise: '寻找失踪信号。' })
    const firstBuild = await buildTtrpgProductionPreviewV1({ scope, productionId: created.production.id! })
    await acceptTtrpgAuthorPreviewV1({ scope, productionId: created.production.id!, buildId: firstBuild.id! })
    const secondBrief = await confirmTtrpgProductionBriefV1({ ...base, premise: '保护见证人并追查印章。' })
    expect(secondBrief.revision).toBe(2)
    const afterRevision = await readTtrpgProductionDetailsV1(scope, created.production.id!)
    expect(afterRevision.briefs.find(row => row.id === firstBrief.id)?.status).toBe('superseded')
    expect(afterRevision.builds.find(row => row.id === firstBuild.id)?.status).toBe('superseded')
    expect(afterRevision.steps.filter(step => step.buildId === firstBuild.id).every(step => step.status === 'stale')).toBe(true)
    expect(afterRevision.production).toMatchObject({ status: 'brief-confirmed', currentBuildId: null, activeBriefId: secondBrief.id })
    const secondBuild = await buildTtrpgProductionPreviewV1({ scope, productionId: created.production.id! })
    expect(secondBuild.buildNumber).toBe(2)
    expect(secondBuild.campaignHash).not.toBe(firstBuild.campaignHash)
  })

  it('中断构建不会隐藏重试：恢复为 failed，下一次显式 Build 使用新编号和 attempt', async () => {
    const scope = await createScope('跑团恢复')
    const created = await createTtrpgDevelopmentProductionV1({
      scope, fixtureKey: 'd20-fantasy-floodgate', productionKey: 'recovery',
    })
    await confirmTtrpgProductionBriefV1({
      scope, productionId: created.production.id!, title: '潮门恢复团', premise: '解除要塞封锁。', tone: ['英雄'],
      scale: { scope: 'short-arc', targetPlayMinutes: 120, targetEndingCount: 2 },
      contentBoundaries: ['安全'], confirmDefaultMappings: true,
    })
    const details = await readTtrpgProductionDetailsV1(scope, created.production.id!)
    const interruptedId = await db.ttrpgProductionBuilds.add({
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: created.production.id!, sourceSelectionId: details.production.activeSourceSelectionId!,
      briefId: details.production.activeBriefId!, buildNumber: 1, status: 'building', developmentOnly: true,
      rulePackJson: '{}', rulePackHash: '', campaignJson: '{}', campaignHash: '', validationJson: '{}',
      buildHash: '', errorJson: null, createdAt: Date.now(), updatedAt: Date.now(),
    }) as number
    await db.ttrpgProductionSteps.add({
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: created.production.id!, buildId: interruptedId, stepKey: 'integration', attempt: 1,
      status: 'running', inputHash: 'a'.repeat(64), outputHash: null, checkpointJson: '{}', errorJson: null,
      startedAt: Date.now(), completedAt: null, updatedAt: Date.now(),
    })
    await db.ttrpgProductions.update(created.production.id!, { status: 'building', currentBuildId: interruptedId })
    await expect(recoverInterruptedTtrpgProductionsV1(scope)).resolves.toEqual([interruptedId])
    expect(await db.ttrpgProductionBuilds.get(interruptedId)).toMatchObject({ status: 'failed', errorJson: expect.stringContaining('interrupted') })
    expect(await db.ttrpgProductionSteps.where('buildId').equals(interruptedId).first()).toMatchObject({ status: 'failed' })
    const retried = await buildTtrpgProductionPreviewV1({ scope, productionId: created.production.id! })
    expect(retried).toMatchObject({ buildNumber: 2, status: 'preview-ready' })
    const attempts = await db.ttrpgProductionSteps.where('[productionId+stepKey]').equals([created.production.id!, 'integration']).sortBy('attempt')
    expect(attempts.map(row => row.attempt)).toEqual([1, 2])
  })

  it('跨 Work 读取和修改生产任务均 fail-closed', async () => {
    const owner = await createScope('跑团所有者')
    const outsider = await createScope('其它作品')
    const created = await createTtrpgDevelopmentProductionV1({
      scope: owner, fixtureKey: 'rank-lite-mist-harbor', productionKey: 'scoped',
    })
    await expect(readTtrpgProductionDetailsV1(outsider, created.production.id!)).rejects.toThrow(/跨 Work/)
    await expect(confirmTtrpgProductionBriefV1({
      scope: outsider, productionId: created.production.id!, title: '越权', premise: '越权', tone: ['无'],
      scale: { scope: 'scene', targetPlayMinutes: 30, targetEndingCount: 1 },
      contentBoundaries: ['安全'], confirmDefaultMappings: true,
    })).rejects.toThrow(/跨 Work/)
  })
})
