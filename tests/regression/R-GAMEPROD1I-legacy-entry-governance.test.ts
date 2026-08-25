import { describe, expect, it } from 'vitest'
import { resolveLegacyManualPublicationPolicyV1 } from '../../src/lib/game-production/legacy-entry-governance'
import type { GameRelease } from '../../src/lib/types'

function release(manifest: unknown): GameRelease {
  return {
    projectId: 1, worldId: 1, workId: 1, gameDefinitionId: 1, worldReleaseId: 1,
    version: 1, label: 'fixture', manifestJson: JSON.stringify(manifest),
    contentHash: 'a'.repeat(64), createdAt: 1,
  }
}

describe('R-GAMEPROD-1I · legacy manual publication governance', () => {
  it('新草稿和 Production-owned 发布流不能从旧工作台直接发布', () => {
    expect(resolveLegacyManualPublicationPolicyV1({ releases: [], productionRouteAvailable: true }))
      .toMatchObject({ mode: 'production-required', directPublicationAllowed: false })
    expect(resolveLegacyManualPublicationPolicyV1({
      productionRouteAvailable: true,
      releases: [release({
        schema: 'storyforge.game-release', version: 2,
        productionProvenance: { productionKey: 'gameprod.1', buildNumber: 1 },
      })],
    })).toMatchObject({ mode: 'production-required', directPublicationAllowed: false })
  })

  it('只为已经存在的 v1 发布序列保留直接维护能力', () => {
    expect(resolveLegacyManualPublicationPolicyV1({
      productionRouteAvailable: true,
      releases: [release({ schema: 'storyforge.game-release', version: 1 })],
    })).toMatchObject({ mode: 'legacy-maintenance', directPublicationAllowed: true })
    expect(resolveLegacyManualPublicationPolicyV1({
      productionRouteAvailable: true,
      releases: [release({ schema: 'storyforge.game-release', version: 99 })],
    })).toMatchObject({ mode: 'production-required', directPublicationAllowed: false })
    expect(resolveLegacyManualPublicationPolicyV1({
      productionRouteAvailable: true, releases: [], legacyDraftPresent: true,
    })).toMatchObject({ mode: 'legacy-maintenance', directPublicationAllowed: true })
  })
})
