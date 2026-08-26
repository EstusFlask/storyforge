import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { verifyGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  commitTtrpgPlayerActionFromHarnessV1,
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
  resolveTtrpgRuleAction,
} from '../../src/lib/simulation/runtime'
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import {
  adoptTtrpgPlayerActionCandidateV1,
  evaluateTtrpgPlayerCandidateOutputV1,
  generateTtrpgPlayerActionCandidateV1,
} from '../../src/lib/ttrpg/player-harness'
import { loadTtrpgPlayerRuntimeViewV1 } from '../../src/lib/ttrpg/player-context'
import {
  coordinateTtrpgAiPlayerEpochV1,
  runTtrpgAiPlayerCycleV1,
} from '../../src/lib/ttrpg/player-coordinator'
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
} from '../../src/lib/ttrpg/authoring'
import { publishTtrpgCampaignReleaseV1 } from '../../src/lib/ttrpg/release'
import { parseTtrpgCampaignContentV1 } from '../../src/lib/ttrpg/campaign'
import { parseRulePackV1 } from '../../src/lib/ttrpg/rule-pack'
import type { SimulationSession, WorkspaceScope, WorldReleaseManifestV2 } from '../../src/lib/types'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const now = 1_792_000_000_000
const validOutput = JSON.stringify({
  actionKey: 'investigate', targetKey: null,
  approach: '沿着当前可见痕迹逐项核对，寻找彼此矛盾的细节。',
  spokenIntent: '我先检查这里留下的痕迹。',
})

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      { _exportId: 0, name: '林舟', identity: '谨慎的调查者', location: '雾港', roleWeight: 'main' },
      { _exportId: 1, name: '顾棠', identity: '行动果断的记录者', location: '雾港', roleWeight: 'main' },
      { _exportId: 2, name: '祁安', identity: '善于交涉的观察者', location: '雾港', roleWeight: 'main' },
      { _exportId: 3, name: '守潮人', identity: '知道旧港秘密的向导', location: '雾港', roleWeight: 'npc' },
    ],
    characterRelations: [],
    importantLocations: [{ _exportId: 0, name: '雾港', description: '退潮时显露的旧港。' }],
    storyArcs: [], itemLedger: [], codexEntries: [], avgMediaAssets: [],
    narrativeModules: [], narrativeNodes: [],
  }
  return {
    schema: 'storyforge.world-package', version: 2,
    worldCode: 'ai-player-harbor', worldName: '潮汐界', workTitle: '雾港纪事',
    selectedTables: Object.keys(records), selectedNarrativeModules: [], dependencies: [], records, portableProject: {},
  }
}

async function createFormalSession(): Promise<{ session: SimulationSession; scope: WorkspaceScope }> {
  const projectId = await db.projects.add({
    name: 'AI 玩家验收', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  const scope = (await ensureWorkspaceOwnership(projectId)).scope
  const manifest = worldManifest()
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId: scope.worldId, revisionId: 1, version: 1, label: '潮汐界 v1',
    manifestJson: JSON.stringify(manifest), contentHash: await hashGameProductionValueV2(manifest),
    sourceWorldCode: manifest.worldCode, createdAt: now,
  }) as number
  const rule = await installStoryForgeRulePackV1(scope)
  const campaign = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope, worldReleaseId, rulePackId: rule.id, fixtureOnly: true, confirmDefaultMappings: true,
  })
  const release = await publishTtrpgCampaignReleaseV1({
    scope, campaignModuleId: campaign.id!, testOnlyAllowFixtureCampaign: true,
  })
  const session = await createWorldInstance({
    scope, kind: 'ttrpg', title: 'AI 玩家混合桌', worldGroupId: null,
    gameSource: { kind: 'release', gameReleaseId: release.id! }, seed: 'ai-player-harness',
  })
  return { session, scope }
}

async function configureSeat(sessionId: number, actorKey: string, controller: 'ai' | 'hybrid') {
  const row = (await readTtrpgSessionParticipantsV2(sessionId)).find(item => item.actorKey === actorKey)!
  return configureTtrpgSessionParticipantV2({
    sessionId, seatKey: row.seatKey, expectedRevision: row.revision,
    commandId: `configure.${controller}.${row.seatKey}`, requestedByViewerKey: 'viewer.gm',
    controller, activation: 'initiative',
    consent: { aiIdentityDisclosed: true, aiAdviceAllowed: controller === 'hybrid' },
  })
}

async function startTable(sessionId: number): Promise<void> {
  const state = await readSimulationState(sessionId)
  let version = await readSimulationStateVersion(sessionId)
  await completeTtrpgSessionZero({
    sessionId, commandId: 'ai-player.zero', baseSequence: version.sequence, baseStateHash: version.stateHash,
    acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: 'gm',
  })
  version = await readSimulationStateVersion(sessionId)
  await openTtrpgCampaignScene({
    sessionId, commandId: 'ai-player.scene', baseSequence: version.sequence, baseStateHash: version.stateHash,
    sceneKey: 'scene.opening',
  })
}

