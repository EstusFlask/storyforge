import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import Dexie from 'dexie'
import { db } from '../db/schema'
import {
  TTRPG_PRODUCTION_STEP_KEYS_V1,
  type TtrpgDevelopmentSourceFixtureKeyV1,
  type GameRuntimePackageV2,
  type TtrpgProductReleaseManifestV1,
  type TtrpgProductReleaseRecordV1,
  type TtrpgProductionBriefRecordV1,
  type TtrpgProductionBuildRecordV1,
  type TtrpgProductionMediaAssetRecordV1,
  type TtrpgProductionRecordV1,
  type TtrpgProductionSourceCatalogV1,
  type TtrpgProductionSourceSelectionV1,
  type TtrpgProductionStepKeyV1,
  type TtrpgProductionStepRecordV1,
  type TtrpgSourceSelectionRecordV1,
  EMPTY_SIMULATION_STATE,
  type SimulationRuntimeState,
  type WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../world-engine/scope'
import { parseTtrpgCampaignContentV1, validateTtrpgCampaignForPublicationV1 } from './campaign'
import {
  compileTtrpgBriefFromProductionSourceV1,
  compileTtrpgPreviewFromConfirmedBriefV1,
  prepareTtrpgProductionSourceV1,
} from './production-kernel'
import type { TtrpgProductionBriefDraftInputV2 } from './production-brief'
import { parseTtrpgProductionBriefV2 } from './production-brief'
import {
  assertTtrpgProductionSourceMayPublishV1,
  createTtrpgDevelopmentSourceFixtureV1,
  parseTtrpgProductionSourceCatalogV1,
  parseTtrpgProductionSourceSelectionV1,
  selectAllTtrpgProductionSourceV1,
} from './production-source'
import { parseRulePackV1 } from './rule-pack'
import { parseGameRuntimePackageV2 } from '../game-production/runtime-package'
import { ttrpgCampaignNarrativeV1 } from './release'
import {
  prepareTtrpgProductionMediaPlanV1,
  verifyTtrpgProductionMediaCoverageV1,
} from './production-media'

const BUILD_STEP_KEYS = TTRPG_PRODUCTION_STEP_KEYS_V1.filter(step => !['source-frozen', 'brief-confirmed'].includes(step))

function fail(message: string): never { throw new Error(`[ttrpg-production-service] ${message}`) }
function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) as unknown }
  catch { return fail(`${label} JSON 已损坏`) }
}
function safeProductionKey(value: string): string {
  const parsed = value.trim().normalize('NFKD').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-|-$/g, '').slice(0, 160)
  if (!parsed) fail('productionKey 不能为空')
  return parsed
}
function nowError(error: unknown): string {
  return canonicalStringify({
    code: 'ttrpg-production-failed',
    message: error instanceof Error ? error.message : String(error),
    recordedAt: Date.now(),
  })
}

export interface TtrpgProductionDetailsV1 {
  production: TtrpgProductionRecordV1
  sourceSelections: TtrpgSourceSelectionRecordV1[]
  briefs: TtrpgProductionBriefRecordV1[]
  steps: TtrpgProductionStepRecordV1[]
  builds: TtrpgProductionBuildRecordV1[]
  mediaAssets: TtrpgProductionMediaAssetRecordV1[]
  releases: TtrpgProductReleaseRecordV1[]
}

async function scopedProduction(scope: WorkspaceScope, productionId: number): Promise<TtrpgProductionRecordV1> {
  const row = await db.ttrpgProductions.get(productionId)
  if (!row || !await assertRecordInScope(scope, 'ttrpgProductions', row, { owner: 'work' })) fail('生产任务不存在或跨 Work')
  return row
}

async function scopedSourceSelection(scope: WorkspaceScope, id: number): Promise<TtrpgSourceSelectionRecordV1> {
  const row = await db.ttrpgSourceSelections.get(id)
  if (!row || !await assertRecordInScope(scope, 'ttrpgSourceSelections', row, { owner: 'work' })) fail('冻结来源不存在或跨 Work')
  return row
}

async function activeInputs(scope: WorkspaceScope, productionId: number): Promise<{
  production: TtrpgProductionRecordV1
  sourceRow: TtrpgSourceSelectionRecordV1
  catalog: TtrpgProductionSourceCatalogV1
  selection: TtrpgProductionSourceSelectionV1
}> {
  const production = await scopedProduction(scope, productionId)
  if (production.activeSourceSelectionId == null) fail('生产任务尚未冻结来源')
  const sourceRow = await scopedSourceSelection(scope, production.activeSourceSelectionId)
  if (sourceRow.productionId !== production.id || sourceRow.status !== 'frozen') fail('当前来源不属于生产任务或已被替换')
  const catalog = parseTtrpgProductionSourceCatalogV1(parseJson(sourceRow.sourceCatalogJson, 'sourceCatalog'))
  const selection = parseTtrpgProductionSourceSelectionV1(parseJson(sourceRow.selectionJson, 'selection'))
  if (catalog.catalogHash !== sourceRow.sourceCatalogHash || selection.selectionHash !== sourceRow.selectionHash) {
    fail('冻结来源行与内容 hash 不一致')
  }
  return { production, sourceRow, catalog, selection }
}

