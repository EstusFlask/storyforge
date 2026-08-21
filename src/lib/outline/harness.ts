import {
  acceptAgentRunContract,
  appendAgentRunEventV1,
  allocateInMemoryAgentRunIdV1,
  createContextManifestFromAssemblyV1,
  createAgentRunV1,
  createGenerationNodeDurableTraceV1,
  createGenerationNodeShadowTraceV1,
  hashCanonicalValue,
  type AgentRunSnapshotV1,
  type GenerationNodeDurableTraceV1,
  type GenerationNodeShadowTraceV1,
} from '../agent/run'
import {
  assertAgentSkillBindingMatchesAssemblyV2,
  createAgentSkillExecutionBindingV2,
} from '../agent/execution-binding'
import {
  getAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
} from '../agent/skill-registry'
import { getOrCreateAgentConversation } from '../agent/conversations'
import type { GenerationNodeShadowTrace } from '../generation/generation-node'
import type { AssembleContextResult } from '../registry/types'
import { resolveScope } from '../world-engine/scope'
import type {
  AgentRunContractV2,
  AgentSkillExecutionBindingV2,
  WorkspaceScope,
} from '../types'
import type { OutlineGenerationRequest } from './generation-request'
import {
  encodeGenerationOperation,
  outlineGenerationModuleKey,
} from './generation-request'
import {
  OUTLINE_GENERATION_CONVERSATION_PURPOSE,
  persistOutlineGenerationCandidateV1,
  type OutlineGenerationBatchRefV1,
  type OutlineGenerationCandidateV1,
} from './candidate-lifecycle'

export * from './candidate-lifecycle'

/** Historical read-only alias. Formal V2 runs resolve the exact runtime set. */
export const OUTLINE_GENERATION_SOURCE_KEYS: readonly string[] = Object.freeze(
  resolveAgentSkillContextSourceKeysV1(
    getAgentSkillV1('outline.compose', 'outline'),
  ),
)

export const OUTLINE_DURABLE_HARNESS_STORAGE_KEY = 'storyforge:harness:outline-durable-v1'

export function isOutlineDurableHarnessEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY) !== 'disabled'
  } catch {
    return true
  }
}

function targetOutlineNodeId(request: OutlineGenerationRequest): number | undefined {
  if (request.kind === 'single-chapter') return request.chapterId
  if (request.kind === 'single-volume' || request.kind === 'chapters') return request.volumeId
  return undefined
}

function writeFields(request: OutlineGenerationRequest): string[] {
  if (request.kind === 'single-chapter' || request.kind === 'single-volume') return ['summary']
  return ['parentId', 'type', 'title', 'summary', 'order']
}

function outlineSkillId(request: OutlineGenerationRequest): 'outline.volumes' | 'outline.chapters' {
  return request.kind === 'volumes' || request.kind === 'single-volume'
    ? 'outline.volumes'
    : 'outline.chapters'
}

export function resolveOutlineGenerationSourceKeysV2(input: {
  request: OutlineGenerationRequest
  hasPriorOutlineCandidate?: boolean
}): string[] {
  const skill = getAgentSkillV1(outlineSkillId(input.request), 'outline')
  return resolveAgentSkillContextSourceKeysV1(skill, {
    includeOptional: input.hasPriorOutlineCandidate === true,
  })
}

export async function resolveOutlineGenerationExecutionBindingV2(input: {
  request: OutlineGenerationRequest
  priorOutlineCandidateText?: string
}): Promise<AgentSkillExecutionBindingV2> {
  const skill = getAgentSkillV1(outlineSkillId(input.request), 'outline')
  const priorText = input.priorOutlineCandidateText?.trim() ?? ''
  return createAgentSkillExecutionBindingV2(skill, {
    optionalContextActivations: priorText ? [{
      sourceKey: 'priorOutlineCandidate',
      reasonCode: 'prior-outline-candidate',
      boundaryHash: await hashCanonicalValue(priorText),
    }] : [],
    writeTargets: [{
      table: 'outlineNodes',
      fields: writeFields(input.request),
      mode: 'candidate-only',
    }],
  })
}

