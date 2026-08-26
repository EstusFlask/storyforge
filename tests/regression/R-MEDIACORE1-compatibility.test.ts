import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { importAvgMediaAsset } from '../../src/lib/avg/authoring'
import { freezeAvgMediaAsset } from '../../src/lib/avg/runtime'
import { readAvgReleaseMediaDataUrl } from '../../src/lib/avg/media'
import { sha256BinaryV1 } from '../../src/lib/media/blob-store'

function binary(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer
}

describe('MEDIA-CORE-1 · AVG compatibility on shared integrity primitives', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('AVG 旧表继续使用共享 SHA-256/DataURL 核心，篡改仍 fail closed', async () => {
    const workspace = await createWorkspace({ name: 'AVG 媒资兼容', genre: 'other', genres: ['other'], status: 'drafting', description: '', targetWordCount: 100_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'long' })
    const data = binary()
    const asset = await importAvgMediaAsset({ scope: workspace.scope, assetKey: 'background.station', kind: 'background', name: 'station.png', blob: new Blob([data], { type: 'image/png' }), altText: '旧车站', source: 'fixture', license: 'CC0', width: 1200, height: 800 })
    expect(asset.contentHash).toBe(await sha256BinaryV1(data))
    const url = await readAvgReleaseMediaDataUrl({ scope: workspace.scope, asset: freezeAvgMediaAsset(asset) })
    expect(url).toMatch(/^data:image\/png;base64,/)
    const blob = await db.avgMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
    // 模拟真正的 pre-MEDIA-CORE 记录：旧行没有共享对象链接，内联字节本身
    // 就是唯一事实源；篡改这个事实源必须 fail closed。
    await db.avgMediaBlobs.update(blob!.id!, {
      blobObjectId: null,
      data: new Uint8Array([1, 2, 3, 4]).buffer,
    })
    await expect(readAvgReleaseMediaDataUrl({ scope: workspace.scope, asset: freezeAvgMediaAsset(asset) })).rejects.toThrow(/完整性|哈希/)
  })
})