async function nextStepAttempt(productionId: number, stepKey: TtrpgProductionStepKeyV1): Promise<number> {
  const rows = await db.ttrpgProductionSteps.where('[productionId+stepKey]').equals([productionId, stepKey]).toArray()
  return Math.max(0, ...rows.map(row => row.attempt)) + 1
}

export async function listTtrpgProductionsV1(scopeInput: WorkspaceScope): Promise<TtrpgProductionRecordV1[]> {
  const scope = await resolveScope({ scope: scopeInput })
  return db.ttrpgProductions.where('workId').equals(scope.workId).reverse().sortBy('updatedAt')
}

export async function readTtrpgProductionDetailsV1(
  scopeInput: WorkspaceScope,
  productionId: number,
): Promise<TtrpgProductionDetailsV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const production = await scopedProduction(scope, productionId)
  const [sourceSelections, briefs, steps, builds, mediaAssets, releases] = await Promise.all([
    db.ttrpgSourceSelections.where('productionId').equals(productionId).sortBy('revision'),
    db.ttrpgProductionBriefs.where('productionId').equals(productionId).sortBy('revision'),
    db.ttrpgProductionSteps.where('productionId').equals(productionId).sortBy('updatedAt'),
    db.ttrpgProductionBuilds.where('productionId').equals(productionId).sortBy('buildNumber'),
    db.ttrpgProductionBuilds.where('productionId').equals(productionId).primaryKeys().then(buildIds => (
      buildIds.length > 0
        ? db.ttrpgProductionMediaAssets.where('buildId').anyOf(buildIds as number[]).toArray()
        : []
    )),
    db.ttrpgProductReleases.where('productionId').equals(productionId).sortBy('version'),
  ])
  return { production, sourceSelections, briefs, steps, builds, mediaAssets, releases }
}

export async function createTtrpgDevelopmentProductionV1(input: {
  scope: WorkspaceScope
  fixtureKey: TtrpgDevelopmentSourceFixtureKeyV1
  productionKey: string
  title?: string
}): Promise<TtrpgProductionDetailsV1> {
  const scope = await resolveScope({ scope: input.scope })
  const productionKey = safeProductionKey(input.productionKey)
  const catalog = await createTtrpgDevelopmentSourceFixtureV1(input.fixtureKey)
  const selection = await selectAllTtrpgProductionSourceV1(catalog)
  const createdAt = Date.now()
  const productionId = await db.transaction('rw', scopeTransactionTables(
    db.ttrpgProductions, db.ttrpgSourceSelections, db.ttrpgProductionSteps,
  ), async () => {
    const duplicate = await db.ttrpgProductions.where('[workId+productionKey]').equals([scope.workId, productionKey]).first()
    if (duplicate) fail(`productionKey 已存在:${productionKey}`)
    const production: TtrpgProductionRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionKey, title: input.title?.trim() || catalog.title, status: 'draft',
      activeSourceSelectionId: null, activeBriefId: null, currentBuildId: null,
      currentProductReleaseId: null, createdAt, updatedAt: createdAt,
    }
    const id = await db.ttrpgProductions.add(production) as number
    const sourceRow: TtrpgSourceSelectionRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: id, revision: 1, sourceKind: catalog.identity.sourceKind,
      developmentOnly: catalog.identity.developmentOnly, sourceWorldReleaseId: null,
      sourceKey: catalog.identity.sourceKey, sourceContentHash: catalog.identity.sourceContentHash,
      sourceCatalogJson: canonicalStringify(catalog), sourceCatalogHash: catalog.catalogHash,
      selectionJson: canonicalStringify(selection), selectionHash: selection.selectionHash,
      status: 'frozen', createdAt,
    }
    const sourceSelectionId = await db.ttrpgSourceSelections.add(sourceRow) as number
    const step: TtrpgProductionStepRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: id, buildId: null, stepKey: 'source-frozen', attempt: 1, status: 'completed',
      inputHash: catalog.catalogHash, outputHash: selection.selectionHash,
      checkpointJson: canonicalStringify({ sourceSelectionId, developmentOnly: true }), errorJson: null,
      startedAt: createdAt, completedAt: createdAt, updatedAt: createdAt,
    }
    await db.ttrpgProductionSteps.add(step)
    await db.ttrpgProductions.update(id, { activeSourceSelectionId: sourceSelectionId, status: 'source-frozen', updatedAt: createdAt })
    return id
  })
  return readTtrpgProductionDetailsV1(scope, productionId)
}

