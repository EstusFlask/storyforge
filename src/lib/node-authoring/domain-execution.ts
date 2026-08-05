import { chat } from '../ai/client'
import {
  adoptCharacterCopilotCandidate,
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
} from '../agent/character-copilot'
import {
  prepareOutlineCopilot,
  adoptRestoredOutlineCandidate,
  type OutlineCopilotMode,
} from '../agent/outline-copilot'
import {
  prepareProseCopilot,
  adoptRestoredProseCandidate,
} from '../agent/prose-copilot'
import { buildEnhancedDetailPrompt, parseEnhancedDetailResult } from '../ai/adapters/detail-scene-adapter'
import { adoptChapterOutlineWorkshopResult } from '../outline/adopt-workshop'
import { assembleContext } from '../registry/assemble-context'
import { db } from '../db/schema'
import type { AIConfig } from '../types'
import type { AdoptResult } from '../registry/types'
import { AUTHORING_NODE_BY_ID } from './catalog'
import { readAuthoringCanonBinding } from './bindings'
import type {
  AuthoringCandidateDomain,
  AuthoringInputEnvelope,
  AuthoringNodeInstance,
  AuthoringSemantic,
} from './contracts'

export interface DomainExecutionResult {
  output: string
  variants?: string[]
  sourceKeys?: string[]
  sourceHash?: string
  sourceEvidence?: {
    included: string[]
    omitted: string[]
    trimmed: string[]
    missing: string[]
  }
  semantic: AuthoringSemantic
  domain: AuthoringCandidateDomain
}

export interface DomainExecutionInput {
  node: AuthoringNodeInstance
  inputs: AuthoringInputEnvelope[]
  projectId: number
  worldGroupId: number | null
  aiConfig: AIConfig
  signal?: AbortSignal
}

function configText(node: AuthoringNodeInstance, key: string): string {
  return typeof node.config[key] === 'string' ? String(node.config[key]).trim() : ''
}

function configNumber(node: AuthoringNodeInstance, key: string, fallback: number): number {
  const value = node.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function inputControl(inputs: AuthoringInputEnvelope[], semantic: string): string {
  return inputs.find(input => input.semantic === semantic)?.content.trim() ?? ''
}

function nonControlInput(inputs: AuthoringInputEnvelope[]): string {
  return inputs
    .filter(input => input.state !== 'control' && input.content.trim())
    .map(input => `【${input.targetPortId}｜${input.semantic}】\n${input.content.trim()}`)
    .join('\n\n')
}

function requestFor(node: AuthoringNodeInstance, fallback: string): string {
  return configText(node, 'request') || fallback
}

function profileForBudget(value: number): 'lean' | 'balanced' | 'full' {
  if (value <= 14_000) return 'lean'
  if (value <= 32_000) return 'balanced'
  return 'full'
}

function generationOverrides(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const temperature = Number(inputControl(inputs, 'control.temperature') || configNumber(node, 'temperature', NaN))
  const maxTokens = Number(inputControl(inputs, 'control.max-tokens') || configNumber(node, 'maxTokens', NaN))
  return {
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    ...(Number.isFinite(maxTokens) ? { maxTokens: Math.max(100, Math.round(maxTokens)) } : {}),
  }
}

function generationCount(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]): number {
  const raw = Number(inputControl(inputs, 'control.count') || configNumber(node, 'candidateCount', 1))
  return Math.min(8, Math.max(1, Number.isFinite(raw) ? Math.round(raw) : 1))
}

function contextBudget(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[], fallback: number): number {
  const value = Number(inputControl(inputs, 'control.context-budget') || configNumber(node, 'contextBudget', fallback))
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function structuredTitleInput(inputs: AuthoringInputEnvelope[], semantic: AuthoringSemantic): string {
  const content = inputs.find(input => input.semantic === semantic && input.content.trim())?.content.trim()
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as unknown
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const title = (first as Record<string, unknown>).title
      if (typeof title === 'string') return title.trim()
    }
  } catch {
    // Free-form upstream content remains available as supplemental context, but is not a safe target key.
  }
  return ''
}

function targetTitle(
  node: AuthoringNodeInstance,
  inputs: AuthoringInputEnvelope[],
  key: string,
  semantic: AuthoringSemantic,
): string {
  return configText(node, key) || structuredTitleInput(inputs, semantic)
}

