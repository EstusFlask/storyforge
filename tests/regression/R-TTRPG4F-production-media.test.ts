import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { collectUnreferencedMediaBlobObjects, sha256MediaData } from '../../src/lib/game-production/media-blob-store'
import { resolvePlayableGameSource } from '../../src/lib/game-production/preview-source'
import {
  buildTtrpgProductionPreviewV1,
  confirmTtrpgProductionBriefV1,
  createTtrpgDevelopmentProductionV1,
  readTtrpgProductionDetailsV1,
} from '../../src/lib/ttrpg/production-service'
import {
  acceptTtrpgProductionMediaAssetV1,
  acceptTtrpgGeneratedMediaCandidateV1,
  generateTtrpgProductionMediaCandidateV1,
  verifyTtrpgProductionMediaCoverageV1,
} from '../../src/lib/ttrpg/production-media'
import type { WorkspaceScope } from '../../src/lib/types'
import { createPlayableGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function scope(name: string): Promise<WorkspaceScope> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'investigation', genres: ['investigation'], status: 'drafting', description: '',
    targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return (await ensureWorkspaceOwnership(projectId)).scope
}

async function buildWithMedia(owner: WorkspaceScope, productionKey: string) {
  const production = await createTtrpgDevelopmentProductionV1({
    scope: owner,
    fixtureKey: 'd100-investigation-archive',
    productionKey,
  })
  await confirmTtrpgProductionBriefV1({
    scope: owner,
    productionId: production.production.id!,
    title: '媒资闭包跑团',
    premise: '调查被篡改的档案并保护证人。',
    tone: ['调查', '压迫'],
    scale: { scope: 'short-arc', targetPlayMinutes: 180, targetEndingCount: 2 },
    contentBoundaries: ['安全'],
    confirmDefaultMappings: true,
    draft: {
      media: {
        visualStyle: '档案馆调查插画',
        sceneImages: true,
        characterPortraits: true,
        characterExpressions: true,
        itemIcons: true,
        handouts: true,
        maps: true,
        tokens: true,
        generationTiming: 'prebuild',
        backgroundGeneration: true,
        textFallback: true,
        maximumGeneratedAssets: 64,
      },
    },
  })
  const build = await buildTtrpgProductionPreviewV1({
    scope: owner,
    productionId: production.production.id!,
  })
  return { production, build }
}

function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return bytes.buffer
}

