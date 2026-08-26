import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { resolvePlayableGameSource } from '../../src/lib/game-production/preview-source'
import {
  branchSimulationSession,
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  resolveTtrpgRuleAction,
} from '../../src/lib/simulation/runtime'
import {
  acceptTtrpgAuthorPreviewV1,
  buildTtrpgProductionPreviewV1,
  confirmTtrpgProductionBriefV1,
  createTtrpgDevelopmentProductionV1,
} from '../../src/lib/ttrpg/production-service'
import { parseRulePackV1 } from '../../src/lib/ttrpg/rule-pack'
import { parseTtrpgCampaignContentV1 } from '../../src/lib/ttrpg/campaign'
import type {
  TtrpgDevelopmentSourceFixtureKeyV1,
  TtrpgProductionBuildRecordV1,
  WorkspaceScope,
} from '../../src/lib/types'
import {
  assertInstanceBinding,
  createPlayableGameInstance,
} from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function createScope(name: string): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'mystery', genres: ['mystery'], status: 'drafting', description: '',
    targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as never) as number
  return (await ensureWorkspaceOwnership(projectId)).scope
}

async function createValidatedBuild(input: {
  scope: WorkspaceScope
  fixtureKey?: TtrpgDevelopmentSourceFixtureKeyV1
  productionKey: string
}): Promise<TtrpgProductionBuildRecordV1> {
  const created = await createTtrpgDevelopmentProductionV1({
    scope: input.scope,
    fixtureKey: input.fixtureKey ?? 'd100-investigation-archive',
    productionKey: input.productionKey,
  })
  const sourceCatalog = JSON.parse(
    created.sourceSelections[0].sourceCatalogJson,
  ) as { characters: Array<{ name: string }> }
  const humanSeats = sourceCatalog.characters.slice(0, 4).map((character, index) => ({
    seatKey: `player.${index + 1}`,
    label: character.name,
    controller: 'human' as const,
    role: 'player' as const,
    characterMode: 'world-template' as const,
    sourceCharacterExportId: index,
    characterName: character.name,
    rankTier: null,
    privateGoal: '',
  }))
  await confirmTtrpgProductionBriefV1({
    scope: input.scope,
    productionId: created.production.id!,
    title: '封蜡档案调查团',
    premise: '调查被改写的证词，在压力升级前找出真正的航行记录。',
    tone: ['调查', '克制', '团队协作'],
    scale: { scope: 'short-arc', targetPlayMinutes: 180, targetEndingCount: 2 },
    contentBoundaries: ['不生成未授权的露骨内容'],
    confirmDefaultMappings: true,
    draft: {
      gmMode: 'human',
      seats: humanSeats,
      information: { hiddenDice: 'gm-only', characterPrivateChannels: true },
      media: {
        visualStyle: '潮湿档案馆调查插画', sceneImages: true,
        characterPortraits: true, characterExpressions: true, itemIcons: true,
        handouts: true, maps: true, tokens: true, generationTiming: 'hybrid',
        backgroundGeneration: true, textFallback: true, maximumGeneratedAssets: 32,
      },
    },
  })
  const build = await buildTtrpgProductionPreviewV1({
    scope: input.scope,
    productionId: created.production.id!,
  })
  return acceptTtrpgAuthorPreviewV1({
    scope: input.scope,
    productionId: created.production.id!,
    buildId: build.id!,
  })
}

