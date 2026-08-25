import { db } from '../db/schema'
import type { PlayableGameSourceV1, ResolvedPlayableGamePackageV2, WorkspaceScope } from '../types'
import { assertGameReleaseUnchanged, parseAnyGameReleaseManifest, parseAnyGameReleaseManifestVersion } from '../text-game/releases'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { createBuildGameMediaResolver, createReleaseGameMediaResolver } from './media-resolver'
import { verifyGameBuildPreviewManifestV1 } from './preview-manifest'
import { gameRuntimePackageFromReleaseV1, verifyGameReleaseManifestV2 } from './runtime-package'
import { resolveTtrpgProductionBuildRuntimeV1 } from '../ttrpg/production-service'
import { createTtrpgProductionBuildMediaResolverV1 } from '../ttrpg/production-media'

export async function resolvePlayableGameSource(input: {
  scope: WorkspaceScope
  source: PlayableGameSourceV1
}): Promise<ResolvedPlayableGamePackageV2> {
  const verified = await verifyPlayableGamePackageSource(input)
  const mediaResolver = input.source.kind === 'release'
    ? await createReleaseGameMediaResolver({ scope: input.scope, runtimePackage: verified.runtimePackage })
    : input.source.kind === 'build' ? await createBuildGameMediaResolver({
      scope: input.scope,
      gameBuildId: input.source.gameBuildId,
      preview: await verifyGameBuildPreviewManifestV1(
        (await db.gameBuilds.get(input.source.gameBuildId))?.previewManifestJson ?? '',
      ),
    }) : await createTtrpgProductionBuildMediaResolverV1({
      scope: input.scope,
      buildId: input.source.ttrpgBuildId,
      expectedBuildHash: input.source.expectedBuildHash,
    })
  return { ...verified, mediaResolver }
}

/**
 * Verify the immutable playable source without acquiring media leases. Runtime
 * and session boundaries use this form so source validation can participate in
 * their own atomic transaction; player presentation adds the resolver above.
 */
export async function verifyPlayableGamePackageSource(input: {
  scope: WorkspaceScope
  source: PlayableGameSourceV1
}): Promise<Omit<ResolvedPlayableGamePackageV2, 'mediaResolver'>> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.source.kind === 'release') {
    const release = await assertGameReleaseUnchanged(input.source.gameReleaseId)
    if (!await assertRecordInScope(scope, 'gameReleases', release, { owner: 'work' })) {
      throw new Error('[playable-game-source] GameRelease 不属于当前 Work')
    }
    const parsed = parseAnyGameReleaseManifestVersion(release.manifestJson)
    const runtimePackage = parsed.version === 2
      ? (await verifyGameReleaseManifestV2(parsed)).runtimePackage
      : gameRuntimePackageFromReleaseV1(parseAnyGameReleaseManifest(release.manifestJson))
    const packageHash = parsed.version === 2 ? parsed.packageHash : release.contentHash
    return {
      source: input.source,
      runtimePackage,
      packageHash,
      runtimeSourceHash: packageHash,
      sourceWorldReleaseId: release.worldReleaseId,
    }
  }

  if (input.source.kind === 'ttrpg-build') {
    const resolved = await resolveTtrpgProductionBuildRuntimeV1({
      scope,
      buildId: input.source.ttrpgBuildId,
      expectedBuildHash: input.source.expectedBuildHash,
    })
    return { source: input.source, ...resolved }
  }

  const build = await db.gameBuilds.get(input.source.gameBuildId)
  if (!build || !await assertRecordInScope(scope, 'gameBuilds', build, { owner: 'work' })) {
    throw new Error('[playable-game-source] GameBuild 不存在或跨 Work')
  }
  if (build.status !== 'preview-ready' && build.status !== 'release-ready' && build.status !== 'released') {
    throw new Error('[playable-game-source] GameBuild 尚未达到可预览状态')
  }
  const [production, brief] = await Promise.all([
    db.gameProductions.get(build.productionId),
    db.gameProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
  ])
  if (!production || !brief || production.workId !== scope.workId || brief.briefHash !== build.briefHash) {
    throw new Error('[playable-game-source] Build 的 Production/Brief 绑定损坏')
  }
  const preview = await verifyGameBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== input.source.expectedPreviewHash || preview.previewHash !== build.previewHash
    || preview.packageHash !== build.packageHash || preview.buildManifestHash !== build.manifestHash
    || preview.productionKey !== production.productionKey || preview.buildNumber !== build.buildNumber) {
    throw new Error('[playable-game-source] Build Preview 指针或 hash 不一致')
  }
  const worldRelease = await db.worldReleases.get(brief.sourceWorldReleaseId)
  if (!worldRelease || worldRelease.projectId !== scope.projectId || worldRelease.worldId !== scope.worldId
    || worldRelease.contentHash !== brief.sourceWorldContentHash
    || preview.runtimePackage.sourceWorld.contentHash !== worldRelease.contentHash) {
    throw new Error('[playable-game-source] Build Preview 的 WorldRelease 来源损坏')
  }
  await assertReleaseUnchanged(worldRelease.id!)
  return {
    source: input.source,
    runtimePackage: preview.runtimePackage,
    packageHash: preview.packageHash,
    runtimeSourceHash: preview.packageHash,
    sourceWorldReleaseId: worldRelease.id!,
  }
}
