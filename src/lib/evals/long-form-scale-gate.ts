import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { hashCanonicalValue } from '../agent/run/hash'

export const LONG_FORM_SCALE_GATE_VERSION_V1 = 'long-form-scale-gate-v1'
export const LONG_FORM_SCALE_TIERS_V1 = [100_000, 300_000, 1_000_000] as const

export type LongFormScaleTierV1 = typeof LONG_FORM_SCALE_TIERS_V1[number]

export interface LongFormScaleEvidenceObligationV1 {
  id: string
  table: string
  recordId: number
  field?: string
  /** Exact marker held by the host-side gate. It is never sent to a model. */
  expectedText: string
}

export interface LongFormScaleGateInputV1 {
  fixtureId: string
  fixtureSetHash: string
  tierCharacters: LongFormScaleTierV1
  manuscriptCharacters: number
  chapterCount: number
  assemblyDurationMs: number
  execution: ContextGatewayExecutionV1
  requiredEvidence: readonly LongFormScaleEvidenceObligationV1[]
  forbiddenText: readonly string[]
  limits?: {
    maxAssemblyDurationMs?: number
    maxPacketTokens?: number
  }
}

export interface LongFormScaleGateCheckV1 {
  id: string
  passed: boolean
  detail: string
}

export interface LongFormScaleGateArtifactV1 {
  version: 1
  artifactType: 'storyforge-long-form-scale-gate'
  gateVersion: typeof LONG_FORM_SCALE_GATE_VERSION_V1
  fixtureId: string
  fixtureSetHash: string
  tierCharacters: LongFormScaleTierV1
  status: 'pass' | 'fail'
  measurements: {
    manuscriptCharacters: number
    chapterCount: number
    assemblyDurationMs: number
    packetTokens: number
    selectedResources: number
    omittedResources: number
    sourceRefs: number
    additionalPlanningModelCalls: number
    additionalToolCalls: number
    executionPath: ContextGatewayExecutionV1['path']
    contextPacketHash: string
    selectorHash: string
  }
  checks: LongFormScaleGateCheckV1[]
  artifactHash: string
}

function assertInput(input: LongFormScaleGateInputV1): void {
  if (!input.fixtureId.trim() || !/^[a-f0-9]{64}$/.test(input.fixtureSetHash)) {
    throw new Error('长篇规模门 fixture 身份不合法。')
  }
  if (!LONG_FORM_SCALE_TIERS_V1.includes(input.tierCharacters)) {
    throw new Error('长篇规模门只接受冻结的 10万/30万/100万字符档位。')
  }
  if (!Number.isSafeInteger(input.manuscriptCharacters) || input.manuscriptCharacters < 0
    || !Number.isSafeInteger(input.chapterCount) || input.chapterCount < 1
    || !Number.isFinite(input.assemblyDurationMs) || input.assemblyDurationMs < 0) {
    throw new Error('长篇规模门测量值不合法。')
  }
  if (!input.requiredEvidence.length
    || new Set(input.requiredEvidence.map(item => item.id)).size !== input.requiredEvidence.length
    || input.requiredEvidence.some(item => (
      !item.id.trim() || !item.table.trim() || !Number.isSafeInteger(item.recordId)
      || item.recordId < 1 || !item.expectedText
    ))) {
    throw new Error('长篇规模门必须声明互异且可回链的证据义务。')
  }
  if (input.forbiddenText.some(item => !item)) throw new Error('禁止泄漏标记不能为空。')
}

function passed(id: string, detail: string): LongFormScaleGateCheckV1 {
  return { id, passed: true, detail }
}

function checked(id: string, condition: boolean, detail: string): LongFormScaleGateCheckV1 {
  return { id, passed: condition, detail }
}

function refMatches(
  ref: ContextGatewayExecutionV1['contextPacket']['sourceRefs'][number],
  obligation: LongFormScaleEvidenceObligationV1,
): boolean {
  return ref.table === obligation.table
    && ref.recordId === obligation.recordId
    && (obligation.field == null || ref.field === obligation.field)
}

/**
 * Host-side engineering gate for the iterative long-form architecture.
 *
 * It deliberately does not grade literary quality and does not expose the
 * expected markers to a generator. The gate proves that a bounded Context
 * Packet can still carry exact, current, scope-correct evidence while the
 * manuscript grows far beyond a single model window.
 */
