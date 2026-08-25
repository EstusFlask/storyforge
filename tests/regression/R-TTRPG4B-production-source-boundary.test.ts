import { describe, expect, it } from 'vitest'
import type { TtrpgDevelopmentSourceFixtureKeyV1, WorkspaceScope } from '../../src/lib/types'
import {
  assertTtrpgProductionSourceCatalogHashV1,
  assertTtrpgProductionSourceMayPublishV1,
  createTtrpgDevelopmentSourceFixtureV1,
  freezeTtrpgProductionSourceSelectionV1,
  parseTtrpgProductionSourceCatalogV1,
  selectAllTtrpgProductionSourceV1,
  validateTtrpgProductionSourceSelectionV1,
} from '../../src/lib/ttrpg/production-source'
import { compileTtrpgDevelopmentPreviewV1 } from '../../src/lib/ttrpg/production-kernel'
import { validateTtrpgCampaignForPublicationV1 } from '../../src/lib/ttrpg/campaign'

const scope: WorkspaceScope = { projectId: 1, worldId: 1, workId: 1 }
const completeFixtures: TtrpgDevelopmentSourceFixtureKeyV1[] = [
  'rank-lite-mist-harbor',
  'd20-fantasy-floodgate',
  'd100-investigation-archive',
]

describe('R-TTRPG-4B · product-owned frozen production source', () => {
  it('四套来源严格冻结，开发 fixture 不能伪装 WorldRelease 或进入正式发布', async () => {
    for (const fixtureKey of [...completeFixtures, 'incomplete-text-fallback'] as const) {
      const catalog = await createTtrpgDevelopmentSourceFixtureV1(fixtureKey)
      expect(await assertTtrpgProductionSourceCatalogHashV1(catalog)).toEqual(catalog)
      expect(catalog.identity).toMatchObject({
        sourceKind: 'development-fixture',
        developmentOnly: true,
        worldBinding: null,
      })
      const selection = await selectAllTtrpgProductionSourceV1(catalog)
      const validation = await validateTtrpgProductionSourceSelectionV1({ catalog, selection })
      expect(validation.valid).toBe(true)
      expect(validation.formalPublicationEligible).toBe(false)
      await expect(assertTtrpgProductionSourceMayPublishV1({ catalog, selection }))
        .rejects.toThrow(/开发测试来源.*不能正式发布/)
    }
    const catalog = await createTtrpgDevelopmentSourceFixtureV1('rank-lite-mist-harbor')
    expect(() => parseTtrpgProductionSourceCatalogV1({
      ...catalog,
      identity: { ...catalog.identity, developmentOnly: false },
    })).toThrow(/不能伪装 WorldRelease/)
  })

  it('Rank Lite、d20、d100 都从同一产品边界编译为不同的完整可玩 CampaignPack', async () => {
    const results = []
    for (const fixtureKey of completeFixtures) {
      const catalog = await createTtrpgDevelopmentSourceFixtureV1(fixtureKey)
      const selection = await selectAllTtrpgProductionSourceV1(catalog)
      const preview = await compileTtrpgDevelopmentPreviewV1({
        scope, catalog, selection,
        title: catalog.title,
        premise: catalog.summary,
        tone: ['角色驱动', '后果明确'],
        scale: { scope: 'short-arc', targetPlayMinutes: 180, targetEndingCount: 2 },
        contentBoundaries: ['不生成未授权的露骨内容'],
        confirmDefaultMappings: true,
        draft: {
          gmMode: 'ai',
          media: {
            visualStyle: '开发来源一致性演练',
            sceneImages: true,
            characterPortraits: true,
            characterExpressions: false,
            itemIcons: true,
            handouts: true,
            maps: true,
            tokens: true,
            generationTiming: 'hybrid',
            backgroundGeneration: true,
            textFallback: true,
            maximumGeneratedAssets: 24,
          },
        },
      })
      expect(preview.developmentOnly).toBe(true)
      expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/)
      const publicationReport = validateTtrpgCampaignForPublicationV1(preview.campaign, preview.rulePack)
      expect(publicationReport.valid, publicationReport.errors.join('；')).toBe(true)
      expect(preview.campaign.scenes.length).toBe(catalog.narrative.nodes.length)
      expect(preview.campaign.endings.length).toBeGreaterThanOrEqual(2)
      expect(preview.campaign.mediaManifest?.slots.length).toBeGreaterThan(0)
      expect(JSON.stringify(preview.brief)).toContain(`ttrpg-development-source:${catalog.identity.sourceContentHash}`)
      expect(JSON.stringify(preview.campaign)).not.toContain(`world:${catalog.identity.sourceContentHash}`)
      results.push({
        fixtureKey,
        ruleSystemId: preview.rulePack.ruleSystemId,
        sceneKeys: preview.campaign.scenes.map(scene => scene.sceneKey),
        characterNames: preview.campaign.characterTemplates.map(character => character.name),
      })
    }
    expect(new Set(results.map(result => result.ruleSystemId)).size).toBe(3)
    expect(new Set(results.map(result => JSON.stringify(result.sceneKeys))).size).toBe(3)
    expect(new Set(results.map(result => JSON.stringify(result.characterNames))).size).toBe(3)
  })

  it('不完整来源显式生成产品内容并文字降级，仍能试玩但不能冒充商业成品', async () => {
    const catalog = await createTtrpgDevelopmentSourceFixtureV1('incomplete-text-fallback')
    const selection = await selectAllTtrpgProductionSourceV1(catalog)
    const validation = await validateTtrpgProductionSourceSelectionV1({ catalog, selection })
    expect(validation).toMatchObject({
      valid: true,
      developmentOnly: true,
      formalPublicationEligible: false,
      generatedDomains: expect.arrayContaining(['characters', 'artifacts', 'storyArcs']),
      degradedDomains: ['locations'],
    })
    const preview = await compileTtrpgDevelopmentPreviewV1({
      scope, catalog, selection,
      title: '不完整来源演练', premise: '缺少世界锚点时仍完成规则闭环。', tone: ['克制'],
      scale: { scope: 'scene', targetPlayMinutes: 60, targetEndingCount: 2 },
      contentBoundaries: ['安全'], confirmDefaultMappings: true,
      draft: { media: { textFallback: true, maximumGeneratedAssets: 0 } },
    })
    expect(preview.campaign.characterTemplates.some(character => character.sourceRefs.includes('world:generated-npc'))).toBe(true)
    expect(preview.campaign.scenes.every(scene => scene.locationKey == null)).toBe(true)
    expect(preview.validation.warnings.join('；')).toMatch(/product-only|文字降级/)
  })

  it('损坏 hash、未知记录和不闭合叙事子图在生产前失败', async () => {
    const catalog = await createTtrpgDevelopmentSourceFixtureV1('d100-investigation-archive')
    const selection = await selectAllTtrpgProductionSourceV1(catalog)
    const tampered = { ...catalog, summary: `${catalog.summary}篡改` }
    await expect(assertTtrpgProductionSourceCatalogHashV1(tampered)).rejects.toThrow(/catalogHash 不匹配/)

    const unknown = await freezeTtrpgProductionSourceSelectionV1({
      ...selection,
      characterKeys: [...selection.characterKeys, 'character.not-exists'],
    })
    expect((await validateTtrpgProductionSourceSelectionV1({ catalog, selection: unknown })).errors)
      .toContain('characters 选择不存在:character.not-exists')

    const notClosed = await freezeTtrpgProductionSourceSelectionV1({
      ...selection,
      narrativeNodeKeys: ['scene.opening', 'scene.index'],
    })
    const report = await validateTtrpgProductionSourceSelectionV1({ catalog, selection: notClosed })
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toMatch(/叙事选择未闭合/)
  })
})
