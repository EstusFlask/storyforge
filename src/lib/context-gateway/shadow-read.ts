import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { assembleContext } from '../registry/assemble-context'
import type { ContextSufficiencyReportV1 } from '../registry/types'
import type { WorkspaceScope } from '../types'
import { executeContextGatewayV1 } from './execution'
import { contextGatewayCacheEpochV1 } from './provider-cache'

export interface ContextGatewayShadowReadReportV1 {
  version: 'context-gateway-shadow-read-v1'
  skillId: string
  scope: {
    projectId: number
    worldId: number
    workId: number
    worldGroupId: number | null
  }
  legacy: {
    includedSourceKeys: string[]
    omittedSourceKeys: string[]
    trimmedSourceKeys: string[]
    inputTokens: number
    contentHash: string
    sourceEvidence: Array<{
      sourceKey: string
      status: 'included' | 'omitted' | 'trimmed'
      delivery: 'full' | 'compressed' | 'truncated' | 'none'
      sourceHash: string | null
      originalTokens: number
      inputTokens: number
    }>
  }
  gateway: {
    path: 'deterministic-fast' | 'deterministic-fallback'
    selectedResourceKeys: string[]
    omittedResourceKeys: string[]
    canonTables: string[]
    sourceRefCount: number
    inputTokens: number
    packetHash: string
    traceHash: string
    sufficiency: ContextSufficiencyReportV1
    catalogPages: number
    catalogResources: number
    resourceReads: number
    planningModelCalls: 0
    toolCalls: 0
  }
  comparison: {
    status: 'comparable' | 'attention-required'
    reasonCodes: string[]
  }
  reportHash: string
}

export class ContextGatewayShadowReadErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[context-gateway-shadow:${code}] ${message}`)
    this.name = 'ContextGatewayShadowReadErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new ContextGatewayShadowReadErrorV1(code, message)
}

/**
 * Runs old and new read paths for observation only. It accepts no model and
 * persists no report, candidate, Run event or artifact.
 */
export async function compareContextGatewayShadowReadV1(input: {
  skill: AgentSkillDefinitionV1
  scope: WorkspaceScope
  worldGroupId?: number | null
  query?: string
  budgetTokens?: number
}): Promise<ContextGatewayShadowReadReportV1> {
  if (input.skill.contextGateway?.rollout !== 'shadow') {
    fail('rollout', `Skill ${input.skill.id} 未处于 shadow，拒绝运行观察性双读`)
  }
  const startedEpoch = contextGatewayCacheEpochV1()
  const worldGroupId = input.worldGroupId ?? null
  const budgetTokens = Math.min(
    input.budgetTokens ?? input.skill.contextGateway.maxRetrievedTokens,
    input.skill.contextGateway.maxRetrievedTokens,
  )
  const legacy = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId,
    sourceKeys: [...input.skill.contextSourceKeys],
    inputBudgetTokens: budgetTokens,
  })
  const gateway = await executeContextGatewayV1({
    skill: input.skill,
    scope: input.scope,
    worldGroupId,
    query: input.query,
    budgetTokens,
    additionalReadsEnabled: false,
  })
  if (startedEpoch !== contextGatewayCacheEpochV1()) {
    fail('source-mutated', 'shadow compare 期间项目数据发生变化，结果已作废')
  }
  if (gateway.metrics.additionalPlanningModelCalls !== 0 || gateway.metrics.additionalToolCalls !== 0) {
    fail('hidden-execution', 'shadow compare 禁止追加模型或 Agent tool 调用')
  }
  const sourceRefs = [...gateway.contextPacket.sourceRefs]
  const reasonCodes = [
    'shadow-read-only',
    ...(legacy.trimmed.length ? ['legacy-source-trimmed'] : []),
    ...(gateway.path === 'deterministic-fallback' ? ['gateway-soft-deficit-no-agent-read'] : []),
    ...(legacy.text.trim() && !gateway.contextPacket.content.trim() ? ['gateway-empty-against-legacy'] : []),
    ...gateway.sufficiency.assumptions.map(assumption => `gateway-assumption:${assumption}`),
  ]
  const body = {
    version: 'context-gateway-shadow-read-v1' as const,
    skillId: input.skill.id,
    scope: {
      projectId: input.scope.projectId,
      worldId: input.scope.worldId,
      workId: input.scope.workId,
      worldGroupId,
    },
    legacy: {
      includedSourceKeys: [...legacy.included].sort(),
      omittedSourceKeys: [...legacy.omitted].sort(),
      trimmedSourceKeys: [...legacy.trimmed].sort(),
      inputTokens: legacy.totalInputTokens,
      contentHash: await sha256Text(legacy.text),
      sourceEvidence: [...(legacy.sourceEvidence ?? [])].map(item => ({
        sourceKey: item.key,
        status: item.status,
        delivery: item.delivery,
        sourceHash: item.sourceHash ?? null,
        originalTokens: item.originalTokens,
        inputTokens: item.inputTokens,
      })).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
    },
    gateway: {
      path: gateway.path === 'deterministic-fast' ? gateway.path : 'deterministic-fallback' as const,
      selectedResourceKeys: gateway.selector.selected.map(item => item.resourceKey).sort(),
      omittedResourceKeys: gateway.selector.omitted.map(item => item.resourceKey).sort(),
      canonTables: [...new Set(sourceRefs.map(ref => ref.table))].sort(),
      sourceRefCount: sourceRefs.length,
      inputTokens: gateway.contextPacket.tokenCount,
      packetHash: gateway.contextPacket.packetHash,
      traceHash: gateway.retrievalTrace.traceHash,
      sufficiency: gateway.sufficiency,
      catalogPages: gateway.metrics.catalogPages,
      catalogResources: gateway.metrics.catalogResources,
      resourceReads: gateway.metrics.deterministicResourceReads,
      planningModelCalls: 0 as const,
      toolCalls: 0 as const,
    },
    comparison: {
      status: reasonCodes.some(code => code !== 'shadow-read-only')
        ? 'attention-required' as const
        : 'comparable' as const,
      reasonCodes,
    },
  }
  return { ...body, reportHash: await hashCanonicalValue(body) }
}