export async function confirmTtrpgProductionBriefV1(input: {
  scope: WorkspaceScope
  productionId: number
  title: string
  premise: string
  tone: string[]
  scale: { targetPlayMinutes: number; targetEndingCount: number; scope: string }
  contentBoundaries: string[]
  confirmDefaultMappings: boolean
  draft?: TtrpgProductionBriefDraftInputV2
}): Promise<TtrpgProductionBriefRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const before = await activeInputs(scope, input.productionId)
  if (['released', 'archived'].includes(before.production.status)) fail('已发布或归档生产不能修改 Brief')
  const { brief } = await compileTtrpgBriefFromProductionSourceV1({
    ...input, catalog: before.catalog, selection: before.selection,
  })
  const briefJson = canonicalStringify(brief)
  const briefHash = await hashCanonicalValue(brief)
  const createdAt = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.ttrpgProductions, db.ttrpgSourceSelections, db.ttrpgProductionBriefs,
    db.ttrpgProductionSteps, db.ttrpgProductionBuilds,
  ), async () => {
    const current = await db.ttrpgProductions.get(input.productionId)
    const currentSource = current?.activeSourceSelectionId == null ? null : await db.ttrpgSourceSelections.get(current.activeSourceSelectionId)
    if (!current || current.activeSourceSelectionId !== before.sourceRow.id
      || currentSource?.selectionHash !== before.sourceRow.selectionHash) fail('冻结来源在 Brief 确认前发生变化')
    const existing = await db.ttrpgProductionBriefs.where('productionId').equals(current.id!).toArray()
    const revision = Math.max(0, ...existing.map(row => row.revision)) + 1
    await db.ttrpgProductionBriefs.where('productionId').equals(current.id!).and(row => row.status === 'confirmed').modify({ status: 'superseded' })
    await db.ttrpgProductionBuilds.where('productionId').equals(current.id!).and(row => row.status !== 'superseded').modify({ status: 'superseded', updatedAt: createdAt })
    await db.ttrpgProductionSteps.where('productionId').equals(current.id!).and(row => !['source-frozen', 'brief-confirmed'].includes(row.stepKey) && row.status !== 'stale').modify({ status: 'stale', updatedAt: createdAt })
    const row: TtrpgProductionBriefRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: current.id!, sourceSelectionId: before.sourceRow.id!, revision,
      briefJson, briefHash, status: 'confirmed', createdAt,
    }
    const id = await db.ttrpgProductionBriefs.add(row) as number
    const attempt = await nextStepAttempt(current.id!, 'brief-confirmed')
    await db.ttrpgProductionSteps.add({
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: current.id!, buildId: null, stepKey: 'brief-confirmed', attempt, status: 'completed',
      inputHash: before.sourceRow.selectionHash, outputHash: briefHash,
      checkpointJson: canonicalStringify({ briefId: id, revision }), errorJson: null,
      startedAt: createdAt, completedAt: createdAt, updatedAt: createdAt,
    })
    await db.ttrpgProductions.update(current.id!, {
      activeBriefId: id, currentBuildId: null, status: 'brief-confirmed', updatedAt: createdAt,
    })
    return { ...row, id }
  })
}

function checkpointForStep(input: {
  stepKey: TtrpgProductionStepKeyV1
  buildId: number
  preview: Awaited<ReturnType<typeof compileTtrpgPreviewFromConfirmedBriefV1>>
  validation: ReturnType<typeof validateTtrpgCampaignForPublicationV1>
}): unknown {
  const { stepKey, buildId, preview, validation } = input
  if (stepKey === 'rule-mapping') return { buildId, ruleSystemId: preview.rulePack.ruleSystemId, ruleSystemVersion: preview.rulePack.ruleSystemVersion }
  if (stepKey === 'roster-and-sheets') return { buildId, characters: preview.campaign.characterTemplates.map(row => ({ key: row.characterKey, controller: row.controller, playable: row.characterSheet?.gates.playableRole ?? false })) }
  if (stepKey === 'campaign-proposals') return { buildId, proposalKeys: preview.brief.campaignDesign?.proposals.map(row => row.proposalKey) ?? [], confirmed: preview.brief.campaignDesign?.selection.confirmed ?? false }
  if (stepKey === 'campaign-graph') return { buildId, scenes: preview.campaign.scenes.map(row => row.sceneKey), endings: preview.campaign.endings.map(row => row.endingKey) }
  if (stepKey === 'clues-fronts-secrets-rewards') return { buildId, clues: preview.campaign.clues.length, fronts: preview.campaign.fronts?.length ?? 0, secrets: preview.campaign.secrets?.length ?? 0, quests: preview.campaign.quests.length }
  if (stepKey === 'visual-bible') return { buildId, visualBible: preview.campaign.visualBible?.schema ?? null, characterAnchors: preview.campaign.visualBible?.characters.length ?? 0 }
  if (stepKey === 'media-prebuild') return { buildId, plannedSlots: preview.campaign.mediaManifest?.slots.length ?? 0, generationTiming: preview.brief.media.generationTiming }
  if (stepKey === 'integration') return { buildId, previewHash: preview.previewHash }
  if (stepKey === 'counterexample-validation') return { buildId, valid: validation.valid, errors: validation.errors, warnings: validation.warnings, structural: validation.structural }
  return { buildId, awaitingAuthorConfirmation: true }
}

