import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { hashGameProductionValueV2 } from '../game-production/hash'
import { assembleContext } from '../registry/assemble-context'
import type {
  AIConfig,
  ChatMessage,
  SimulationTtrpgModelEvidenceV1,
  TtrpgCharacterSheetDraftV2,
  TtrpgCharacterSheetV2,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../world-engine/scope'
import { adoptTtrpgCharacterSheetCandidateV2 } from './authoring'
import { parseTtrpgCampaignContentV1 } from './campaign'
import { createCompleteTtrpgCharacterSheetV2 } from './character-sheet'
import { parseRulePackV1 } from './rule-pack'

export const TTRPG_CHARACTER_SHEET_STEP_ID_V2 = 'ttrpg:character-sheet-candidate' as const
export const TTRPG_CHARACTER_SHEET_VERIFIER_V2 = 'ttrpg-character-sheet-author-confirmed-v2' as const

export interface TtrpgCharacterSheetCandidateV2 {
  schema: 'storyforge.ttrpg-character-sheet-candidate'
  version: 2
  portable: false
  runId: number
  campaignModuleId: number
  campaignContentHash: string
  rulePackContentHash: string
  characterKey: string
  lockedFields: string[]
  contextManifestHash: string
  draft: TtrpgCharacterSheetDraftV2
  modelEvidence: SimulationTtrpgModelEvidenceV1
  modelCalls: SimulationTtrpgModelEvidenceV1[]
  repairApplied: boolean
  candidateHash: string
}

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

const IDENTITY_FIELDS = [
  'name', 'pronouns', 'gender', 'age', 'ancestry', 'occupation', 'appearance', 'origin', 'background',
  'personalityTraits', 'beliefs', 'flaws', 'fears', 'desires', 'boundaries', 'shortTermGoal', 'longTermGoal',
  'publicKnowledge', 'privateKnowledge', 'safetyNotes', 'portrayal', 'voice', 'sampleLines',
] as const satisfies ReadonlyArray<keyof TtrpgCharacterSheetDraftV2['identity']>

function fail(message: string): never { throw new Error(`[ttrpg-character-sheet-harness] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail(`${label} 字段不在允许闭集`)
  }
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  try { return record(JSON.parse(source), '模型输出') }
  catch (error) { if (error instanceof SyntaxError) fail('模型输出不是有效 JSON'); throw error }
}

async function loadTarget(input: { scope: WorkspaceScope; campaignModuleId: number; characterKey: string }) {
  const campaignRow = await db.ttrpgCampaignModules.get(input.campaignModuleId)
  if (!campaignRow || !await assertRecordInScope(input.scope, 'ttrpgCampaignModules', campaignRow, { owner: 'work' })) {
    fail('CampaignPack 不存在或跨 Work')
  }
  const ruleRow = await db.gameRulePacks.get(campaignRow.rulePackId)
  if (!ruleRow || !await assertRecordInScope(input.scope, 'gameRulePacks', ruleRow, { owner: 'work' })) fail('RulePack 不存在或跨 Work')
  const rulePack = parseRulePackV1(ruleRow.rulePackJson)
  if (await hashGameProductionValueV2(rulePack) !== ruleRow.contentHash) fail('RulePack hash 校验失败')
  const campaign = parseTtrpgCampaignContentV1(campaignRow.contentJson, rulePack)
  if (await hashGameProductionValueV2(campaign) !== campaignRow.contentHash) fail('CampaignPack hash 校验失败')
  const template = campaign.characterTemplates.find(item => item.characterKey === input.characterKey && item.role === 'player')
    ?? fail('目标不是当前 CampaignPack 的玩家角色')
  return { campaignRow, ruleRow, rulePack, campaign, template }
}

function currentCompleteSheet(target: Awaited<ReturnType<typeof loadTarget>>): TtrpgCharacterSheetV2 {
  if (target.template.characterSheet) return target.template.characterSheet
  const { characterSheet: _sheet, ...template } = target.template
  return createCompleteTtrpgCharacterSheetV2({ template, rulePack: target.rulePack })
}

function messages(input: {
  objective: string
  context: string
  lockedFields: string[]
  attributeBudget: number
}): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 的 TTRPG 完整车卡设计器。只生成一个玩家角色卡候选，作者确认前不能写入战役。',
      '只能使用给定世界/战役公开设定和角色来源；上下文不含 GM 场景秘密，不得猜测未提供的秘密。',
      `attributes 必须精确覆盖 RulePack 属性，全部为整数、在上下限内且总点数必须等于 ${input.attributeBudget}。`,
      `以下字段已锁定，必须逐字逐值保持当前卡：${input.lockedFields.join('、') || '无'}。`,
      'publicKnowledge 是其他玩家可见内容；privateKnowledge 只供本角色和 KP；两者不能出现同一条文本。',
      '只输出严格 JSON；顶层只能有 identity、attributes。identity 必须精确包含以下字段：',
      IDENTITY_FIELDS.join(', '),
      'personalityTraits/beliefs/flaws/fears/desires/boundaries/publicKnowledge/privateKnowledge/safetyNotes/sampleLines 必须是字符串数组，其余 identity 字段必须是非空字符串。',
    ].join('\n'),
  }, {
    role: 'user',
    content: `【车卡目标】${input.objective}\n\n【冻结安全制作上下文】\n${input.context}`,
  }]
}

function parseDraft(
  output: string,
  target: Awaited<ReturnType<typeof loadTarget>>,
  lockedFields: string[],
): TtrpgCharacterSheetDraftV2 {
  const root = parseJson(output)
  exact(root, ['identity', 'attributes'], 'AI 车卡候选')
  const identity = record(root.identity, 'identity')
  exact(identity, IDENTITY_FIELDS, 'identity')
  const attributesRow = record(root.attributes, 'attributes')
  const attributes = Object.fromEntries(target.rulePack.attributes.map(attribute => {
    const value = attributesRow[attribute.key]
    if (!Number.isInteger(value) || Number(value) < attribute.minimum || Number(value) > attribute.maximum) {
      fail(`属性越界:${attribute.key}`)
    }
    return [attribute.key, Number(value)]
  }))
  if (Object.keys(attributesRow).length !== target.rulePack.attributes.length) fail('attributes 必须精确覆盖 RulePack')
  const budget = target.rulePack.attributes.reduce((sum, attribute) => sum + target.template.attributes[attribute.key], 0)
  if (Object.values(attributes).reduce((sum, value) => sum + value, 0) !== budget) fail(`属性预算必须保持 ${budget} 点`)
  const draft = {
    characterKey: target.template.characterKey,
    identity: structuredClone(identity) as unknown as TtrpgCharacterSheetDraftV2['identity'],
    attributes,
  }
  const { characterSheet: _sheet, ...withoutSheet } = target.template
  const proposedTemplate = {
    ...withoutSheet,
    name: String(draft.identity.name),
    description: String(draft.identity.background),
    attributes,
  }
  const current = currentCompleteSheet(target)
  const parsed = createCompleteTtrpgCharacterSheetV2({
    template: proposedTemplate,
    rulePack: target.rulePack,
    authoringMode: 'ai',
    identity: {
      ...draft.identity,
      relationships: current.identity.relationships,
      worldBindings: current.identity.worldBindings,
    },
  })
  draft.identity = Object.fromEntries(IDENTITY_FIELDS.map(field => [field, parsed.identity[field]])) as unknown as TtrpgCharacterSheetDraftV2['identity']
  const stable = (value: unknown) => JSON.stringify(value)
  for (const locked of lockedFields) {
    const [kind, key] = locked.split('.', 2)
    const before = kind === 'identity'
      ? current.identity[key as keyof typeof current.identity] : target.template.attributes[key]
    const after = kind === 'identity'
      ? draft.identity[key as keyof typeof draft.identity] : draft.attributes[key]
    if (stable(before) !== stable(after)) fail(`模型改写锁定字段:${locked}`)
  }
  return draft
}

function evidence(calls: SimulationTtrpgModelEvidenceV1[]): SimulationTtrpgModelEvidenceV1 {
  const first = calls[0] ?? fail('缺少模型调用证据')
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0)
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0)
  const costs = calls.map(call => call.estimatedCostUsd)
  return {
    provider: first.provider, model: first.model,
    usageSource: calls.every(call => call.usageSource === 'provider') ? 'provider' : 'estimated',
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    estimatedCostUsd: costs.every((cost): cost is number => cost != null) ? costs.reduce((sum, cost) => sum + cost, 0) : null,
  }
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

export async function generateTtrpgCharacterSheetCandidateV2(input: {
  scope: WorkspaceScope
  campaignModuleId: number
  characterKey: string
  objective: string
  lockedFields?: string[]
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: TtrpgCharacterSheetCandidateV2 }> {
  const objective = input.objective.trim()
  const characterKey = input.characterKey.trim()
  const lockedFields = [...new Set(input.lockedFields ?? [])].sort()
  if (!objective || objective.length > 4_000 || !characterKey) fail('车卡目标或角色 key 无效')
  if (!input.aiConfig && !input.runAI) fail('缺少 AI 配置')
  const target = await loadTarget({ scope: input.scope, campaignModuleId: input.campaignModuleId, characterKey })
  const knownLocks = new Set([
    ...IDENTITY_FIELDS.map(field => `identity.${field}`),
    ...target.rulePack.attributes.map(attribute => `attribute.${attribute.key}`),
  ])
  if (lockedFields.some(field => !knownLocks.has(field))) fail('包含未知锁定字段')
  const skill = getAgentSkillV1('prose.ttrpg-character-sheet-candidate')
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, {
    category: 'authoring.ttrpg-character', projectId: input.scope.projectId, contextOverflowPolicy: 'reject',
  }) : null
  const modelIdentity = input.runAI
    ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved?.config.provider ?? fail('缺少 provider'), model: resolved?.config.model ?? fail('缺少 model') }
  const runtimeBindingHash = await hashCanonicalValue({
    campaignContentHash: target.campaignRow.contentHash, rulePackContentHash: target.ruleRow.contentHash,
    characterKey, lockedFields, executionBinding: createAgentSkillExecutionBindingV1(skill), modelIdentity,
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: null,
    contract: {
      version: 1, objective, workflowKind: 'direct-generation',
      scope: { projectId: input.scope.projectId, worldGroupId: null },
      permissions: { contextSourceKeys: ['ttrpg.character-authoring'], writeTargets: [] },
      runtimeBindingHash,
      executionBindings: [{ stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, ...createAgentSkillExecutionBindingV1(skill) }],
      budget: { maxModelCalls: 2, maxToolCalls: 0, maxInputTokens: 32_000, maxOutputTokens: 8_000, maxAttemptsPerStep: 2 },
      acceptance: [
        { id: 'character.valid', kind: 'deterministic-check', required: true },
        { id: 'character.author-confirmed', kind: 'author-confirmed', required: true },
        { id: 'character.cas-adopted', kind: 'post-state-matches', required: true },
      ],
      verificationPlan: [{ id: 'character.terminal', kind: 'terminal', verifier: TTRPG_CHARACTER_SHEET_VERIFIER_V2, criterionIds: ['character.valid', 'character.author-confirmed', 'character.cas-adopted'] }],
      failurePolicy: { onProtocolError: 'retry', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    },
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: 1 })
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId, scope: input.scope,
      ttrpgCampaignModuleId: input.campaignModuleId, ttrpgCharacterKey: characterKey,
      sourceKeys: ['ttrpg.character-authoring'], provider: input.aiConfig?.provider, model: input.aiConfig?.model,
      inputBudgetMaxTokens: 16_000,
    })
    if (!assembled.included.includes('ttrpg.character-authoring')) fail('单角色安全车卡上下文为空')
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: null,
      declaredSourceKeys: ['ttrpg.character-authoring'], assembled,
      readerVersion: 'ttrpg-character-authoring-context-v2',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: 1, manifestHash: manifest.manifestHash,
    })
    const prompt = messages({
      objective, context: assembled.text, lockedFields,
      attributeBudget: target.rulePack.attributes.reduce((sum, attribute) => sum + target.template.attributes[attribute.key], 0),
    })
    const call = async (callMessages: ChatMessage[], attempt: 1 | 2) => {
      snapshot = await append(input.scope, snapshot, 'model.requested', {
        stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt,
        bindingHash: await hashCanonicalValue({ runtimeBindingHash, manifestHash: manifest.manifestHash, messages: callMessages }),
      })
      const result: ChatResult = {}
      const startedAt = Date.now()
      const output = input.runAI ? await input.runAI(callMessages, input.signal) : await chat(
        callMessages, input.aiConfig!, {
          category: 'authoring.ttrpg-character', projectId: input.scope.projectId, contextOverflowPolicy: 'reject',
        }, input.signal, result, undefined, resolved!,
      )
      const inputTokens = result.usage?.inputTokens ?? callMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
      const outputTokens = result.usage?.outputTokens ?? estimateTokens(output)
      const modelEvidence: SimulationTtrpgModelEvidenceV1 = {
        provider: modelIdentity.provider, model: modelIdentity.model,
        usageSource: result.usage ? 'provider' : 'estimated', inputTokens, outputTokens,
        totalTokens: inputTokens + outputTokens, latencyMs: Math.max(0, Date.now() - startedAt),
        estimatedCostUsd: computeKnownCostUsd(modelIdentity.model, inputTokens, outputTokens),
      }
      snapshot = await append(input.scope, snapshot, 'model.responded', {
        stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt, outputHash: await hashCanonicalValue(output),
      })
      return { output, modelEvidence }
    }
    const first = await call(prompt, 1)
    const calls = [first.modelEvidence]
    let draft: TtrpgCharacterSheetDraftV2
    let repairApplied = false
    try { draft = parseDraft(first.output, target, lockedFields) }
    catch (error) {
      const issue = error instanceof Error ? error.message : String(error)
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: 1,
        code: 'ttrpg-character-protocol', retryable: true, category: 'protocol', action: 'retry',
      })
      snapshot = await append(input.scope, snapshot, 'step.started', { stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: 2 })
      const second = await call([...prompt, { role: 'assistant', content: first.output.slice(0, 20_000) }, {
        role: 'user', content: `上次输出未通过：${issue.slice(0, 1_000)}。只修复协议、预算和锁定字段，输出完整严格 JSON。`,
      }], 2)
      calls.push(second.modelEvidence)
      draft = parseDraft(second.output, target, lockedFields)
      repairApplied = true
    }
    const currentAfterModel = await loadTarget({ scope: input.scope, campaignModuleId: input.campaignModuleId, characterKey })
    if (currentAfterModel.campaignRow.contentHash !== target.campaignRow.contentHash) fail('模型生成期间 CampaignPack 已变化')
    const body = {
      schema: 'storyforge.ttrpg-character-sheet-candidate' as const, version: 2 as const, portable: false as const,
      runId: snapshot.run.id, campaignModuleId: input.campaignModuleId,
      campaignContentHash: target.campaignRow.contentHash, rulePackContentHash: target.ruleRow.contentHash,
      characterKey, lockedFields, contextManifestHash: manifest.manifestHash, draft,
      modelEvidence: evidence(calls), modelCalls: calls, repairApplied,
    }
    const candidate: TtrpgCharacterSheetCandidateV2 = { ...body, candidateHash: await hashCanonicalValue(body) }
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, attempt: repairApplied ? 2 : 1,
      candidateHash: candidate.candidateHash, requiresConfirmation: true,
    })
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope, runId: snapshot.run.id, resumePayload: candidate,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    try {
      const current = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
      if (!current && snapshot.projection.steps[TTRPG_CHARACTER_SHEET_STEP_ID_V2]?.status === 'running') {
        snapshot = await append(input.scope, snapshot, 'step.failed', {
          stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2,
          attempt: snapshot.projection.steps[TTRPG_CHARACTER_SHEET_STEP_ID_V2]?.attempt ?? 1,
          code: 'ttrpg-character-generation-failed', retryable: false, category: 'protocol', action: 'fail',
        })
        await append(input.scope, snapshot, 'run.failed', { code: 'ttrpg-character-generation-failed', retryable: false })
      }
    } catch { /* keep the original generation failure */ }
    throw error
  }
}

function candidateBody(candidate: TtrpgCharacterSheetCandidateV2) {
  const { candidateHash: _hash, ...body } = candidate
  return body
}
function isCandidate(value: unknown): value is TtrpgCharacterSheetCandidateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<TtrpgCharacterSheetCandidateV2>
  return row.schema === 'storyforge.ttrpg-character-sheet-candidate' && row.version === 2 && row.portable === false
    && Number.isInteger(row.runId) && Number.isInteger(row.campaignModuleId)
    && typeof row.characterKey === 'string' && typeof row.candidateHash === 'string'
}

export async function adoptTtrpgCharacterSheetCandidateFromRunV2(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: TtrpgCharacterSheetCandidateV2; contentHash: string }> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'work' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复的完整车卡候选')
  const candidate = saved.resumePayload
  if (candidate.runId !== input.runId || await hashCanonicalValue(candidateBody(candidate)) !== candidate.candidateHash) fail('候选哈希不匹配')
  let snapshot = saved.snapshot
  const step = snapshot.projection.steps[TTRPG_CHARACTER_SHEET_STEP_ID_V2]
  if (step?.status === 'awaiting_confirmation') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, candidateHash: candidate.candidateHash, decision: 'adopt',
    })
  } else if (step?.confirmation !== 'adopt') fail('车卡候选当前不等待作者确认')
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, candidateHash: candidate.candidateHash,
  })
  let updated: Awaited<ReturnType<typeof adoptTtrpgCharacterSheetCandidateV2>>
  try {
    updated = await adoptTtrpgCharacterSheetCandidateV2({
      scope: input.scope, campaignModuleId: candidate.campaignModuleId,
      expectedContentHash: candidate.campaignContentHash, candidateHash: candidate.candidateHash,
      runId: candidate.runId, lockedFields: candidate.lockedFields, draft: candidate.draft,
    })
  } catch (error) {
    await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, candidateHash: candidate.candidateHash, code: 'campaign-cas-stale',
    })
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2,
    candidateHash: candidate.candidateHash, adoptionHash: updated.contentHash,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2,
    attempt: snapshot.projection.steps[TTRPG_CHARACTER_SHEET_STEP_ID_V2]?.attempt ?? 1,
    outputHash: updated.contentHash,
  })
  snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: TTRPG_CHARACTER_SHEET_VERIFIER_V2 })
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: input.runId, generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: updated.contentHash,
    verifierSetVersion: TTRPG_CHARACTER_SHEET_VERIFIER_V2,
    criteria: [
      { id: 'character.valid', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'character.author-confirmed', status: 'passed', evidenceRefs: [`run:${input.runId}:confirmation`] },
      { id: 'character.cas-adopted', status: 'passed', evidenceRefs: [`campaign:${candidate.campaignModuleId}:${updated.contentHash}`] },
    ], acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, candidate, contentHash: updated.contentHash }
}

export async function rejectTtrpgCharacterSheetCandidateV2(input: {
  scope: WorkspaceScope
  runId: number
  note?: string
}): Promise<AgentRunSnapshotV1> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId, { owner: 'work' })
  if (!saved || !isCandidate(saved.resumePayload)) fail('运行缺少可恢复的完整车卡候选')
  const step = saved.snapshot.projection.steps[TTRPG_CHARACTER_SHEET_STEP_ID_V2]
  if (step?.status !== 'awaiting_confirmation') fail('车卡候选当前不等待作者确认')
  return append(input.scope, saved.snapshot, 'confirmation.recorded', {
    stepId: TTRPG_CHARACTER_SHEET_STEP_ID_V2, candidateHash: saved.resumePayload.candidateHash,
    decision: 'reject',
  })
}
