import { create } from 'zustand'
import { db } from '../lib/db/schema'
import {
  appendSimulationEvent,
  branchSimulationSession,
  createSimulationCheckpoint,
  createSimulationSession,
  deleteSimulationSession,
  readSimulationState,
  resolveSimulationDice,
  verifySimulationCheckpoint,
} from '../lib/simulation/runtime'
import { buildSimulationCanonSnapshot } from '../lib/simulation/canon-snapshot'
import {
  EMPTY_SIMULATION_STATE,
  type SimulationCheckpoint,
  type SimulationEvent,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
} from '../lib/types'

interface SimulationRuntimeStore {
  projectId: number | null
  worldGroupId: number | null
  sessions: SimulationSession[]
  selectedSessionId: number | null
  events: SimulationEvent[]
  checkpoints: SimulationCheckpoint[]
  runtimeState: SimulationRuntimeState
  loading: boolean
  error: string
  load(projectId: number, worldGroupId: number | null): Promise<void>
  select(sessionId: number | null): Promise<void>
  createSession(input: {
    projectId: number
    worldGroupId: number | null
    kind: SimulationSessionKind
    title: string
    seed?: string
    sourceKeys: string[]
  }): Promise<number>
  advanceTime(amount: number): Promise<void>
  recordNarrative(text: string): Promise<void>
  rollDice(expression: string): Promise<void>
  checkpoint(name: string): Promise<void>
  branch(title: string): Promise<number>
  restoreCheckpoint(checkpointId: number): Promise<number>
  remove(sessionId: number): Promise<void>
}

async function readSessionDetails(sessionId: number) {
  const [events, checkpoints, runtimeState] = await Promise.all([
    db.simulationEvents.where('sessionId').equals(sessionId).toArray(),
    db.simulationCheckpoints.where('sessionId').equals(sessionId).toArray(),
    readSimulationState(sessionId),
  ])
  events.sort((left, right) => left.sequence - right.sequence)
  checkpoints.sort((left, right) => right.createdAt - left.createdAt)
  return { events, checkpoints, runtimeState }
}

export const useSimulationRuntimeStore = create<SimulationRuntimeStore>((set, get) => {
  const refreshSelected = async () => {
    const sessionId = get().selectedSessionId
    if (sessionId == null) return
    const details = await readSessionDetails(sessionId)
    set(details)
  }

  return {
    projectId: null,
    worldGroupId: null,
    sessions: [],
    selectedSessionId: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
    loading: false,
    error: '',

    load: async (projectId, worldGroupId) => {
      set({ loading: true, error: '' })
      try {
        const sessions = (await db.simulationSessions.where('projectId').equals(projectId).toArray())
          .filter(session => (session.worldGroupId ?? null) === worldGroupId)
        sessions.sort((left, right) => right.updatedAt - left.updatedAt)
        const current = get().projectId === projectId && get().worldGroupId === worldGroupId
          ? get().selectedSessionId
          : null
        const selectedSessionId = current != null && sessions.some(row => row.id === current)
          ? current
          : sessions[0]?.id ?? null
        set({ projectId, worldGroupId, sessions, selectedSessionId, loading: false })
        if (selectedSessionId != null) await refreshSelected()
        else set({
          events: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
        })
      } catch (error) {
        set({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    select: async sessionId => {
      set({ selectedSessionId: sessionId, error: '' })
      if (sessionId == null) {
        set({
          events: [],
          checkpoints: [],
          runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
        })
        return
      }
      try {
        set(await readSessionDetails(sessionId))
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    createSession: async input => {
      const frozen = await buildSimulationCanonSnapshot({
        projectId: input.projectId,
        worldGroupId: input.worldGroupId,
        sourceKeys: input.sourceKeys,
      })
      const session = await createSimulationSession({
        projectId: input.projectId,
        worldGroupId: input.worldGroupId,
        kind: input.kind,
        title: input.title,
        seed: input.seed,
        canonSnapshot: frozen.snapshot,
        initialState: frozen.initialState,
      })
      await get().load(input.projectId, input.worldGroupId)
      await get().select(session.id!)
      return session.id!
    },

    advanceTime: async amount => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendSimulationEvent({
        sessionId,
        type: 'time.advanced',
        payload: { amount },
      })
      await refreshSelected()
    },

    recordNarrative: async text => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await appendSimulationEvent({
        sessionId,
        type: 'narrative.recorded',
        payload: { text },
      })
      await refreshSelected()
    },

    rollDice: async expression => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await resolveSimulationDice({ sessionId, expression })
      await refreshSelected()
    },

    checkpoint: async name => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      await createSimulationCheckpoint({ sessionId, name })
      await refreshSelected()
    },

    branch: async title => {
      const sessionId = get().selectedSessionId
      if (sessionId == null) throw new Error('请先选择运行时会话。')
      const parent = get().sessions.find(row => row.id === sessionId)
      if (!parent) throw new Error('当前运行时会话不存在。')
      const child = await branchSimulationSession({
        parentSessionId: sessionId,
        throughSequence: get().runtimeState.lastSequence,
        title,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    restoreCheckpoint: async checkpointId => {
      const checkpoint = get().checkpoints.find(row => row.id === checkpointId)
      const parent = get().sessions.find(row => row.id === checkpoint?.sessionId)
      if (!checkpoint || !parent) throw new Error('要恢复的检查点不存在。')
      if (!await verifySimulationCheckpoint(checkpointId)) {
        throw new Error('检查点内容校验失败，不能用于恢复。')
      }
      const child = await branchSimulationSession({
        parentSessionId: parent.id!,
        throughSequence: checkpoint.throughSequence,
        title: `${parent.title} · ${checkpoint.name}`,
      })
      await get().load(parent.projectId, parent.worldGroupId ?? null)
      await get().select(child.id!)
      return child.id!
    },

    remove: async sessionId => {
      const projectId = get().projectId
      const worldGroupId = get().worldGroupId
      await deleteSimulationSession(sessionId)
      if (projectId != null) await get().load(projectId, worldGroupId)
    },
  }
})