export async function buildTtrpgProductionPreviewV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<TtrpgProductionBuildRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const before = await activeInputs(scope, input.productionId)
  if (before.production.activeBriefId == null) fail('必须先确认 Brief')
  const briefRow = await db.ttrpgProductionBriefs.get(before.production.activeBriefId)
  if (!briefRow || !await assertRecordInScope(scope, 'ttrpgProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.productionId !== before.production.id || briefRow.status !== 'confirmed') fail('当前 Brief 不存在、跨 Work 或已失效')
  const brief = parseTtrpgProductionBriefV2(parseJson(briefRow.briefJson, 'brief'))
  if (await hashCanonicalValue(brief) !== briefRow.briefHash) fail('Brief hash 不匹配')
  const startedAt = Date.now()
  const reserved = await db.transaction('rw', scopeTransactionTables(
    db.ttrpgProductions, db.ttrpgSourceSelections, db.ttrpgProductionBriefs,
    db.ttrpgProductionBuilds, db.ttrpgProductionSteps,
  ), async () => {
    const current = await db.ttrpgProductions.get(before.production.id!)
    if (!current || current.activeSourceSelectionId !== before.sourceRow.id || current.activeBriefId !== briefRow.id) {
      fail('生产输入在 Build 开始前发生变化')
    }
    const builds = await db.ttrpgProductionBuilds.where('productionId').equals(current.id!).toArray()
    const buildNumber = Math.max(0, ...builds.map(row => row.buildNumber)) + 1
    const row: TtrpgProductionBuildRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: current.id!, sourceSelectionId: before.sourceRow.id!, briefId: briefRow.id!,
      buildNumber, status: 'building', developmentOnly: before.sourceRow.developmentOnly,
      rulePackJson: '{}', rulePackHash: '', campaignJson: '{}', campaignHash: '',
      validationJson: '{}', buildHash: '', errorJson: null, createdAt: startedAt, updatedAt: startedAt,
    }
    const buildId = await db.ttrpgProductionBuilds.add(row) as number
    for (const stepKey of BUILD_STEP_KEYS) {
      const attempt = await nextStepAttempt(current.id!, stepKey)
      await db.ttrpgProductionSteps.add({
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        productionId: current.id!, buildId, stepKey, attempt,
        status: stepKey === 'integration' ? 'running' : 'pending',
        inputHash: await Dexie.waitFor(hashCanonicalValue({ source: before.sourceRow.selectionHash, brief: briefRow.briefHash, buildNumber, stepKey })),
        outputHash: null, checkpointJson: '{}', errorJson: null,
        startedAt: stepKey === 'integration' ? startedAt : null, completedAt: null, updatedAt: startedAt,
      })
    }
    await db.ttrpgProductions.update(current.id!, { status: 'building', currentBuildId: buildId, updatedAt: startedAt })
    return { ...row, id: buildId }
  })
  try {
    const preview = await compileTtrpgPreviewFromConfirmedBriefV1({
      scope, catalog: before.catalog, selection: before.selection, brief,
    })
    const validation = validateTtrpgCampaignForPublicationV1(preview.campaign, preview.rulePack)
    if (!validation.valid) fail(`CampaignPack 验证失败:${validation.errors.join('；')}`)
    const rulePackHash = await hashCanonicalValue(preview.rulePack)
    const campaignHash = await hashCanonicalValue(preview.campaign)
    const buildBody = {
      sourceSelectionHash: before.sourceRow.selectionHash, briefHash: briefRow.briefHash,
      rulePackHash, campaignHash, validation, developmentOnly: before.sourceRow.developmentOnly,
    }
    const buildHash = await hashCanonicalValue(buildBody)
    const completedAt = Date.now()
    const mediaPlan = await prepareTtrpgProductionMediaPlanV1({
      scope,
      buildId: reserved.id!,
      buildHash,
      campaign: preview.campaign,
      createdAt: completedAt,
    })
    return db.transaction('rw', scopeTransactionTables(
      db.ttrpgProductions, db.ttrpgSourceSelections, db.ttrpgProductionBriefs,
      db.ttrpgProductionBuilds, db.ttrpgProductionSteps, db.ttrpgProductionMediaAssets,
    ), async () => {
      const [current, currentSource, currentBrief, currentBuild] = await Promise.all([
        db.ttrpgProductions.get(before.production.id!), db.ttrpgSourceSelections.get(before.sourceRow.id!),
        db.ttrpgProductionBriefs.get(briefRow.id!), db.ttrpgProductionBuilds.get(reserved.id!),
      ])
      if (!current || current.currentBuildId !== reserved.id || currentSource?.selectionHash !== before.sourceRow.selectionHash
        || currentBrief?.briefHash !== briefRow.briefHash || currentBuild?.status !== 'building') fail('Build 提交前输入或控制权发生变化')
      await db.ttrpgProductionBuilds.update(reserved.id!, {
        status: 'preview-ready', rulePackJson: canonicalStringify(preview.rulePack), rulePackHash,
        campaignJson: canonicalStringify(preview.campaign), campaignHash,
        validationJson: canonicalStringify(validation), buildHash, errorJson: null, updatedAt: completedAt,
      })
      const existingMedia = await db.ttrpgProductionMediaAssets.where('buildId').equals(reserved.id!).count()
      if (existingMedia !== 0) fail('Build 提交前已出现未授权媒资计划')
      if (mediaPlan.length > 0) await db.ttrpgProductionMediaAssets.bulkAdd(mediaPlan)
      const steps = await db.ttrpgProductionSteps.where('buildId').equals(reserved.id!).toArray()
      for (const step of steps) {
        const checkpoint = checkpointForStep({ stepKey: step.stepKey, buildId: reserved.id!, preview, validation })
        if (step.stepKey === 'author-preview') {
          await db.ttrpgProductionSteps.update(step.id!, {
            status: 'pending', checkpointJson: canonicalStringify(checkpoint), outputHash: null,
            startedAt: null, completedAt: null, updatedAt: completedAt,
          })
        } else {
          await db.ttrpgProductionSteps.update(step.id!, {
            status: 'completed', checkpointJson: canonicalStringify(checkpoint),
            outputHash: await Dexie.waitFor(hashCanonicalValue(checkpoint)),
            startedAt: step.startedAt ?? startedAt, completedAt, updatedAt: completedAt,
          })
        }
      }
      await db.ttrpgProductions.update(current.id!, { status: 'preview-ready', updatedAt: completedAt })
      return (await db.ttrpgProductionBuilds.get(reserved.id!))!
    })
  } catch (error) {
    const failedAt = Date.now(); const errorJson = nowError(error)
    await db.transaction('rw', scopeTransactionTables(db.ttrpgProductions, db.ttrpgProductionBuilds, db.ttrpgProductionSteps), async () => {
      const build = await db.ttrpgProductionBuilds.get(reserved.id!)
      if (build?.status === 'building') await db.ttrpgProductionBuilds.update(build.id!, { status: 'failed', errorJson, updatedAt: failedAt })
      const steps = await db.ttrpgProductionSteps.where('buildId').equals(reserved.id!).toArray()
      for (const step of steps) await db.ttrpgProductionSteps.update(step.id!, {
        status: step.stepKey === 'integration' ? 'failed' : 'stale', errorJson: step.stepKey === 'integration' ? errorJson : null,
        completedAt: step.stepKey === 'integration' ? failedAt : null, updatedAt: failedAt,
      })
      const production = await db.ttrpgProductions.get(input.productionId)
      if (production?.currentBuildId === reserved.id) await db.ttrpgProductions.update(production.id!, { status: 'failed', updatedAt: failedAt })
    })
    throw error
  }
}

