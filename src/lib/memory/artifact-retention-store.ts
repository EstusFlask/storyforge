import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  AgentRunArtifactRecordV1,
  ExactRunArtifactIdentityV1,
  ExactRunArtifactKindV1,
  ExactRunArtifactPruneReceiptV1,
  MemoryArtifactRefV1,
} from '../types'
import { planExactArtifactRetentionV1 } from './artifact-retention'
import { canonicalStringify } from '../agent/run/hash'

const HASH = /^[a-f0-9]{64}$/
const KINDS = new Set<ExactRunArtifactKindV1>([
  'context-manifest', 'selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request', 'raw-response',
])

export class AgentRunArtifactRetentionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[agent-run-artifact:${code}] ${message}`)
    this.name = 'AgentRunArtifactRetentionError'
  }
}

function fail(code: string, message: string): never {
  throw new AgentRunArtifactRetentionError(code, message)
}

function identityKey(value: ExactRunArtifactIdentityV1): string {
  return `${value.artifactKind}\u0000${value.contentHash}`
}

async function liveArtifactRefsForProjectInTransactionV1(projectId: number): Promise<{
  refs: MemoryArtifactRefV1[]
  runIdsByIdentity: Map<string, Set<number>>
}> {
  const events = await db.agentRunEvents.where('projectId').equals(projectId).toArray()
  const refs: MemoryArtifactRefV1[] = []
  const runIdsByIdentity = new Map<string, Set<number>>()
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>
    } catch {
      fail('ledger-corrupt', `Run ${event.runId} 的 exact artifact 引用 JSON 已损坏`)
    }
    const artifactKind = payload.artifactKind
    const contentHash = payload.contentHash
    if (typeof artifactKind !== 'string' || !KINDS.has(artifactKind as ExactRunArtifactKindV1)
      || typeof contentHash !== 'string' || !HASH.test(contentHash)) {
      fail('ledger-corrupt', `Run ${event.runId} 的 exact artifact 引用非法`)
    }
    const identity = { artifactKind: artifactKind as ExactRunArtifactKindV1, contentHash }
    const key = identityKey(identity)
    const owners = runIdsByIdentity.get(key) ?? new Set<number>()
    owners.add(event.runId)
    runIdsByIdentity.set(key, owners)
    refs.push({
      artifactId: `exact:${artifactKind}:${contentHash}`,
      sourceKind: 'agent-run-artifact',
      sourceExportId: `run:${event.runId}:artifact:${artifactKind}:${contentHash}`,
      contentHash,
      artifactKind: artifactKind as ExactRunArtifactKindV1,
      authority: 'evidence',
    })
  }
  return { refs, runIdsByIdentity }
}

async function writePruneReceiptsV1(
  projectId: number,
  receipts: readonly ExactRunArtifactPruneReceiptV1[],
): Promise<void> {
  for (const receipt of receipts) {
    const row = await db.agentRunArtifacts
      .where('[projectId+artifactKind+contentHash]')
      .equals([projectId, receipt.artifactKind, receipt.contentHash])
      .first()
    if (!row?.id || row.retentionState === 'evidence-pruned') continue
    await db.agentRunArtifacts.update(row.id, {
      content: null,
      retentionState: 'evidence-pruned',
      pruneReceiptJson: canonicalStringify(receipt),
      pruneReceiptHash: receipt.receiptHash,
      updatedAt: receipt.prunedAt,
    })
  }
}

/** @internal Caller must enlist agentRunArtifacts and agentRunEvents. */
export async function pruneUnreferencedAgentRunArtifactsInCurrentTransactionV1(
  projectId: number,
  now = Date.now(),
): Promise<ExactRunArtifactPruneReceiptV1[]> {
  const artifacts = await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()
  const available = artifacts.filter(row => row.retentionState === 'available')
  const { refs } = await liveArtifactRefsForProjectInTransactionV1(projectId)
  const plan = await Dexie.waitFor(planExactArtifactRetentionV1({
    artifacts: available,
    liveRefs: refs,
    mode: 'mark-and-sweep',
    now,
  }))
  await writePruneReceiptsV1(projectId, plan.prune)
  return plan.prune
}

export async function markAndSweepAgentRunArtifactsV1(
  projectId: number,
  now = Date.now(),
): Promise<ExactRunArtifactPruneReceiptV1[]> {
  return db.transaction('rw', db.agentRunArtifacts, db.agentRunEvents, async () => (
    pruneUnreferencedAgentRunArtifactsInCurrentTransactionV1(projectId, now)
  ))
}

/** Explicit retention is fail-closed while any referencing Run is non-terminal. */
export async function pruneAgentRunArtifactsExplicitlyV1(input: {
  projectId: number
  targets: readonly ExactRunArtifactIdentityV1[]
  now?: number
}): Promise<ExactRunArtifactPruneReceiptV1[]> {
  return db.transaction('rw', db.agentRunArtifacts, db.agentRunEvents, db.agentRuns, async () => {
    const { refs, runIdsByIdentity } = await liveArtifactRefsForProjectInTransactionV1(input.projectId)
    const referencedRunIds = [...new Set(input.targets.flatMap(target => (
      [...(runIdsByIdentity.get(identityKey(target)) ?? [])]
    )))]
    const runs = referencedRunIds.length ? await db.agentRuns.bulkGet(referencedRunIds) : []
    const terminal = new Set(['completed', 'failed', 'cancelled'])
    if (runs.some(run => run != null && !terminal.has(run.status))) {
      fail('live-run', '仍被未终结 Run 引用的 exact artifact 不得显式裁剪')
    }
    const rows = await db.agentRunArtifacts.where('projectId').equals(input.projectId).toArray()
    const available = rows.filter((row): row is AgentRunArtifactRecordV1 & { content: string } => (
      row.retentionState === 'available' && row.content != null
    ))
    const plan = await Dexie.waitFor(planExactArtifactRetentionV1({
      artifacts: available,
      liveRefs: refs,
      mode: 'explicit-retention-prune',
      explicitTargets: input.targets,
      now: input.now ?? Date.now(),
    }))
    await writePruneReceiptsV1(input.projectId, plan.prune)
    return plan.prune
  })
}
