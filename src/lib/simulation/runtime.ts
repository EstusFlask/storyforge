import { db } from '../db/schema'
import { transactionTablesForReferences } from '../registry/lifecycle'
import {
  EMPTY_SIMULATION_STATE,
  RUNTIME_ENTITY_KINDS,
  RUNTIME_LIFECYCLE_STATUSES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_SESSION_KINDS,
  type RuntimeAttributes,
  type RuntimeEntityState,
  type RuntimeMemory,
  type SimulationCheckpoint,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationNpcEvolutionCandidate,
  type SimulationNpcEvolutionProposal,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type SimulationTtrpgAction,
  type SimulationTtrpgCheck,
  type SimulationTtrpgCheckRequest,
  type SimulationTtrpgScene,
  type SimulationTtrpgState,
  type SimulationTtrpgTurnCandidate,
} from '../types'

type JsonObject = Record<string, unknown>

export interface CreateSimulationSessionInput {
  projectId: number
  worldGroupId?: number | null
  kind: SimulationSessionKind
  title: string
  seed?: string
  canonSnapshot?: unknown
  initialState?: SimulationRuntimeState
}

export interface DiceResolution {
  expression: string
  dice: number[]
  modifier: number
  total: number
  nonce: string
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(value: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(value)
    if (!isObject(parsed)) throw new Error(`${label} 必须是 JSON 对象。`)
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('必须是 JSON 对象。')) throw error
    throw new Error(`${label} 不是合法 JSON。`)
  }
}

function assertFiniteInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}..${max} 的整数。`)
  }
  return Number(value)
}

function assertRuntimeAttributes(value: unknown): RuntimeAttributes {
  if (!isObject(value)) throw new Error('运行时 attributes 必须是对象。')
  const result: RuntimeAttributes = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim() || key.length > 80) throw new Error('运行时属性键无效。')
    if (raw !== null && !['string', 'number', 'boolean'].includes(typeof raw)) {
      throw new Error(`运行时属性 ${key} 只能是标量。`)
    }
    if (typeof raw === 'number' && !Number.isFinite(raw)) {
      throw new Error(`运行时属性 ${key} 不是有限数字。`)
    }
    result[key] = raw as RuntimeAttributes[string]
  }
  return result
}

function assertRuntimeEntity(value: unknown): RuntimeEntityState {
  if (!isObject(value)) throw new Error('运行时实体必须是对象。')
  const entityKey = String(value.entityKey ?? '').trim()
  const name = String(value.name ?? '').trim()
  const kind = String(value.kind ?? '')
  const lifecycleStatus = String(value.lifecycleStatus ?? '')
  if (!entityKey || entityKey.length > 160) throw new Error('运行时实体缺少有效 entityKey。')
  if (!name || name.length > 200) throw new Error('运行时实体缺少有效名称。')
  if (!RUNTIME_ENTITY_KINDS.includes(kind as RuntimeEntityState['kind'])) {
    throw new Error(`未知运行时实体类型: ${kind}`)
  }
  if (!RUNTIME_LIFECYCLE_STATUSES.includes(lifecycleStatus as RuntimeEntityState['lifecycleStatus'])) {
    throw new Error(`未知运行时生命周期: ${lifecycleStatus}`)
  }
  const sourceId = value.sourceId == null
    ? null
    : assertFiniteInteger(value.sourceId, 'sourceId', 1, Number.MAX_SAFE_INTEGER)
  const locationKey = value.locationKey == null ? null : String(value.locationKey).trim() || null
  return {
    entityKey,
    kind: kind as RuntimeEntityState['kind'],
    sourceId,
    name,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState['lifecycleStatus'],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
  }
}

function assertRuntimeMemory(value: unknown): RuntimeMemory {
  if (!isObject(value)) throw new Error('运行时记忆必须是对象。')
  const id = String(value.id ?? '').trim()
  const subjectKey = String(value.subjectKey ?? '').trim()
  const content = String(value.content ?? '').trim()
  const status = String(value.status ?? '')
  if (!id || id.length > 160) throw new Error('运行时记忆缺少有效 id。')
  if (!subjectKey || subjectKey.length > 160) throw new Error('运行时记忆缺少主体。')
  if (!content || content.length > 4_000) throw new Error('运行时记忆内容无效。')
  if (!['known', 'mistaken', 'forgotten'].includes(status)) {
    throw new Error(`未知运行时记忆状态: ${status}`)
  }
  return {
    id,
    subjectKey,
    content,
    status: status as RuntimeMemory['status'],
    sourceEventSequence: assertFiniteInteger(
      value.sourceEventSequence,
      'sourceEventSequence',
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  }
}

export function isNpcRuntimeEntity(entity: RuntimeEntityState): boolean {
  return entity.kind === 'npc'
    || (entity.kind === 'character' && (
      entity.attributes.role === 'npc'
      || entity.attributes.roleWeight === 'npc'
    ))
}

export function parseSimulationNpcEvolutionCandidate(
  value: unknown,
): SimulationNpcEvolutionCandidate {
  if (!isObject(value)) throw new Error('NPC 演进候选必须是对象。')
  const allowed = new Set([
    'baseSequence',
    'entityKey',
    'locationKey',
    'lifecycleStatus',
    'attributes',
    'narrative',
    'memory',
    'rationale',
  ])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`NPC 演进候选包含未知字段: ${unknown.join(', ')}`)
  const entityKey = String(value.entityKey ?? '').trim()
  if (!entityKey || entityKey.length > 160) throw new Error('NPC 演进候选缺少有效实体。')
  const rawLocationKey = value.locationKey
  if (rawLocationKey != null && typeof rawLocationKey !== 'string') {
    throw new Error('NPC 演进地点必须是稳定实体键或 null。')
  }
  const locationKey = typeof rawLocationKey === 'string'
    ? rawLocationKey.trim() || null
    : null
  const lifecycleStatus = String(value.lifecycleStatus ?? '')
  if (!RUNTIME_LIFECYCLE_STATUSES.includes(lifecycleStatus as RuntimeEntityState['lifecycleStatus'])) {
    throw new Error(`未知 NPC 生命周期状态: ${lifecycleStatus}`)
  }
  const narrative = String(value.narrative ?? '').trim()
  if (narrative.length > 20_000) throw new Error('NPC 演进叙事过长。')
  const rationale = String(value.rationale ?? '').trim()
  if (rationale.length > 4_000) throw new Error('NPC 演进理由过长。')
  let memory: SimulationNpcEvolutionCandidate['memory'] = null
  if (value.memory != null) {
    if (!isObject(value.memory)) throw new Error('NPC 演进记忆必须是对象或 null。')
    const status = String(value.memory.status ?? '')
    const content = String(value.memory.content ?? '').trim()
    if (!['known', 'mistaken', 'forgotten'].includes(status)) {
      throw new Error(`未知 NPC 记忆状态: ${status}`)
    }
    if (!content || content.length > 4_000) throw new Error('NPC 演进记忆内容无效。')
    memory = { status: status as RuntimeMemory['status'], content }
  }
  return {
    baseSequence: assertFiniteInteger(
      value.baseSequence,
      'NPC 演进基线序号',
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    entityKey,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState['lifecycleStatus'],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
    narrative,
    memory,
    rationale,
  }
}

function prepareNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
): RuntimeEntityState {
  const existing = state.entities[candidate.entityKey]
  if (!existing) throw new Error(`要演进的运行时实体不存在: ${candidate.entityKey}`)
  if (!isNpcRuntimeEntity(existing)) throw new Error('只有运行时 NPC 可以进入演进候选。')
  if (candidate.locationKey != null) {
    const location = state.entities[candidate.locationKey]
    if (!location || location.kind !== 'location') {
      throw new Error(`NPC 演进目标地点不存在: ${candidate.locationKey}`)
    }
  }
  const next = assertRuntimeEntity({
    ...existing,
    locationKey: candidate.locationKey,
    lifecycleStatus: candidate.lifecycleStatus,
    attributes: { ...existing.attributes, ...candidate.attributes },
  })
  const attributesChanged = Object.entries(candidate.attributes)
    .some(([key, child]) => existing.attributes[key] !== child)
  if (
    next.locationKey === existing.locationKey
    && next.lifecycleStatus === existing.lifecycleStatus
    && !attributesChanged
    && !candidate.narrative
    && !candidate.memory
  ) throw new Error('NPC 演进候选没有任何状态或经历变化。')
  return next
}

function applyNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
  eventSequence: number,
): void {
  state.entities[candidate.entityKey] = prepareNpcEvolution(state, candidate)
  if (candidate.narrative) {
    state.narratives.push({ eventSequence, text: candidate.narrative })
  }
  if (candidate.memory) {
    state.memories.push({
      id: `npc-evolution:${eventSequence}:${candidate.entityKey}`,
      subjectKey: candidate.entityKey,
      status: candidate.memory.status,
      content: candidate.memory.content,
      sourceEventSequence: eventSequence,
    })
  }
}

function assertTtrpgScene(value: unknown): SimulationTtrpgScene {
  if (!isObject(value)) throw new Error('跑团场景必须是对象。')
  const sceneId = String(value.sceneId ?? '').trim()
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  const locationKey = value.locationKey == null ? null : String(value.locationKey).trim() || null
  const status = String(value.status ?? 'active')
  if (!sceneId || sceneId.length > 160) throw new Error('跑团场景缺少有效 ID。')
  if (!title || title.length > 200) throw new Error('跑团场景标题无效。')
  if (description.length > 8_000) throw new Error('跑团场景描述过长。')
  if (status !== 'active' && status !== 'resolved') throw new Error('跑团场景状态无效。')
  return { sceneId, title, description, locationKey, status: status as SimulationTtrpgScene['status'] }
}

function assertTtrpgAction(value: unknown): SimulationTtrpgAction {
  if (!isObject(value)) throw new Error('跑团动作必须是对象。')
  const eventSequence = assertFiniteInteger(value.eventSequence, '跑团动作事件序号', 1, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const text = String(value.text ?? '').trim()
  if (!actorKey || actorKey.length > 160) throw new Error('跑团动作缺少行动者。')
  if (!text || text.length > 4_000) throw new Error('跑团动作文本无效。')
  return { eventSequence, actorKey, text }
}

function assertTtrpgCheck(value: unknown): SimulationTtrpgCheck {
  if (!isObject(value)) throw new Error('跑团检定必须是对象。')
  const eventSequence = assertFiniteInteger(value.eventSequence, '跑团检定事件序号', 1, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const skill = String(value.skill ?? '').trim()
  const expression = String(value.expression ?? '').trim()
  const dc = assertFiniteInteger(value.dc, '检定难度', 0, 1_000)
  const dice = value.dice
  if (!actorKey || actorKey.length > 160) throw new Error('跑团检定缺少行动者。')
  if (!skill || skill.length > 120) throw new Error('跑团检定技能无效。')
  if (!Array.isArray(dice)) throw new Error('跑团检定缺少骰子结果。')
  const parsed = parseDiceExpression(expression)
  if (dice.length !== parsed.count) throw new Error('跑团检定骰子数量与骰式不一致。')
  const normalizedDice = dice.map(die => assertFiniteInteger(die, '检定骰子点数', 1, parsed.sides))
  const modifier = Number(value.modifier)
  const total = Number(value.total)
  const success = value.success
  if (modifier !== parsed.modifier || total !== normalizedDice.reduce((sum, die) => sum + die, modifier)) {
    throw new Error('跑团检定合计与骰式不一致。')
  }
  if (success !== (total >= dc)) throw new Error('跑团检定成功状态与合计不一致。')
  return {
    eventSequence,
    actorKey,
    skill,
    expression: parsed.normalized,
    dice: normalizedDice,
    modifier,
    total,
    dc,
    success: Boolean(success),
  }
}

function emptyTtrpgState(): SimulationTtrpgState {
  return { scene: null, round: 0, activeActorKey: null, turnOrder: [], actions: [], checks: [] }
}

function parseTtrpgState(value: unknown): SimulationTtrpgState | null {
  if (value == null) return null
  if (!isObject(value)) throw new Error('跑团状态必须是对象或 null。')
  const scene = value.scene == null ? null : assertTtrpgScene(value.scene)
  const round = assertFiniteInteger(value.round, '跑团回合', 0, Number.MAX_SAFE_INTEGER)
  const activeActorKey = value.activeActorKey == null ? null : String(value.activeActorKey).trim() || null
  if (!Array.isArray(value.turnOrder)) throw new Error('跑团回合顺序必须是数组。')
  const turnOrder = value.turnOrder.map(raw => String(raw).trim())
  if (turnOrder.some(key => !key || key.length > 160) || new Set(turnOrder).size !== turnOrder.length) {
    throw new Error('跑团回合顺序包含无效或重复行动者。')
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey)) throw new Error('跑团当前行动者不在回合顺序中。')
  if (!Array.isArray(value.actions) || !Array.isArray(value.checks)) throw new Error('跑团动作与检定记录必须是数组。')
  return {
    scene,
    round,
    activeActorKey,
    turnOrder,
    actions: value.actions.map(assertTtrpgAction),
    checks: value.checks.map(assertTtrpgCheck),
  }
}

function requireTtrpgState(state: SimulationRuntimeState): SimulationTtrpgState {
  if (!state.ttrpg) state.ttrpg = emptyTtrpgState()
  return state.ttrpg
}

export function parseSimulationTtrpgTurnCandidate(value: unknown): SimulationTtrpgTurnCandidate {
  if (!isObject(value)) throw new Error('跑团回合候选必须是对象。')
  const allowed = new Set(['baseSequence', 'actorKey', 'action', 'narrative', 'check', 'outcomes', 'nextActorKey'])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`跑团回合候选包含未知字段: ${unknown.join(', ')}`)
  const baseSequence = assertFiniteInteger(value.baseSequence, '跑团候选基线序号', 0, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const action = String(value.action ?? '').trim()
  const narrative = String(value.narrative ?? '').trim()
  const nextActorKey = value.nextActorKey == null ? null : String(value.nextActorKey).trim() || null
  if (!actorKey || actorKey.length > 160) throw new Error('跑团候选缺少行动者。')
  if (!action || action.length > 4_000) throw new Error('跑团候选动作无效。')
  if (!narrative || narrative.length > 20_000) throw new Error('跑团候选叙事无效。')
  let check: SimulationTtrpgCheckRequest | null = null
  if (value.check != null) {
    if (!isObject(value.check)) throw new Error('跑团检定候选必须是对象或 null。')
    const skill = String(value.check.skill ?? '').trim()
    const expression = String(value.check.expression ?? '').trim()
    const reason = String(value.check.reason ?? '').trim()
    const dc = assertFiniteInteger(value.check.dc, '检定难度', 0, 1_000)
    parseDiceExpression(expression)
    if (!skill || skill.length > 120) throw new Error('跑团候选技能无效。')
    if (!reason || reason.length > 1_000) throw new Error('跑团候选检定理由无效。')
    check = { skill, expression, dc, reason }
  }
  let outcomes: SimulationTtrpgTurnCandidate['outcomes'] = null
  if (value.outcomes != null) {
    if (!isObject(value.outcomes)) throw new Error('跑团检定分支叙事必须是对象或 null。')
    const success = String(value.outcomes.success ?? '').trim()
    const failure = String(value.outcomes.failure ?? '').trim()
    if (!success || !failure || success.length > 20_000 || failure.length > 20_000) {
      throw new Error('跑团检定成功/失败叙事无效。')
    }
    outcomes = { success, failure }
  }
  if ((check == null) !== (outcomes == null)) throw new Error('跑团检定与成功/失败叙事必须同时提供。')
  return { baseSequence, actorKey, action, narrative, check, outcomes, nextActorKey }
}

export function parseSimulationState(value: string | SimulationRuntimeState): SimulationRuntimeState {
  const parsed = typeof value === 'string' ? parseJsonObject(value, '运行时状态') : value
  if (parsed.version !== 1) throw new Error('不支持的运行时状态版本。')
  const clock = assertFiniteInteger(parsed.clock, '运行时时钟', 0, Number.MAX_SAFE_INTEGER)
  const lastSequence = assertFiniteInteger(
    parsed.lastSequence,
    'lastSequence',
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (!isObject(parsed.entities)) throw new Error('运行时 entities 必须是对象。')
  const entities: Record<string, RuntimeEntityState> = {}
  for (const [key, raw] of Object.entries(parsed.entities)) {
    const entity = assertRuntimeEntity(raw)
    if (entity.entityKey !== key) throw new Error(`实体索引与 entityKey 不一致: ${key}`)
    entities[key] = entity
  }
  if (!Array.isArray(parsed.memories)) throw new Error('运行时 memories 必须是数组。')
  if (!Array.isArray(parsed.narratives)) throw new Error('运行时 narratives 必须是数组。')
  const memories = parsed.memories.map(assertRuntimeMemory)
  const narratives = parsed.narratives.map(raw => {
    if (!isObject(raw)) throw new Error('运行时叙事记录必须是对象。')
    const text = String(raw.text ?? '').trim()
    if (!text || text.length > 20_000) throw new Error('运行时叙事文本无效。')
    return {
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        'narrative.eventSequence',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      text,
    }
  })
  return {
    version: 1,
    clock,
    entities,
    memories,
    narratives,
    ttrpg: parseTtrpgState(parsed.ttrpg),
    lastSequence,
  }
}

function cloneState(state: SimulationRuntimeState): SimulationRuntimeState {
  return structuredClone(state)
}

function parseEventPayload(event: SimulationEvent): JsonObject {
  if (!SIMULATION_EVENT_TYPES.includes(event.type)) {
    throw new Error(`未知模拟事件类型: ${event.type}`)
  }
  return parseJsonObject(event.payloadJson, `模拟事件 ${event.type}`)
}

export function applySimulationEvent(
  current: SimulationRuntimeState,
  event: SimulationEvent,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current))
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error(`模拟事件序号不连续: 期望 ${state.lastSequence + 1}，收到 ${event.sequence}`)
  }
  const payload = parseEventPayload(event)
  switch (event.type) {
    case 'time.advanced': {
      const amount = assertFiniteInteger(payload.amount, '时间推进量', 1, 1_000_000_000)
      if (state.clock + amount > Number.MAX_SAFE_INTEGER) throw new Error('运行时时钟溢出。')
      state.clock += amount
      break
    }
    case 'entity.upserted': {
      const entity = assertRuntimeEntity(payload.entity)
      state.entities[entity.entityKey] = entity
      break
    }
    case 'entity.patched': {
      const entityKey = String(payload.entityKey ?? '').trim()
      const existing = state.entities[entityKey]
      if (!existing) throw new Error(`运行时实体不存在: ${entityKey}`)
      if (!isObject(payload.patch)) throw new Error('实体补丁必须是对象。')
      const allowed = new Set(['name', 'locationKey', 'lifecycleStatus', 'attributes'])
      for (const key of Object.keys(payload.patch)) {
        if (!allowed.has(key)) throw new Error(`实体补丁禁止字段: ${key}`)
      }
      state.entities[entityKey] = assertRuntimeEntity({
        ...existing,
        ...payload.patch,
        entityKey,
        kind: existing.kind,
        sourceId: existing.sourceId,
        attributes: payload.patch.attributes == null
          ? existing.attributes
          : { ...existing.attributes, ...assertRuntimeAttributes(payload.patch.attributes) },
      })
      break
    }
    case 'entity.removed': {
      const entityKey = String(payload.entityKey ?? '').trim()
      if (!state.entities[entityKey]) throw new Error(`运行时实体不存在: ${entityKey}`)
      delete state.entities[entityKey]
      break
    }
    case 'memory.recorded': {
      const memory = assertRuntimeMemory(payload.memory)
      if (memory.sourceEventSequence !== event.sequence) {
        throw new Error('运行时记忆必须引用自身事件序号。')
      }
      const index = state.memories.findIndex(row => row.id === memory.id)
      if (index >= 0) state.memories[index] = memory
      else state.memories.push(memory)
      break
    }
    case 'random.resolved': {
      assertDiceResolution(payload)
      break
    }
    case 'narrative.recorded': {
      const text = String(payload.text ?? '').trim()
      if (!text || text.length > 20_000) throw new Error('运行时叙事文本无效。')
      state.narratives.push({ eventSequence: event.sequence, text })
      break
    }
    case 'ttrpg.scene.opened': {
      const ttrpg = requireTtrpgState(state)
      const scene = assertTtrpgScene(payload.scene)
      const rawTurnOrder = payload.turnOrder
      if (!Array.isArray(rawTurnOrder) || rawTurnOrder.length === 0) {
        throw new Error('跑团场景至少需要一个行动者。')
      }
      const turnOrder = rawTurnOrder.map(raw => String(raw).trim())
      if (new Set(turnOrder).size !== turnOrder.length) throw new Error('跑团回合顺序不能重复。')
      for (const actorKey of turnOrder) {
        const actor = state.entities[actorKey]
        if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
          throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
        }
      }
      if (scene.locationKey != null) {
        const location = state.entities[scene.locationKey]
        if (!location || location.kind !== 'location') throw new Error(`跑团场景地点不存在: ${scene.locationKey}`)
      }
      ttrpg.scene = scene
      ttrpg.round = 1
      ttrpg.activeActorKey = turnOrder[0]
      ttrpg.turnOrder = turnOrder
      ttrpg.actions = []
      ttrpg.checks = []
      break
    }
    case 'ttrpg.action.recorded': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const action = assertTtrpgAction({
        eventSequence: event.sequence,
        actorKey: payload.actorKey,
        text: payload.text,
      })
      if (!ttrpg.turnOrder.includes(action.actorKey)) throw new Error('跑团动作行动者不在当前回合顺序中。')
      if (ttrpg.activeActorKey !== action.actorKey) throw new Error('当前还没轮到该行动者。')
      ttrpg.actions.push(action)
      break
    }
    case 'ttrpg.check.resolved': {
      const ttrpg = requireTtrpgState(state)
      if (!isObject(payload.check)) throw new Error('跑团检定缺少 check 对象。')
      const check = assertTtrpgCheck({ ...payload.check, eventSequence: event.sequence })
      if (!ttrpg.turnOrder.includes(check.actorKey)) throw new Error('跑团检定行动者不在当前回合顺序中。')
      ttrpg.checks.push(check)
      break
    }
    case 'ttrpg.gm.response.recorded': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const actionSequence = assertFiniteInteger(payload.actionSequence, '跑团动作序号', 1, event.sequence - 1)
      if (!ttrpg.actions.some(action => action.eventSequence === actionSequence)) {
        throw new Error('AI GM 叙事没有对应的玩家动作。')
      }
      if (payload.checkSequence != null) {
        const checkSequence = assertFiniteInteger(payload.checkSequence, '跑团检定序号', 1, event.sequence - 1)
        if (!ttrpg.checks.some(check => check.eventSequence === checkSequence)) {
          throw new Error('AI GM 叙事引用了不存在的检定。')
        }
      }
      const text = String(payload.text ?? '').trim()
      if (!text || text.length > 20_000) throw new Error('AI GM 叙事文本无效。')
      state.narratives.push({ eventSequence: event.sequence, text })
      break
    }
    case 'ttrpg.turn.advanced': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const nextActorKey = String(payload.nextActorKey ?? '').trim()
      const round = assertFiniteInteger(payload.round, '跑团回合', 1, Number.MAX_SAFE_INTEGER)
      if (!ttrpg.turnOrder.includes(nextActorKey)) throw new Error('下一个行动者不在当前回合顺序中。')
      const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey ?? '')
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length
      const expectedActorKey = ttrpg.turnOrder[nextIndex]
      const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0)
      if (nextActorKey !== expectedActorKey || round !== expectedRound) {
        throw new Error('跑团回合推进与确定性顺序不一致。')
      }
      ttrpg.activeActorKey = nextActorKey
      ttrpg.round = round
      break
    }
    case 'npc.evolution.proposed': {
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate)
      if (candidate.baseSequence !== state.lastSequence) {
        throw new Error('NPC 演进候选基线与当前事件序号不一致。')
      }
      prepareNpcEvolution(state, candidate)
      break
    }
    case 'npc.evolution.accepted': {
      const proposalSequence = assertFiniteInteger(
        payload.proposalSequence,
        'NPC 演进提案序号',
        1,
        event.sequence - 1,
      )
      if (state.lastSequence !== proposalSequence) {
        throw new Error('NPC 演进候选已过期，请重新生成。')
      }
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate)
      if (candidate.baseSequence !== proposalSequence - 1) {
        throw new Error('NPC 演进候选与提案序号不一致。')
      }
      applyNpcEvolution(state, candidate, event.sequence)
      break
    }
    case 'npc.evolution.rejected': {
      assertFiniteInteger(
        payload.proposalSequence,
        'NPC 演进提案序号',
        1,
        event.sequence - 1,
      )
      const reason = String(payload.reason ?? '').trim()
      if (reason.length > 1_000) throw new Error('NPC 演进拒绝原因过长。')
      break
    }
  }
  state.lastSequence = event.sequence
  return state
}

export function replaySimulationEvents(
  initialState: SimulationRuntimeState,
  events: readonly SimulationEvent[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): SimulationRuntimeState {
  let state = cloneState(parseSimulationState(initialState))
  const ordered = [...events]
    .filter(event => event.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence)
  for (const event of ordered) state = applySimulationEvent(state, event)
  return state
}

async function assertSessionScope(input: {
  projectId: number
  worldGroupId?: number | null
}): Promise<void> {
  if (!await db.projects.get(input.projectId)) throw new Error('模拟会话所属项目不存在。')
  if (input.worldGroupId != null) {
    const world = await db.worldGroups.get(input.worldGroupId)
    if (!world || world.projectId !== input.projectId) {
      throw new Error('模拟会话所属世界不存在或不属于当前项目。')
    }
  }
}

function defaultSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export async function createSimulationSession(
  input: CreateSimulationSessionInput,
): Promise<SimulationSession> {
  await assertSessionScope(input)
  if (!SIMULATION_SESSION_KINDS.includes(input.kind)) throw new Error('未知模拟会话类型。')
  const title = input.title.trim()
  if (!title || title.length > 200) throw new Error('模拟会话标题无效。')
  const initialState = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE)
  if (initialState.lastSequence !== 0) throw new Error('模拟会话初始状态 lastSequence 必须为 0。')
  const canonSnapshot = input.canonSnapshot ?? { version: 1, sources: [] }
  if (!isObject(canonSnapshot)) throw new Error('Canon 冻结快照必须是对象。')
  const now = Date.now()
  const session: SimulationSession = {
    projectId: input.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title,
    status: 'active',
    rulesetVersion: 1,
    seed: input.seed?.trim() || defaultSeed(),
    canonSnapshotJson: JSON.stringify(canonSnapshot),
    initialStateJson: JSON.stringify(initialState),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
  }
  session.id = await db.simulationSessions.add(session) as number
  return session
}

async function readSessionEvents(
  session: SimulationSession,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationEvent[]> {
  const events = await db.simulationEvents.where('sessionId').equals(session.id!).toArray()
  for (const event of events) {
    if (
      event.projectId !== session.projectId
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)
    ) {
      throw new Error(`模拟事件 ${event.id ?? '?'} 作用域与会话不一致。`)
    }
  }
  return events.filter(event => event.sequence <= throughSequence)
}

export async function readSimulationState(
  sessionId: number,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationRuntimeState> {
  const session = await db.simulationSessions.get(sessionId)
  if (!session) throw new Error('模拟会话不存在。')
  const events = await readSessionEvents(session, throughSequence)
  return replaySimulationEvents(parseSimulationState(session.initialStateJson), events, throughSequence)
}

async function appendBuiltEvent(
  sessionId: number,
  build: (input: {
    session: SimulationSession
    state: SimulationRuntimeState
    events: SimulationEvent[]
    sequence: number
  }) => Omit<SimulationEvent, 'id' | 'projectId' | 'worldGroupId' | 'sessionId' | 'sequence' | 'createdAt'>,
): Promise<SimulationEvent> {
  return db.transaction(
    'rw',
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(sessionId)
      if (!session) throw new Error('模拟会话不存在。')
      if (session.status !== 'active') throw new Error('只有 active 会话可以追加事件。')
      const events = await readSessionEvents(session)
      const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
      const sequence = state.lastSequence + 1
      const built = build({ session, state, events, sequence })
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId,
        sequence,
        ...built,
        createdAt: Date.now(),
      }
      applySimulationEvent(state, event)
      event.id = await db.simulationEvents.add(event) as number
      await db.simulationSessions.update(sessionId, { updatedAt: event.createdAt })
      return event
    },
  )
}

export async function appendSimulationEvent(input: {
  sessionId: number
  type: SimulationEventType
  actorKey?: string | null
  targetKey?: string | null
  payload: unknown
}): Promise<SimulationEvent> {
  if (input.type === 'random.resolved') {
    throw new Error('随机判定只能通过 resolveSimulationDice() 生成。')
  }
  if (
    input.type === 'npc.evolution.proposed'
    || input.type === 'npc.evolution.accepted'
    || input.type === 'npc.evolution.rejected'
    || input.type === 'ttrpg.scene.opened'
    || input.type === 'ttrpg.action.recorded'
    || input.type === 'ttrpg.check.resolved'
    || input.type === 'ttrpg.gm.response.recorded'
    || input.type === 'ttrpg.turn.advanced'
  ) {
    throw new Error('受治理的互动事件只能通过对应的专用 API 生成。')
  }
  return appendBuiltEvent(input.sessionId, ({ sequence }) => {
    let payload = input.payload
    if (
      input.type === 'memory.recorded'
      && isObject(payload)
      && isObject(payload.memory)
    ) {
      payload = {
        ...payload,
        memory: {
          ...payload.memory,
          sourceEventSequence: sequence,
        },
      }
    }
    return {
      type: input.type,
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(payload),
    }
  })
}

function proposalSequenceFromResolution(event: SimulationEvent): number | null {
  if (
    event.type !== 'npc.evolution.accepted'
    && event.type !== 'npc.evolution.rejected'
  ) return null
  const payload = parseEventPayload(event)
  return Number.isInteger(payload.proposalSequence) ? Number(payload.proposalSequence) : null
}

export function readPendingNpcEvolutionProposals(
  events: readonly SimulationEvent[],
): SimulationNpcEvolutionProposal[] {
  const resolved = new Set(events.flatMap(event => {
    const sequence = proposalSequenceFromResolution(event)
    return sequence == null ? [] : [sequence]
  }))
  return events
    .filter(event => event.type === 'npc.evolution.proposed' && !resolved.has(event.sequence))
    .map(event => ({
      ...parseSimulationNpcEvolutionCandidate(parseEventPayload(event).candidate),
      proposalSequence: event.sequence,
    }))
    .sort((left, right) => left.proposalSequence - right.proposalSequence)
}

export async function appendNpcEvolutionProposal(input: {
  sessionId: number
  candidate: SimulationNpcEvolutionCandidate
}): Promise<SimulationEvent> {
  const candidate = parseSimulationNpcEvolutionCandidate(input.candidate)
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'npc-evolution') {
      throw new Error('NPC 演进候选只能写入 NPC 演进会话。')
    }
    if (candidate.baseSequence !== state.lastSequence) {
      throw new Error('NPC 演进生成期间会话已变化，请重新生成。')
    }
    prepareNpcEvolution(state, candidate)
    return {
      type: 'npc.evolution.proposed',
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({ candidate }),
    }
  })
}

export async function acceptNpcEvolutionProposal(input: {
  sessionId: number
  proposalSequence: number
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, state, events }) => {
    if (session.kind !== 'npc-evolution') throw new Error('当前不是 NPC 演进会话。')
    const proposal = events.find(event => (
      event.sequence === input.proposalSequence
      && event.type === 'npc.evolution.proposed'
    ))
    if (!proposal) throw new Error('NPC 演进提案不存在。')
    if (events.some(event => proposalSequenceFromResolution(event) === input.proposalSequence)) {
      throw new Error('NPC 演进提案已经处理。')
    }
    if (state.lastSequence !== input.proposalSequence) {
      throw new Error('NPC 演进候选已过期，请重新生成。')
    }
    const candidate = parseSimulationNpcEvolutionCandidate(parseEventPayload(proposal).candidate)
    return {
      type: 'npc.evolution.accepted',
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({ proposalSequence: input.proposalSequence, candidate }),
    }
  })
}

export async function rejectNpcEvolutionProposal(input: {
  sessionId: number
  proposalSequence: number
  reason?: string
}): Promise<SimulationEvent> {
  const reason = input.reason?.trim() ?? ''
  if (reason.length > 1_000) throw new Error('NPC 演进拒绝原因过长。')
  return appendBuiltEvent(input.sessionId, ({ session, events }) => {
    if (session.kind !== 'npc-evolution') throw new Error('当前不是 NPC 演进会话。')
    const proposal = events.find(event => (
      event.sequence === input.proposalSequence
      && event.type === 'npc.evolution.proposed'
    ))
    if (!proposal) throw new Error('NPC 演进提案不存在。')
    if (events.some(event => proposalSequenceFromResolution(event) === input.proposalSequence)) {
      throw new Error('NPC 演进提案已经处理。')
    }
    return {
      type: 'npc.evolution.rejected',
      actorKey: proposal.actorKey ?? null,
      targetKey: proposal.targetKey ?? null,
      payloadJson: JSON.stringify({ proposalSequence: input.proposalSequence, reason }),
    }
  })
}

function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  return hash >>> 0
}

function deterministicDie(seed: string, sides: number): number {
  let value = hash32(seed)
  value += 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) % sides + 1
}

function parseDiceExpression(expression: string): {
  normalized: string
  count: number
  sides: number
  modifier: number
} {
  const match = expression.trim().toLowerCase().match(/^(\d{1,3})d(\d{1,4})(?:([+-])(\d{1,7}))?$/)
  if (!match) throw new Error('骰式必须是 NdM±K，例如 1d20+3。')
  const count = assertFiniteInteger(Number(match[1]), '骰子数量', 1, 100)
  const sides = assertFiniteInteger(Number(match[2]), '骰子面数', 2, 1_000)
  const rawModifier = match[4] ? Number(match[4]) : 0
  const modifier = match[3] === '-' ? -rawModifier : rawModifier
  if (Math.abs(modifier) > 1_000_000) throw new Error('骰式修正值过大。')
  const normalized = `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`
  return { normalized, count, sides, modifier }
}

function assertDiceResolution(value: unknown): DiceResolution {
  if (!isObject(value)) throw new Error('随机判定结果必须是对象。')
  const parsed = parseDiceExpression(String(value.expression ?? ''))
  if (!Array.isArray(value.dice) || value.dice.length !== parsed.count) {
    throw new Error('随机判定骰子数量与骰式不一致。')
  }
  const dice = value.dice.map(die => assertFiniteInteger(die, '骰子点数', 1, parsed.sides))
  const modifier = Number(value.modifier)
  const total = Number(value.total)
  if (modifier !== parsed.modifier || total !== dice.reduce((sum, die) => sum + die, modifier)) {
    throw new Error('随机判定合计与骰式不一致。')
  }
  return {
    expression: parsed.normalized,
    dice,
    modifier,
    total,
    nonce: String(value.nonce ?? ''),
  }
}

function buildDiceResolution(input: {
  seed: string
  sequence: number
  expression: ReturnType<typeof parseDiceExpression>
  nonce: string
}): DiceResolution {
  const dice = Array.from({ length: input.expression.count }, (_, index) => (
    deterministicDie(
      `${input.seed}\u0000${input.sequence}\u0000${input.expression.normalized}\u0000${input.nonce}\u0000${index}`,
      input.expression.sides,
    )
  ))
  return {
    expression: input.expression.normalized,
    dice,
    modifier: input.expression.modifier,
    total: dice.reduce((sum, die) => sum + die, input.expression.modifier),
    nonce: input.nonce,
  }
}

export async function resolveSimulationDice(input: {
  sessionId: number
  expression: string
  nonce?: string
  actorKey?: string | null
  targetKey?: string | null
}): Promise<SimulationEvent> {
  const parsed = parseDiceExpression(input.expression)
  const nonce = input.nonce?.trim() ?? ''
  if (nonce.length > 200) throw new Error('随机判定 nonce 过长。')
  return appendBuiltEvent(input.sessionId, ({ session, sequence }) => {
    const resolution = buildDiceResolution({ seed: session.seed, sequence, expression: parsed, nonce })
    return {
      type: 'random.resolved',
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(resolution),
    }
  })
}

function assertTtrpgActor(state: SimulationRuntimeState, actorKey: string): void {
  const actor = state.entities[actorKey]
  if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
    throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
  }
  const ttrpg = state.ttrpg
  if (!ttrpg?.scene || ttrpg.scene.status !== 'active') throw new Error('请先开始一个跑团场景。')
  if (!ttrpg.turnOrder.includes(actorKey)) throw new Error('行动者不在当前回合顺序中。')
  if (ttrpg.activeActorKey !== actorKey) throw new Error('当前还没轮到该行动者。')
}

export async function openTtrpgScene(input: {
  sessionId: number
  title: string
  description: string
  locationKey?: string | null
  turnOrder: string[]
}): Promise<SimulationEvent> {
  const title = input.title.trim()
  const description = input.description.trim()
  const turnOrder = [...new Set(input.turnOrder.map(key => key.trim()).filter(Boolean))]
  if (!title || title.length > 200) throw new Error('跑团场景标题无效。')
  if (description.length > 8_000) throw new Error('跑团场景描述过长。')
  if (turnOrder.length === 0) throw new Error('跑团场景至少需要一个行动者。')
  const scene: SimulationTtrpgScene = {
    sceneId: globalThis.crypto?.randomUUID?.() ?? `scene-${Date.now()}-${Math.random()}`,
    title,
    description,
    locationKey: input.locationKey?.trim() || null,
    status: 'active',
  }
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以开始场景。')
    for (const actorKey of turnOrder) {
      const actor = state.entities[actorKey]
      if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
        throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
      }
    }
    if (scene.locationKey != null) {
      const location = state.entities[scene.locationKey]
      if (!location || location.kind !== 'location') throw new Error(`跑团场景地点不存在: ${scene.locationKey}`)
    }
    return {
      type: 'ttrpg.scene.opened',
      actorKey: turnOrder[0],
      targetKey: scene.locationKey,
      payloadJson: JSON.stringify({ scene, turnOrder }),
    }
  })
}

export async function resolveTtrpgCheck(input: {
  sessionId: number
  actorKey: string
  skill: string
  expression: string
  dc: number
  nonce?: string
}): Promise<SimulationEvent> {
  const actorKey = input.actorKey.trim()
  const skill = input.skill.trim()
  const parsed = parseDiceExpression(input.expression)
  const dc = assertFiniteInteger(input.dc, '检定难度', 0, 1_000)
  const nonce = input.nonce?.trim() || `check:${skill}`
  if (!skill || skill.length > 120) throw new Error('检定技能无效。')
  if (nonce.length > 200) throw new Error('检定 nonce 过长。')
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以进行技能检定。')
    assertTtrpgActor(state, actorKey)
    const resolution = buildDiceResolution({ seed: session.seed, sequence, expression: parsed, nonce })
    return {
      type: 'ttrpg.check.resolved',
      actorKey,
      targetKey: actorKey,
      payloadJson: JSON.stringify({
        check: {
          actorKey,
          skill,
          expression: resolution.expression,
          dice: resolution.dice,
          modifier: resolution.modifier,
          total: resolution.total,
          dc,
          success: resolution.total >= dc,
        },
      }),
    }
  })
}

export async function appendTtrpgTurn(input: {
  sessionId: number
  candidate: SimulationTtrpgTurnCandidate
}): Promise<SimulationEvent[]> {
  const candidate = parseSimulationTtrpgTurnCandidate(input.candidate)
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session) throw new Error('模拟会话不存在。')
    if (session.status !== 'active') throw new Error('只有 active 会话可以追加事件。')
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以记录回合。')
    const events = await readSessionEvents(session)
    let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (candidate.baseSequence !== state.lastSequence) throw new Error('跑团候选已过期，请重新生成。')
    assertTtrpgActor(state, candidate.actorKey)
    const ttrpg = state.ttrpg!
    const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey!)
    const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length
    const expectedNextActorKey = ttrpg.turnOrder[nextIndex]
    const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0)
    if (candidate.nextActorKey != null && candidate.nextActorKey !== expectedNextActorKey) {
      throw new Error('跑团候选尝试改变确定性回合顺序。')
    }
    if (candidate.check) parseDiceExpression(candidate.check.expression)
    const appended: SimulationEvent[] = []
    const appendLocal = (inputEvent: {
      type: SimulationEventType
      actorKey?: string | null
      targetKey?: string | null
      payload: unknown
    }) => {
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: state.lastSequence + 1,
        type: inputEvent.type,
        actorKey: inputEvent.actorKey ?? null,
        targetKey: inputEvent.targetKey ?? null,
        payloadJson: JSON.stringify(inputEvent.payload),
        createdAt: Date.now(),
      }
      state = applySimulationEvent(state, event)
      appended.push(event)
    }
    appendLocal({
      type: 'ttrpg.action.recorded',
      actorKey: candidate.actorKey,
      targetKey: candidate.actorKey,
      payload: { actorKey: candidate.actorKey, text: candidate.action },
    })
    let checkSequence: number | null = null
    let resolvedNarrative = candidate.narrative
    if (candidate.check) {
      const expression = parseDiceExpression(candidate.check.expression)
      const sequence = state.lastSequence + 1
      const resolution = buildDiceResolution({
        seed: session.seed,
        sequence,
        expression,
        nonce: `check:${candidate.check.skill}`,
      })
      checkSequence = sequence
      resolvedNarrative = [
        candidate.narrative,
        resolution.total >= candidate.check.dc ? candidate.outcomes!.success : candidate.outcomes!.failure,
      ].filter(Boolean).join('\n\n')
      appendLocal({
        type: 'ttrpg.check.resolved',
        actorKey: candidate.actorKey,
        targetKey: candidate.actorKey,
        payload: {
          check: {
            actorKey: candidate.actorKey,
            skill: candidate.check.skill,
            expression: resolution.expression,
            dice: resolution.dice,
            modifier: resolution.modifier,
            total: resolution.total,
            dc: candidate.check.dc,
            success: resolution.total >= candidate.check.dc,
          },
        },
      })
    }
    const actionSequence = appended[0].sequence
    appendLocal({
      type: 'ttrpg.gm.response.recorded',
      actorKey: null,
      targetKey: candidate.actorKey,
      payload: {
        actionSequence,
        checkSequence,
        text: resolvedNarrative,
      },
    })
    appendLocal({
      type: 'ttrpg.turn.advanced',
      actorKey: candidate.actorKey,
      targetKey: expectedNextActorKey,
      payload: { nextActorKey: expectedNextActorKey, round: expectedRound },
    })
    for (const event of appended) event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(input.sessionId, { updatedAt: appended[appended.length - 1].createdAt })
    return appended
  })
}

async function hashStateJson(stateJson: string): Promise<string> {
  const data = new TextEncoder().encode(stateJson)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSimulationCheckpoint(input: {
  sessionId: number
  name: string
  throughSequence?: number
}): Promise<SimulationCheckpoint> {
  const session = await db.simulationSessions.get(input.sessionId)
  if (!session) throw new Error('模拟会话不存在。')
  const events = await readSessionEvents(session)
  const latest = events.reduce((max, event) => Math.max(max, event.sequence), 0)
  const throughSequence = input.throughSequence ?? latest
  if (!Number.isInteger(throughSequence) || throughSequence < 0 || throughSequence > latest) {
    throw new Error('检查点序号不在会话事件范围内。')
  }
  const state = replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    events,
    throughSequence,
  )
  const stateJson = JSON.stringify(state)
  const name = input.name.trim() || `检查点 ${throughSequence}`
  if (name.length > 200) throw new Error('检查点名称不能超过 200 个字符。')
  const checkpoint: SimulationCheckpoint = {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    throughSequence,
    name,
    stateJson,
    stateHash: await hashStateJson(stateJson),
    createdAt: Date.now(),
  }
  checkpoint.id = await db.simulationCheckpoints.add(checkpoint) as number
  return checkpoint
}

export async function verifySimulationCheckpoint(checkpointId: number): Promise<boolean> {
  const checkpoint = await db.simulationCheckpoints.get(checkpointId)
  if (!checkpoint) return false
  const session = await db.simulationSessions.get(checkpoint.sessionId)
  if (
    !session
    || session.projectId !== checkpoint.projectId
    || (session.worldGroupId ?? null) !== (checkpoint.worldGroupId ?? null)
  ) return false
  const replayed = await readSimulationState(checkpoint.sessionId, checkpoint.throughSequence)
  const stateJson = JSON.stringify(replayed)
  return stateJson === checkpoint.stateJson
    && await hashStateJson(stateJson) === checkpoint.stateHash
}

export async function branchSimulationSession(input: {
  parentSessionId: number
  throughSequence: number
  title: string
  seed?: string
}): Promise<SimulationSession> {
  const parent = await db.simulationSessions.get(input.parentSessionId)
  if (!parent) throw new Error('父模拟会话不存在。')
  const events = await readSessionEvents(parent)
  const latest = events.reduce((max, event) => Math.max(max, event.sequence), 0)
  if (
    !Number.isInteger(input.throughSequence)
    || input.throughSequence < 0
    || input.throughSequence > latest
  ) throw new Error('分支序号不在父会话事件范围内。')
  const state = replaySimulationEvents(
    parseSimulationState(parent.initialStateJson),
    events,
    input.throughSequence,
  )
  state.lastSequence = 0
  const child = await createSimulationSession({
    projectId: parent.projectId,
    worldGroupId: parent.worldGroupId ?? null,
    kind: parent.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: parseJsonObject(parent.canonSnapshotJson, 'Canon 冻结快照'),
    initialState: state,
  })
  await db.simulationSessions.update(child.id!, {
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
  })
  return {
    ...child,
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
  }
}

export async function deleteSimulationSession(sessionId: number): Promise<void> {
  await db.transaction('rw', transactionTablesForReferences('simulationSessions'), async () => {
    await db.simulationEvents.where('sessionId').equals(sessionId).delete()
    await db.simulationCheckpoints.where('sessionId').equals(sessionId).delete()
    const children = await db.simulationSessions.where('parentSessionId').equals(sessionId).toArray()
    for (const child of children) {
      if (child.id != null) {
        await db.simulationSessions.update(child.id, {
          parentSessionId: null,
          parentThroughSequence: null,
        })
      }
    }
    await db.simulationSessions.delete(sessionId)
  })
}
