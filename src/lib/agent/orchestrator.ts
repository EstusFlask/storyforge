import JSON5 from 'json5'
import { useAIConfigStore } from '../../stores/ai-config'
import { useCharacterStore } from '../../stores/character'
import { useInspirationWorkspaceStore } from '../../stores/inspiration-workspace'
import { useWorldviewStore } from '../../stores/worldview'
import { chat } from '../ai/client'
import { db } from '../db/schema'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
  type GenerationNode,
} from '../generation/generation-node'
import {
  parseInspirationFragments,
  MAX_INSPIRATION_FRAGMENTS,
} from '../inspiration/workspace'
import { adopt } from '../registry/adopt'
import type {
  AgentEvent,
  InspirationResultMode,
} from '../types'
import {
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
  type CharacterCopilotCandidate,
  type CharacterRosterSnapshot,
} from './character-copilot'
import {
  parseInspirationCandidateDraft,
  prepareInspirationCopilot,
  type InspirationCopilotResult,
  type InspirationWorkspaceSnapshot,
} from './inspiration-copilot'
import {
  prepareWorldOriginCopilot,
  type WorldOriginSnapshot,
} from './world-origin-copilot'
import { executeAgentTool } from './tool-registry'

export const DOMAIN_AGENT_IDS = ['world-origin', 'character', 'inspiration'] as const
export type DomainAgentId = typeof DOMAIN_AGENT_IDS[number]

export interface MasterAgentTask {
  id: string
  agentId: DomainAgentId
  instruction: string
  dependsOn: string[]
}

export interface MasterAgentPlan {
  summary: string
  tasks: MasterAgentTask[]
}

export interface MasterCandidatePayload {
  version: 1
  taskId: string
  agentId: DomainAgentId
  label: string
  contextSources: string[]
  baseSnapshot: unknown
  mode?: InspirationResultMode
  selectedFragmentIds?: string[]
}

export interface ExecutedMasterCandidate {
  payload: MasterCandidatePayload
  draft: string
  runtimeNode: GenerationNode<any, any, any>
  runtimeOutput: unknown
}

interface PlannerDependencies {
  complete?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => Promise<string>
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('主 Agent 没有返回任务计划 JSON。')
  const parsed = JSON5.parse(fenced.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('主 Agent 任务计划必须是对象。')
  }
  return parsed as Record<string, unknown>
}

function fallbackPlan(request: string): MasterAgentPlan {
  const tasks: MasterAgentTask[] = []
  const hasWorld = /世界|设定|起源|文明|力量|体系|时代|地理/.test(request)
  const hasCharacter = /角色|人物|主角|配角|反派|npc/i.test(request)
  const hasInspiration = /灵感|反推|碎片|脑洞/.test(request)
  if (hasWorld) tasks.push({
    id: 'world-1',
    agentId: 'world-origin',
    instruction: request,
    dependsOn: [],
  })
  if (hasInspiration) tasks.push({
    id: 'inspiration-1',
    agentId: 'inspiration',
    instruction: request,
    dependsOn: [],
  })
  if (hasCharacter || tasks.length === 0) tasks.push({
    id: 'character-1',
    agentId: 'character',
    instruction: request,
    dependsOn: hasWorld ? ['world-1'] : [],
  })
  return { summary: '根据用户要求调度相关创作领域。', tasks }
}

function sanitizePlan(raw: Record<string, unknown>, request: string): MasterAgentPlan {
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const tasks: MasterAgentTask[] = []
  const ids = new Set<string>()
  for (const item of rawTasks.slice(0, 6)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (!DOMAIN_AGENT_IDS.includes(source.agentId as DomainAgentId)) continue
    const id = typeof source.id === 'string' && source.id.trim()
      ? source.id.trim().slice(0, 80)
      : `task-${tasks.length + 1}`
    if (ids.has(id)) continue
    ids.add(id)
    const instruction = typeof source.instruction === 'string' && source.instruction.trim()
      ? source.instruction.trim().slice(0, 1000)
      : request
    tasks.push({
      id,
      agentId: source.agentId as DomainAgentId,
      instruction,
      dependsOn: Array.isArray(source.dependsOn)
        ? source.dependsOn.filter((value): value is string => typeof value === 'string').slice(0, 5)
        : [],
    })
  }
  if (!tasks.length) return fallbackPlan(request)
  const knownIds = new Set(tasks.map(task => task.id))
  tasks.forEach(task => {
    task.dependsOn = task.dependsOn.filter(id => id !== task.id && knownIds.has(id))
  })
  return {
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim().slice(0, 500)
      : '主 Agent 已拆分本轮创作任务。',
    tasks,
  }
}