async function outlineRunContract(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  binding?: AgentSkillExecutionBindingV2
}): Promise<AgentRunContractV2> {
  const stepId = encodeGenerationOperation(input.request)
  const outlineNodeId = targetOutlineNodeId(input.request)
  const binding = input.binding ?? await resolveOutlineGenerationExecutionBindingV2(input)
  assertAgentSkillBindingMatchesAssemblyV2(binding, input.assembled, `大纲 ${stepId}`)
  return {
    version: 2,
    objective: `生成${outlineGenerationModuleKey(input.request) === 'outline.volume' ? '卷纲' : '章纲'}候选：${stepId}`,
    workflowKind: 'direct-generation',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: outlineNodeId == null ? undefined : [outlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...binding.contextSourceKeys],
      writeTargets: binding.writeTargets.map(target => ({ ...target, fields: [...target.fields] })),
    },
    executionBindings: [{ stepId, ...binding }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: input.assembled.inputBudget,
      maxOutputTokens: binding.maxOutputTokens,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'outline.output-present', kind: 'output-present', required: true },
    ],
    verificationPlan: [
      {
        id: 'outline.shadow-terminal',
        kind: 'terminal',
        verifier: 'shadow-output-presence-v1',
        criterionIds: ['outline.output-present'],
      },
    ],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
}

async function outlineManifest(input: {
  runId: number
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  binding: AgentSkillExecutionBindingV2
}) {
  const outlineNodeId = targetOutlineNodeId(input.request)
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: encodeGenerationOperation(input.request),
    attempt: 1,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: input.binding.contextSourceKeys,
    assembled: input.assembled,
    boundary: outlineNodeId == null ? undefined : { outlineNodeId },
    readerVersion: 'assemble-context-v1',
  })
}

export async function createOutlineGenerationShadowTraceV1(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  binding?: AgentSkillExecutionBindingV2
}): Promise<GenerationNodeShadowTraceV1> {
  const runId = allocateInMemoryAgentRunIdV1()
  const stepId = encodeGenerationOperation(input.request)
  const binding = input.binding ?? await resolveOutlineGenerationExecutionBindingV2(input)
  const acceptedContract = await acceptAgentRunContract(await outlineRunContract({ ...input, binding }))
  const manifest = await outlineManifest({
    runId,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    request: input.request,
    assembled: input.assembled,
    binding,
  })
  return createGenerationNodeShadowTraceV1({ runId, stepId, acceptedContract, manifest })
}

export interface OutlineGenerationTraceV1 extends GenerationNodeShadowTrace {
  readonly mode: 'durable-shadow' | 'shadow-only'
  readonly shadow: GenerationNodeShadowTraceV1
  readonly durable?: GenerationNodeDurableTraceV1
  readonly initializationError?: string
  readonly traceErrors: readonly string[]
  persistCandidate: (output: string) => Promise<OutlineGenerationCandidateV1 | null>
  terminateRun: (input: { status: 'failed' | 'cancelled'; code: string }) => Promise<void>
}

