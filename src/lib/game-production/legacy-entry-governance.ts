import type { GameRelease } from '../types'

export interface LegacyManualPublicationPolicyV1 {
  mode: 'legacy-maintenance' | 'production-required' | 'internal-compatibility'
  directPublicationAllowed: boolean
  reason: string
}

function isLegacyV1Release(release: GameRelease): boolean {
  try {
    const value = JSON.parse(release.manifestJson) as Record<string, unknown>
    return value.schema === 'storyforge.game-release' && value.version === 1
  } catch {
    return false
  }
}

/**
 * ProductHub always supplies the Production route. Only a stream that already
 * has a legacy v1 GameRelease may keep using the old direct publisher; new or
 * Production-owned streams must use Build/Preview/atomic adoption.
 *
 * The compatibility mode exists for isolated legacy component tests and
 * non-routed migration tools. It is not used by the product UI.
 */
export function resolveLegacyManualPublicationPolicyV1(input: {
  releases: GameRelease[]
  productionRouteAvailable: boolean
  legacyDraftPresent?: boolean
}): LegacyManualPublicationPolicyV1 {
  const productionOwned = input.releases.some(release => {
    try {
      const value = JSON.parse(release.manifestJson) as Record<string, unknown>
      return value.schema === 'storyforge.game-release' && value.version === 2
        && value.productionProvenance != null
    } catch {
      return false
    }
  })
  if (productionOwned && input.productionRouteAvailable) return {
    mode: 'production-required',
    directPublicationAllowed: false,
    reason: '该游戏已由 Production 接管，后续版本必须继续走 Build/Preview/原子发布。',
  }
  if (input.releases.some(isLegacyV1Release)) return {
    mode: 'legacy-maintenance',
    directPublicationAllowed: true,
    reason: '该游戏已有旧版发布，可继续维护其既有发布序列。',
  }
  if (input.legacyDraftPresent) return {
    mode: 'legacy-maintenance',
    directPublicationAllowed: true,
    reason: '该草稿已在统一制作入口上线前存在，可完成旧发布序列迁移；不能从产品入口新建同类草稿。',
  }
  if (input.productionRouteAvailable) return {
    mode: 'production-required',
    directPublicationAllowed: false,
    reason: '新游戏和 Production 发布必须进入制作中心，旧工作台只负责草稿维护。',
  }
  return {
    mode: 'internal-compatibility',
    directPublicationAllowed: true,
    reason: '仅供未接入 ProductHub 的旧版迁移或隔离验证使用。',
  }
}
