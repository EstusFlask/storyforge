import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameReleaseManifestV2, verifyGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
  reviseTtrpgCampaignCharacterMappingsV1,
} from '../../src/lib/ttrpg/authoring'
import {
  compileTtrpgCampaignDraftV1,
  isTtrpgFixtureCampaignV1,
  parseTtrpgCampaignContentV1,
  validateTtrpgCampaignForPublicationV1,
} from '../../src/lib/ttrpg/campaign'
import { publishTtrpgCampaignReleaseV1, buildTtrpgRuntimePackageV1 } from '../../src/lib/ttrpg/release'
import {
  parseRulePackV1,
  resolveRulePackCheckV1,
  runRulePackFixturesV1,
  verifyRulePackCheckResolutionV2,
} from '../../src/lib/ttrpg/rule-pack'
import { mapUint32ToTtrpgDieV2, parseTtrpgDiceExpressionV2 } from '../../src/lib/ttrpg/dice'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { measureTtrpgTabletopDistanceV1 } from '../../src/lib/ttrpg/tabletop'
import type { PlayableWorldBundleV1, WorldGameSourceSelectionV2, WorldReleaseManifestV2 } from '../../src/lib/types'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const now = 1_790_000_000_000
const worldHash = 'a'.repeat(64)

function worldManifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      { _exportId: 0, name: '林舟', identity: '谨慎的调查者', location: '雾港', roleWeight: 'main' },
      { _exportId: 1, name: '守潮人', identity: '知道旧港秘密的向导', location: '雾港', roleWeight: 'npc' },
    ],
    characterRelations: [],
    importantLocations: [{ _exportId: 0, name: '雾港', description: '退潮时显露的旧港。' }],
    storyArcs: [], itemLedger: [], codexEntries: [], avgMediaAssets: [],
    narrativeModules: [], narrativeNodes: [],
  }
  return {
    schema: 'storyforge.world-package', version: 2,
    worldCode: 'mist-harbor', worldName: '潮汐界', workTitle: '雾港纪事',
    selectedTables: Object.keys(records), selectedNarrativeModules: [],
    dependencies: [], records, portableProject: {},
  }
}

function playableFixture(confirm = false): { bundle: PlayableWorldBundleV1; campaign: ReturnType<typeof compileTtrpgCampaignDraftV1> } {
  const bundle: PlayableWorldBundleV1 = {
    schema: 'storyforge.playable-world-bundle', version: 1, compilerVersion: 1,
    source: { worldCode: 'mist-harbor', worldName: '潮汐界', worldContentHash: worldHash },
    createdAt: now,
    canonSnapshot: {
      schema: 'storyforge.simulation-canon', version: 1, createdAt: now,
      worldGroupId: null, worldLabel: '潮汐界',
      sources: [{ sourceKey: 'release-world:mist-harbor', kind: 'world', recordId: null, name: '潮汐界', summary: '群岛世界', fields: {}, updatedAt: now, contentHash: 'c'.repeat(64) }],
      snapshotHash: 'd'.repeat(64),
    },
    initialState: {
      version: 1, clock: 0,
      entities: {
        'release-character:0': { entityKey: 'release-character:0', kind: 'character', name: '林舟', locationKey: 'release-location:0', lifecycleStatus: 'active', attributes: { identity: '调查者' } },
        'release-character:1': { entityKey: 'release-character:1', kind: 'character', name: '守潮人', locationKey: 'release-location:0', lifecycleStatus: 'active', attributes: { identity: '向导' } },
        'release-location:0': { entityKey: 'release-location:0', kind: 'location', name: '雾港', locationKey: 'release-location:0', lifecycleStatus: 'active', attributes: {} },
      },
      memories: [], narratives: [], ttrpg: null, chat: null, interaction: null,
      narrative: null, adventure: null, presentation: null, narrativeSimulation: null, openWorld: null,
      lastSequence: 0,
    },
    diagnostics: [], bundleHash: 'b'.repeat(64),
  }
  return { bundle, campaign: compileTtrpgCampaignDraftV1({ playableWorld: bundle, rulePack: createStoryForgeRulePackV1(), fixtureOnly: true, confirmDefaultMappings: confirm }) }
}

