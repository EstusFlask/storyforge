import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  acceptNpcEvolutionProposal,
  appendNpcEvolutionProposal,
  appendSimulationEvent,
  createSimulationSession,
  readPendingNpcEvolutionProposals,
  readSimulationState,
} from '../../src/lib/simulation/runtime'
import {
  buildNpcEvolutionPrompt,
  parseNpcEvolutionCandidate,
} from '../../src/lib/simulation/npc-evolution'
import { buildSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'
import type { SimulationRuntimeState } from '../../src/lib/types'

const initialState: SimulationRuntimeState = {
  version: 1,
  clock: 0,
  entities: {
    'npc:gatekeeper': {
      entityKey: 'npc:gatekeeper',
      kind: 'npc',
      sourceId: 7,
      name: '守门人',
      locationKey: 'location:gate',
      lifecycleStatus: 'active',
      attributes: { mood: '平静', role: 'npc' },
    },
    'location:gate': {
      entityKey: 'location:gate',
      kind: 'location',
      sourceId: 8,
      name: '城门',
      locationKey: null,
      lifecycleStatus: 'active',
      attributes: {},
    },
    'location:market': {
      entityKey: 'location:market',
      kind: 'location',
      sourceId: 9,
      name: '集市',
      locationKey: null,
      lifecycleStatus: 'active',
      attributes: {},
    },
  },
  memories: [],
  narratives: [],
  lastSequence: 0,
}

async function seedProject() {
  const projectId = 97001
  await db.projects.put({
    id: projectId,
    name: 'SIM-1C 测试项目',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 1000,
    enableMultiWorld: false,
    createdAt: 1,
    updatedAt: 1,
  } as any)
  return projectId
}

describe('SIM-1C · NPC 演进功能闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('提案持久化、确认回放，并保持作者 Canon 不变', async () => {
    const projectId = await seedProject()
    await db.characters.put({
      id: 7,
      projectId,
      name: '守门人',
      role: 'npc',
      roleWeight: 'npc',
      shortDescription: '原始主档',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    const session = await createSimulationSession({
      projectId,
      kind: 'npc-evolution',
      title: '城门线',
      initialState,
    })
    const candidate = {
      baseSequence: 0,
      entityKey: 'npc:gatekeeper',
      locationKey: 'location:market',
      lifecycleStatus: 'inactive' as const,
      attributes: { mood: '警惕', trust: 2 },
      narrative: '守门人听见警报后离开城门。',
      memory: { status: 'known' as const, content: '他记住了集市的暗号。' },
      rationale: '作者要求体现冲突后的退场。',
    }

    const proposed = await appendNpcEvolutionProposal({ sessionId: session.id!, candidate })
    expect(proposed.type).toBe('npc.evolution.proposed')
    expect((await readSimulationState(session.id!)).entities['npc:gatekeeper']).toMatchObject({
      locationKey: 'location:gate', lifecycleStatus: 'active', attributes: { mood: '平静' },
    })
    expect(readPendingNpcEvolutionProposals([proposed])).toMatchObject([{ proposalSequence: 1 }])

    await acceptNpcEvolutionProposal({ sessionId: session.id!, proposalSequence: 1 })
    const state = await readSimulationState(session.id!)
    expect(state.entities['npc:gatekeeper']).toMatchObject({
      locationKey: 'location:market',
      lifecycleStatus: 'inactive',
      attributes: { mood: '警惕', role: 'npc', trust: 2 },
    })
    expect(state.narratives).toEqual([{ eventSequence: 2, text: candidate.narrative }])
    expect(state.memories).toMatchObject([{ subjectKey: 'npc:gatekeeper', content: candidate.memory.content, sourceEventSequence: 2 }])
    expect(await db.characters.get(7)).toMatchObject({ shortDescription: '原始主档', name: '守门人' })
    expect(readPendingNpcEvolutionProposals(await db.simulationEvents.where('sessionId').equals(session.id!).toArray())).toEqual([])
  })

  it('会话继续追加事件后候选过期，且通用入口不能绕过专用 API', async () => {
    const projectId = await seedProject()
    const session = await createSimulationSession({ projectId, kind: 'npc-evolution', title: '过期线', initialState })
    const candidate = {
      baseSequence: 0,
      entityKey: 'npc:gatekeeper',
      locationKey: 'location:gate',
      lifecycleStatus: 'active' as const,
      attributes: { mood: '犹豫' },
      narrative: '守门人犹豫片刻。',
      memory: null,
      rationale: '',
    }
    await appendNpcEvolutionProposal({ sessionId: session.id!, candidate })
    await appendSimulationEvent({ sessionId: session.id!, type: 'time.advanced', payload: { amount: 1 } })
    await expect(acceptNpcEvolutionProposal({ sessionId: session.id!, proposalSequence: 1 }))
      .rejects.toThrow('过期')
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'npc.evolution.proposed',
      payload: { candidate },
    })).rejects.toThrow('API')
  })

  it('拒绝非 NPC、伪造地点和未知字段，严格解析候选 JSON', async () => {
    const projectId = await seedProject()
    const nonNpcState: SimulationRuntimeState = {
      ...initialState,
      entities: { ...initialState.entities, 'character:hero': { ...initialState.entities['npc:gatekeeper'], entityKey: 'character:hero', kind: 'character', attributes: { role: 'main' } } },
    }
    const session = await createSimulationSession({ projectId, kind: 'npc-evolution', title: '边界线', initialState: nonNpcState })
    const baseCandidate = {
      baseSequence: 0,
      entityKey: 'character:hero',
      locationKey: 'location:gate',
      lifecycleStatus: 'active' as const,
      attributes: { mood: '变化' },
      narrative: '',
      memory: null,
      rationale: '',
    }
    await expect(appendNpcEvolutionProposal({ sessionId: session.id!, candidate: baseCandidate }))
      .rejects.toThrow('只有运行时 NPC')
    await expect(appendNpcEvolutionProposal({
      sessionId: session.id!,
      candidate: { ...baseCandidate, entityKey: 'npc:gatekeeper', locationKey: 'location:forged' },
    })).rejects.toThrow('目标地点不存在')
    expect(() => parseNpcEvolutionCandidate({
      draft: JSON.stringify({ ...baseCandidate, entityKey: 'npc:gatekeeper', extra: true }),
      state: initialState,
      targetEntityKey: 'npc:gatekeeper',
      baseSequence: 0,
    })).toThrow('未知字段')
    expect(buildNpcEvolutionPrompt({
      authorRequest: '让他警惕起来',
      targetEntityKey: 'npc:gatekeeper',
      targetName: '守门人',
      runtimeContext: '【运行时实体】',
    })[0].content).toContain('不要修改作者 Canon')
  })

  it('运行时上下文只接受同项目同世界会话，并拒绝被篡改的冻结快照', async () => {
    const projectId = await seedProject()
    const worldGroupId = await db.worldGroups.add({ projectId, name: '默认世界', type: 'primary', order: 0, createdAt: 1, updatedAt: 1 } as any) as number
    const npcId = await db.characters.add({ projectId, homeWorldGroupId: worldGroupId, name: '守门人', role: 'npc', roleWeight: 'npc', createdAt: 1, updatedAt: 1 } as any) as number
    const locationId = await db.importantLocations.add({ projectId, name: '城门', createdAt: 1, updatedAt: 1 } as any) as number
    const catalog = await buildSimulationCanonSnapshot({
      projectId,
      worldGroupId,
      sourceKeys: [`character:${npcId}`, `location:${locationId}`],
    })
    const session = await createSimulationSession({
      projectId,
      worldGroupId,
      kind: 'npc-evolution',
      title: '上下文线',
      canonSnapshot: catalog.snapshot,
      initialState: catalog.initialState,
    })
    const context = await assembleContext({ projectId, worldGroupId, simulationSessionId: session.id!, sourceKeys: ['simulationRuntime'] })
    expect(context.included).toEqual(['simulationRuntime'])
    expect(context.text).toContain('守门人')
    expect(context.text).toContain('城门')
    expect((await assembleContext({ projectId: projectId + 1, simulationSessionId: session.id!, sourceKeys: ['simulationRuntime'] })).included).toEqual([])
    await db.simulationSessions.update(session.id!, {
      canonSnapshotJson: JSON.stringify({ ...catalog.snapshot, worldLabel: '篡改' }),
    })
    await expect(assembleContext({ projectId, worldGroupId, simulationSessionId: session.id!, sourceKeys: ['simulationRuntime'] })).rejects.toThrow('校验失败')
  })
})
