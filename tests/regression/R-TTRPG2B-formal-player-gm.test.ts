import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { verifyGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import {
  completeTtrpgSessionZero,
  changeTtrpgSafetyStatus,
  completeTtrpgCampaignEnding,
  advanceTtrpgCharacterV1,
  commitTtrpgItemCommandV2,
  commitTtrpgEffectPlanV2,
  customizeTtrpgPlayerCharacterV1,
  branchSimulationSession,
  deleteSimulationSession,
  discoverTtrpgClue,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  resolveTtrpgRuleAction,
  resolveTtrpgRuleCheck,
  updateTtrpgTabletopV1,
} from '../../src/lib/simulation/runtime'
import {
  configureTtrpgSessionParticipantV2,
  finalizeMigratedTtrpgParticipantsV2,
  migrateLegacyTtrpgSessionParticipantsV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from '../../src/lib/ttrpg/authoring'
import { publishTtrpgCampaignReleaseV1 } from '../../src/lib/ttrpg/release'
import { parseTtrpgCampaignContentV1 } from '../../src/lib/ttrpg/campaign'
import { parseRulePackV1 } from '../../src/lib/ttrpg/rule-pack'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import type { SimulationSession, WorkspaceScope, WorldReleaseManifestV2 } from '../../src/lib/types'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const now = 1_791_000_000_000

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      { _exportId: 0, name: '林舟', identity: '谨慎的调查者', location: '雾港', roleWeight: 'main' },
      { _exportId: 1, name: '潮汐学者', identity: '负责交叉验证的同伴', location: '雾港', roleWeight: 'main' },
      { _exportId: 2, name: '守潮人', identity: '知道旧港秘密的向导', location: '雾港', roleWeight: 'npc' },
    ],
    characterRelations: [],
    importantLocations: [{ _exportId: 0, name: '雾港', description: '退潮时显露的旧港。' }],
    storyArcs: [], itemLedger: [], codexEntries: [], avgMediaAssets: [],
    narrativeModules: [], narrativeNodes: [],
  }
  return {
    schema: 'storyforge.world-package', version: 2,
    worldCode: 'mist-harbor', worldName: '潮汐界', workTitle: '雾港纪事',
    selectedTables: Object.keys(records), selectedNarrativeModules: [],
    dependencies: [], records, portableProject: {},
  }
}

async function createFormalSession(): Promise<{ session: SimulationSession; scope: WorkspaceScope }> {
  const projectId = await db.projects.add({
    name: 'TTRPG 玩家主持验收', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  const scope = (await ensureWorkspaceOwnership(projectId)).scope
  const manifest = worldManifest()
  const contentHash = await hashGameProductionValueV2(manifest)
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId: scope.worldId, revisionId: 1, version: 1, label: '潮汐界 v1',
    manifestJson: JSON.stringify(manifest), contentHash, sourceWorldCode: 'mist-harbor', createdAt: now,
  }) as number
  const rule = await installStoryForgeRulePackV1(scope)
  const campaign = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope, worldReleaseId, rulePackId: rule.id, fixtureOnly: true, confirmDefaultMappings: true,
  })
  const release = await publishTtrpgCampaignReleaseV1({ scope, campaignModuleId: campaign.id!, testOnlyAllowFixtureCampaign: true })
  const session = await createWorldInstance({
    scope, kind: 'ttrpg', title: '雾港调查战役', worldGroupId: null,
    gameSource: { kind: 'release', gameReleaseId: release.id! }, seed: 'formal-player-gm',
  })
  return { session, scope }
}

async function completeSessionZero(sessionId: number) {
  const state = await readSimulationState(sessionId)
  const version = await readSimulationStateVersion(sessionId)
  return completeTtrpgSessionZero({
    sessionId,
    commandId: 'session-zero.accept.v1',
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: 'gm',
  })
}