export async function acceptTtrpgAuthorPreviewV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TtrpgProductionBuildRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await scopedProduction(scope, input.productionId)
  const build = await db.ttrpgProductionBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(scope, 'ttrpgProductionBuilds', build, { owner: 'work' })
    || build.productionId !== production.id || production.currentBuildId !== build.id || build.status !== 'preview-ready') {
    fail('当前 Build 不可确认')
  }
  const acceptedAt = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.ttrpgProductions, db.ttrpgProductionBuilds, db.ttrpgProductionSteps), async () => {
    const currentBuild = await db.ttrpgProductionBuilds.get(build.id!)
    if (!currentBuild || currentBuild.status !== 'preview-ready') fail('Build 已变化')
    const step = await db.ttrpgProductionSteps.where('buildId').equals(build.id!).and(row => row.stepKey === 'author-preview' && row.status === 'pending').first()
    if (!step) fail('作者预览确认点不存在')
    const checkpoint = { buildId: build.id!, accepted: true, acceptedAt }
    await db.ttrpgProductionSteps.update(step.id!, {
      status: 'completed', checkpointJson: canonicalStringify(checkpoint), outputHash: await Dexie.waitFor(hashCanonicalValue(checkpoint)),
      startedAt: acceptedAt, completedAt: acceptedAt, updatedAt: acceptedAt,
    })
    const nextBuildStatus = build.developmentOnly ? 'validated' as const : 'release-ready' as const
    await db.ttrpgProductionBuilds.update(build.id!, { status: nextBuildStatus, updatedAt: acceptedAt })
    await db.ttrpgProductions.update(production.id!, {
      status: build.developmentOnly ? 'preview-ready' : 'release-ready', updatedAt: acceptedAt,
    })
    return (await db.ttrpgProductionBuilds.get(build.id!))!
  })
}