async function advanceTo(sessionId: number, actorKey: string): Promise<void> {
  for (let guard = 0; guard < 8; guard += 1) {
    const state = await readSimulationState(sessionId)
    if (state.ttrpg?.activeActorKey === actorKey) return
    const active = state.ttrpg?.activeActorKey
    if (!active) throw new Error('当前战役没有行动者')
    const version = await readSimulationStateVersion(sessionId)
    await resolveTtrpgRuleAction({
      sessionId, commandId: `advance.${guard}.${active}`,
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actorKey: active, actionKey: 'investigate', difficulty: 8,
    })
  }
  throw new Error('未能推进到目标 AI 玩家')
}

describe('TTRPG-2F · isolated AI player and mixed-seat authority', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('1 真人 + 2 AI 使用单角色玩家上下文，绝不包含 KP 秘密、失败路线或其他角色私档', async () => {
    const { session, scope } = await createFormalSession()
    const playerRows = (await readTtrpgSessionParticipantsV2(session.id!)).filter(row => row.role === 'player')
    expect(playerRows).toHaveLength(3)
    await configureSeat(session.id!, playerRows[1].actorKey!, 'ai')
    await configureSeat(session.id!, playerRows[2].actorKey!, 'ai')
    await startTable(session.id!)
    const started = await readSimulationState(session.id!)
    const order = started.ttrpg!.turnOrder
    const activeIndex = order.indexOf(started.ttrpg!.activeActorKey!)
    const aiKeys = new Set([playerRows[1].actorKey!, playerRows[2].actorKey!])
    const actorKey = Array.from({ length: order.length }, (_, offset) => order[(activeIndex + offset) % order.length])
      .find(key => aiKeys.has(key))!
    await advanceTo(session.id!, actorKey)

    const assembled = await assembleContext({
      projectId: scope.projectId, scope, worldGroupId: null,
      simulationSessionId: session.id!, ttrpgPlayerActorKey: actorKey,
      sourceKeys: ['ttrpgPlayerRuntime'],
    })
    expect(assembled.included).toEqual(['ttrpgPlayerRuntime'])
    expect(assembled.text).toContain('storyforge.ttrpg-player-runtime-view')
    expect(assembled.text).not.toContain('gmSecret')
    expect(assembled.text).not.toContain('failureForward')
    expect(assembled.text).not.toContain('gmControls')

    const release = await db.gameReleases.get(session.gameReleaseId!)
    const manifest = await verifyGameReleaseManifestV2(release!.manifestJson)
    const rule = parseRulePackV1(manifest.runtimePackage.ttrpg!.rulePack.content)
    const campaign = parseTtrpgCampaignContentV1(manifest.runtimePackage.ttrpg!.campaign, rule)
    for (const scene of campaign.scenes) expect(assembled.text).not.toContain(scene.gmSecret)
    const own = campaign.characterTemplates.find(item => item.characterKey === actorKey)!
    const other = campaign.characterTemplates.find(item => item.characterKey !== actorKey && item.role === 'player')!
    if (own.playerProfile?.privateGoal) expect(assembled.text).toContain(own.playerProfile.privateGoal)
    if (other.playerProfile?.privateGoal) expect(assembled.text).not.toContain(other.playerProfile.privateGoal)
  })

  it('纯 AI 席位只产行动候选，采用时由 RulePack 重算并留下 Run/候选/上下文授权证据', async () => {
    const { session, scope } = await createFormalSession()
    const actor = (await readTtrpgSessionParticipantsV2(session.id!)).find(row => row.role === 'player')!
    await configureSeat(session.id!, actor.actorKey!, 'ai')
    await startTable(session.id!)
    await advanceTo(session.id!, actor.actorKey!)
    const before = await readSimulationState(session.id!)
    const version = await readSimulationStateVersion(session.id!)
    await expect(resolveTtrpgRuleAction({
      sessionId: session.id!, commandId: 'manual-bypass.ai-seat',
      baseSequence: version.sequence, baseStateHash: version.stateHash,
      actorKey: actor.actorKey!, actionKey: 'investigate', difficulty: 8,
    })).rejects.toThrow('不能通过真人直提入口')
    const generated = await generateTtrpgPlayerActionCandidateV1({
      scope, simulationSessionId: session.id!, actorKey: actor.actorKey!,
      objective: '依据角色目标选择一个稳妥且能推进调查的行动', runAI: async () => validOutput,
    })
    expect(generated.snapshot.projection.state).toBe('running')
    expect(await readSimulationState(session.id!)).toEqual(before)
    expect(generated.candidate).toMatchObject({
      actorKey: actor.actorKey, controller: 'ai', requiresHumanConfirmation: false,
      actionKey: 'investigate', targetKey: null, defaultDifficulty: expect.any(Number),
    })
    const adopted = await adoptTtrpgPlayerActionCandidateV1({ scope, runId: generated.candidate.runId })
    expect(adopted.snapshot.projection.state).toBe('completed')
    const result = (await readSimulationState(session.id!)).ttrpg!.product!.actionHistory.at(-1)!
    expect(result.actorAuthority).toMatchObject({
      source: 'ai-player', viewerKey: actor.viewerKey,
      runId: generated.candidate.runId, candidateHash: generated.candidate.candidateHash,
      contextManifestHash: generated.candidate.contextManifestHash,
      approach: generated.candidate.approach,
    })
    expect(result.check?.dice.every(value => value >= 1 && value <= 100)).toBe(true)
  })

  it('混合席位候选必须由真人确认；模型不能提交额外字段、越界目标或预写判定结果', async () => {
    const { session, scope } = await createFormalSession()
    const actor = (await readTtrpgSessionParticipantsV2(session.id!)).find(row => row.role === 'player')!
    await configureSeat(session.id!, actor.actorKey!, 'hybrid')
    await startTable(session.id!)
    await advanceTo(session.id!, actor.actorKey!)
    const view = await loadTtrpgPlayerRuntimeViewV1({ scope, simulationSessionId: session.id!, actorKey: actor.actorKey! })
    expect(evaluateTtrpgPlayerCandidateOutputV1(JSON.stringify({
      actionKey: 'investigate', targetKey: null, approach: '我已经成功发现线索。', spokenIntent: null,
    }), view)).toMatchObject({ accepted: false, reason: expect.stringContaining('机械结果') })
    expect(evaluateTtrpgPlayerCandidateOutputV1(JSON.stringify({
      actionKey: 'investigate', targetKey: null, approach: '查看现场', spokenIntent: null, dice: [100],
    }), view)).toMatchObject({ accepted: false, reason: expect.stringContaining('允许闭集') })
    expect(evaluateTtrpgPlayerCandidateOutputV1(JSON.stringify({
      actionKey: 'investigate', targetKey: 'future-secret-npc', approach: '查看现场', spokenIntent: null,
    }), view).accepted).toBe(false)

    const generated = await generateTtrpgPlayerActionCandidateV1({
      scope, simulationSessionId: session.id!, actorKey: actor.actorKey!,
      objective: '给真人玩家一个角色内行动建议', runAI: async () => validOutput,
    })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    await expect(commitTtrpgPlayerActionFromHarnessV1({
      sessionId: session.id!, runId: generated.candidate.runId,
      candidateHash: generated.candidate.candidateHash,
    })).rejects.toThrow('尚未获得真人确认')
    const adopted = await adoptTtrpgPlayerActionCandidateV1({ scope, runId: generated.candidate.runId })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await readSimulationState(session.id!)).ttrpg!.product!.actionHistory.at(-1)!.actorAuthority?.source)
      .toBe('hybrid-confirmed')
  })

  it('2 真人 + 1 AI 的协调器每个状态纪元只采用一个候选，并在下一非 AI 席位停止', async () => {
    const { session, scope } = await createFormalSession()
    const players = (await readTtrpgSessionParticipantsV2(session.id!)).filter(row => row.role === 'player')
    const ai = players[2]
    await configureSeat(session.id!, ai.actorKey!, 'ai')
    await startTable(session.id!)
    await advanceTo(session.id!, ai.actorKey!)
    const generated = await generateTtrpgPlayerActionCandidateV1({
      scope, simulationSessionId: session.id!, actorKey: ai.actorKey!,
      objective: '生成一次可恢复的 AI 行动', runAI: async () => validOutput,
    })
    const recovered = await coordinateTtrpgAiPlayerEpochV1({
      scope, simulationSessionId: session.id!, runAI: async () => {
        throw new Error('同一纪元不应再次调用模型')
      },
    })
    expect(recovered).toMatchObject({
      status: 'action-committed', actorKey: ai.actorKey, reused: true,
      candidate: { candidateHash: generated.candidate.candidateHash },
    })
    const cycle = await runTtrpgAiPlayerCycleV1({
      scope, simulationSessionId: session.id!, runAI: async () => validOutput,
    })
    expect(cycle.committedActions).toBe(0)
    expect(['human-controlled', 'gm-controlled']).toContain(cycle.decisions[0]?.status)
    expect((await readSimulationState(session.id!)).ttrpg!.product!.actionHistory
      .filter(action => action.actorAuthority?.candidateHash === generated.candidate.candidateHash)).toHaveLength(1)
  })
})
