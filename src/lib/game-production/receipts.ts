import type { GameBuildArtifactRecordV1 } from '../types'
import { hashGameProductionValueV2, isSha256Hash } from './hash'

export interface GameBuildRootTerminalReceiptInputV1 {
  planHash: string
  manifestHash: string
  packageHash: string
  qualityReportHash: string
  controlEpoch: number
  budgetLedgerJson: string
  artifacts: Array<Pick<GameBuildArtifactRecordV1,
    'artifactKey' | 'version' | 'contentHash' | 'producerReceiptHash'>>
}

export async function createGameBuildRootTerminalReceiptV1(
  input: GameBuildRootTerminalReceiptInputV1,
): Promise<string> {
  if (![input.planHash, input.manifestHash, input.packageHash, input.qualityReportHash].every(isSha256Hash)
    || !Number.isInteger(input.controlEpoch) || input.controlEpoch < 0) {
    throw new Error('[game-production-receipt] Build terminal 指针无效')
  }
  let budgetLedger: unknown
  try { budgetLedger = JSON.parse(input.budgetLedgerJson) } catch {
    throw new Error('[game-production-receipt] budget ledger 不是合法 JSON')
  }
  const artifactReceipts = [...input.artifacts]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
    .map(row => ({
      artifactKey: row.artifactKey,
      version: row.version,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    }))
  if (artifactReceipts.some(row => !row.artifactKey || !Number.isInteger(row.version) || row.version < 1
    || !isSha256Hash(row.contentHash)
    || (row.producerReceiptHash != null && !isSha256Hash(row.producerReceiptHash)))) {
    throw new Error('[game-production-receipt] Artifact receipt 无效')
  }
  return hashGameProductionValueV2({
    schema: 'storyforge.game-build-root-terminal-receipt',
    version: 1,
    planHash: input.planHash,
    manifestHash: input.manifestHash,
    packageHash: input.packageHash,
    qualityReportHash: input.qualityReportHash,
    controlEpoch: input.controlEpoch,
    budgetLedger,
    artifactReceipts,
  })
}
