import { describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import {
  AuthoritativeOnlineRoomV1,
  type OnlineRoomCommandV1,
  type OnlineRoomPersistenceV1,
  type OnlineRoomSnapshotV1,
} from '../../src/lib/online/room-authority'
import { DurableFormalTtrpgRoomAdapterV1 } from '../../src/lib/online/ttrpg-durable-adapter'
import { parseOnlineTtrpgRoomProjectionV1 } from '../../src/lib/online/ttrpg-projection'
import { HostedFormalTtrpgRoomRegistryV1 } from '../../src/lib/online/ttrpg-room-registry'
import { compileTtrpgCampaignDraftV1 } from '../../src/lib/ttrpg/campaign'
import { buildTtrpgRuntimePackageV1 } from '../../src/lib/ttrpg/release'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { createDeterministicGmSynthesisFrameV2 } from '../../src/lib/ttrpg/action-feedback'
import type { PlayableWorldBundleV1, TtrpgRuntimeContentV1, WorldReleaseManifestV2 } from '../../src/lib/types'

class MemoryRoomStore implements OnlineRoomPersistenceV1 {
  readonly snapshots = new Map<string, OnlineRoomSnapshotV1>()

  async load(roomId: string): Promise<OnlineRoomSnapshotV1 | null> {
    const snapshot = this.snapshots.get(roomId)
    return snapshot ? structuredClone(snapshot) : null
  }

  async compareAndSwap(input: {
    roomId: string
    expectedRevision: number | null
    snapshot: OnlineRoomSnapshotV1
  }): Promise<boolean> {
    const current = this.snapshots.get(input.roomId)
    if ((current?.revision ?? null) !== input.expectedRevision) return false
    this.snapshots.set(input.roomId, structuredClone(input.snapshot))
    return true
  }
}

function playableFixture(): PlayableWorldBundleV1 {
  const now = 1_800_600_000_000
  return {
    schema: 'storyforge.playable-world-bundle', version: 1, compilerVersion: 1,
    source: { worldCode: 'durable-room-world', worldName: '可恢复世界', worldContentHash: 'a'.repeat(64) },
    createdAt: now,
    canonSnapshot: {
      schema: 'storyforge.simulation-canon', version: 1, createdAt: now,
      worldGroupId: null, worldLabel: '可恢复世界',
      sources: [{
        sourceKey: 'release-world:durable', kind: 'world', recordId: null,
        name: '可恢复世界', summary: '用于正式房间恢复验收', fields: {},
        updatedAt: now, contentHash: 'c'.repeat(64),
      }],
      snapshotHash: 'd'.repeat(64),
    },
    initialState: {
      version: 1, clock: 0,
      entities: {
        'release-character:0': {
          entityKey: 'release-character:0', kind: 'character', name: '潮痕调查者',
          locationKey: 'release-location:0', lifecycleStatus: 'active',
          attributes: { identity: '谨慎而敏锐的调查者', roleWeight: 'main' },
        },
        'release-character:1': {
          entityKey: 'release-character:1', kind: 'character', name: '潮痕调查者乙',
          locationKey: 'release-location:0', lifecycleStatus: 'active',
          attributes: { identity: '与同伴共同追索旧港秘密的调查者', roleWeight: 'main' },
        },
        'release-character:2': {
          entityKey: 'release-character:2', kind: 'character', name: '守潮向导',
          locationKey: 'release-location:0', lifecycleStatus: 'active',
          attributes: { identity: '知道旧港秘密的向导', roleWeight: 'npc' },
        },
        'release-location:0': {
          entityKey: 'release-location:0', kind: 'location', name: '退潮旧港',
          locationKey: 'release-location:0', lifecycleStatus: 'active', attributes: {},
        },
      },
      memories: [], narratives: [], ttrpg: null, chat: null, interaction: null,
      narrative: null, adventure: null, presentation: null,
      narrativeSimulation: null, openWorld: null, lastSequence: 0,
    },
    diagnostics: [], bundleHash: 'b'.repeat(64),
  }
}

async function fixture(): Promise<{
  releaseHash: string
  content: TtrpgRuntimeContentV1
  playerKey: string
  playerKeys: string[]
}> {
  const rulePack = createStoryForgeRulePackV1()
  const campaign = compileTtrpgCampaignDraftV1({
    playableWorld: playableFixture(), rulePack, fixtureOnly: true, confirmDefaultMappings: true,
  })
  const content: TtrpgRuntimeContentV1 = {
    rulePack: { content: rulePack, contentHash: await hashGameProductionValueV2(rulePack) },
    campaign,
    compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
  }
  const playerKeys = campaign.characterTemplates
    .filter(item => item.role === 'player')
    .map(item => item.characterKey)
  return {
    releaseHash: await hashGameProductionValueV2({ content, productType: 'ttrpg' }),
    content,
    playerKey: playerKeys[0],
    playerKeys,
  }
}

function command(input: {
  roomId: string
  releaseHash: string
  requestId: string
  memberId: string
  authToken: string
  expectedSequence: number
  kind: OnlineRoomCommandV1['kind']
  actorKey?: string | null
  payload: unknown
}): OnlineRoomCommandV1 {
  return { protocolVersion: 1, actorKey: input.actorKey ?? null, ...input }
}

describe('PLATFORM-1B · durable formal TTRPG domain adapter', () => {
  it('服务端 AI 玩家只读取单角色投影、只能选择合法行动，骰点与结果仍由 RulePack 权威结算', async () => {
    const base = await fixture()
    const content = structuredClone(base.content)
    const aiActorKey = base.playerKeys[0]
    const aiTemplate = content.campaign.characterTemplates.find(
      item => item.characterKey === aiActorKey,
    )!
    aiTemplate.controller = 'ai'
    const releaseHash = await hashGameProductionValueV2({ content, productType: 'ttrpg' })
    let malicious = true
    let invalidAiGm = true
    const propose = vi.fn(async ({ actorKey, projection }: any) => {
      expect(actorKey).toBe(aiActorKey)
      expect(projection.role).toBe('player')
      expect(projection.actorKey).toBe(aiActorKey)
      expect(projection.gmControls).toBeNull()
      expect(JSON.stringify(projection)).not.toContain('两条线索分别指向时间与动机')
      if (malicious) return {
        runId: 71, actionKey: 'not-in-projection', targetKey: null,
        approach: '尝试越过行动闭集。', spokenIntent: null,
      }
      const action = projection.availableActions.find((item: any) => item.actionKey === 'investigate')
        ?? projection.availableActions[0]
      const actor = projection.actors.find((item: any) => item.actorKey === aiActorKey)
      const target = action.target === 'self'
        ? actor.actorKey
        : action.target === 'scene'
          ? null
          : projection.actors.find((item: any) =>
              item.actorKey !== aiActorKey && (action.target === 'single-ally' ? item.role === 'player' : item.role === 'npc'),
            )?.actorKey ?? null
      return {
        runId: 72, actionKey: action.actionKey, targetKey: target,
        approach: '依据可见潮痕逐项核对现场记录。', spokenIntent: '我先核对这份记录。',
      }
    })
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.ai-player', releaseHash, content,
      selectedCharacterKeys: base.playerKeys, maximumCommittedRolls: 8,
      aiPlayerService: { propose },
      aiGmService: {
        act: vi.fn(async () => {
          throw new Error('not used in AI player narration test')
        }),
        narrate: vi.fn(async ({ projection, action }) => {
          expect(projection.role).toBe('gm')
          expect(action.receipt).toBeDefined()
          const synthesisFrame = createDeterministicGmSynthesisFrameV2(action.receipt!)
          return {
            runId: 91,
            text: 'AI KP 依据已经提交的机械结果，描述潮痕记录在现场引发的变化。',
            modelEvidence: {
              provider: 'test-provider', model: 'test-ai-gm', usageSource: 'provider',
              inputTokens: 200, outputTokens: 80, totalTokens: 280,
              latencyMs: 40, estimatedCostUsd: 0.001,
            },
            synthesisFrame: invalidAiGm
              ? { ...synthesisFrame, actionSequence: synthesisFrame.actionSequence + 1 }
              : synthesisFrame,
          }
        }),
      },
    })
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.ai-player', releaseHash, gmDisplayName: 'AI 混合桌主持', adapter,
    })
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'scene.open',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 0, kind: 'scene.open', payload: { sceneKey: 'scene.opening' },
    }))
    let roomSequence = 1
    for (let guard = 0; adapter.inspect().state.ttrpg?.activeActorKey !== aiActorKey && guard < 20; guard += 1) {
      const actorKey = adapter.inspect().state.ttrpg!.activeActorKey!
      await created.room.submit(command({
        roomId: created.room.roomId, releaseHash, requestId: `advance.to-ai.${guard}`,
        memberId: created.gm.member.memberId, authToken: created.gm.authToken,
        expectedSequence: roomSequence, kind: 'rule.action', actorKey,
        payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
      }))
      roomSequence += 1
    }
    expect(adapter.inspect().state.ttrpg?.activeActorKey).toBe(aiActorKey)
    const beforeSequence = adapter.inspect().state.lastSequence
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'ai.invalid-proposal',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'ai.player.run',
      payload: { objective: '推动当前调查，但不得越过角色可见信息。' },
    }))).rejects.toThrow('投影闭集之外')
    expect(adapter.inspect().state.lastSequence).toBe(beforeSequence)
    malicious = false
    const receipt = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'ai.valid-proposal',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'ai.player.run',
      payload: { objective: '推动当前调查，但不得越过角色可见信息。' },
    }))
    expect(receipt.event.publicPayload).toMatchObject({ actorKey: aiActorKey })
    const result = adapter.inspect().state.ttrpg!.product!.actionHistory.at(-1)!
    expect(result.actorAuthority).toMatchObject({
      source: 'ai-player', viewerKey: `viewer.online-ai:${aiActorKey}`, runId: 72,
      approach: '依据可见潮痕逐项核对现场记录。', spokenIntent: '我先核对这份记录。',
    })
    expect(result.check?.rule.proofHash).toMatch(/^[a-f0-9]{64}$/)
    expect(propose).toHaveBeenCalledTimes(2)
    roomSequence += 1
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'ai-gm.invalid-frame',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'ai.gm.narrate',
      payload: { objective: '忠实反馈刚才的判定，并给出下一步提示。' },
    }))).rejects.toThrow('行动绑定无效')
    expect(adapter.inspect().state.ttrpg?.product?.gmNarrations).toHaveLength(0)
    invalidAiGm = false
    const narration = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'ai-gm.valid',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'ai.gm.narrate',
      payload: { objective: '忠实反馈刚才的判定，并给出下一步提示。' },
    }))
    expect(narration.event.publicPayload).toMatchObject({
      actionSequence: result.eventSequence, source: 'ai-confirmed',
    })
    expect(adapter.inspect().state.ttrpg?.product?.gmNarrations).toEqual([
      expect.objectContaining({
        actionSequence: result.eventSequence,
        source: 'ai-confirmed',
        runId: 91,
        modelEvidence: expect.objectContaining({ provider: 'test-provider', model: 'test-ai-gm' }),
      }),
    ])
  })

  it('在线 AI KP 可在 NPC 回合提出闭集意图并由权威 RulePack 结算，真人直提和越权候选均失败关闭', async () => {
    const base = await fixture()
    const content = structuredClone(base.content)
    content.campaign.gmMode = 'ai'
    const npcKey = content.campaign.characterTemplates.find(item => item.role === 'npc')!.characterKey
    const releaseHash = await hashGameProductionValueV2({ content, productType: 'ttrpg' })
    let invalid = true
    const act = vi.fn(async ({ actorKey, projection }: any) => {
      expect(actorKey).toBe(npcKey)
      expect(projection.role).toBe('gm')
      expect(projection.actorKey).toBeNull()
      expect(projection.gmController).toBe('ai')
      expect(projection.actors.find((item: any) => item.actorKey === npcKey).privateProfile).not.toBeNull()
      if (invalid) return {
        runId: 101,
        actionKey: 'invent-an-action',
        targetKey: null,
        approach: '越过冻结行动闭集。',
        spokenIntent: null,
      }
      const action = projection.availableActions.find((item: any) => item.actionKey === 'investigate')
        ?? projection.availableActions.find((item: any) => item.target === 'scene')
        ?? projection.availableActions[0]
      const targetKey = action.target === 'self'
        ? actorKey
        : action.target === 'scene'
          ? null
          : projection.actors.find((item: any) =>
              item.actorKey !== actorKey &&
              (action.target === 'single-ally' ? item.role === 'npc' : item.role === 'player'),
            )?.actorKey ?? null
      return {
        runId: 102,
        actionKey: action.actionKey,
        targetKey,
        approach: '依据当前掌握的潮痕与自身目标核对档案，并回应调查者的逼问。',
        spokenIntent: '这些记录还不能交给你们。',
      }
    })
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.ai-gm-actor',
      releaseHash,
      content,
      selectedCharacterKeys: base.playerKeys,
      maximumCommittedRolls: 32,
      aiGmService: {
        act,
        narrate: vi.fn(async () => {
          throw new Error('not used in AI GM actor test')
        }),
      },
    })
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.ai-gm-actor',
      releaseHash,
      gmDisplayName: '在线 AI KP 管理员',
      adapter,
    })
    await created.room.submit(command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'gm-actor.scene.open',
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: 0,
      kind: 'scene.open',
      payload: { sceneKey: 'scene.opening' },
    }))
    let roomSequence = 1
    for (let guard = 0; adapter.inspect().state.ttrpg?.activeActorKey !== npcKey && guard < 20; guard += 1) {
      const actorKey = adapter.inspect().state.ttrpg!.activeActorKey!
      await created.room.submit(command({
        roomId: created.room.roomId,
        releaseHash,
        requestId: `gm-actor.advance.${guard}`,
        memberId: created.gm.member.memberId,
        authToken: created.gm.authToken,
        expectedSequence: roomSequence,
        kind: 'rule.action',
        actorKey,
        payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
      }))
      roomSequence += 1
    }
    expect(adapter.inspect().state.ttrpg?.activeActorKey).toBe(npcKey)
    const beforeSequence = adapter.inspect().state.lastSequence
    await expect(created.room.submit(command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'gm-actor.manual-bypass',
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: roomSequence,
      kind: 'rule.action',
      actorKey: npcKey,
      payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
    }))).rejects.toThrow('不能通过真人直提入口')
    expect(adapter.inspect().state.lastSequence).toBe(beforeSequence)
    await expect(created.room.submit(command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'gm-actor.invalid-proposal',
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: roomSequence,
      kind: 'ai.gm.act',
      payload: { objective: '让当前 NPC 依照自身目标对玩家行动作出合理回应。' },
    }))).rejects.toThrow('投影闭集之外')
    expect(adapter.inspect().state.lastSequence).toBe(beforeSequence)
    invalid = false
    const receipt = await created.room.submit(command({
      roomId: created.room.roomId,
      releaseHash,
      requestId: 'gm-actor.valid-proposal',
      memberId: created.gm.member.memberId,
      authToken: created.gm.authToken,
      expectedSequence: roomSequence,
      kind: 'ai.gm.act',
      payload: { objective: '让当前 NPC 依照自身目标对玩家行动作出合理回应。' },
    }))
    expect(receipt.event.publicPayload).toMatchObject({ actorKey: npcKey })
    const result = adapter.inspect().state.ttrpg!.product!.actionHistory.at(-1)!
    expect(result.actorAuthority).toMatchObject({
      source: 'ai-gm-npc',
      viewerKey: 'viewer.online-gm',
      runId: 102,
      approach: '依据当前掌握的潮痕与自身目标核对档案，并回应调查者的逼问。',
      spokenIntent: '这些记录还不能交给你们。',
    })
    expect(result.actorAuthority?.candidateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.actorAuthority?.contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.check?.rule.proofHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.nextActorKey).not.toBe(npcKey)
    expect(act).toHaveBeenCalledTimes(2)
  })

  it('KP 可提出私密互斥后果，只有所有者可确认且结算与检查点恢复保持原子性', async () => {
    const { releaseHash, content, playerKey, playerKeys } = await fixture()
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.effect-choice', releaseHash, content,
      selectedCharacterKeys: playerKeys, maximumCommittedRolls: 12,
    })
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.effect-choice', releaseHash, gmDisplayName: '选择后果主持', adapter,
    })
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.scene.open',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 0, kind: 'scene.open', payload: { sceneKey: 'scene.opening' },
    }))
    const ownerInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: playerKey, expiresAt: Date.now() + 60_000,
    })
    const owner = await created.room.join({ ...ownerInvite, displayName: '奖励选择者' })
    const otherKey = playerKeys.find(key => key !== playerKey)!
    const otherInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: otherKey, expiresAt: Date.now() + 60_000,
    })
    const other = await created.room.join({ ...otherInvite, displayName: '另一玩家' })
    let roomSequence = 1
    while (adapter.inspect().state.ttrpg?.activeActorKey !== playerKey) {
      const actorKey = adapter.inspect().state.ttrpg!.activeActorKey!
      await created.room.submit(command({
        roomId: created.room.roomId, releaseHash, requestId: `choice.advance.${roomSequence}`,
        memberId: created.gm.member.memberId, authToken: created.gm.authToken,
        expectedSequence: roomSequence, kind: 'rule.action', actorKey,
        payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
      }))
      roomSequence += 1
    }
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.owner.action',
      memberId: owner.member.memberId, authToken: owner.authToken,
      expectedSequence: roomSequence, kind: 'rule.action', actorKey: playerKey,
      payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
    }))
    roomSequence += 1
    const action = adapter.inspect().state.ttrpg!.product!.actionHistory.at(-1)!
    const proposalPayload = {
      actionSequence: action.eventSequence,
      ownerActorKey: playerKey,
      plan: {
        schema: 'storyforge.ttrpg-effect-plan' as const,
        version: 2 as const,
        planKey: `choice.reward.${action.eventSequence}`,
        degree: action.outcome === 'automatic' ? 'success' as const : action.outcome,
        sourceEventId: `event.${action.eventSequence}`,
        ruleRef: action.actionKey,
        reason: '在稳妥成长与冒险成长之间选择一项，仅该玩家与 KP 可见。',
        audience: `actor:${playerKey}` as const,
        status: 'pending-choice' as const,
        effects: [
          {
            effectKey: `choice.reward.${action.eventSequence}.safe`,
            family: 'advancement' as const, operation: 'xp' as const,
            targetRef: playerKey, advancementKey: 'session-xp', amount: 2,
          },
          {
            effectKey: `choice.reward.${action.eventSequence}.bold`,
            family: 'advancement' as const, operation: 'xp' as const,
            targetRef: playerKey, advancementKey: 'session-xp', amount: 5,
          },
        ],
      },
    }
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.player-propose-denied',
      memberId: owner.member.memberId, authToken: owner.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.propose', actorKey: playerKey,
      payload: proposalPayload,
    }))).rejects.toThrow('只允许 GM')
    const proposal = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.gm.propose',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.propose', payload: proposalPayload,
    }))
    expect(JSON.stringify(proposal.event.publicPayload)).not.toContain('冒险成长')
    expect(JSON.stringify(proposal.event.privatePayload)).toContain('冒险成长')
    roomSequence += 1
    const ownerProjection = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: owner.member.memberId, authToken: owner.authToken, afterSequence: 0,
    })).projection)
    expect(ownerProjection.campaign.pendingEffectChoices).toEqual([
      expect.objectContaining({ ownerActorKey: playerKey, options: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining('5') }),
      ]) }),
    ])
    const otherProjection = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: other.member.memberId, authToken: other.authToken, afterSequence: 0,
    })).projection)
    expect(otherProjection.campaign.pendingEffectChoices).toEqual([])
    const checkpoint = await adapter.exportCheckpoint()
    const restored = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.effect-choice', releaseHash, content,
      selectedCharacterKeys: playerKeys, maximumCommittedRolls: 12,
    })
    await restored.restoreCheckpoint(checkpoint)
    expect(restored.inspect().state.ttrpg?.product?.effectLedger?.pendingChoices).toHaveLength(1)
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.other.resolve-denied',
      memberId: other.member.memberId, authToken: other.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.resolve', actorKey: playerKey,
      payload: {
        choiceKey: proposalPayload.plan.planKey,
        selectedEffectKey: proposalPayload.plan.effects[1].effectKey,
      },
    }))).rejects.toThrow('只能确认自己角色')
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.gm-human-resolve-denied',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.resolve', actorKey: playerKey,
      payload: {
        choiceKey: proposalPayload.plan.planKey,
        selectedEffectKey: proposalPayload.plan.effects[1].effectKey,
      },
    }))).rejects.toThrow('只能代纯 AI')
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.owner.invalid-option',
      memberId: owner.member.memberId, authToken: owner.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.resolve', actorKey: playerKey,
      payload: { choiceKey: proposalPayload.plan.planKey, selectedEffectKey: 'choice.not-frozen' },
    }))).rejects.toThrow('不属于冻结提议')
    const resolved = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'choice.owner.resolve',
      memberId: owner.member.memberId, authToken: owner.authToken,
      expectedSequence: roomSequence, kind: 'effects.choice.resolve', actorKey: playerKey,
      payload: {
        choiceKey: proposalPayload.plan.planKey,
        selectedEffectKey: proposalPayload.plan.effects[1].effectKey,
      },
    }))
    expect(JSON.stringify(resolved.event.publicPayload)).not.toContain('冒险成长')
    expect(JSON.stringify(resolved.event.privatePayload)).toContain(proposalPayload.plan.effects[1].effectKey)
    const ledger = adapter.inspect().state.ttrpg!.product!.effectLedger!
    expect(ledger.pendingChoices).toEqual([])
    expect(ledger.entries.at(-1)?.transitions).toEqual([
      expect.objectContaining({ effectKey: proposalPayload.plan.effects[1].effectKey, afterJson: '5' }),
    ])
  })

  it('真实 RulePack 行动、玩家安全投影和预承诺骰子随房间快照一起跨进程恢复', async () => {
    const { releaseHash, content, playerKey, playerKeys } = await fixture()
    expect(playerKeys).toHaveLength(2)
    const store = new MemoryRoomStore()
    const memberByActor = new Map<string, string>()
    const firstAdapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.formal-durable', releaseHash, content,
      selectedCharacterKeys: playerKeys, maximumCommittedRolls: 8,
      memberIdForActor: actorKey => memberByActor.get(actorKey) ?? null,
    })
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.formal-durable', releaseHash, gmDisplayName: '可恢复主持人',
      adapter: firstAdapter, persistence: store,
    })
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'scene.opening',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 0, kind: 'scene.open', payload: { sceneKey: 'scene.opening' },
    }))
    const startedSession = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'campaign.session.start.1',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence: 1, kind: 'campaign.session.start', payload: { title: '雾港联机第一夜' },
    }))
    expect(startedSession.event.publicPayload).toMatchObject({
      sessionKey: 'session.1', ordinal: 1, title: '雾港联机第一夜', status: 'active',
    })
    const invite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: playerKey, expiresAt: Date.now() + 60_000,
    })
    const player = await created.room.join({ ...invite, displayName: '潮痕调查者' })
    memberByActor.set(playerKey, player.member.memberId)
    let before = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })).projection)
    let expectedSequence = 2
    for (let guard = 0; before.campaign.turn.activeActorKey !== playerKey && guard < 20; guard += 1) {
      const controlledByGmKey = before.campaign.turn.activeActorKey!
      await created.room.submit(command({
        roomId: created.room.roomId, releaseHash, requestId: `action.pre-player.${guard}`,
        memberId: created.gm.member.memberId, authToken: created.gm.authToken,
        expectedSequence, kind: 'rule.action', actorKey: controlledByGmKey,
        payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
      }))
      expectedSequence += 1
      before = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
        memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
      })).projection)
    }
    expect(before.campaign.turn.activeActorKey).toBe(playerKey)
    expect(before.campaign.availableActions.map(item => item.actionKey)).toContain('investigate')

    const action = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'action.investigate',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence, kind: 'intent.submit', actorKey: playerKey,
      payload: {
        intentKey: 'intent.durable.investigate',
        rawInput: '我检查潮痕记录是否被人改过。',
        actionKey: 'investigate', targetKey: null,
        goal: '确认记录真伪', method: '比对潮痕',
        difficulty: 8, situationalModifier: 0, rollVisibility: 'public',
      },
    }))
    expect(action.event.publicPayload).toMatchObject({
      actionKey: 'investigate', actorKey: playerKey,
      check: { rule: {
        skillKey: 'investigate', skillValue: expect.any(Number),
        rulePackContentHash: content.rulePack.contentHash,
      } },
      receipt: { terminalStatus: 'resolved-check' },
    })
    expect(JSON.stringify(action.event.publicPayload)).not.toContain('潮痕记录')
    expect(JSON.stringify(action.event.privatePayload)).toContain('潮痕记录')
    expect(JSON.stringify(action.event.privatePayload)).not.toContain('两条线索分别指向时间与动机')
    expectedSequence += 1

    const resolved = firstAdapter.inspect().state.ttrpg!.product!.actionHistory
      .find(item => item.eventSequence === (action.event.publicPayload as { eventSequence: number }).eventSequence)!
    const promptedActorKey = resolved.receipt!.context.observers
      .find(item => item.responsePolicy === 'prompt-human' && item.actorKey !== playerKey)!.actorKey
    const responseInvite = await created.room.issueInvite({
      gmMemberId: created.gm.member.memberId, gmAuthToken: created.gm.authToken,
      role: 'player', actorKey: promptedActorKey, expiresAt: Date.now() + 60_000,
    })
    const responder = await created.room.join({ ...responseInvite, displayName: '回应角色' })
    memberByActor.set(promptedActorKey, responder.member.memberId)
    const responsePayload = {
      actionSequence: resolved.eventSequence,
      actionReceiptKey: resolved.receipt!.receiptKey,
      responseKind: 'speak' as const,
      text: '我把异样的潮汐刻度只告诉主持人。',
      audience: 'gm-only' as const,
    }
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'response.gm-spoof',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'human.response', actorKey: promptedActorKey,
      payload: responsePayload,
    }))).rejects.toThrow('只能由已认证的玩家席位')
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'response.other-player-spoof',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence, kind: 'human.response', actorKey: promptedActorKey,
      payload: responsePayload,
    }))).rejects.toThrow('只能回应自己')
    const response = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'response.owner',
      memberId: responder.member.memberId, authToken: responder.authToken,
      expectedSequence, kind: 'human.response', actorKey: promptedActorKey,
      payload: responsePayload,
    }))
    expect(JSON.stringify(response.event.publicPayload)).not.toContain('潮汐刻度')
    expect(JSON.stringify(response.event.privatePayload)).toContain('潮汐刻度')
    expectedSequence += 1
    const firstPlayerAfterResponse = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })).projection)
    expect(JSON.stringify(firstPlayerAfterResponse.campaign.humanResponses)).not.toContain('潮汐刻度')
    const responderAfterResponse = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: responder.member.memberId, authToken: responder.authToken, afterSequence: 0,
    })).projection)
    expect(JSON.stringify(responderAfterResponse.campaign.humanResponses)).toContain('潮汐刻度')
    const effectPayload = {
      actionSequence: resolved.eventSequence,
      plan: {
        schema: 'storyforge.ttrpg-effect-plan' as const,
        version: 2 as const,
        planKey: `online.effect.${resolved.eventSequence}`,
        degree: resolved.outcome === 'automatic' ? 'success' as const : resolved.outcome,
        sourceEventId: `event.${resolved.eventSequence}`,
        ruleRef: resolved.actionKey,
        reason: '仅该角色与主持人可见的潮痕成长奖励。',
        audience: `actor:${playerKey}` as const,
        status: 'immediate' as const,
        effects: [{
          effectKey: `online.effect.${resolved.eventSequence}.xp`,
          family: 'advancement' as const,
          operation: 'xp' as const,
          targetRef: playerKey,
          advancementKey: 'session-xp',
          amount: 3,
        }],
      },
    }
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'effect.player-denied',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence, kind: 'effects.apply', actorKey: playerKey,
      payload: effectPayload,
    }))).rejects.toThrow('只允许 GM')
    const effect = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'effect.gm-private',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'effects.apply', payload: effectPayload,
    }))
    expect(JSON.stringify(effect.event.publicPayload)).not.toContain('潮痕成长奖励')
    expect(JSON.stringify(effect.event.privatePayload)).toContain('潮痕成长奖励')
    expectedSequence += 1
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'effect.gm-duplicate-source',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'effects.apply', payload: {
        ...effectPayload,
        plan: { ...effectPayload.plan, planKey: `online.effect.${resolved.eventSequence}.duplicate` },
      },
    }))).rejects.toThrow('唯一后果计划')
    const playerAfterEffect = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })).projection)
    expect(JSON.stringify(playerAfterEffect.campaign.effectReceipts)).toContain('潮痕成长奖励')
    const otherPlayerAfterEffect = parseOnlineTtrpgRoomProjectionV1((await created.room.reconnect({
      memberId: responder.member.memberId, authToken: responder.authToken, afterSequence: 0,
    })).projection)
    expect(JSON.stringify(otherPlayerAfterEffect.campaign.effectReceipts)).not.toContain('潮痕成长奖励')
    const ownedItem = firstPlayerAfterResponse.campaign.inventory[0]
    expect(ownedItem).toBeDefined()
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'item.other-player-spoof',
      memberId: responder.member.memberId, authToken: responder.authToken,
      expectedSequence, kind: 'item.command', actorKey: playerKey,
      payload: { operation: {
        kind: 'use', instanceId: ownedItem.itemInstanceId,
        expectedOwnerRef: playerKey, amount: 1,
      } },
    }))).rejects.toThrow('只能操作自己角色')
    const usedItem = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'item.owner-use',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence, kind: 'item.command', actorKey: playerKey,
      payload: { operation: {
        kind: 'use', instanceId: ownedItem.itemInstanceId,
        expectedOwnerRef: playerKey, amount: 1,
      } },
    }))
    expect(usedItem.event.publicPayload).toMatchObject({
      operation: 'use', itemInstanceId: ownedItem.itemInstanceId, changed: true,
    })
    expect(usedItem.event.privatePayload).toMatchObject({
      operation: 'use', requestedBy: { role: 'player', actorKey: playerKey },
    })
    expectedSequence += 1
    await expect(created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'rest.player-spoof',
      memberId: player.member.memberId, authToken: player.authToken,
      expectedSequence, kind: 'rest.complete', actorKey: playerKey,
      payload: {
        restKey: 'rest.online.short.denied', restKind: 'short-rest',
        actorKeys: playerKeys, reason: '玩家不能自行结算全队休息。',
      },
    }))).rejects.toThrow('只能由 GM')
    const rested = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'rest.gm.short',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'rest.complete',
      payload: {
        restKey: 'rest.online.short.1', restKind: 'short-rest',
        actorKeys: playerKeys, reason: '队伍在潮水回涨前短暂整备。',
      },
    }))
    expect(rested.event.publicPayload).toMatchObject({
      restKey: 'rest.online.short.1', kind: 'short-rest', actorKeys: playerKeys,
    })
    expectedSequence += 1
    const completedSession = await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'campaign.session.complete.1',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'campaign.session.complete', payload: {
        publicNote: '主持公开补充：队伍约定下次追查潮位表。',
        memorySummary: '只有第一位调查者记得封蜡背面的隐秘刻痕。',
        memoryAudience: `actor:${playerKey}`,
      },
    }))
    expect(completedSession.event.publicPayload).toMatchObject({
      sessionKey: 'session.1', status: 'completed',
    })
    expect(JSON.stringify(completedSession.event.publicPayload)).not.toContain('隐秘刻痕')
    expect(JSON.stringify(completedSession.event.privatePayload)).toContain('隐秘刻痕')
    expectedSequence += 1
    await created.room.submit(command({
      roomId: created.room.roomId, releaseHash, requestId: 'dice.precommitted',
      memberId: created.gm.member.memberId, authToken: created.gm.authToken,
      expectedSequence, kind: 'dice.request', payload: { expression: '2d6+1' },
    }))
    expectedSequence += 1

    const restoredAdapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.formal-durable', releaseHash, content,
      selectedCharacterKeys: playerKeys, maximumCommittedRolls: 8,
      memberIdForActor: actorKey => memberByActor.get(actorKey) ?? null,
    })
    const restored = await AuthoritativeOnlineRoomV1.restore({
      roomId: 'room.formal-durable', adapter: restoredAdapter, persistence: store,
    })
    const recovered = await restored.reconnect({
      memberId: player.member.memberId, authToken: player.authToken, afterSequence: 0,
    })
    const projection = parseOnlineTtrpgRoomProjectionV1(recovered.projection)
    expect(recovered.cursor).toBe(expectedSequence)
    expect(projection.campaign.recentActions).toContainEqual(expect.objectContaining({ actionKey: 'investigate', actorKey: playerKey }))
    expect(projection.diceCommitments).toEqual(firstAdapter.inspect().commitments)
    expect(JSON.stringify(projection)).not.toContain('两条线索分别指向时间与动机')
    expect(JSON.stringify(projection.campaign.humanResponses)).not.toContain('潮汐刻度')
    expect(projection.campaign.recentRests).toEqual([
      expect.objectContaining({ restKey: 'rest.online.short.1', kind: 'short-rest' }),
    ])
    expect(projection.campaign.continuity.playSessions).toEqual([
      expect.objectContaining({ sessionKey: 'session.1', status: 'completed' }),
    ])
    expect(JSON.stringify(projection.campaign.continuity.memories)).toContain('隐秘刻痕')
    expect(restoredAdapter.inspect().state.ttrpg?.product?.itemHistory).toEqual([
      expect.objectContaining({ operation: 'use', itemInstanceId: ownedItem.itemInstanceId }),
    ])
    expect(restoredAdapter.inspect().state.ttrpg?.product?.effectLedger?.entries).toEqual([
      expect.objectContaining({
        sourceEventId: `event.${resolved.eventSequence}`,
        audience: `actor:${playerKey}`,
      }),
    ])
    const recoveredResponder = parseOnlineTtrpgRoomProjectionV1((await restored.reconnect({
      memberId: responder.member.memberId, authToken: responder.authToken, afterSequence: 0,
    })).projection)
    expect(JSON.stringify(recoveredResponder.campaign.humanResponses)).toContain('潮汐刻度')
    expect(JSON.stringify(recoveredResponder.campaign.continuity.memories)).not.toContain('隐秘刻痕')
  })

  it('领域 checkpoint 即使绕过外层快照校验也会用自身完整性 hash 拒绝篡改', async () => {
    const { releaseHash, content, playerKey } = await fixture()
    const adapter = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.domain-corrupt', releaseHash, content,
      selectedCharacterKeys: [playerKey], maximumCommittedRolls: 2,
    })
    const checkpoint = await adapter.exportCheckpoint()
    checkpoint.state.clock = 99
    await expect(adapter.restoreCheckpoint(checkpoint)).rejects.toThrow('损坏')

    const store = new MemoryRoomStore()
    const created = await AuthoritativeOnlineRoomV1.create({
      roomId: 'room.domain-corrupt', releaseHash, gmDisplayName: '主持人', adapter, persistence: store,
    })
    const snapshot = (await store.load(created.room.roomId))!
    ;(snapshot.domainCheckpoint as { state: { clock: number } }).state.clock = 100
    const { integrityHash: _old, ...body } = snapshot
    snapshot.integrityHash = await hashCanonicalValue(body)
    store.snapshots.set(snapshot.roomId, snapshot)
    const fresh = await DurableFormalTtrpgRoomAdapterV1.create({
      roomId: 'room.domain-corrupt', releaseHash, content,
      selectedCharacterKeys: [playerKey], maximumCommittedRolls: 2,
    })
    await expect(AuthoritativeOnlineRoomV1.restore({
      roomId: snapshot.roomId, adapter: fresh, persistence: store,
    })).rejects.toThrow('checkpoint 无效或损坏')
  })

  it('托管注册表校验账号 entitlement 与发布 hash，缓存淘汰后从同一 CAS 房间恢复', async () => {
    const base = await fixture()
    const worldManifest: WorldReleaseManifestV2 = {
      schema: 'storyforge.world-package', version: 2,
      worldCode: 'durable-room-world', worldName: '可恢复世界', workTitle: '正式房间作品',
      selectedTables: [], selectedNarrativeModules: [], dependencies: [], records: {}, portableProject: {},
    }
    const runtimePackage = await buildTtrpgRuntimePackageV1({
      worldReleaseManifest: worldManifest, worldContentHash: 'a'.repeat(64),
      rulePack: base.content.rulePack.content,
      rulePackContentHash: base.content.rulePack.contentHash,
      campaign: base.content.campaign,
    })
    const manifest = await createGameReleaseManifestV2({ runtimePackage, productionProvenance: null })
    const releaseHash = await hashGameProductionValueV2(manifest)
    const store = new MemoryRoomStore()
    const registry = new HostedFormalTtrpgRoomRegistryV1({
      releases: {
        loadByContentHash: async hash => hash === releaseHash ? {
          contentHash: releaseHash, manifestJson: JSON.stringify(manifest), status: 'published',
        } : null,
      },
      identity: {
        authorizeRoomCreation: async ({ creatorAccessToken }) => {
          if (creatorAccessToken === 'creator.valid.token') {
            return { userId: 'creator.1', entitled: true, allowedToHost: true }
          }
          if (creatorAccessToken === 'creator.other.token') {
            return { userId: 'creator.2', entitled: true, allowedToHost: true }
          }
          return null
        },
        authenticateRoomMembership: async ({ memberAccessToken }) => {
          if (memberAccessToken === 'creator.valid.token') return { userId: 'creator.1' }
          if (memberAccessToken === 'creator.other.token') return { userId: 'creator.2' }
          if (memberAccessToken === 'player.valid.token') return { userId: 'player.1' }
          return null
        },
      },
      credentials: {
        issueStableGmCredential: async input => `gm.${await hashGameProductionValueV2(input)}`,
        issueStableRoomSessionCredential: async input => `session.${await hashGameProductionValueV2(input)}`,
        issueStableInviteCredential: async input => ({
          inviteId: `invite.${(await hashGameProductionValueV2(input)).slice(0, 32)}`,
          inviteToken: `invite-token.${await hashGameProductionValueV2(input)}`,
        }),
      },
      persistence: { forRoom: () => store },
      maximumCachedRooms: 1,
      maximumCommittedRolls: 4,
    })
    await expect(registry.create({
      requestId: 'host.denied', roomId: 'room.hosted-denied', releaseHash,
      selectedCharacterKeys: [base.playerKey], creatorAccessToken: 'creator.invalid.token',
      gmDisplayName: '主持人',
    })).rejects.toThrow('凭据无效')
    const created = await registry.create({
      requestId: 'host.create', roomId: 'room.hosted', releaseHash,
      selectedCharacterKeys: [base.playerKey], creatorAccessToken: 'creator.valid.token',
      gmDisplayName: '主持人',
    })
    registry.evict('room.hosted')
    const restored = await registry.load('room.hosted')
    expect(restored).not.toBeNull()
    const gmProjection = parseOnlineTtrpgRoomProjectionV1((await restored!.reconnect({
      memberId: created.gm.member.memberId, authToken: created.gm.authToken, afterSequence: 0,
    })).projection)
    expect(gmProjection.campaign).toMatchObject({ role: 'gm', gmControls: expect.any(Object) })
    const matchmakingExpiresAt = Date.now() + 60_000
    const invite = await registry.issueMatchmakingInvite({
      requestId: 'matchmaking.application.1', roomId: 'room.hosted',
      hostAccessToken: 'creator.valid.token', expectedHostUserId: 'creator.1', actorKey: base.playerKey,
      expiresAt: matchmakingExpiresAt,
    })
    await expect(registry.issueMatchmakingInvite({
      requestId: 'matchmaking.application.1', roomId: 'room.hosted',
      hostAccessToken: 'creator.valid.token', expectedHostUserId: 'creator.1', actorKey: base.playerKey,
      expiresAt: matchmakingExpiresAt,
    })).resolves.toEqual(invite)
    await expect(registry.issueMatchmakingInvite({
      requestId: 'matchmaking.cross-account', roomId: 'room.hosted',
      hostAccessToken: 'creator.other.token', expectedHostUserId: 'creator.1', actorKey: base.playerKey,
      expiresAt: matchmakingExpiresAt,
    })).rejects.toThrow('账号不一致')
    const joined = await registry.joinAuthenticated({
      requestId: 'join.account.1',
      roomId: 'room.hosted',
      ...invite,
      memberAccessToken: 'player.valid.token',
      displayName: '跨设备玩家',
    })
    registry.evict('room.hosted')
    const resumedPlayer = await registry.resumeAuthenticated({
      roomId: 'room.hosted', memberAccessToken: 'player.valid.token',
    })
    expect(resumedPlayer.member).toMatchObject({
      member: { memberId: joined.member.member.memberId, role: 'player', actorKey: base.playerKey },
      authToken: joined.member.authToken,
    })
    const playerProjection = parseOnlineTtrpgRoomProjectionV1((await resumedPlayer.room.reconnect({
      memberId: resumedPlayer.member.member.memberId,
      authToken: resumedPlayer.member.authToken,
      afterSequence: 0,
    })).projection)
    expect(playerProjection.campaign.gmControls).toBeNull()
    expect(playerProjection.campaign.scenes.every(scene => scene.gmSecret === null)).toBe(true)
    expect(JSON.stringify(playerProjection)).not.toContain('只有主持人知道')
    await expect(registry.resumeAuthenticated({
      roomId: 'room.hosted', memberAccessToken: 'unknown.token',
    })).rejects.toThrow('账号访问凭据无效')
    expect(JSON.stringify(store.snapshots.get('room.hosted'))).not.toContain('player.1')
    const retried = await registry.create({
      requestId: 'host.create', roomId: 'room.hosted', releaseHash,
      selectedCharacterKeys: [base.playerKey], creatorAccessToken: 'creator.valid.token',
      gmDisplayName: '主持人',
    })
    expect(retried.gm).toMatchObject({
      authToken: created.gm.authToken,
      member: {
        memberId: created.gm.member.memberId,
        role: 'gm',
        connected: true,
      },
    })
    await expect(registry.create({
      requestId: 'host.duplicate', roomId: 'room.hosted', releaseHash,
      selectedCharacterKeys: [base.playerKey], creatorAccessToken: 'creator.valid.token',
      gmDisplayName: '主持人',
    })).rejects.toThrow('其他创建请求占用')
    await expect(registry.create({
      requestId: 'host.create', roomId: 'room.hosted', releaseHash,
      selectedCharacterKeys: [base.playerKey], creatorAccessToken: 'creator.other.token',
      gmDisplayName: '主持人',
    })).rejects.toThrow('其他创建请求占用')
  })
})