async function executeCharacter(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const supplementalContext = nonControlInput(input.inputs)
  const budget = contextBudget(input.node, input.inputs, 28_500)
  const prepared = await prepareCharacterCopilot({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    authorRequest: requestFor(input.node, '根据当前世界资料创建一个结构完整的新角色。'),
    supplementalContext,
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(budget),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    const candidate = await prepared.node.run(prepared.prepared.messages)
    variants.push(JSON.stringify(candidate, null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: 'character.profile',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'character', rosterSnapshot: prepared.snapshot.serialized },
  }
}

async function executeOutline(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const supplementalContext = nonControlInput(input.inputs)
  const template = AUTHORING_NODE_BY_ID.get(input.node.templateId)
  const mode: OutlineCopilotMode = input.node.templateId === 'outline.volume' ? 'volumes' : 'chapters'
  const configuredVolume = configText(input.node, 'volumeTitle')
  const request = requestFor(
    input.node,
    mode === 'volumes' ? '根据当前世界和故事核心规划卷纲。' : '根据所属卷规划章节大纲。',
  )
  const modeHint = mode === 'volumes' && !/卷纲|卷级|分卷|全书大纲|规划.{0,6}卷/.test(request)
    ? `${request} 请输出卷纲。`
    : request
  const requestWithTarget = configuredVolume && !modeHint.includes(configuredVolume)
    ? `${modeHint} 目标卷：《${configuredVolume}》`
    : modeHint
  const parameterValues = {
    ...(mode === 'volumes'
      ? { volumeCount: Number(inputControl(input.inputs, 'control.volume-count')) || '' }
      : { chaptersPerVolume: Number(inputControl(input.inputs, 'control.chapter-count')) || '' }),
  }
  const prepared = await prepareOutlineCopilot({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    authorRequest: requestWithTarget,
    supplementalContext,
    routingCategory: template?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 48_000)),
    parameterValues,
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    const candidate = await prepared.node.run(prepared.prepared.messages)
    variants.push(JSON.stringify(candidate, null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: mode === 'volumes' ? 'outline.volume' : 'outline.chapter',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: {
      kind: 'outline',
      mode: prepared.mode,
      parentVolumeId: prepared.parentVolumeId,
      snapshot: prepared.snapshot,
    },
  }
}

function segmentText(assembled: Awaited<ReturnType<typeof assembleContext>>, key: string): string {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

async function executeDetail(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  const allNodes = await db.outlineNodes.where('projectId').equals(input.projectId).toArray()
  const title = targetTitle(input.node, input.inputs, 'chapterTitle', 'outline.chapter')
  const candidates = allNodes.filter(node => (
    node.type === 'chapter'
    && (node.worldGroupId ?? null) === input.worldGroupId
    && (!title || node.title === title || nonControlInput(input.inputs).includes(node.title))
  ))
  if (candidates.length !== 1 || candidates[0]?.id == null) {
    throw new Error(title ? `找不到唯一的目标章节《${title}》。` : '章节细纲节点需要填写唯一的目标章节标题。')
  }
  const outline = candidates[0]!
  const outlineId = outline.id!
  const siblings = allNodes
    .filter(node => node.type === 'chapter' && node.parentId === outline.parentId && (node.worldGroupId ?? null) === input.worldGroupId)
    .sort((left, right) => left.order - right.order)
  const index = siblings.findIndex(node => node.id === outline.id)
  const assembled = await assembleContext({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    outlineNodeId: outlineId,
    sourceKeys: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.reads?.sourceKeys,
    inputBudgetTokens: contextBudget(input.node, input.inputs, 16_000),
    provider: input.aiConfig.provider,
    model: input.aiConfig.model,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const messages = buildEnhancedDetailPrompt(
    outline.title,
    outline.summary,
    siblings[index - 1]?.summary ?? '',
    siblings[index + 1]?.summary ?? '',
    segmentText(assembled, 'worldview'),
    segmentText(assembled, 'characters'),
    segmentText(assembled, 'foreshadows'),
  )
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    const raw = await chat(messages, input.aiConfig, {
      category: 'detail.chapter-planning',
      projectId: input.projectId,
      configOverrides: generationOverrides(input.node, input.inputs),
      contextOverflowPolicy: 'reject',
    }, input.signal)
    const parsed = parseEnhancedDetailResult(raw)
    if (!parsed) throw new Error('细纲候选不是有效的 JSON 对象。')
    variants.push(JSON.stringify(parsed, null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: 'outline.plan',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'detail', outlineNodeId: outlineId, chapterSummary: outline.summary },
  }
}

async function executeProse(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const configuredTitle = configText(input.node, 'chapterTitle')
  const baseRequest = requestFor(input.node, '根据当前章纲生成正文。')
  const request = configuredTitle && !baseRequest.includes(configuredTitle)
    ? `${baseRequest} 目标章节：《${configuredTitle}》`
    : baseRequest
  const supplementalContext = nonControlInput(input.inputs)
  const prepared = await prepareProseCopilot({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    authorRequest: request,
    supplementalContext,
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 64_000)),
    parameterValues: { wordCount: inputControl(input.inputs, 'control.word-count') },
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    variants.push(await prepared.node.run(prepared.prepared.messages))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: 'chapter.prose',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: {
      kind: 'prose',
      operation: prepared.operation,
      outlineNodeId: prepared.outlineNodeId,
      snapshot: prepared.snapshot,
    },
  }
}

/** 领域节点专用执行器；返回 null 时由通用 FLOW-3 执行器处理。 */
export async function executeDomainNode(input: DomainExecutionInput): Promise<DomainExecutionResult | null> {
  switch (input.node.templateId) {
    case 'character.profile': return executeCharacter(input)
    case 'outline.volume':
    case 'outline.chapter': return executeOutline(input)
    case 'outline.plan': return executeDetail(input)
    case 'chapter.prose': return executeProse(input)
    default: return null
  }
}

function emptyAdoptResult(): AdoptResult {
  return { written: [], aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}

/** 领域节点专用采纳器；未命中领域候选时返回 null。 */
export async function adoptDomainCandidate(input: {
  node: AuthoringNodeInstance
  domain: AuthoringCandidateDomain
  output: string
  projectId: number
  worldGroupId: number | null
}): Promise<AdoptResult | null> {
  if (input.domain.kind === 'character') {
    const candidate = parseCharacterCandidateDraft(input.output)
    return adoptCharacterCopilotCandidate({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      snapshot: { serialized: input.domain.rosterSnapshot, visibleNames: [] },
      candidate,
    })
  }
  if (input.domain.kind === 'outline') {
    const result = await adoptRestoredOutlineCandidate({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      mode: input.domain.mode,
      parentVolumeId: input.domain.parentVolumeId,
      snapshot: input.domain.snapshot,
      draft: input.output,
    })
    const written = Array.from({ length: result.writtenCount }, (_, index) => ({
      id: index === 0 ? (result.firstId ?? 0) : 0,
      fields: ['title', 'summary'],
    }))
    return { ...emptyAdoptResult(), written, skipped: result.skippedReasons.map(reason => ({ reason, data: input.output })) }
  }
  if (input.domain.kind === 'detail') {
    const current = await db.outlineNodes.get(input.domain.outlineNodeId)
    if (!current || current.projectId !== input.projectId || current.summary !== input.domain.chapterSummary) {
      throw new Error('目标章纲已变化，请重新运行细纲节点后再采纳。')
    }
    const [characters, foreshadows] = await Promise.all([
      db.characters.where('projectId').equals(input.projectId).toArray(),
      db.foreshadows.where('projectId').equals(input.projectId).toArray(),
    ])
    const visibleCharacters = characters.filter(character => (
      Boolean(character.isCrossWorld) || (character.homeWorldGroupId ?? null) === input.worldGroupId
    ))
    const result = await adoptChapterOutlineWorkshopResult({
      raw: input.output,
      projectId: input.projectId,
      outlineNodeId: input.domain.outlineNodeId,
      chapterSummary: current.summary,
      validCharacterIds: new Set(visibleCharacters.flatMap(row => row.id == null ? [] : [row.id])),
      // 伏笔是项目级共享表，可跨世界引用；埋设/呼应/回收章节仍由其软引用处理。
      validForeshadowIds: new Set(foreshadows.flatMap(row => row.id == null ? [] : [row.id])),
    })
    if (!result.ok) throw new Error(result.reason ?? '细纲候选未能采纳。')
    const saved = await db.detailedOutlines.where('outlineNodeId').equals(input.domain.outlineNodeId).toArray()
    const latest = saved.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    return { ...emptyAdoptResult(), written: [{ id: latest?.id ?? 0, fields: ['scenes', 'openingHook', 'endingCliffhanger'] }] }
  }
  if (input.domain.kind === 'prose') {
    const result = await adoptRestoredProseCandidate({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      operation: input.domain.operation,
      outlineNodeId: input.domain.outlineNodeId,
      snapshot: input.domain.snapshot,
      draft: input.output,
    })
    return { ...emptyAdoptResult(), written: [{ id: result.chapterId, fields: ['content'] }] }
  }
  return null
}