export async function publishTtrpgProductReleaseV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  label?: string
}): Promise<TtrpgProductReleaseRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const { production, sourceRow, catalog, selection } = await activeInputs(scope, input.productionId)
  if (production.currentBuildId !== input.buildId) fail('只能发布当前 Build')
  const [build, briefRow] = await Promise.all([
    db.ttrpgProductionBuilds.get(input.buildId),
    production.activeBriefId == null ? null : db.ttrpgProductionBriefs.get(production.activeBriefId),
  ])
  if (sourceRow.developmentOnly || build?.developmentOnly) {
    await assertTtrpgProductionSourceMayPublishV1({ catalog, selection })
  }
  if (!build || !briefRow || build.status !== 'release-ready' || build.developmentOnly) fail('Build 未达到正式发布门槛')
  if (sourceRow.sourceWorldReleaseId == null) fail('正式发布必须绑定 WorldRelease')
  await assertTtrpgProductionSourceMayPublishV1({ catalog, selection })
  const brief = parseTtrpgProductionBriefV2(parseJson(briefRow.briefJson, 'brief'))
  const rulePack = parseRulePackV1(parseJson(build.rulePackJson, 'rulePack'))
  const campaign = parseTtrpgCampaignContentV1(parseJson(build.campaignJson, 'campaign'), rulePack)
  if (await hashCanonicalValue(brief) !== briefRow.briefHash
    || await hashCanonicalValue(rulePack) !== build.rulePackHash
    || await hashCanonicalValue(campaign) !== build.campaignHash) fail('发布内容 hash 不一致')
  const mediaCoverage = await verifyTtrpgProductionMediaCoverageV1({
    scope,
    buildId: build.id!,
    expectedBuildHash: build.buildHash,
    verifyBytes: true,
  })
  if (mediaCoverage.missingRequiredSlotKeys.length > 0) {
    fail(`正式发布缺少生产期必需素材:${mediaCoverage.missingRequiredSlotKeys.join('、')}`)
  }
  const createdAt = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.ttrpgProductions, db.ttrpgSourceSelections, db.ttrpgProductionBriefs,
    db.ttrpgProductionBuilds, db.ttrpgProductionMediaAssets, db.mediaBlobObjects,
    db.ttrpgProductReleases, db.worldReleases,
  ), async () => {
    const [currentProduction, currentSource, currentBrief, currentBuild, worldRelease] = await Promise.all([
      db.ttrpgProductions.get(production.id!), db.ttrpgSourceSelections.get(sourceRow.id!),
      db.ttrpgProductionBriefs.get(briefRow.id!), db.ttrpgProductionBuilds.get(build.id!),
      db.worldReleases.get(sourceRow.sourceWorldReleaseId!),
    ])
    if (!currentProduction || currentProduction.currentBuildId !== build.id || currentSource?.selectionHash !== sourceRow.selectionHash
      || currentBrief?.briefHash !== briefRow.briefHash || currentBuild?.buildHash !== build.buildHash
      || currentBuild.status !== 'release-ready' || !worldRelease || worldRelease.contentHash !== sourceRow.sourceContentHash) {
      fail('正式发布提交前来源、Brief、Build 或 WorldRelease 发生变化')
    }
    const currentMediaRows = await db.ttrpgProductionMediaAssets.where('buildId').equals(build.id!).toArray()
    const activeAvailable = currentMediaRows
      .filter((row): row is TtrpgProductionMediaAssetRecordV1 & {
        contentHash: string; mimeType: string; blobObjectId: number
      } => row.status === 'available' && row.contentHash != null && row.mimeType != null && row.blobObjectId != null)
      .sort((left, right) => left.slotKey.localeCompare(right.slotKey) || right.version - left.version)
    const latestBySlot = new Map(activeAvailable.map(row => [row.slotKey, row]))
    const mediaStillMatches = mediaCoverage.assets.every(asset => {
      const row = latestBySlot.get(asset.slotKey)
      return row?.assetKey === asset.assetKey && row.contentHash === asset.contentHash
        && row.mimeType === asset.mimeType && row.byteSize === asset.byteSize && row.specHash === asset.specHash
    }) && latestBySlot.size === mediaCoverage.assets.length
    if (!mediaStillMatches) fail('正式发布提交前媒资版本发生变化')
    const prior = await db.ttrpgProductReleases.where('productionId').equals(production.id!).toArray()
    const version = Math.max(0, ...prior.map(row => row.version)) + 1
    const manifest: TtrpgProductReleaseManifestV1 = {
      schema: 'storyforge.ttrpg-product-release', version: 1, productType: 'ttrpg', releaseVersion: version,
      source: {
        worldReleaseId: worldRelease.id!, sourceContentHash: sourceRow.sourceContentHash,
        sourceCatalogHash: sourceRow.sourceCatalogHash, selection,
      },
      brief: { content: brief, contentHash: briefRow.briefHash },
      rulePack: { content: rulePack, contentHash: build.rulePackHash },
      campaign: { content: campaign, contentHash: build.campaignHash },
      media: { assets: mediaCoverage.assets, manifestHash: mediaCoverage.manifestHash },
      buildHash: build.buildHash,
      compatibility: { productionContract: 1, runtimeProtocol: 1, minimumPlayerVersion: 1 },
      createdAt,
    }
    const contentHash = await Dexie.waitFor(hashCanonicalValue(manifest))
    const row: TtrpgProductReleaseRecordV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id!, sourceSelectionId: sourceRow.id!, sourceWorldReleaseId: worldRelease.id!,
      briefId: briefRow.id!, buildId: build.id!, version,
      label: input.label?.trim() || `${production.title} v${version}`,
      manifestJson: canonicalStringify(manifest), contentHash, createdAt,
    }
    const id = await db.ttrpgProductReleases.add(row) as number
    await db.ttrpgProductions.update(production.id!, { status: 'released', currentProductReleaseId: id, updatedAt: createdAt })
    return { ...row, id }
  })
}