export async function buildLongFormScaleGateArtifactV1(
  input: LongFormScaleGateInputV1,
): Promise<LongFormScaleGateArtifactV1> {
  assertInput(input)
  const packet = input.execution.contextPacket
  const refs = packet.sourceRefs
  const maxPacketTokens = input.limits?.maxPacketTokens ?? 64_000
  const maxAssemblyDurationMs = input.limits?.maxAssemblyDurationMs ?? 30_000
  const checks: LongFormScaleGateCheckV1[] = [
    checked(
      'manuscript-scale',
      input.manuscriptCharacters >= input.tierCharacters,
      `${input.manuscriptCharacters}/${input.tierCharacters} 字符`,
    ),
    checked(
      'bounded-context-packet',
      packet.tokenCount <= maxPacketTokens,
      `${packet.tokenCount}/${maxPacketTokens} tokens`,
    ),
    checked(
      'bounded-assembly-duration',
      input.assemblyDurationMs <= maxAssemblyDurationMs,
      `${input.assemblyDurationMs.toFixed(1)}/${maxAssemblyDurationMs} ms`,
    ),
    checked(
      'zero-retrieval-model-calls',
      input.execution.metrics.additionalPlanningModelCalls === 0,
      `${input.execution.metrics.additionalPlanningModelCalls} planning calls`,
    ),
    checked(
      'zero-retrieval-tool-roundtrips',
      input.execution.metrics.additionalToolCalls === 0,
      `${input.execution.metrics.additionalToolCalls} additional tool calls`,
    ),
  ]

  for (const obligation of input.requiredEvidence) {
    const hasRef = refs.some(ref => refMatches(ref, obligation))
    const hasText = packet.content.includes(obligation.expectedText)
    checks.push(checked(
      `evidence:${obligation.id}`,
      hasRef && hasText,
      `ref=${hasRef ? 'yes' : 'no'}, text=${hasText ? 'yes' : 'no'}`,
    ))
  }
  for (const [index, marker] of input.forbiddenText.entries()) {
    checks.push(checked(
      `isolation:${index + 1}`,
      !packet.content.includes(marker),
      packet.content.includes(marker) ? 'forbidden marker leaked' : 'not present',
    ))
  }
  if (!input.forbiddenText.length) checks.push(passed('isolation:not-applicable', 'no forbidden marker'))

  const unsigned = {
    version: 1 as const,
    artifactType: 'storyforge-long-form-scale-gate' as const,
    gateVersion: LONG_FORM_SCALE_GATE_VERSION_V1 as typeof LONG_FORM_SCALE_GATE_VERSION_V1,
    fixtureId: input.fixtureId,
    fixtureSetHash: input.fixtureSetHash,
    tierCharacters: input.tierCharacters,
    status: checks.every(item => item.passed) ? 'pass' as const : 'fail' as const,
    measurements: {
      manuscriptCharacters: input.manuscriptCharacters,
      chapterCount: input.chapterCount,
      assemblyDurationMs: input.assemblyDurationMs,
      packetTokens: packet.tokenCount,
      selectedResources: input.execution.selector.selected.length,
      omittedResources: input.execution.selector.omitted.length,
      sourceRefs: refs.length,
      additionalPlanningModelCalls: input.execution.metrics.additionalPlanningModelCalls,
      additionalToolCalls: input.execution.metrics.additionalToolCalls,
      executionPath: input.execution.path,
      contextPacketHash: packet.contentHash,
      selectorHash: input.execution.selector.selectorHash,
    },
    checks,
  }
  return { ...unsigned, artifactHash: await hashCanonicalValue(unsigned) }
}

export async function verifyLongFormScaleGateArtifactV1(
  artifact: LongFormScaleGateArtifactV1,
): Promise<boolean> {
  const { artifactHash, ...unsigned } = artifact
  return artifact.gateVersion === LONG_FORM_SCALE_GATE_VERSION_V1
    && LONG_FORM_SCALE_TIERS_V1.includes(artifact.tierCharacters)
    && artifact.status === (artifact.checks.every(item => item.passed) ? 'pass' : 'fail')
    && artifactHash === await hashCanonicalValue(unsigned)
}