export async function createMasterAgentPlan(input: {
  projectId: number
  worldGroupId: number | null
  request: string
  signal?: AbortSignal
}, dependencies: PlannerDependencies = {}): Promise<MasterAgentPlan> {
  const request = input.request.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的创作要求。')
  const config = useAIConfigStore.getState().config
  const status = await executeAgentTool('read_project_status', {
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    provider: config.provider,
    model: config.model,
  })
  const messages = [{
    role: 'system' as const,
    content: `你是 StoryForge 面向用户的唯一主 Agent。你不直接生成作品，也不要求用户选择领域；
你只把用户目标拆成幕后领域任务。可用领域 Agent：
- world-origin：建立或补充世界来源、时代与文明起点；
- character：设计一个新角色；
- inspiration：基于项目内已保存灵感碎片做结构化反推。
依赖任务必须写 dependsOn。世界设定与角色同时出现时，角色应依赖世界任务。
只输出 JSON：{"summary":"给用户的简短计划","tasks":[{"id":"稳定ID","agentId":"world-origin|character|inspiration","instruction":"给分 Agent 的完整要求","dependsOn":[]}]}。
最多 6 个任务；不要输出 Markdown。`,
  }, {
    role: 'user' as const,
    content: `【项目紧凑状态】\n${status.ok ? status.content : '状态不可用'}\n\n【用户目标】\n${request}`,
  }]
  try {
    const output = dependencies.complete
      ? await dependencies.complete(messages)
      : await chat(messages, config, {
          category: 'agent.orchestrator',
          projectId: input.projectId,
          configOverrides: { maxTokens: 1800, temperature: 0.2 },
          contextOverflowPolicy: 'reject',
        }, input.signal)
    return sanitizePlan(extractJsonObject(output), request)
  } catch (error) {
    if (input.signal?.aborted) throw error
    console.warn('[master-agent] 计划模型失败，使用确定性路由降级：', error)
    return fallbackPlan(request)
  }
}

function topologicalTasks(plan: MasterAgentPlan): MasterAgentTask[] {
  const byId = new Map(plan.tasks.map(task => [task.id, task]))
  const done = new Set<string>()
  const result: MasterAgentTask[] = []
  while (result.length < plan.tasks.length) {
    const available = plan.tasks.filter(task => (
      !done.has(task.id) && task.dependsOn.every(id => done.has(id) || !byId.has(id))
    ))
    if (!available.length) throw new Error('主 Agent 任务计划包含循环依赖。')
    available.forEach(task => {
      result.push(task)
      done.add(task.id)
    })
  }
  return result
}

export async function executeMasterAgentPlan(input: {
  projectId: number
  worldGroupId: number | null
  plan: MasterAgentPlan
  signal?: AbortSignal
  onTask?: (task: MasterAgentTask, status: 'running' | 'completed' | 'failed', error?: string) => void
}): Promise<ExecutedMasterCandidate[]> {
  const candidates: ExecutedMasterCandidate[] = []
  const outputs = new Map<string, string>()
  for (const task of topologicalTasks(input.plan)) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    input.onTask?.(task, 'running')
    try {
      const upstream = task.dependsOn
        .map(id => outputs.get(id))
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n\n')
      if (task.agentId === 'world-origin') {
        const prepared = await prepareWorldOriginCopilot({
          projectId: input.projectId,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          signal: input.signal,
        })
        const result = await runGenerationNode(prepared.node, prepared.prepared)
        if (result.gate?.status === 'blocked') {
          throw new Error(result.gate.issues.map(issue => issue.message).join('；'))
        }
        const draft = result.output
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '世界来源',
            contextSources: prepared.contextSources,
            baseSnapshot: prepared.snapshot,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else if (task.agentId === 'character') {
        const prepared = await prepareCharacterCopilot({
          projectId: input.projectId,
          worldGroupId: input.worldGroupId,
          authorRequest: task.instruction,
          supplementalContext: upstream,
          signal: input.signal,
        })
        const result = await runGenerationNode(prepared.node, prepared.prepared)
        if (result.gate?.status === 'blocked') {
          throw new Error(result.gate.issues.map(issue => issue.message).join('；'))
        }
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '新角色',
            contextSources: prepared.contextSources,
            baseSnapshot: prepared.snapshot,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      } else {
        const workspace = await db.inspirationWorkspaces.where('projectId').equals(input.projectId).first()
        const selectedFragmentIds = parseInspirationFragments(workspace?.fragments)
          .slice(0, MAX_INSPIRATION_FRAGMENTS)
          .map(fragment => fragment.id)
        if (!selectedFragmentIds.length) throw new Error('项目尚无已保存的灵感碎片。')
        const prepared = await prepareInspirationCopilot({
          projectId: input.projectId,
          selectedFragmentIds,
          authorRequest: task.instruction,
          signal: input.signal,
        })
        const result = await runGenerationNode(prepared.node, prepared.prepared)
        if (result.gate?.status === 'blocked') {
          throw new Error(result.gate.issues.map(issue => issue.message).join('；'))
        }
        const draft = JSON.stringify(result.output, null, 2)
        candidates.push({
          payload: {
            version: 1,
            taskId: task.id,
            agentId: task.agentId,
            label: '灵感反推版本',
            contextSources: prepared.contextSources,
            baseSnapshot: prepared.snapshot,
            mode: prepared.mode,
            selectedFragmentIds,
          },
          draft,
          runtimeNode: prepared.node,
          runtimeOutput: result.output,
        })
        outputs.set(task.id, draft)
      }
      input.onTask?.(task, 'completed')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      input.onTask?.(task, 'failed', message)
      throw error
    }
  }
  return candidates
}

