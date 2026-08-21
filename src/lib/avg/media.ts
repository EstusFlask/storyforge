import { db } from '../db/schema'
import type { FrozenAvgMediaAsset, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { binaryDataUrlV1, sha256BinaryV1 } from '../media/blob-store'

export async function readAvgReleaseMediaDataUrl(input: { scope: WorkspaceScope; asset: FrozenAvgMediaAsset }): Promise<string> {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.avgMediaAssets.where('[workId+assetKey+version]').equals([scope.workId, input.asset.assetKey, input.asset.version]).first()
  if (!asset || !await assertRecordInScope(scope, 'avgMediaAssets', asset, { owner: 'work' }) || asset.contentHash !== input.asset.contentHash || asset.mimeType !== input.asset.mimeType) throw new Error(`[avg] 冻结媒资版本缺失或元数据不匹配:${input.asset.assetKey}@${input.asset.version}`)
  const row = await db.avgMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
  if (!row || !await assertRecordInScope(scope, 'avgMediaBlobs', row, { owner: 'work' }) || row.data.byteLength !== input.asset.byteSize || await sha256BinaryV1(row.data) !== input.asset.contentHash) throw new Error(`[avg] 冻结媒资二进制缺失或哈希不匹配:${input.asset.assetKey}@${input.asset.version}`)
  return binaryDataUrlV1(row.data, asset.mimeType)
}

export async function preloadAvgReleaseMedia(input: { scope: WorkspaceScope; assets: FrozenAvgMediaAsset[]; maximumBytes?: number }): Promise<{ urls: Record<string, string>; failures: Array<{ assetKey: string; reason: string }> }> {
  const maximumBytes = input.maximumBytes ?? 64 * 1024 * 1024
  const urls: Record<string, string> = {}; const failures: Array<{ assetKey: string; reason: string }> = []; let used = 0
  for (const asset of input.assets) {
    if (used + asset.byteSize > maximumBytes) { failures.push({ assetKey: asset.assetKey, reason: '预加载容量预算已满' }); continue }
    try { urls[asset.assetKey] = await readAvgReleaseMediaDataUrl({ scope: input.scope, asset }); used += asset.byteSize }
    catch (cause) { failures.push({ assetKey: asset.assetKey, reason: cause instanceof Error ? cause.message : String(cause) }) }
  }
  return { urls, failures }
}
