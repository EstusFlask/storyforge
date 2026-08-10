import JSON5 from 'json5'
import type {
  ChatMessage,
  SimulationRuntimeState,
  SimulationTtrpgEncounterCandidate,
  SimulationTtrpgTurnCandidate,
} from '../types'
import { parseSimulationTtrpgEncounterCandidate, parseSimulationTtrpgTurnCandidate } from './runtime'

export const MAX_TTRPG_ACTION_CHARS = 4_000
export const MAX_TTRPG_CANDIDATE_CHARS = 30_000

export function buildTtrpgEncounterPrompt(input: {
  runtimeContext: string
  participantKeys: string[]
}): ChatMessage[] {
  if (input.participantKeys.length < 2) throw new Error('遭遇至少需要两个参与者。')
  return [
    {
      role: 'system',
      content: [
        '你是 StoryForge 的跑团遭遇设计助手。',
        '你只能依据冻结运行时上下文，为作者提出一份可审阅的战斗遭遇候选。',
        '不要决定先攻、生命值、护甲、骰点或状态变化；这些由代码依据运行时实体和固定种子确定。',
        '只能使用作者指定的参与者稳定实体键，不得创建实体、修改 Canon 或输出额外字段。',
        '不要输出 Markdown、解释或额外文本。',
        '输出格式：{"title":"遭遇标题","description":"遭遇目标、环境与冲突","participantKeys":["实体键"]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `指定参与者：${input.participantKeys.join('、')}`,
        '【冻结运行时上下文】',
        input.runtimeContext,
      ].join('\n\n'),
    },
  ]
}

export function buildTtrpgGmPrompt(input: {
  actorKey: string
  actorName: string
  action: string
  runtimeContext: string
}): ChatMessage[] {
  const action = input.action.trim()
  if (!input.actorKey.trim()) throw new Error('跑团行动者不能为空。')
  if (!action || action.length > MAX_TTRPG_ACTION_CHARS) throw new Error('跑团动作文本无效。')
  return [
    {
      role: 'system',
      content: [
        '你是 StoryForge 的单机跑团 AI GM。',
        '你只能依据冻结运行时上下文和玩家本次动作，提出一个可审阅的回合候选。',
        '你不能直接改变角色、地点、物品、生命状态或骰子结果；需要规则判定时只能提出检定请求，结果由代码确定性掷骰。',
        '如果提出检定，必须同时给出 success / failure 两段分支叙事，代码会依据真实结果选择其中一段。',
        '不要把小说 Canon 当作可写存档，不要创建实体，不要输出 Markdown、解释或额外字段。',
        'check 为 null 或包含 skill、expression（安全 NdM±K）、dc（0-1000）与 reason。',
        'outcomes 在 check 为 null 时必须为 null；有检定时必须包含 success 与 failure。',
        '输出格式：',
        '{',
        '  "actorKey": "当前行动者稳定实体键",',
        '  "narrative": "动作发生前后的共同叙事",',
        '  "check": {"skill": "技能", "expression": "1d20+3", "dc": 12, "reason": "为什么需要判定"},',
        '  "outcomes": {"success": "检定成功后的叙事", "failure": "检定失败后的叙事"},',
        '  "nextActorKey": "按上下文回合顺序的下一个行动者稳定实体键或 null"',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `行动者：${input.actorName}（${input.actorKey}）`,
        `玩家动作：${action}`,
        '【冻结运行时上下文】',
        input.runtimeContext,
      ].join('\n\n'),
    },
  ]
}

function parseJsonObject(draft: string): Record<string, unknown> {
  const input = draft.trim()
  if (!input) throw new Error('AI GM 回合候选为空。')
  if (input.length > MAX_TTRPG_CANDIDATE_CHARS) {
    throw new Error(`AI GM 回合候选不能超过 ${MAX_TTRPG_CANDIDATE_CHARS} 个字符。`)
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(input)
  const candidate = fenced?.[1]?.trim() ?? input
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('AI GM 回合候选不是完整 JSON 对象。')
  if (candidate.slice(end + 1).trim()) throw new Error('AI GM 回合候选 JSON 后包含额外文本。')
  const json = candidate.slice(start, end + 1)
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    try {
      return JSON5.parse(json) as Record<string, unknown>
    } catch {
      throw new Error('AI GM 回合候选不是有效 JSON。')
    }
  }
}

export function parseTtrpgTurnCandidate(input: {
  draft: string
  state: SimulationRuntimeState
  actorKey: string
  action: string
  baseSequence: number
}): SimulationTtrpgTurnCandidate {
  const raw = parseJsonObject(input.draft)
  const actorKey = input.actorKey.trim()
  const target = input.state.entities[actorKey]
  if (!target || !['player', 'character', 'npc'].includes(target.kind)) {
    throw new Error('跑团行动者不是当前会话中的有效角色。')
  }
  if (raw.actorKey != null && String(raw.actorKey).trim() !== actorKey) {
    throw new Error('AI GM 候选不能改写本次行动者。')
  }
  const candidate = parseSimulationTtrpgTurnCandidate({
    ...raw,
    baseSequence: input.baseSequence,
    actorKey,
    action: input.action,
  })
  if (candidate.nextActorKey != null && !input.state.ttrpg?.turnOrder.includes(candidate.nextActorKey)) {
    throw new Error('AI GM 候选引用了不在当前回合顺序中的行动者。')
  }
  return candidate
}

export function parseTtrpgEncounterCandidate(input: {
  draft: string
  state: SimulationRuntimeState
  participantKeys: string[]
  baseSequence: number
}): SimulationTtrpgEncounterCandidate {
  const raw = parseJsonObject(input.draft)
  const candidate = parseSimulationTtrpgEncounterCandidate({
    ...raw,
    baseSequence: input.baseSequence,
  })
  const expected = new Set(input.participantKeys.map(key => key.trim()).filter(Boolean))
  if (candidate.participantKeys.some(key => !expected.has(key))) {
    throw new Error('AI 遭遇候选引用了作者未指定的参与者。')
  }
  if (candidate.participantKeys.length !== expected.size) throw new Error('AI 遭遇候选必须保留全部指定参与者。')
  for (const key of candidate.participantKeys) {
    const entity = input.state.entities[key]
    if (!entity || !['player', 'character', 'npc'].includes(entity.kind)) throw new Error(`AI 遭遇候选引用了无效参与者: ${key}`)
  }
  return candidate
}