function composeOutlineTraces(input: {
  shadow: GenerationNodeShadowTraceV1
  durable?: GenerationNodeDurableTraceV1
  scope?: WorkspaceScope
  conversationId?: number
  request: OutlineGenerationRequest
  batch?: OutlineGenerationBatchRefV1
  initializationError?: string
}): OutlineGenerationTraceV1 {
  const diagnostics: string[] = input.initializationError ? [input.initializationError] : []
  const traces: GenerationNodeShadowTrace[] = [input.shadow]
  if (input.durable) traces.push(input.durable)
  let persistedCandidate: OutlineGenerationCandidateV1 | null = null
  let pendingModelOutput: unknown
  const notify = async (action: (trace: GenerationNodeShadowTrace) => Promise<void>) => {
    for (const trace of traces) {
      try {
        await action(trace)
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error))
        try {
          trace.onTraceError?.(error)
        } catch {
          // Trace diagnostics must not replace the generation result.
        }
      }
    }
  }
  return {
    mode: input.durable ? 'durable-shadow' : 'shadow-only',
    shadow: input.shadow,
    durable: input.durable,
    initializationError: input.initializationError,
    get traceErrors() {
      return [...diagnostics]
    },
    beforeModel: value => notify(trace => trace.beforeModel(value)),
    // Durable model.responded is committed together with the candidate body.
    // The in-memory shadow still observes the response immediately.
    modelResponded: value => {
      pendingModelOutput = value
      return notify(trace => trace === input.durable
        ? Promise.resolve()
        : trace.modelResponded(value))
    },
    async candidateReady(output: unknown) {
      if (typeof output !== 'string' || !input.durable || !input.scope || input.conversationId == null) return
      try {
        persistedCandidate = await persistOutlineGenerationCandidateV1({
          scope: input.scope,
          conversationId: input.conversationId,
          request: input.request,
          durable: input.durable,
          output,
          batch: input.batch,
        })
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error))
        try {
          input.durable.onTraceError?.(error)
        } catch {
          // Candidate tracing remains behavior-neutral until the durable path is authoritative.
        }
      }
    },
    // The H0 shadow remains behavior-neutral. Durable outline runs do not
    // succeed until the persisted candidate has been confirmed and adopted.
    stepSucceeded: value => notify(trace => trace === input.shadow
      ? trace.stepSucceeded(value)
      : Promise.resolve()),
    stepFailed: value => notify(async trace => {
      // Successful candidates commit model.responded atomically with the
      // candidate body. A deterministic gate rejection has no candidate, so
      // persist its response hash immediately before the failure evidence.
      if (trace === input.durable && value.phase === 'gate') {
        await trace.modelResponded(pendingModelOutput)
      }
      await trace.stepFailed(value)
    }),
    async persistCandidate(output: string) {
      if (!input.durable || !input.scope || input.conversationId == null || !output.trim()) return null
      if (persistedCandidate?.output === output) return persistedCandidate
      persistedCandidate = await persistOutlineGenerationCandidateV1({
        scope: input.scope,
        conversationId: input.conversationId,
        request: input.request,
        durable: input.durable,
        output,
        batch: input.batch,
      })
      return persistedCandidate
    },
    async terminateRun({ status, code }) {
      if (!input.durable || !input.scope) return
      const projection = input.durable.projection()
      if (['completed', 'failed', 'cancelled', 'recovery_required'].includes(projection.state)) return
      await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.durable.runId,
        type: status === 'cancelled' ? 'run.cancelled' : 'run.failed',
        payload: status === 'cancelled'
          ? { reason: code.trim().slice(0, 200) || 'outline_generation_cancelled' }
          : { code: code.trim().slice(0, 160) || 'outline_generation_failed', retryable: false },
        expectedLastSequence: projection.lastSequence,
      })
    },
    onTraceError(error: unknown) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
    },
  }
}

export async function createOutlineGenerationTraceV1(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  batch?: OutlineGenerationBatchRefV1
  durable?: boolean
}): Promise<OutlineGenerationTraceV1> {
  const binding = await resolveOutlineGenerationExecutionBindingV2(input)
  assertAgentSkillBindingMatchesAssemblyV2(binding, input.assembled, `大纲 ${encodeGenerationOperation(input.request)}`)
  const shadow = await createOutlineGenerationShadowTraceV1({ ...input, binding })
  if ((input.durable ?? isOutlineDurableHarnessEnabledV1()) === false) {
    return composeOutlineTraces({ shadow, request: input.request, batch: input.batch })
  }

  let created: AgentRunSnapshotV1 | null = null
  let scope: WorkspaceScope | null = null
  try {
    scope = await resolveScope({ projectId: input.projectId })
    const conversation = await getOrCreateAgentConversation({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      purpose: OUTLINE_GENERATION_CONVERSATION_PURPOSE,
      title: '大纲生成记录',
      scope,
    })
    if (conversation.id == null) throw new Error('大纲生成对话缺少持久化 ID')
    created = await createAgentRunV1({
      scope,
      worldGroupId: input.worldGroupId,
      conversationId: conversation.id,
      contract: await outlineRunContract({ ...input, binding }),
    })
    const manifest = await outlineManifest({
      runId: created.run.id,
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      request: input.request,
      assembled: input.assembled,
      binding,
    })
    const durable = createGenerationNodeDurableTraceV1({
      scope,
      snapshot: created,
      stepId: encodeGenerationOperation(input.request),
      manifest,
    })
    return composeOutlineTraces({
      shadow,
      durable,
      scope,
      conversationId: conversation.id,
      request: input.request,
      batch: input.batch,
    })
  } catch (error) {
    const initializationError = error instanceof Error ? error.message : String(error)
    if (created && scope) {
      await appendAgentRunEventV1({
        scope,
        runId: created.run.id,
        type: 'run.failed',
        payload: { code: 'trace_initialization_failed', retryable: true },
        expectedLastSequence: created.projection.lastSequence,
      }).catch(() => undefined)
    }
    return composeOutlineTraces({
      shadow,
      request: input.request,
      batch: input.batch,
      initializationError,
    })
  }
}