/** Mark interrupted local builds explicitly failed; callers choose whether to retry. */
export async function recoverInterruptedTtrpgProductionsV1(scopeInput: WorkspaceScope): Promise<number[]> {
  const scope = await resolveScope({ scope: scopeInput })
  const interrupted = await db.ttrpgProductionBuilds.where('workId').equals(scope.workId).and(row => row.status === 'building').toArray()
  const recovered: number[] = []
  for (const build of interrupted) {
    const errorJson = canonicalStringify({ code: 'interrupted', message: '上次构建未完成，可由作者显式重试。' })
    await db.transaction('rw', scopeTransactionTables(db.ttrpgProductions, db.ttrpgProductionBuilds, db.ttrpgProductionSteps), async () => {
      const current = await db.ttrpgProductionBuilds.get(build.id!)
      if (!current || current.status !== 'building') return
      await db.ttrpgProductionBuilds.update(current.id!, { status: 'failed', errorJson, updatedAt: Date.now() })
      const steps = await db.ttrpgProductionSteps.where('buildId').equals(current.id!).toArray()
      for (const step of steps) if (['pending', 'running'].includes(step.status)) {
        await db.ttrpgProductionSteps.update(step.id!, { status: step.status === 'running' ? 'failed' : 'stale', errorJson: step.status === 'running' ? errorJson : null, updatedAt: Date.now() })
      }
      const production = await db.ttrpgProductions.get(current.productionId)
      if (production && production.currentBuildId === current.id) {
        await db.ttrpgProductions.update(production.id!, { status: 'failed', updatedAt: Date.now() })
      }
      recovered.push(current.id!)
    })
  }
  return recovered
}

/** Zero-trust adapter from a product-owned Build to the existing simulation runtime. */
export async function resolveTtrpgProductionBuildRuntimeV1(input: {
  scope: WorkspaceScope
  buildId: number
  expectedBuildHash: string
}): Promise<{
  runtimePackage: GameRuntimePackageV2
  packageHash: string
  runtimeSourceHash: string
  sourceWorldReleaseId: number | null
}> {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.ttrpgProductionBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(scope, 'ttrpgProductionBuilds', build, { owner: 'work' })) {
    fail('Build 不存在或跨 Work')
  }
  if (!['preview-ready', 'validated', 'release-ready'].includes(build.status)) fail('Build 尚未达到可试玩状态')
  if (build.buildHash !== input.expectedBuildHash) fail('Build 指针 hash 不一致')
  const [production, sourceRow, briefRow] = await Promise.all([
    db.ttrpgProductions.get(build.productionId),
    db.ttrpgSourceSelections.get(build.sourceSelectionId),
    db.ttrpgProductionBriefs.get(build.briefId),
  ])
  if (!production || !sourceRow || !briefRow || production.workId !== scope.workId
    || sourceRow.productionId !== production.id || briefRow.productionId !== production.id
    || briefRow.sourceSelectionId !== sourceRow.id) fail('Build 的生产谱系已损坏')
  const catalog = parseTtrpgProductionSourceCatalogV1(parseJson(sourceRow.sourceCatalogJson, 'sourceCatalog'))
  const selection = parseTtrpgProductionSourceSelectionV1(parseJson(sourceRow.selectionJson, 'selection'))
  const prepared = await prepareTtrpgProductionSourceV1({ catalog, selection })
  const brief = parseTtrpgProductionBriefV2(parseJson(briefRow.briefJson, 'brief'))
  const rulePack = parseRulePackV1(parseJson(build.rulePackJson, 'rulePack'))
  const campaign = parseTtrpgCampaignContentV1(parseJson(build.campaignJson, 'campaign'), rulePack)
  const validation = validateTtrpgCampaignForPublicationV1(campaign, rulePack)
  if (!validation.valid) fail(`Build CampaignPack 已失效:${validation.errors.join('；')}`)
  const validationStored = parseJson(build.validationJson, 'validation')
  const [briefHash, rulePackHash, campaignHash] = await Promise.all([
    hashCanonicalValue(brief), hashCanonicalValue(rulePack), hashCanonicalValue(campaign),
  ])
  const recomputedBuildHash = await hashCanonicalValue({
    sourceSelectionHash: sourceRow.selectionHash,
    briefHash,
    rulePackHash,
    campaignHash,
    validation: validationStored,
    developmentOnly: build.developmentOnly,
  })
  if (briefHash !== briefRow.briefHash || rulePackHash !== build.rulePackHash
    || campaignHash !== build.campaignHash || recomputedBuildHash !== build.buildHash) fail('Build 内容 hash 校验失败')
  const runtimePackage = parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'ttrpg',
    definition: {
      gameKey: campaign.campaignKey, title: campaign.title, description: campaign.pitch,
      enabledCapabilities: ['narrative', 'ttrpg'], rulesetVersion: 1,
      initialVariables: { sessionZeroComplete: false, revealedClueKeys: [], completedQuestKeys: [] },
    },
    sourceWorld: { contentHash: sourceRow.sourceContentHash, selection: prepared.compilerSelection },
    narrative: ttrpgCampaignNarrativeV1(campaign),
    ttrpg: {
      rulePack: { content: rulePack, contentHash: build.rulePackHash },
      campaign,
      compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
    },
  })
  const packageHash = await hashCanonicalValue(runtimePackage)
  return {
    runtimePackage,
    packageHash,
    runtimeSourceHash: packageHash,
    sourceWorldReleaseId: sourceRow.sourceWorldReleaseId,
  }
}