describe('TTRPG-2A · RulePack / CampaignPack / formal GameRelease', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('第一方 RulePack 通过闭集 parser 与 fixture，拒绝未知脚本字段', () => {
    const pack = createStoryForgeRulePackV1()
    expect(parseRulePackV1(pack).ruleSystemId).toBe('storyforge.narrative')
    expect(() => runRulePackFixturesV1(pack)).not.toThrow()
    expect(() => parseRulePackV1({ ...pack, script: 'fetch("https://example.com")' })).toThrow('字段不精确')
    expect(() => parseRulePackV1({
      ...pack,
      derivedStats: [{ ...pack.derivedStats[0], formula: { op: 'eval', source: 'globalThis' } }],
    })).toThrow('枚举无效')
  })

  it('所有跑团骰式硬限制 d2～d100，d100 合法而 d101 在共享 parser 与 RulePack 导入时拒绝', () => {
    expect(parseTtrpgDiceExpressionV2(' 1D100 + 3 ')).toMatchObject({
      count: 1, sides: 100, modifier: 3, normalized: '1d100+3',
    })
    expect(() => parseTtrpgDiceExpressionV2('1d101')).toThrow('d2～d100')
    const d100Pack = structuredClone(createStoryForgeRulePackV1())
    d100Pack.diceModels[0].sides = 100
    expect(parseRulePackV1(d100Pack).diceModels[0].sides).toBe(100)
    d100Pack.diceModels[0].sides = 101
    expect(() => parseRulePackV1(d100Pack)).toThrow('d2～d100')
  })

  it('uint32 到骰面的映射使用拒绝采样边界而不是直接取模', () => {
    expect(mapUint32ToTtrpgDieV2(0, 100)).toBe(1)
    expect(mapUint32ToTtrpgDieV2(4_294_967_199, 100)).toBe(100)
    expect(mapUint32ToTtrpgDieV2(0xffff_ffff, 100)).toBeNull()
  })

  it('相同 seed/nonce 的规则检定完全幂等，不同 nonce 产生不同证明', async () => {
    const rulePack = createStoryForgeRulePackV1()
    const input = { rulePack, checkKey: 'standard', attributeKey: 'mind', attributes: { body: 1, mind: 2, presence: 0 }, seed: 'campaign-seed', nonce: 'turn-1', difficulty: 8 }
    const first = await resolveRulePackCheckV1(input)
    const replay = await resolveRulePackCheckV1(input)
    const next = await resolveRulePackCheckV1({ ...input, nonce: 'turn-2' })
    expect(replay).toEqual(first)
    expect(next.proofHash).not.toBe(first.proofHash)
    expect(first.total).toBe(first.keptDice.reduce((sum, die) => sum + die, 0) + 2)
    expect(first.rollTrace).toMatchObject({
      algorithm: 'uint32-rejection-v2', requestedDice: 2, sides: 6,
    })
    expect(first.rollTrace.consumedSamples).toBe(first.rollTrace.requestedDice + first.rollTrace.rejectedSamples)
    expect(first.seedCommitment).toMatch(/^[0-9a-f]{64}$/)
    await expect(verifyRulePackCheckResolutionV2({ ...input, resolution: first })).resolves.toBe(true)
    await expect(verifyRulePackCheckResolutionV2({
      ...input,
      resolution: { ...first, total: first.total + 1 },
    })).resolves.toBe(false)
  })

  it('未确认的角色默认映射阻止发布；明确确认后线索冗余、角色卡与安全工具全部通过', () => {
    const rulePack = createStoryForgeRulePackV1()
    const draft = playableFixture(false).campaign
    const blocked = validateTtrpgCampaignForPublicationV1(draft, rulePack)
    expect(blocked.valid).toBe(false)
    expect(blocked.unconfirmedAttributeMappings.length).toBeGreaterThan(0)
    const confirmed = playableFixture(true).campaign
    const report = validateTtrpgCampaignForPublicationV1(confirmed, rulePack)
    expect(report.valid).toBe(true)
    expect(confirmed.clues.every(clue => !clue.required || clue.discoveryPaths.length >= 2)).toBe(true)
    expect(confirmed.sessionZero.consentChecklist.length).toBeGreaterThan(0)
    expect(confirmed.endings).toHaveLength(2)
    expect(confirmed.tabletop?.maps).toHaveLength(confirmed.scenes.length)
    const openingMap = confirmed.tabletop!.maps[0]
    expect(measureTtrpgTabletopDistanceV1({
      map: openingMap, from: openingMap.tokens[0], to: openingMap.tokens[1],
    })).toEqual({ cells: 2, distance: 4, unit: '米', rule: 'square-chebyshev' })
    const invalidFog = structuredClone(confirmed)
    invalidFog.tabletop!.maps[0].fog[0].x = 99
    expect(validateTtrpgCampaignForPublicationV1(invalidFog, rulePack).errors[0]).toContain('超出地图边界')
    const npc = confirmed.characterTemplates.find(character => character.role === 'npc')
    expect(npc?.gmProfile).toMatchObject({ objective: expect.any(String), secret: expect.any(String) })
    const legacy = structuredClone(confirmed)
    for (const character of legacy.characterTemplates) delete character.gmProfile
    delete legacy.tabletop
    for (const scene of legacy.scenes) delete scene.tabletopMapKey
    expect(validateTtrpgCampaignForPublicationV1(legacy, rulePack).valid).toBe(true)
  })

  it('TTRPG RuntimePackage 与 GameRelease v2 冻结 RulePack hash，篡改规则零信任拒绝', async () => {
    const rulePack = createStoryForgeRulePackV1()
    const campaign = playableFixture(true).campaign
    const rulePackContentHash = await hashGameProductionValueV2(rulePack)
    const runtimePackage = await buildTtrpgRuntimePackageV1({
      worldReleaseManifest: worldManifest(), worldContentHash: worldHash,
      rulePack, rulePackContentHash, campaign,
    })
    const manifest = await createGameReleaseManifestV2({ runtimePackage, productionProvenance: null })
    await expect(verifyGameReleaseManifestV2(manifest)).resolves.toMatchObject({ productType: 'ttrpg' })
    const tamperedPackage = structuredClone(runtimePackage)
    tamperedPackage.ttrpg!.rulePack.content.title = '被篡改规则'
    const tamperedManifest = await createGameReleaseManifestV2({ runtimePackage: tamperedPackage, productionProvenance: null })
    await expect(verifyGameReleaseManifestV2(tamperedManifest)).rejects.toThrow('RulePack contentHash')
  })

  it('Brief 的角色子集约束实际 Campaign，越出 WorldRelease 的便携 ID 被拒绝', async () => {
    const { bundle } = playableFixture(true)
    const selection: WorldGameSourceSelectionV2 = {
      schema: 'storyforge.world-game-source', version: 2, productType: 'ttrpg', worldContentHash: worldHash,
      narrativeModuleExportIds: [], characterExportIds: [0], characterRelationExportIds: [],
      importantLocationExportIds: [0], artifactExportIds: [], codexEntryExportIds: [], storyArcExportIds: [],
      avgMediaAssetExportIds: [],
      productSource: {
        kind: 'ttrpg', participantCharacterExportIds: [0], locationExportIds: [0], questStoryArcExportIds: [],
      },
    }
    const rulePack = createStoryForgeRulePackV1()
    const campaign = compileTtrpgCampaignDraftV1({
      playableWorld: bundle, rulePack, fixtureOnly: true, selection, confirmDefaultMappings: true,
    })
    expect(isTtrpgFixtureCampaignV1(campaign)).toBe(true)
    expect(isTtrpgFixtureCampaignV1({
      ...campaign, tags: campaign.tags.filter(tag => tag !== 'fixture-only'),
    })).toBe(true)
    expect(campaign.characterTemplates.map(character => character.characterKey)).toEqual(['release-character:0'])
    expect(campaign.scenes.every(scene => scene.participantKeys.every(key => key === 'release-character:0'))).toBe(true)
    const rulePackContentHash = await hashGameProductionValueV2(rulePack)
    await expect(buildTtrpgRuntimePackageV1({
      worldReleaseManifest: worldManifest(), worldContentHash: worldHash,
      selection, rulePack, rulePackContentHash, campaign,
    })).resolves.toMatchObject({
      sourceWorld: { selection: { characterExportIds: [0] } },
      ttrpg: { campaign: { characterTemplates: [expect.objectContaining({ characterKey: 'release-character:0' })] } },
    })
    const forged = structuredClone(selection)
    forged.characterExportIds = [999]
    forged.productSource = { ...forged.productSource!, participantCharacterExportIds: [999] }
    await expect(buildTtrpgRuntimePackageV1({
      worldReleaseManifest: worldManifest(), worldContentHash: worldHash,
      selection: forged, rulePack, rulePackContentHash, campaign,
    })).rejects.toThrow(/不属于冻结 WorldRelease/)
  })

  it('WorldRelease → 规则包 → CampaignPack → GameRelease → 正式 TTRPG Session 全链可走通', async () => {
    const projectId = await db.projects.add({ name: 'TTRPG 产品验收', genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '', targetWordCount: 100_000, createdAt: now, updatedAt: now } as any) as number
    const ownership = await ensureWorkspaceOwnership(projectId)
    const scope = ownership.scope
    const manifest = worldManifest()
    const contentHash = await hashGameProductionValueV2(manifest)
    const releaseId = await db.worldReleases.add({
      projectId, worldId: scope.worldId, revisionId: 1, version: 1, label: '潮汐界 v1',
      manifestJson: JSON.stringify(manifest), contentHash, sourceWorldCode: 'mist-harbor', createdAt: now,
    }) as number
    const rule = await installStoryForgeRulePackV1(scope)
    await expect(compileWorldReleaseToTtrpgCampaignDraftV1({
      scope, worldReleaseId: releaseId, rulePackId: rule.id, confirmDefaultMappings: false,
    })).rejects.toThrow('固定四场景编译器已退出正式产品')
    const draft = await compileWorldReleaseToTtrpgCampaignDraftV1({
      scope, worldReleaseId: releaseId, rulePackId: rule.id, fixtureOnly: true, confirmDefaultMappings: false,
    })
    expect(draft.status).toBe('draft')
    const draftContent = parseTtrpgCampaignContentV1(draft.contentJson, createStoryForgeRulePackV1())
    const campaign = await reviseTtrpgCampaignCharacterMappingsV1({
      scope, campaignModuleId: draft.id!, expectedContentHash: draft.contentHash,
      characters: draftContent.characterTemplates.map((character, index) => ({
        characterKey: character.characterKey,
        attributes: { ...character.attributes, ...(index === 0 ? { body: 2 } : {}) },
      })),
    })
    expect(campaign.status).toBe('validated')
    const revisedContent = parseTtrpgCampaignContentV1(campaign.contentJson, createStoryForgeRulePackV1())
    expect(revisedContent.characterTemplates[0]).toMatchObject({
      attributes: { body: 2 }, attributeMappings: { body: { value: 2, authorConfirmed: true } },
    })
    await expect(reviseTtrpgCampaignCharacterMappingsV1({
      scope, campaignModuleId: draft.id!, expectedContentHash: draft.contentHash,
      characters: draftContent.characterTemplates.map(character => ({
        characterKey: character.characterKey, attributes: character.attributes,
      })),
    })).rejects.toThrow('已变化')
    await expect(publishTtrpgCampaignReleaseV1({
      scope, campaignModuleId: campaign.id!,
    })).rejects.toThrow('固定战役 fixture 不得进入正式 GameRelease')
    const release = await publishTtrpgCampaignReleaseV1({ scope, campaignModuleId: campaign.id!, testOnlyAllowFixtureCampaign: true })
    const replay = await publishTtrpgCampaignReleaseV1({ scope, campaignModuleId: campaign.id!, testOnlyAllowFixtureCampaign: true })
    expect(replay.id).toBe(release.id)
    const session = await createWorldInstance({
      scope, kind: 'ttrpg', title: '雾港调查战役', worldGroupId: null,
      gameSource: { kind: 'release', gameReleaseId: release.id! }, seed: 'formal-campaign',
    })
    const state = await readSimulationState(session.id!)
    expect(session.gameReleaseId).toBe(release.id)
    expect(session.runtimeSourceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(state.ttrpg?.campaign?.summary).toContain('调查冒险')
    expect(state.entities['release-character:0'].kind).toBe('player')
    expect(state.entities['release-character:0'].attributes).toMatchObject({ body: 2, mind: 1, presence: 1, maxHp: 10, armorClass: 9 })
  })
})