describe('R-TTRPG-4D · product Build launches the real runtime', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('冻结产品 Build 可开桌、完成 Session Zero、开场并结算带反馈的真实规则行动', async () => {
    const scope = await createScope('跑团产品 Build 真运行')
    const build = await createValidatedBuild({ scope, productionKey: 'runtime-mainline' })
    const source = {
      kind: 'ttrpg-build' as const,
      ttrpgBuildId: build.id!,
      expectedBuildHash: build.buildHash,
    }
    const playable = await resolvePlayableGameSource({ scope, source })
    expect(playable.runtimePackage.productType).toBe('ttrpg')
    expect(playable.sourceWorldReleaseId).toBeNull()
    const media = await playable.mediaResolver.preload({
      assetKeys: ['scene.opening.background', 'character.lead.portrait'],
      maximumBytes: 2_000_000,
    })
    expect(media.urls).toEqual({})
    expect(media.failures).toHaveLength(2)
    playable.mediaResolver.dispose()

    const session = await createPlayableGameInstance({
      scope,
      source,
      title: '封蜡档案试玩桌',
      seed: 'ttrpg-product-build-runtime',
    })
    expect(session).toMatchObject({
      kind: 'ttrpg', ttrpgBuildId: build.id, gameBuildId: null,
      gameReleaseId: null, worldReleaseId: null,
      draftSnapshotHash: playable.runtimeSourceHash,
      runtimeSourceHash: playable.runtimeSourceHash,
    })
    await expect(assertInstanceBinding(session.id!, scope)).resolves.toMatchObject({
      id: session.id,
      ttrpgBuildId: build.id,
    })

    const rulePack = parseRulePackV1(JSON.parse(build.rulePackJson))
    const campaign = parseTtrpgCampaignContentV1(JSON.parse(build.campaignJson), rulePack)
    expect(Math.max(...rulePack.diceModels.map(model => model.sides))).toBeLessThanOrEqual(100)
    let state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product).toMatchObject({
      campaignKey: campaign.campaignKey,
      rulePackContentHash: build.rulePackHash,
    })
    expect(state.ttrpg?.product?.sessionZero.completed).toBe(false)
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(session.id!).count())
      .toBe(campaign.characterTemplates.filter(row => row.role === 'player').length + 1)

    let version = await readSimulationStateVersion(session.id!)
    await completeTtrpgSessionZero({
      sessionId: session.id!, commandId: 'product-build.session-zero',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      completedBy: 'gm',
    })
    version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'product-build.opening',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      sceneKey: campaign.openingSceneKey,
    })

    state = await readSimulationState(session.id!)
    const actorKey = state.ttrpg!.activeActorKey!
    const scene = campaign.scenes.find(row => row.sceneKey === campaign.openingSceneKey)!
    const actor = campaign.characterTemplates.find(row => row.characterKey === actorKey)!
    const action = rulePack.actions.find(row =>
      scene.actionKeys.includes(row.key) && actor.actionKeys.includes(row.key))!
    expect(action).toBeDefined()
    const targetKey = action.target === 'single'
      ? state.ttrpg!.turnOrder.find(key => key !== actorKey) ?? null
      : null
    version = await readSimulationStateVersion(session.id!)
    await resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'product-build.first-action',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: action.key, actorKey, targetKey, difficulty: 8,
      declaredIntent: {
        intentKey: 'intent.product-build.first-action',
        rawInput: '我检查眼前的档案与环境，寻找能够推动调查的异常。',
        goal: '获得一条可继续追查的信息', method: '现场检查',
      },
    })
    state = await readSimulationState(session.id!)
    const result = state.ttrpg!.product!.actionHistory.at(-1)!
    expect(result).toMatchObject({
      actorKey, actionKey: action.key,
      receipt: {
        schema: 'storyforge.ttrpg-action-receipt',
        context: { declaredIntent: { intentKey: 'intent.product-build.first-action' } },
      },
    })
    if (result.check) {
      const model = rulePack.diceModels.find(row => row.key === result.check!.rule!.diceModelKey)!
      expect(model.sides).toBeLessThanOrEqual(100)
      expect(result.check.rule?.proofHash).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(result.receipt?.mechanicalSummary).toEqual(expect.any(String))
    expect(result.receipt?.actorConsequence).toEqual(expect.any(String))
    expect(result.receipt?.sceneConsequence).toEqual(expect.any(String))
    expect(result.receipt?.context.observers.length).toBe(state.ttrpg!.turnOrder.length)
    expect(result.receipt?.context.reactionWindows.map(row => row.layer)).toEqual([
      'mechanical-reaction', 'immediate-character', 'scene-consequence', 'campaign-consequence',
    ])
  })

  it('错误 hash、跨 Work 与构建内容篡改都不能启动试玩', async () => {
    const owner = await createScope('跑团 Build 所有者')
    const outsider = await createScope('跑团 Build 越权者')
    const build = await createValidatedBuild({ scope: owner, productionKey: 'runtime-guards' })
    await expect(createPlayableGameInstance({
      scope: owner,
      source: { kind: 'ttrpg-build', ttrpgBuildId: build.id!, expectedBuildHash: '0'.repeat(64) },
      title: '错误 hash',
    })).rejects.toThrow(/Build 指针 hash 不一致/)
    await expect(createPlayableGameInstance({
      scope: outsider,
      source: { kind: 'ttrpg-build', ttrpgBuildId: build.id!, expectedBuildHash: build.buildHash },
      title: '跨 Work',
    })).rejects.toThrow(/跨 Work/)
    await db.ttrpgProductionBuilds.update(build.id!, {
      campaignJson: build.campaignJson.replace('封蜡', '伪造'),
    })
    await expect(createPlayableGameInstance({
      scope: owner,
      source: { kind: 'ttrpg-build', ttrpgBuildId: build.id!, expectedBuildHash: build.buildHash },
      title: '篡改内容',
    })).rejects.toThrow(/内容 hash 校验失败/)
    expect(await db.simulationSessions.count()).toBe(0)
  })

  it('产品 Build 试玩分支继续绑定同一冻结来源并复制席位与进度', async () => {
    const scope = await createScope('跑团产品 Build 分支')
    const build = await createValidatedBuild({
      scope, fixtureKey: 'rank-lite-mist-harbor', productionKey: 'runtime-branch',
    })
    const parent = await createPlayableGameInstance({
      scope,
      source: { kind: 'ttrpg-build', ttrpgBuildId: build.id!, expectedBuildHash: build.buildHash },
      title: '雾港试玩主线', seed: 'ttrpg-product-build-branch',
    })
    const state = await readSimulationState(parent.id!)
    const version = await readSimulationStateVersion(parent.id!)
    await completeTtrpgSessionZero({
      sessionId: parent.id!, commandId: 'branch.session-zero',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      completedBy: 'gm',
    })
    const progressed = await readSimulationState(parent.id!)
    const child = await branchSimulationSession({
      parentSessionId: parent.id!, throughSequence: progressed.lastSequence,
      title: '雾港另一种选择',
    })
    expect(child).toMatchObject({
      parentSessionId: parent.id,
      ttrpgBuildId: build.id,
      gameBuildId: null,
      gameReleaseId: null,
      runtimeSourceHash: parent.runtimeSourceHash,
    })
    await expect(assertInstanceBinding(child.id!, scope)).resolves.toMatchObject({ id: child.id })
    expect((await readSimulationState(child.id!)).ttrpg?.product?.sessionZero.completed).toBe(true)
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(child.id!).count())
      .toBe(await db.ttrpgSessionParticipants.where('sessionId').equals(parent.id!).count())
  })
})