describe('R-TTRPG-4F · product-owned production media lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Build 自动规划全部槽位；采纳真实图片后形成版本、可读取且仍保留未完成降级清单', async () => {
    const owner = await scope('跑团媒资主链')
    const { production, build } = await buildWithMedia(owner, 'media-mainline')
    const details = await readTtrpgProductionDetailsV1(owner, production.production.id!)
    const planned = details.mediaAssets.filter(row => row.buildId === build.id && row.status === 'planned')
    const campaign = JSON.parse(build.campaignJson) as { mediaManifest: { slots: Array<{ slotKey: string }> } }
    expect(planned).toHaveLength(campaign.mediaManifest.slots.length)
    expect(planned.length).toBeGreaterThan(10)
    expect(new Set(planned.map(row => row.slotKey)).size).toBe(planned.length)

    const before = await verifyTtrpgProductionMediaCoverageV1({
      scope: owner,
      buildId: build.id!,
      expectedBuildHash: build.buildHash,
    })
    expect(before).toMatchObject({ availableSlots: 0, requiredSlots: planned.length })
    expect(before.missingRequiredSlotKeys).toHaveLength(planned.length)

    const slot = planned[0]
    const accepted = await acceptTtrpgProductionMediaAssetV1({
      scope: owner,
      buildId: build.id!,
      slotKey: slot.slotKey,
      expectedSpecHash: slot.specHash,
      data: png(slot.width!, slot.height!),
      declaredMimeType: 'image/png',
      provider: {
        adapterId: 'test.image.v1',
        requestId: 'provider-request-1',
        modelId: 'test-image-model',
        receiptHash: 'a'.repeat(64),
      },
      rights: {
        sourceKind: 'provider-generated',
        license: 'provider-commercial-output-v1',
        authorConfirmed: true,
      },
    })
    expect(accepted).toMatchObject({ status: 'available', version: 2, mimeType: 'image/png' })
    expect(accepted.contentHash).toMatch(/^[a-f0-9]{64}$/)

    const after = await verifyTtrpgProductionMediaCoverageV1({
      scope: owner,
      buildId: build.id!,
      expectedBuildHash: build.buildHash,
    })
    expect(after.availableSlots).toBe(1)
    expect(after.missingRequiredSlotKeys).not.toContain(slot.slotKey)
    expect(after.fallbackSlotKeys).toHaveLength(planned.length - 1)

    const playable = await resolvePlayableGameSource({
      scope: owner,
      source: { kind: 'ttrpg-build', ttrpgBuildId: build.id!, expectedBuildHash: build.buildHash },
    })
    const blob = await playable.mediaResolver.read(slot.slotKey)
    expect(blob).toMatchObject({ size: 24, type: 'image/png' })
    await expect(playable.mediaResolver.read(planned[1].slotKey)).rejects.toThrow(/文字 fallback/)
    playable.mediaResolver.dispose()
  })

  it('错误 hash、伪 MIME、错误尺寸、未确认版权和跨 Work 均在采纳边界 fail-closed', async () => {
    const owner = await scope('媒资守卫所有者')
    const outsider = await scope('媒资守卫越权者')
    const { production, build } = await buildWithMedia(owner, 'media-guards')
    const slot = (await readTtrpgProductionDetailsV1(owner, production.production.id!)).mediaAssets[0]
    const base = {
      scope: owner,
      buildId: build.id!,
      slotKey: slot.slotKey,
      expectedSpecHash: slot.specHash,
      data: png(slot.width!, slot.height!),
      declaredMimeType: 'image/png' as const,
      provider: null,
      rights: {
        sourceKind: 'author-owned-import' as const,
        license: 'author-owned',
        authorConfirmed: true,
      },
    }
    await expect(acceptTtrpgProductionMediaAssetV1({ ...base, expectedSpecHash: 'b'.repeat(64) }))
      .rejects.toThrow(/规格已变化/)
    await expect(acceptTtrpgProductionMediaAssetV1({
      ...base,
      declaredMimeType: 'image/jpeg',
    })).rejects.toThrow(/真实 MIME/)
    await expect(acceptTtrpgProductionMediaAssetV1({
      ...base,
      data: png(slot.width! + 1, slot.height!),
    })).rejects.toThrow(/尺寸/)
    await expect(acceptTtrpgProductionMediaAssetV1({
      ...base,
      rights: { ...base.rights, authorConfirmed: false },
    })).rejects.toThrow(/作者必须确认/)
    await expect(acceptTtrpgProductionMediaAssetV1({ ...base, scope: outsider }))
      .rejects.toThrow(/跨 Work/)
    expect(await db.mediaBlobObjects.where('workId').equals(owner.workId).count()).toBe(0)
  })

  it('同一槽位追加新版本；可用引用阻止 GC，解除产品引用后对象才可回收', async () => {
    const owner = await scope('跑团媒资版本与回收')
    const { production, build } = await buildWithMedia(owner, 'media-versioning')
    const slot = (await readTtrpgProductionDetailsV1(owner, production.production.id!)).mediaAssets[0]
    const adopt = (requestId: string) => acceptTtrpgProductionMediaAssetV1({
      scope: owner,
      buildId: build.id!,
      slotKey: slot.slotKey,
      expectedSpecHash: slot.specHash,
      data: png(slot.width!, slot.height!),
      declaredMimeType: 'image/png',
      provider: {
        adapterId: 'test.image.v1', requestId,
        receiptHash: requestId === 'one' ? 'c'.repeat(64) : 'd'.repeat(64),
      },
      rights: { sourceKind: 'provider-generated', license: 'commercial', authorConfirmed: true },
    })
    const first = await adopt('one')
    const second = await adopt('two')
    expect(second.version).toBe(3)
    const versions = await db.ttrpgProductionMediaAssets
      .where('[buildId+slotKey]').equals([build.id!, slot.slotKey]).sortBy('version')
    expect(versions.map(row => [row.version, row.status])).toEqual([
      [1, 'superseded'], [2, 'superseded'], [3, 'available'],
    ])
    expect(second.blobObjectId).toBe(first.blobObjectId)
    expect((await collectUnreferencedMediaBlobObjects({ scope: owner })).retained).toContain(second.blobObjectId)

    await db.ttrpgProductionMediaAssets.where('buildId').equals(build.id!).delete()
    expect((await collectUnreferencedMediaBlobObjects({ scope: owner })).deleted).toContain(second.blobObjectId)
  })

  it('首个试玩实例创建后冻结生产媒资，旧 Build 不得在玩家运行期间偷偷换图', async () => {
    const owner = await scope('跑团媒资开桌冻结')
    const { production, build } = await buildWithMedia(owner, 'media-freeze-on-play')
    const slot = (await readTtrpgProductionDetailsV1(owner, production.production.id!)).mediaAssets[0]
    await createPlayableGameInstance({
      scope: owner,
      source: {
        kind: 'ttrpg-build',
        ttrpgBuildId: build.id!,
        expectedBuildHash: build.buildHash,
      },
      title: '已开桌的冻结媒资 Build',
      seed: 'ttrpg-media-freeze-on-play',
    })
    await expect(acceptTtrpgProductionMediaAssetV1({
      scope: owner,
      buildId: build.id!,
      slotKey: slot.slotKey,
      expectedSpecHash: slot.specHash,
      data: png(slot.width!, slot.height!),
      declaredMimeType: 'image/png',
      provider: null,
      rights: {
        sourceKind: 'author-owned-import',
        license: 'author-owned',
        authorConfirmed: true,
      },
    })).rejects.toThrow(/生产媒资已冻结/)
    expect(await db.mediaBlobObjects.where('workId').equals(owner.workId).count()).toBe(0)
    const versions = await db.ttrpgProductionMediaAssets
      .where('[buildId+slotKey]').equals([build.id!, slot.slotKey]).toArray()
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, status: 'planned' })
  })

  it('Provider 只产生内存候选；回执、商业权利与作者确认通过后才能写入正式媒资账本', async () => {
    const owner = await scope('跑团媒资候选采用')
    const { production, build } = await buildWithMedia(owner, 'media-provider-candidate')
    const slot = (await readTtrpgProductionDetailsV1(owner, production.production.id!)).mediaAssets[0]
    const adapter = {
      capability: {
        adapterId: 'test.provider.image.v1', version: 1 as const,
        mediaClasses: ['image' as const], operations: ['generate' as const],
        executionLocations: ['trusted-relay' as const], maximumOutputsPerRequest: 1,
        commercialEligible: true, availability: 'implemented' as const,
      },
      async estimate(request: { requestId: string }) {
        return { requestId: request.requestId, outputCount: 1, estimatedCostUsd: 0.1, estimatedDurationMs: 100, estimatedStorageBytes: 24 }
      },
      async generate(request: any) {
        const data = png(request.width, request.height)
        return [{
          schema: 'storyforge.game-media-candidate' as const, version: 1 as const,
          adapterId: 'test.provider.image.v1', requestId: request.requestId, candidateIndex: 0,
          mediaClass: 'image' as const, mediaKind: request.mediaKind, mimeType: 'image/png', byteSize: data.byteLength,
          contentHash: await sha256MediaData(data), data, metadata: { model: 'test-image-model' },
          rights: {
            origin: 'generated' as const, adapterId: 'test.provider.image.v1',
            rightsPolicyVersion: request.rightsPolicyVersion, commercialUse: true,
            requiresProviderTermsReview: true,
          },
          providerReceipt: {
            providerRequestId: 'provider-1', executionLocation: 'trusted-relay' as const,
            usage: { images: 1 }, costUsd: 0.1,
          },
        }]
      },
      async parseAndVerify(candidate: any) { return structuredClone(candidate) },
    }
    const value = await generateTtrpgProductionMediaCandidateV1({
      scope: owner,
      buildId: build.id!,
      slotKey: slot.slotKey,
      expectedSpecHash: slot.specHash,
      adapter,
      transport: {
        executionLocation: 'trusted-relay' as const,
        async request() { throw new Error('mock adapter does not call transport') },
      },
    })
    expect(value).toMatchObject({ slotKey: slot.slotKey, providerReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect((await db.ttrpgProductionMediaAssets.where('[buildId+slotKey]').equals([build.id!, slot.slotKey]).toArray())
      .every(row => row.status !== 'available')).toBe(true)
    await expect(acceptTtrpgGeneratedMediaCandidateV1({ scope: owner, value, authorConfirmed: false }))
      .rejects.toThrow(/尚未确认/)
    await expect(acceptTtrpgGeneratedMediaCandidateV1({
      scope: owner,
      value: { ...value, providerReceiptHash: 'f'.repeat(64) },
      authorConfirmed: true,
    })).rejects.toThrow(/回执已损坏/)
    await expect(acceptTtrpgGeneratedMediaCandidateV1({ scope: owner, value, authorConfirmed: true }))
      .resolves.toMatchObject({ status: 'available', providerAdapterId: 'test.provider.image.v1' })
  })
})