/**
 * Product-owned runtime bootstrap for development Builds. It materializes only
 * the entities selected in the frozen product source and never reads mutable
 * world authoring tables.
 */
export async function createTtrpgProductionBuildBootstrapV1(input: {
  scope: WorkspaceScope
  buildId: number
  expectedBuildHash: string
}): Promise<{
  canonSnapshot: Record<string, unknown>
  initialState: SimulationRuntimeState
}> {
  await resolveTtrpgProductionBuildRuntimeV1(input)
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.ttrpgProductionBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(scope, 'ttrpgProductionBuilds', build, { owner: 'work' })) {
    fail('Build 不存在或跨 Work')
  }
  const sourceRow = await scopedSourceSelection(scope, build.sourceSelectionId)
  const catalog = parseTtrpgProductionSourceCatalogV1(
    parseJson(sourceRow.sourceCatalogJson, 'sourceCatalog'),
  )
  const selection = parseTtrpgProductionSourceSelectionV1(
    parseJson(sourceRow.selectionJson, 'selection'),
  )
  const prepared = await prepareTtrpgProductionSourceV1({ catalog, selection })
  const entities: SimulationRuntimeState['entities'] = {}
  for (const sourceKey of selection.locationKeys) {
    const location = catalog.locations.find(row => row.sourceKey === sourceKey)
    const portableId = prepared.sourceKeyToCompilerId[sourceKey]
    if (!location || !Number.isInteger(portableId)) fail(`冻结地点无法启动:${sourceKey}`)
    const entityKey = `release-location:${portableId}`
    entities[entityKey] = {
      entityKey, kind: 'location', sourceId: null, name: location.name,
      locationKey: entityKey, lifecycleStatus: 'active',
      attributes: { description: location.description, tags: location.tags.join('、') },
    }
  }
  for (const sourceKey of selection.artifactKeys) {
    const artifact = catalog.artifacts.find(row => row.sourceKey === sourceKey)
    const portableId = prepared.sourceKeyToCompilerId[sourceKey]
    if (!artifact || !Number.isInteger(portableId)) fail(`冻结物品无法启动:${sourceKey}`)
    const entityKey = `release-item:${portableId}`
    entities[entityKey] = {
      entityKey, kind: 'item', sourceId: null, name: artifact.name,
      locationKey: null, lifecycleStatus: 'active',
      attributes: { description: artifact.description, tags: artifact.tags.join('、') },
    }
  }
  const snapshotBody = {
    schema: 'storyforge.ttrpg-product-source-snapshot', version: 1,
    sourceKind: sourceRow.sourceKind, developmentOnly: sourceRow.developmentOnly,
    buildId: build.id!, buildHash: build.buildHash,
    sourceContentHash: sourceRow.sourceContentHash,
    sourceCatalogHash: sourceRow.sourceCatalogHash,
    selectionHash: sourceRow.selectionHash,
    entityKeys: Object.keys(entities).sort(),
  }
  return {
    canonSnapshot: {
      ...snapshotBody,
      snapshotHash: await hashCanonicalValue(snapshotBody),
    },
    initialState: {
      ...structuredClone(EMPTY_SIMULATION_STATE),
      entities,
    },
  }
}