function sameWorldSnapshot(
  left: WorldOriginSnapshot,
  right: WorldOriginSnapshot,
): boolean {
  return left.id === right.id
    && left.updatedAt === right.updatedAt
    && left.worldOrigin === right.worldOrigin
}

async function currentWorldSnapshot(projectId: number, worldGroupId: number | null): Promise<WorldOriginSnapshot> {
  const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
  const row = worldGroupId == null
    ? (rows.find(item => (item.worldGroupId ?? null) === null) ?? rows[0] ?? null)
    : (rows.find(item => item.worldGroupId === worldGroupId) ?? null)
  return { id: row?.id ?? null, updatedAt: row?.updatedAt ?? null, worldOrigin: row?.worldOrigin ?? '' }
}

async function currentRosterSnapshot(projectId: number, worldGroupId: number | null): Promise<CharacterRosterSnapshot> {
  const rows = await db.characters.where('projectId').equals(projectId).toArray()
  return {
    serialized: JSON.stringify(rows.map(character => ({
      id: character.id ?? null,
      updatedAt: character.updatedAt,
      name: character.name,
      homeWorldGroupId: character.homeWorldGroupId ?? null,
      isCrossWorld: Boolean(character.isCrossWorld),
    })).sort((left, right) => (left.id ?? 0) - (right.id ?? 0))),
    visibleNames: rows
      .filter(character => character.isCrossWorld || (character.homeWorldGroupId ?? null) === worldGroupId)
      .map(character => character.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')),
  }
}

async function currentInspirationSnapshot(projectId: number): Promise<InspirationWorkspaceSnapshot> {
  const row = await db.inspirationWorkspaces.where('projectId').equals(projectId).first()
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    fragments: row?.fragments ?? '[]',
    versions: row?.versions ?? '[]',
  }
}

export async function adoptMasterCandidate(input: {
  projectId: number
  worldGroupId: number | null
  event: AgentEvent
  payload: MasterCandidatePayload
  draft: string
  runtime?: ExecutedMasterCandidate
}): Promise<string> {
  if (input.runtime) {
    const output = input.payload.agentId === 'world-origin'
      ? input.draft
      : input.payload.agentId === 'character'
        ? parseCharacterCandidateDraft(input.draft)
        : parseInspirationCandidateDraft(input.draft, input.payload.mode ?? 'single')
    const result = await adoptGenerationNodeOutput(input.runtime.runtimeNode, output)
    if (!result.adopted) {
      throw new Error(result.gate?.issues.map(issue => issue.message).join('；') || '候选没有通过确认闸门。')
    }
  } else if (input.payload.agentId === 'world-origin') {
    const base = input.payload.baseSnapshot as WorldOriginSnapshot
    if (!sameWorldSnapshot(base, await currentWorldSnapshot(input.projectId, input.worldGroupId))) {
      throw new Error('世界来源已在候选生成后发生变化，请重新生成。')
    }
    const draft = input.draft.trim()
    if (draft.length < 4 || draft.length > 12_000) throw new Error('世界来源候选长度无效。')
    await adopt({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      target: 'worldviews',
      mode: 'replace',
      data: { worldOrigin: draft },
    })
  } else if (input.payload.agentId === 'character') {
    const base = input.payload.baseSnapshot as CharacterRosterSnapshot
    const current = await currentRosterSnapshot(input.projectId, input.worldGroupId)
    if (base.serialized !== current.serialized) throw new Error('角色主档已变化，请重新生成。')
    const candidate = parseCharacterCandidateDraft(input.draft)
    const normalized = candidate.name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    if (current.visibleNames.includes(normalized)) throw new Error(`当前世界已存在角色“${candidate.name}”。`)
    await adopt({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      target: 'characters',
      mode: 'add',
      data: { ...candidate, isCrossWorld: false },
    })
  } else {
    const base = input.payload.baseSnapshot as InspirationWorkspaceSnapshot
    const current = await currentInspirationSnapshot(input.projectId)
    if (JSON.stringify(base) !== JSON.stringify(current)) throw new Error('灵感工作区已变化，请重新生成。')
    const mode = input.payload.mode ?? 'single'
    const result = parseInspirationCandidateDraft(input.draft, mode)
    await useInspirationWorkspaceStore.getState().load(input.projectId)
    await useInspirationWorkspaceStore.getState().saveVersion(input.projectId, {
      mode,
      parentVersionId: null,
      fragmentIds: input.payload.selectedFragmentIds ?? [],
      result: result as InspirationCopilotResult,
    })
  }

  await Promise.all([
    useWorldviewStore.getState().loadAll(input.projectId, input.worldGroupId),
    useCharacterStore.getState().loadAll(input.projectId),
  ])
  return input.payload.agentId === 'world-origin'
    ? '世界来源已写入项目。'
    : input.payload.agentId === 'character'
      ? `角色“${(parseCharacterCandidateDraft(input.draft) as CharacterCopilotCandidate).name}”已加入项目。`
      : `已保存新的${input.payload.mode === 'multiworld' ? '多世界' : '单世界'}灵感版本。`
}