describe('TTRPG-2B · formal player and GM commands', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Session Zero 必须全量确认并提供精确幂等与陈旧状态保护', async () => {
    const { session } = await createFormalSession()
    const original = await readSimulationStateVersion(session.id!)
    await expect(completeTtrpgSessionZero({
      sessionId: session.id!, commandId: 'session-zero.incomplete',
      baseSequence: original.sequence, baseStateHash: original.stateHash,
      acceptedItemKeys: ['consent.1'], completedBy: 'gm',
    })).rejects.toThrow('必须确认全部')

    const first = await completeSessionZero(session.id!)
    const replay = await completeTtrpgSessionZero({
      sessionId: session.id!, commandId: 'session-zero.accept.v1',
      baseSequence: original.sequence, baseStateHash: original.stateHash,
      acceptedItemKeys: (await readSimulationState(session.id!)).ttrpg!.product!.sessionZero.requiredItemKeys,
      completedBy: 'gm',
    })
    expect(replay.id).toBe(first.id)
    expect((await readSimulationState(session.id!)).ttrpg?.product?.sessionZero).toMatchObject({
      completed: true, completedBy: 'gm', completedAtSequence: first.sequence,
    })
    const participants = await readTtrpgSessionParticipantsV2(session.id!)
    expect(participants).toHaveLength(3)
    expect(participants.every(row => row.sessionZeroAcceptedAtSequence === first.sequence)).toBe(true)
    expect(participants.filter(row => row.role === 'player').every(row => row.assignmentState === 'claimed')).toBe(true)
    await expect(openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.stale',
      baseSequence: original.sequence, baseStateHash: original.stateHash, sceneKey: 'scene.opening',
    })).rejects.toThrow('状态已变化')
  })

  it('席位控制权和 AI 代打同意独立持久化，未授权、陈旧配置与空缺席位均拒绝', async () => {
    const { session } = await createFormalSession()
    let participants = await readTtrpgSessionParticipantsV2(session.id!)
    const player = participants.find(row => row.role === 'player')!
    await expect(configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: player.revision,
      commandId: 'seat.unauthorized', requestedByViewerKey: 'viewer.stranger',
      activation: 'natural',
    })).rejects.toThrow('只有席位本人或 GM')
    await expect(configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: player.revision,
      commandId: 'seat.no-consent', requestedByViewerKey: player.viewerKey,
      controller: 'hybrid', substitutionPolicy: 'with-owner-consent',
      consent: { aiIdentityDisclosed: true },
    })).rejects.toThrow('未记录本人同意')
    const configured = await configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: player.revision,
      commandId: 'seat.hybrid-consented', requestedByViewerKey: player.viewerKey,
      controller: 'hybrid', activation: 'natural', substitutionPolicy: 'with-owner-consent',
      consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true, aiSubstitutionAllowed: true },
    })
    expect(configured).toMatchObject({
      controller: 'hybrid', activation: 'natural', substitutionPolicy: 'with-owner-consent',
      consent: { aiAdviceAllowed: true, aiSubstitutionAllowed: true },
      revision: player.revision + 1,
    })
    await expect(configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: player.revision,
      commandId: 'seat.stale', requestedByViewerKey: player.viewerKey,
      activation: 'pooled',
    })).rejects.toThrow('已被其他配置更新')

    await completeSessionZero(session.id!)
    participants = await readTtrpgSessionParticipantsV2(session.id!)
    expect(participants.find(row => row.seatKey === player.seatKey)).toMatchObject({
      controller: 'hybrid', assignmentState: 'claimed', sessionZeroAcceptedAtSequence: expect.any(Number),
    })
    await expect(configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: configured.revision + 1,
      commandId: 'seat.after-zero', requestedByViewerKey: player.viewerKey,
      activation: 'pooled',
    })).rejects.toThrow('Session Zero 完成后')
  })

  it('席位记录随 Instance 删除级联，不残留玩家同意或 viewer 绑定', async () => {
    const { session } = await createFormalSession()
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(session.id!).count()).toBeGreaterThan(0)
    await deleteSimulationSession(session.id!)
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(session.id!).count()).toBe(0)
  })

  it('旧会话只从冻结 Release 显式重建席位，绝不推断历史同意，并支持已开团桌重新确认', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    const started = await readSimulationState(session.id!)
    await db.ttrpgSessionParticipants.where('sessionId').equals(session.id!).delete()
    await expect(readTtrpgSessionParticipantsV2(session.id!)).rejects.toThrow('安全迁移')

    const migrated = await migrateLegacyTtrpgSessionParticipantsV2({
      sessionId: session.id!, commandId: 'legacy-seats.v2', requestedByViewerKey: 'viewer.gm',
    })
    expect(migrated).toHaveLength(3)
    expect(migrated.every(row => row.sessionZeroAcceptedAtSequence == null
      && !row.consent.safetyBoundariesAccepted
      && !row.consent.aiIdentityDisclosed
      && !row.consent.aiSubstitutionAllowed)).toBe(true)
    expect(await migrateLegacyTtrpgSessionParticipantsV2({
      sessionId: session.id!, commandId: 'legacy-seats.v2', requestedByViewerKey: 'viewer.gm',
    })).toHaveLength(3)

    const player = migrated.find(row => row.role === 'player')!
    const hybrid = await configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey, expectedRevision: player.revision,
      commandId: 'legacy-seat.hybrid', requestedByViewerKey: 'viewer.gm', controller: 'hybrid',
      consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true },
    })
    expect(hybrid.consent.safetyBoundariesAccepted).toBe(false)
    const confirmed = await finalizeMigratedTtrpgParticipantsV2({
      sessionId: session.id!, baseSequence: started.lastSequence,
      selectedCharacterKeys: started.ttrpg!.product!.sessionZero.selectedCharacterKeys,
      commandId: 'legacy-reconsent.v2', requestedByViewerKey: 'viewer.gm',
    })
    const active = confirmed.filter(row => row.role === 'gm'
      || started.ttrpg!.product!.sessionZero.selectedCharacterKeys.includes(row.actorKey ?? ''))
    expect(active.every(row => row.consent.safetyBoundariesAccepted
      && row.sessionZeroAcceptedAtSequence === started.lastSequence)).toBe(true)
    await expect(configureTtrpgSessionParticipantV2({
      sessionId: session.id!, seatKey: player.seatKey,
      expectedRevision: hybrid.revision + 1, commandId: 'legacy-seat.after-confirm',
      requestedByViewerKey: 'viewer.gm', activation: 'pooled',
    })).rejects.toThrow('Session Zero 完成后')
  })

  it('角色创建器只允许在 Session Zero 前按 RulePack 点数重配，并可安全进入分支', async () => {
    const { session } = await createFormalSession()
    let version = await readSimulationStateVersion(session.id!)
    await expect(customizeTtrpgPlayerCharacterV1({
      sessionId: session.id!, commandId: 'character.invalid-budget',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      characterKey: 'release-character:0', name: '林舟·改', description: '更擅长调查的谨慎角色。',
      attributes: { body: 1, mind: 4, presence: 1 },
    })).rejects.toThrow('属性点必须保持')

    const customized = await customizeTtrpgPlayerCharacterV1({
      sessionId: session.id!, commandId: 'character.valid',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      characterKey: 'release-character:0', name: '林舟·听潮者', description: '放弃蛮力、专注推理的调查者。',
      attributes: { body: 0, mind: 2, presence: 1 },
      identity: {
        pronouns: '她/她', gender: '女性', age: '27', ancestry: '潮汐界人', occupation: '档案调查员',
        appearance: '深色雨衣与旧式录音机。', origin: '雾港北岸', background: '曾参与导师的潮门信号研究。',
        personalityTraits: ['谨慎', '执着'], beliefs: ['证据应当经得起交叉验证'], flaws: ['过度独自承担风险'],
        fears: ['导师的失踪是自己的错误'], desires: ['找到导师并公开真相'], boundaries: ['不替其他玩家决定'],
        shortTermGoal: '找到失踪导师', longTermGoal: '重建雾港档案网络',
        publicKnowledge: ['档案调查员'], privateKnowledge: ['曾隐瞒一段失真的录音'],
        safetyNotes: ['遵守暂停信号'], portrayal: '先观察证据，再明确表达判断。',
        voice: '语速克制，提及导师时会停顿。', sampleLines: ['这段记录的时间对不上。'],
      },
    })
    const state = await readSimulationState(session.id!)
    expect(state.entities['release-character:0']).toMatchObject({
      name: '林舟·听潮者', attributes: { identity: '放弃蛮力、专注推理的调查者。', body: 0, mind: 2, presence: 1 },
    })
    expect(state.ttrpg?.product?.characterCustomizations).toEqual([
      expect.objectContaining({
        characterKey: 'release-character:0', customizedAtSequence: customized.sequence,
        characterSheet: expect.objectContaining({
          schema: 'storyforge.ttrpg-character-sheet', version: 2,
          identity: expect.objectContaining({ gender: '女性', privateKnowledge: ['曾隐瞒一段失真的录音'] }),
          gates: expect.objectContaining({ characterComplete: true, ruleLegal: true, secretScope: true }),
        }),
      }),
    ])
    const child = await branchSimulationSession({
      parentSessionId: session.id!, throughSequence: state.lastSequence, title: '自定义角色分支',
    })
    expect((await readSimulationState(child.id!)).entities['release-character:0'].name).toBe('林舟·听潮者')

    await completeSessionZero(session.id!)
    version = await readSimulationStateVersion(session.id!)
    await expect(customizeTtrpgPlayerCharacterV1({
      sessionId: session.id!, commandId: 'character.after-zero',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      characterKey: 'release-character:0', name: '越界改名', description: '不应成功。',
      attributes: { body: 0, mind: 2, presence: 1 },
    })).rejects.toThrow('Session Zero')
  })

  it('正式场景来自 CampaignPack，线索只能在所属场景发现并可由私密升级为队伍公开', async () => {
    const { session } = await createFormalSession()
    const beforeZero = await readSimulationStateVersion(session.id!)
    await expect(openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.before-zero',
      baseSequence: beforeZero.sequence, baseStateHash: beforeZero.stateHash, sceneKey: 'scene.opening',
    })).rejects.toThrow('Session Zero')
    await completeSessionZero(session.id!)
    const sceneVersion = await readSimulationStateVersion(session.id!)
    const opened = await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.opening.v1',
      baseSequence: sceneVersion.sequence, baseStateHash: sceneVersion.stateHash, sceneKey: 'scene.opening',
    })
    expect(opened.targetKey).toBe('release-location:0')
    expect((await readSimulationState(session.id!)).ttrpg?.scene?.sceneKey).toBe('scene.opening')

    const privateVersion = await readSimulationStateVersion(session.id!)
    await discoverTtrpgClue({
      sessionId: session.id!, commandId: 'clue.timeline.private',
      baseSequence: privateVersion.sequence, baseStateHash: privateVersion.stateHash,
      clueKey: 'clue.timeline', actorKey: 'release-character:0', visibility: 'private',
    })
    const partyVersion = await readSimulationStateVersion(session.id!)
    await discoverTtrpgClue({
      sessionId: session.id!, commandId: 'clue.timeline.party',
      baseSequence: partyVersion.sequence, baseStateHash: partyVersion.stateHash,
      clueKey: 'clue.timeline', actorKey: 'release-character:0', visibility: 'party',
    })
    expect((await readSimulationState(session.id!)).ttrpg?.product?.discoveredClues).toEqual([
      expect.objectContaining({ clueKey: 'clue.timeline', visibility: 'party' }),
    ])
    const duplicateVersion = await readSimulationStateVersion(session.id!)
    await expect(discoverTtrpgClue({
      sessionId: session.id!, commandId: 'clue.timeline.duplicate',
      baseSequence: duplicateVersion.sequence, baseStateHash: duplicateVersion.stateHash,
      clueKey: 'clue.timeline', actorKey: 'release-character:0', visibility: 'party',
    })).rejects.toThrow('已经发现')
  })

  it('Session Zero 冻结本局角色编组，安全暂停在事件层阻断全部正式推进并可恢复', async () => {
    const { session } = await createFormalSession()
    let state = await readSimulationState(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await completeTtrpgSessionZero({
      sessionId: session.id!, commandId: 'roster.zero',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
      selectedCharacterKeys: ['release-character:0'], completedBy: 'gm',
    })
    version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'roster.scene',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.sessionZero.selectedCharacterKeys).toEqual(['release-character:0'])
    expect(new Set(state.ttrpg?.turnOrder)).toEqual(new Set(['release-character:0', 'release-character:2']))
    expect(state.ttrpg?.initiative?.entries.map(entry => entry.actorKey)).toEqual(state.ttrpg?.turnOrder)
    expect(state.ttrpg!.initiative!.entries[0].total).toBeGreaterThanOrEqual(state.ttrpg!.initiative!.entries[1].total)

    version = await readSimulationStateVersion(session.id!)
    const paused = await changeTtrpgSafetyStatus({
      sessionId: session.id!, commandId: 'roster.pause',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      status: 'paused', reason: '重新确认人物冲突边界', changedBy: 'player',
    })
    expect((await readSimulationState(session.id!)).ttrpg?.product?.safety).toMatchObject({
      status: 'paused', reason: '重新确认人物冲突边界', changedBy: 'player', changedAtSequence: paused.sequence,
    })
    version = await readSimulationStateVersion(session.id!)
    await expect(resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'roster.blocked-action',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'investigate', actorKey: 'release-character:0', difficulty: 8,
    })).rejects.toThrow('安全工具暂停')

    const resumed = await changeTtrpgSafetyStatus({
      sessionId: session.id!, commandId: 'roster.resume',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      status: 'active', changedBy: 'gm',
    })
    expect((await readSimulationState(session.id!)).ttrpg?.product?.safety).toMatchObject({
      status: 'active', reason: null, changedBy: 'gm', changedAtSequence: resumed.sequence,
    })
    const resumedActorKey = (await readSimulationState(session.id!)).ttrpg!.activeActorKey!
    version = await readSimulationStateVersion(session.id!)
    await expect(resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'roster.resumed-action',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'investigate', actorKey: resumedActorKey, difficulty: 8,
    })).resolves.toMatchObject({ type: 'ttrpg.rule.action.resolved' })
  })

  it('玩家投影不包含未来场景、GM 秘密或其他角色的私密线索', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'viewer.opening',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    version = await readSimulationStateVersion(session.id!)
    await discoverTtrpgClue({
      sessionId: session.id!, commandId: 'viewer.private-clue',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      clueKey: 'clue.timeline', actorKey: 'release-character:0', visibility: 'private',
    })
    const release = await db.gameReleases.get(session.gameReleaseId!)
    const manifest = await verifyGameReleaseManifestV2(release!.manifestJson)
    const rulePack = parseRulePackV1(manifest.runtimePackage.ttrpg!.rulePack.content)
    const campaign = parseTtrpgCampaignContentV1(manifest.runtimePackage.ttrpg!.campaign, rulePack)
    const state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.openedSceneKeys).toEqual(['scene.opening'])

    const gm = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'gm' })
    const owner = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'player', actorKey: 'release-character:0' })
    const other = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'player', actorKey: 'release-character:1' })
    expect(JSON.stringify(gm)).toContain('两条线索分别指向时间与动机')
    expect(owner.visibleClues.map(item => item.clueKey)).toEqual(['clue.timeline'])
    expect(other.visibleClues).toEqual([])
    expect(owner.actors.find(actor => actor.actorKey === 'release-character:0')?.characterSheet.privateFieldsVisible).toBe(true)
    expect(owner.actors.find(actor => actor.actorKey === 'release-character:1')?.characterSheet.privateFieldsVisible).toBe(false)
    expect(other.actors.find(actor => actor.actorKey === 'release-character:0')?.characterSheet.identity.privateKnowledge).toEqual([])
    for (const playerView of [owner, other]) {
      const bytes = JSON.stringify(playerView)
      expect(bytes).not.toContain('两条线索分别指向时间与动机')
      // “交叉验证”也可能合法出现在该玩家自己的冻结角色背景中；
      // 隔离边界应检查锁定场景字段，而不是对玩家已知文本做全局关键词封禁。
      expect(bytes).not.toContain('最终对质')
      expect(playerView.scenes.filter(item => item.status === 'locked').every(item => (
        item.sceneKey == null && item.title == null && item.description == null && item.gmSecret == null
      ))).toBe(true)
    }
  })

  it('冻结桌面随场景切换，玩家看不到 GM 图层、隐藏 token 或迷雾标题', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'tabletop.opening',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    let state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.tabletop?.currentMapKey).toBe('map.scene.opening')
    const release = await db.gameReleases.get(session.gameReleaseId!)
    const manifest = await verifyGameReleaseManifestV2(release!.manifestJson)
    const rulePack = parseRulePackV1(manifest.runtimePackage.ttrpg!.rulePack.content)
    const campaign = parseTtrpgCampaignContentV1(manifest.runtimePackage.ttrpg!.campaign, rulePack)
    const gm = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'gm' })
    const player = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'player', actorKey: 'release-character:0' })
    expect(gm.tabletop).toMatchObject({ mapKey: 'map.scene.opening', width: 20, height: 12 })
    expect(gm.tabletop?.layers.some(layer => layer.gmOnly)).toBe(true)
    expect(gm.tabletop?.tokens.some(token => token.hidden)).toBe(true)
    expect(player.tabletop?.layers.every(layer => !layer.gmOnly)).toBe(true)
    expect(player.tabletop?.areas.every(area => !area.gmOnly)).toBe(true)
    expect(player.tabletop?.tokens.every(token => !token.hidden)).toBe(true)
    expect(player.tabletop?.fog.every(fog => fog.title == null)).toBe(true)
    expect(JSON.stringify(player)).not.toContain('GM 隐藏区')
    expect(JSON.stringify(player)).not.toContain('GM 线索标记')

    version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'tabletop.crosscheck',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.crosscheck',
    })
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.tabletop?.currentMapKey).toBe('map.scene.crosscheck')
  })

  it('桌面移动、迷雾和图层只走正式幂等事件，并按玩家控制权拒绝越权', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'tabletop-authority.opening',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    const initialTabletop = (await readSimulationState(session.id!)).ttrpg!.product!.tabletop!
    const controlledToken = initialTabletop.tokens.find(token => token.mapKey === initialTabletop.currentMapKey && token.controllerKey != null)!
    const gmToken = initialTabletop.tokens.find(token => token.mapKey === initialTabletop.currentMapKey && token.controllerKey == null)!
    version = await readSimulationStateVersion(session.id!)
    const move = {
      sessionId: session.id!, commandId: 'tabletop.move.player',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      role: 'player' as const, actorKey: controlledToken.controllerKey!,
      operation: { kind: 'move-token' as const, tokenKey: controlledToken.tokenKey, x: 42, y: 53 },
    }
    const moved = await updateTtrpgTabletopV1(move)
    expect((await updateTtrpgTabletopV1(move)).id).toBe(moved.id)
    let state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.tabletop?.tokens.find(token => token.tokenKey === controlledToken.tokenKey)).toMatchObject({ x: 42, y: 53 })

    version = await readSimulationStateVersion(session.id!)
    await expect(updateTtrpgTabletopV1({
      sessionId: session.id!, commandId: 'tabletop.move.other',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      role: 'player', actorKey: controlledToken.controllerKey!,
      operation: { kind: 'move-token', tokenKey: gmToken.tokenKey, x: 10, y: 10 },
    })).rejects.toThrow('只能移动自己控制')
    await expect(updateTtrpgTabletopV1({
      sessionId: session.id!, commandId: 'tabletop.fog.player',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      role: 'player', actorKey: controlledToken.controllerKey!,
      operation: { kind: 'set-fog', fogKey: 'fog.scene.opening.focus', revealed: true },
    })).rejects.toThrow('只有 GM')

    const revealed = await updateTtrpgTabletopV1({
      sessionId: session.id!, commandId: 'tabletop.fog.gm',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      role: 'gm', actorKey: 'gm',
      operation: { kind: 'set-fog', fogKey: 'fog.scene.opening.focus', revealed: true },
    })
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.tabletop).toMatchObject({
      revealedFogKeys: ['fog.scene.opening.focus'], updatedAtSequence: revealed.sequence,
    })
    const child = await branchSimulationSession({
      parentSessionId: session.id!, throughSequence: state.lastSequence, title: '桌面状态分支',
    })
    expect((await readSimulationState(child.id!)).ttrpg?.product?.tabletop?.revealedFogKeys)
      .toEqual(['fog.scene.opening.focus'])
  })

  it('玩家正常行动只使用冻结 RulePack，并持久化可审计确定性证明', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.opening.check',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    const activeActorKey = (await readSimulationState(session.id!)).ttrpg!.activeActorKey!
    expect((await readSimulationState(session.id!)).entities[activeActorKey].kind).toBe('player')
    version = await readSimulationStateVersion(session.id!)
    const input = {
      sessionId: session.id!, commandId: 'rule.investigate.1',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'investigate', actorKey: activeActorKey, difficulty: 8,
    }
    const first = await resolveTtrpgRuleCheck(input)
    const replay = await resolveTtrpgRuleCheck(input)
    expect(replay.id).toBe(first.id)
    const state = await readSimulationState(session.id!)
    const check = state.ttrpg?.checks.at(-1)
    expect(check?.rule).toMatchObject({
      actionKey: 'investigate', checkKey: 'standard', attributeKey: 'mind',
      rulePackContentHash: state.ttrpg?.product?.rulePackContentHash,
    })
    expect(check?.rule?.proofHash).toMatch(/^[0-9a-f]{64}$/)
    expect(check?.total).toBe(check!.dice.reduce((sum, die) => sum + die, check!.modifier))
  })

  it('完整规则行动原子结算资源、状态、伤害与回合推进', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.opening.effects',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.crosscheck.effects',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.crosscheck',
    })
    let before = await readSimulationState(session.id!)
    const assistingActorKey = before.ttrpg!.activeActorKey!
    const assistedActorKey = before.ttrpg!.turnOrder.find(key => key !== assistingActorKey)!
    expect(before.entities[assistingActorKey].kind).toBe('player')
    const focusBefore = before.entities[assistingActorKey].attributes['resource.focus']
    expect(before.ttrpg?.product?.actionEconomy).toMatchObject({
      sceneKey: 'scene.crosscheck', round: 1, activeActorKey: assistingActorKey,
    })
    version = await readSimulationStateVersion(session.id!)
    await resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'rule.assist.effects',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'assist', actorKey: assistingActorKey, targetKey: assistedActorKey,
    })
    let state = await readSimulationState(session.id!)
    expect(state.entities[assistingActorKey].attributes['resource.focus']).toBe(Number(focusBefore) - 1)
    expect(state.ttrpg?.product?.conditions[assistedActorKey]).toEqual([
      { conditionKey: 'inspired', stacks: 1, duration: 1 },
    ])
    expect(state.ttrpg?.activeActorKey).toBe(assistedActorKey)
    expect(state.ttrpg?.product?.actionEconomy?.budgets[assistingActorKey].actionsRemaining).toBe(0)
    expect(state.ttrpg?.product?.actionEconomy?.activeActorKey).toBe(assistedActorKey)
    expect(state.ttrpg?.product?.abilityStates?.[`${assistingActorKey}::assist`]?.lastUsedEventId).toBe(`event.${state.ttrpg?.product?.actionHistory[0].eventSequence}`)

    version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.confrontation.effects',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.confrontation',
    })
    before = await readSimulationState(session.id!)
    const strikingActorKey = before.ttrpg!.activeActorKey!
    const strikeTargetKey = before.ttrpg!.turnOrder.find(key => key !== strikingActorKey)!
    const strikingIndex = before.ttrpg!.turnOrder.indexOf(strikingActorKey)
    const expectedNextActorKey = before.ttrpg!.turnOrder[(strikingIndex + 1) % before.ttrpg!.turnOrder.length]
    const vigorBefore = Number(before.entities[strikeTargetKey].attributes['resource.vigor'])
    version = await readSimulationStateVersion(session.id!)
    await resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'rule.strike.effects',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'strike', actorKey: strikingActorKey, targetKey: strikeTargetKey, difficulty: 0,
    })
    state = await readSimulationState(session.id!)
    const history = state.ttrpg?.product?.actionHistory ?? []
    const result = history[history.length - 1]
    expect(result?.outcome).toMatch(/success/)
    expect(Number(state.entities[strikeTargetKey].attributes['resource.vigor'])).toBeLessThan(vigorBefore)
    expect(result?.resourceChanges[0].proofHash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.ttrpg?.activeActorKey).toBe(expectedNextActorKey)
    expect(result?.receipt).toMatchObject({
      schema: 'storyforge.ttrpg-action-receipt', version: 2,
      actionSequence: result?.eventSequence, terminalStatus: 'resolved-check',
      context: {
        schema: 'storyforge.ttrpg-action-context', version: 2,
        sceneKey: 'scene.confrontation', actorKey: strikingActorKey,
        targetKey: strikeTargetKey, criticality: 'critical',
      },
      nextActorKey: expectedNextActorKey,
    })
    expect(result?.receipt?.context.observers.map(observer => observer.actorKey))
      .toEqual(before.ttrpg?.turnOrder)
    expect(result?.receipt?.context.reactionWindows.map(window => window.layer)).toEqual([
      'mechanical-reaction', 'immediate-character', 'scene-consequence', 'campaign-consequence',
    ])
    expect(result?.receipt?.changedEntityKeys).toContain(strikeTargetKey)
    expect(result?.receipt?.worldConsequence).toContain('不会直接修改世界 Canon')

    const child = await branchSimulationSession({
      parentSessionId: session.id!, throughSequence: state.lastSequence, title: '对质后的分支',
    })
    const childState = await readSimulationState(child.id!)
    expect(child.gameReleaseId).toBe(session.gameReleaseId)
    expect(childState.lastSequence).toBe(0)
    expect(childState.ttrpg?.product?.actionHistory).toHaveLength(2)
    expect(childState.entities[strikeTargetKey].attributes['resource.vigor'])
      .toBe(state.entities[strikeTargetKey].attributes['resource.vigor'])
    const [parentParticipants, childParticipants] = await Promise.all([
      readTtrpgSessionParticipantsV2(session.id!), readTtrpgSessionParticipantsV2(child.id!),
    ])
    expect(childParticipants.map(row => ({ seatKey: row.seatKey, controller: row.controller, consent: row.consent })))
      .toEqual(parentParticipants.map(row => ({ seatKey: row.seatKey, controller: row.controller, consent: row.consent })))
  })

  it('非当前角色可消耗 reaction 预算护援，且不抢走当前行动者的回合', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'scene.reaction',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    const before = await readSimulationState(session.id!)
    const activeActorKey = before.ttrpg!.activeActorKey!
    const reactingActorKey = before.ttrpg!.turnOrder.find(key => key !== activeActorKey)!
    version = await readSimulationStateVersion(session.id!)
    await resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'rule.guard.reaction',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actionKey: 'guard', actorKey: reactingActorKey, targetKey: activeActorKey,
    })
    const state = await readSimulationState(session.id!)
    expect(state.ttrpg?.activeActorKey).toBe(activeActorKey)
    expect(state.ttrpg?.product?.actionEconomy?.budgets[reactingActorKey].reactionsRemaining).toBe(0)
    expect(state.ttrpg?.product?.conditions[activeActorKey]).toEqual([
      { conditionKey: 'inspired', stacks: 1, duration: 1 },
    ])
    const stale = await readSimulationStateVersion(session.id!)
    await expect(resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'rule.guard.reaction.again',
      baseSequence: stale.sequence, baseStateHash: stale.stateHash,
      actionKey: 'guard', actorKey: reactingActorKey, targetKey: activeActorKey,
    })).rejects.toThrow('反应次数已经耗尽')
  })

  it('ItemInstance 转移通过正式事件原子提交，重试不复制且陈旧所有者被拒绝', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let state = await readSimulationState(session.id!)
    const item = Object.values(state.ttrpg!.product!.inventory!.items)[0]
    const itemCount = Object.keys(state.ttrpg!.product!.inventory!.items).length
    const destination = state.ttrpg!.product!.sessionZero.selectedCharacterKeys.find(key => key !== item.ownerRef)!
    let version = await readSimulationStateVersion(session.id!)
    const commandId = 'item.transfer.formal.1'
    const input = {
      sessionId: session.id!, commandId,
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      requestedBy: { role: 'gm' as const, actorKey: 'gm' },
      command: {
        commandId, kind: 'transfer' as const, instanceId: item.itemInstanceId,
        expectedOwnerRef: item.ownerRef, destinationOwnerRef: destination,
      },
    }
    const committed = await commitTtrpgItemCommandV2(input)
    expect((await commitTtrpgItemCommandV2(input)).id).toBe(committed.id)
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.inventory?.items[item.itemInstanceId].ownerRef).toBe(destination)
    expect(Object.keys(state.ttrpg!.product!.inventory!.items)).toHaveLength(itemCount)
    version = await readSimulationStateVersion(session.id!)
    await expect(commitTtrpgItemCommandV2({
      sessionId: session.id!, commandId: 'item.transfer.formal.stale',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      requestedBy: { role: 'gm', actorKey: 'gm' },
      command: {
        commandId: 'item.transfer.formal.stale', kind: 'transfer', instanceId: item.itemInstanceId,
        expectedOwnerRef: item.ownerRef, destinationOwnerRef: destination,
      },
    })).rejects.toThrow('所有者已变化')
  })

  it('奖励惩罚 EffectPlan 将成长、关系、状态、物品和剧情时钟一次提交且失败不留半笔', async () => {
    const { session } = await createFormalSession()
    const zero = await completeSessionZero(session.id!)
    let state = await readSimulationState(session.id!)
    const actorKey = state.ttrpg!.product!.sessionZero.selectedCharacterKeys[0]
    let version = await readSimulationStateVersion(session.id!)
    const commandId = 'effect.reward.bundle.1'
    const plan = {
      schema: 'storyforge.ttrpg-effect-plan' as const, version: 2 as const,
      planKey: 'reward.bundle.1', degree: 'success' as const,
      sourceEventId: `event.${zero.sequence}`, ruleRef: 'reward.scene-clear',
      reason: '完成场景目标后的公开奖励与代价。', audience: 'party' as const,
      idempotencyKey: commandId, status: 'immediate' as const,
      effects: [
        { effectKey: 'xp', family: 'advancement' as const, operation: 'xp' as const, targetRef: actorKey, advancementKey: 'growth', amount: 3 },
        { effectKey: 'bond', family: 'social' as const, operation: 'relationship' as const, targetRef: actorKey, socialKey: 'party-trust', amount: 1 },
        { effectKey: 'pressure', family: 'story' as const, operation: 'clock.advance' as const, targetRef: 'campaign', storyKey: 'danger', value: 1 },
        { effectKey: 'condition', family: 'condition' as const, operation: 'condition.apply' as const, targetRef: actorKey, conditionKey: 'inspired', stacks: 1, duration: 1 },
        { effectKey: 'loot', family: 'item' as const, operation: 'item.grant' as const, targetRef: actorKey, itemDefinitionRef: 'protective-gear', itemInstanceRef: null, destinationRef: null, amount: 1 },
      ],
    }
    const event = await commitTtrpgEffectPlanV2({
      sessionId: session.id!, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash, plan,
    })
    expect((await commitTtrpgEffectPlanV2({
      sessionId: session.id!, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash, plan,
    })).id).toBe(event.id)
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.effectLedger).toMatchObject({
      appliedIdempotencyKeys: [commandId],
      advancementBalances: { [`${actorKey}:xp:growth`]: 3 },
      socialBalances: { [`${actorKey}:relationship:party-trust`]: 1 },
      storyClocks: { 'campaign:danger': 1 },
    })
    expect(state.ttrpg?.product?.conditions[actorKey]).toContainEqual({ conditionKey: 'inspired', stacks: 1, duration: 1 })
    expect(Object.values(state.ttrpg!.product!.inventory!.items).some(item => (
      item.ownerRef === actorKey && item.acquiredByEventId === `event.${event.sequence}`
    ))).toBe(true)

    const bodyBefore = Number(state.entities[actorKey].attributes.body)
    const vigorMaximumBefore = Number(state.entities[actorKey].attributes['resourceMax.vigor'])
    version = await readSimulationStateVersion(session.id!)
    const advancement = await advanceTtrpgCharacterV1({
      sessionId: session.id!, commandId: 'advance.body.1',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      characterKey: actorKey, kind: 'attribute', targetKey: 'body',
    })
    state = await readSimulationState(session.id!)
    expect(state.entities[actorKey].attributes.body).toBe(bodyBefore + 1)
    expect(state.entities[actorKey].attributes['resourceMax.vigor']).toBe(vigorMaximumBefore + 2)
    expect(state.ttrpg?.product?.characterProgression?.[actorKey]).toMatchObject({
      spentCurrency: 3, attributeIncreases: { body: 1 },
      history: [{ eventSequence: advancement.sequence, kind: 'attribute', targetKey: 'body', before: bodyBefore, after: bodyBefore + 1, cost: 3 }],
    })

    version = await readSimulationStateVersion(session.id!)
    await expect(commitTtrpgEffectPlanV2({
      sessionId: session.id!, commandId: 'effect.invalid.reclaim-spent',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      plan: {
        ...plan, planKey: 'reward.invalid-reclaim', idempotencyKey: 'effect.invalid.reclaim-spent',
        sourceEventId: `event.${advancement.sequence}`, effects: [
          { effectKey: 'xp-penalty', family: 'advancement', operation: 'xp', targetRef: actorKey, advancementKey: 'growth', amount: -1 },
        ],
      },
    })).rejects.toThrow('不能追回')

    const beforeEntries = state.ttrpg!.product!.effectLedger!.entries.length
    version = await readSimulationStateVersion(session.id!)
    await expect(commitTtrpgEffectPlanV2({
      sessionId: session.id!, commandId: 'effect.invalid.atomic',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      plan: {
        ...plan, planKey: 'reward.invalid', idempotencyKey: 'effect.invalid.atomic', sourceEventId: `event.${event.sequence}`,
        effects: [
          { effectKey: 'xp-first', family: 'advancement', operation: 'xp', targetRef: actorKey, advancementKey: 'growth', amount: 100 },
          { effectKey: 'missing-resource', family: 'numeric', operation: 'resource.spend', targetRef: actorKey, valueKey: 'not-real', amount: 1 },
        ],
      },
    })).rejects.toThrow('资源不存在')
    state = await readSimulationState(session.id!)
    expect(state.ttrpg!.product!.effectLedger!.entries).toHaveLength(beforeEntries)
    expect(state.ttrpg!.product!.effectLedger!.advancementBalances[`${actorKey}:xp:growth`]).toBe(3)
  })

  it('主线结论自动完成任务，终局选择原子冻结结局与成长奖励', async () => {
    const { session } = await createFormalSession()
    await completeSessionZero(session.id!)
    let version = await readSimulationStateVersion(session.id!)
    await openTtrpgCampaignScene({
      sessionId: session.id!, commandId: 'ending.opening',
      baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey: 'scene.opening',
    })
    for (const clueKey of ['clue.timeline', 'clue.motive']) {
      version = await readSimulationStateVersion(session.id!)
      await discoverTtrpgClue({
        sessionId: session.id!, commandId: `ending.${clueKey}`,
        baseSequence: version.sequence, baseStateHash: version.stateHash,
        clueKey, actorKey: 'release-character:0', visibility: 'party',
      })
    }
    let state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.questProgress).toEqual([
      expect.objectContaining({ questKey: 'quest.truth', status: 'completed' }),
    ])
    version = await readSimulationStateVersion(session.id!)
    await expect(completeTtrpgCampaignEnding({
      sessionId: session.id!, commandId: 'ending.too-early',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      endingKey: 'ending.reveal', completedBy: 'gm',
    })).rejects.toThrow('终局场景')

    for (const sceneKey of ['scene.crosscheck', 'scene.confrontation']) {
      version = await readSimulationStateVersion(session.id!)
      await openTtrpgCampaignScene({
        sessionId: session.id!, commandId: `ending.${sceneKey}`,
        baseSequence: version.sequence, baseStateHash: version.stateHash, sceneKey,
      })
    }
    version = await readSimulationStateVersion(session.id!)
    const input = {
      sessionId: session.id!, commandId: 'ending.reveal.commit',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      endingKey: 'ending.reveal', completedBy: 'gm',
    }
    const first = await completeTtrpgCampaignEnding(input)
    expect((await completeTtrpgCampaignEnding(input)).id).toBe(first.id)
    state = await readSimulationState(session.id!)
    expect(state.ttrpg?.product?.ending).toEqual({ endingKey: 'ending.reveal', eventSequence: first.sequence })
    expect(state.ttrpg?.scene?.status).toBe('resolved')
    expect(state.ttrpg?.activeActorKey).toBeNull()
    expect(state.ttrpg?.product?.advancement).toMatchObject({
      totalAwarded: 1, awardedMilestoneKeys: ['milestone.truth'],
    })
    expect(state.narratives[state.narratives.length - 1]?.text).toContain('真相改变了局势')
  })
})
