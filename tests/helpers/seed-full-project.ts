/**
 * 全量项目种子 · 测试共享 helper
 *
 * 覆盖全部 exportable 表 + 双世界组 + 树 + 各类外键。
 * 供 R-export-fullcoverage(往返安全网)与 R-export-derive-equivalence(派生等价性)共用。
 */
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { replayAgentRunEventsV1, toAgentRunProjectionBodyV1 } from '../../src/lib/agent/run/projection'
import { createNarrativeSimulationAcceptanceContent } from '../../src/lib/narrative-simulation/authoring'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  confirmComicVisualBible,
  createAdaptation,
  listActiveSourceUnits,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../src/lib/adaptation/source-manifest'
import { createScreenplayScene } from '../../src/lib/screenplay/service'
import { createComicPage, saveComicVisualSubject } from '../../src/lib/comic/service'
import { commitUploadedComicAssetV1 } from '../../src/lib/comic/media-service'
import type {
  AdaptationBriefV1,
  AdaptationPlanV1,
  AnyAgentRunEventV1,
  ComicTargetSpecV1,
  ScreenplayTargetSpecV1,
  WorkspaceScope,
} from '../../src/lib/types'

const now = 1_700_000_000_000 // 固定时间戳,保证派生/手写两版导出可逐字段比对

const adaptationBrief: AdaptationBriefV1 = {
  version: 1,
  coreTheme: '选择与代价',
  dominantEmotion: '克制',
  mustKeep: ['青云山门的抉择'],
  mayCut: [],
  mayMerge: [],
  mayReorder: [],
  allowedAdditions: [],
  audience: '大众',
  rating: 'PG-13',
  targetScale: '全表往返夹具',
  narrativePerspective: '林惊羽',
  timeBudget: '',
  costLimit: '',
  deviationNotes: '',
  unresolvedQuestions: [],
  assumptions: [],
}

const screenplayTargetSpec: ScreenplayTargetSpecV1 = {
  format: 'film',
  language: 'zh-CN',
  episodeCount: null,
  targetMinutesPerEpisode: 90,
  rating: 'PG-13',
  dialogueDensity: 'balanced',
  productionScale: 'standard',
  preserveVoiceOver: false,
  titlePage: {
    creditLine: '小说改编',
    authorDisplayName: '全量夹具',
    contactText: '',
    copyrightNotice: '测试用途',
    draftLabel: '第一稿',
  },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const comicTargetSpec: ComicTargetSpecV1 = {
  format: 'page-comic',
  audience: '大众',
  readingDirection: 'ltr',
  chapterCount: 1,
  targetPagesPerChapter: 20,
  pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 30 },
  colorMode: 'color',
  artStyleBrief: '清晰线稿与克制配色',
  renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: {
    referenceImage: false,
    deterministicSeed: false,
    inpainting: false,
    commercialUseRequired: false,
    minimumWidth: 1024,
    minimumHeight: 1024,
  },
}

function fixturePng(width = 1200, height = 1700): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

async function seedAdaptationProducts(sourceScope: WorkspaceScope) {
  const screenplay = await createAdaptation({
    sourceScope,
    sourceWorkId: sourceScope.workId,
    title: '青云山门 · 剧本',
    sourceSelection: { mode: 'entire-work' },
    medium: 'screenplay',
    targetSpec: screenplayTargetSpec,
  })
  const screenplayUnit = (await listActiveSourceUnits(screenplay.adaptation.id!))
    .find(unit => unit.sourceKind === 'chapter')
  if (!screenplayUnit?.id) throw new Error('全量夹具缺少剧本来源章节单元')
  const screenplayPlan: AdaptationPlanV1 = {
    version: 1,
    premise: '林惊羽必须决定复仇还是守护。',
    sections: [{
      stableKey: 'act-1',
      title: '第一幕',
      summary: '踏入山门并遭遇抉择。',
      order: 0,
      episodeNumber: 1,
      sourceUnitKeys: [screenplayUnit.sourceUnitKey],
    }],
    globalAssumptions: [],
  }
  let screenplayRoot = await saveAdaptationBriefDraft({ adaptationProjectId: screenplay.adaptation.id!, brief: adaptationBrief, expectedRevision: screenplay.adaptation.revision })
  screenplayRoot = await confirmAdaptationBrief({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await saveAdaptationPlanDraft({ adaptationProjectId: screenplayRoot.id!, plan: screenplayPlan, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await confirmAdaptationPlan({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await startAdaptationProduction({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  const screenplayScene = await createScreenplayScene(screenplay.scope, {
    stableKey: 'scene-1',
    planSectionKey: 'act-1',
    episodeNumber: 1,
    sceneNumber: 1,
    intExt: 'EXT',
    location: '青云山门',
    timeOfDay: '晨',
    summary: '林惊羽踏入山门。',
    estimatedSeconds: 45,
    sourceUnitIds: [screenplayUnit.id],
    blocks: [{ id: 'action-1', type: 'action', text: '云海散开，青云山门出现在林惊羽面前。' }],
  })

  const comic = await createAdaptation({
    sourceScope,
    sourceWorkId: sourceScope.workId,
    title: '青云山门 · 漫画',
    sourceSelection: { mode: 'entire-work' },
    medium: 'comic',
    targetSpec: comicTargetSpec,
  })
  const comicUnit = (await listActiveSourceUnits(comic.adaptation.id!))
    .find(unit => unit.sourceKind === 'chapter')
  if (!comicUnit?.id) throw new Error('全量夹具缺少漫画来源章节单元')
  const comicPlan: AdaptationPlanV1 = {
    version: 1,
    premise: '用一页建立山门与人物的力量关系。',
    sections: [{
      stableKey: 'comic-chapter-1',
      title: '山门',
      summary: '主人公第一次看见青云山。',
      order: 0,
      episodeNumber: 1,
      sourceUnitKeys: [comicUnit.sourceUnitKey],
    }],
    globalAssumptions: [],
  }
  let comicRoot = await saveAdaptationBriefDraft({ adaptationProjectId: comic.adaptation.id!, brief: adaptationBrief, expectedRevision: comic.adaptation.revision })
  comicRoot = await confirmAdaptationBrief({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  comicRoot = await saveAdaptationPlanDraft({ adaptationProjectId: comicRoot.id!, plan: comicPlan, expectedRevision: comicRoot.revision })
  comicRoot = await confirmAdaptationPlan({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  comicRoot = await confirmComicVisualBible({
    adaptationProjectId: comicRoot.id!,
    expectedRevision: comicRoot.revision,
    visualBible: {
      version: 1,
      artDirection: '东方奇幻页漫',
      linework: '清晰有重量的墨线',
      palette: ['青灰', '金色'],
      lighting: '晨雾逆光',
      periodAndMaterials: '古典山门与石阶',
      cameraLanguage: ['先建立镜头，再切人物近景'],
      prohibitedDepictions: ['成图不含文字与水印'],
    },
  })
  comicRoot = await startAdaptationProduction({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  const styleSubject = await saveComicVisualSubject({
    scope: comic.scope,
    draft: {
      stableKey: 'fixture-style',
      kind: 'style',
      characterId: null,
      locationRefKey: null,
      label: '青云视觉风格',
      design: {
        description: '晨雾中的东方奇幻山门',
        silhouette: '层叠山峰与高耸牌楼',
        facialFeatures: '',
        hairAndCostume: '',
        palette: ['青灰', '金色'],
        materials: ['青石', '木构'],
        distinguishingMarks: ['云海金边'],
        prohibitedChanges: ['不得改成现代建筑'],
      },
      sourceUnitIds: [comicUnit.id],
      status: 'reviewed',
    },
  })
  const comicPage = await createComicPage(comic.scope, {
    stableKey: 'page-1',
    chapterNumber: 1,
    summary: '林惊羽踏入青云山门。',
    panels: [{
      stableKey: 'page-1-panel-1',
      frame: { x: 0, y: 0, width: 1, height: 1 },
      shot: { size: 'wide', angle: 'low', movement: 'static', composition: '人物位于山门前景下方' },
      action: '林惊羽仰望云海中的青云山门。',
      visualPrompt: 'eastern fantasy mountain gate in morning mist, no text',
      negativePrompt: 'letters, watermark, logo',
      continuityRefs: [{ subjectKey: styleSubject.stableKey, note: '保持青灰与金色主调' }],
      lettering: [{
        id: 'caption-1',
        kind: 'caption',
        text: '青云山。',
        frame: { x: 0.05, y: 0.05, width: 0.3, height: 0.12 },
        direction: 'horizontal',
        fontFamily: 'storyforge-serif',
        fontSize: 28,
        textColor: '#111111',
        fillColor: '#ffffff',
        strokeColor: '#111111',
        strokeWidth: 2,
        tail: null,
        zIndex: 1,
      }],
      sourceUnitIds: [comicUnit.id],
    }],
  })
  const comicMedia = await commitUploadedComicAssetV1({
    scope: comic.scope,
    data: fixturePng(),
    panelId: comicPage.panels[0].id!,
    rights: {
      version: 1,
      source: 'author-upload',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      attribution: 'StoryForge 全量夹具',
      declaration: '测试夹具确认拥有该测试图片的完整使用权。',
      declaredAt: Date.now(),
    },
  })
  return { screenplay, screenplayRoot, screenplayScene, comic, comicRoot, comicPage, comicMedia }
}

/** 种子:每张 exportable 表至少一行,带双世界组 + 树 + 各类外键。返回各源 id 便于断言。 */
export async function seedFullProject() {
  const projectId = await db.projects.add({
    name: '全量作品', genre: 'fantasy', genres: ['fantasy'], description: '全表往返',
    targetWordCount: 100000, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number

  // ── WORLD-2C C1 显式世界/作品根 ──
  const worldId = await db.worlds.add({
    projectId,
    code: 'world-full-fixture',
    name: '全量世界',
    description: '全表往返世界根',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    code: 'work-full-fixture',
    title: '全量作品',
    description: '全表往返作品根',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100000,
    kind: 'novel',
    novelProfile: 'long',
    createdAt: now,
    updatedAt: now,
  }) as number

  // ── 双世界组(order 决定导出序) ──
  const wgA = await db.worldGroups.add({ projectId, name: '主世界群', order: 0, createdAt: now, updatedAt: now } as any) as number
  const wgB = await db.worldGroups.add({ projectId, name: '镜世界群', order: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldGroupLinks.add({ projectId, fromGroupId: wgA, toGroupId: wgB, type: 'portal', createdAt: now, updatedAt: now } as any)

  // ── worldScoped 设定表(挂 wgA / wgB,验证 worldGroupId 重映射) ──
  await db.worldviews.add({ projectId, worldGroupId: wgA, worldOrigin: '混沌创世', powerHierarchy: '炼气→金丹', createdAt: now, updatedAt: now } as any)
  await db.worldviews.add({ projectId, worldGroupId: wgB, worldOrigin: '镜中倒影', createdAt: now, updatedAt: now } as any)
  await db.storyCores.add({ projectId, logline: '少年逆袭', mainPlot: '从山村到仙界', createdAt: now, updatedAt: now } as any)
  await db.powerSystems.add({ projectId, worldGroupId: wgA, name: '修真体系', description: '九重天', createdAt: now, updatedAt: now } as any)
  await db.geographies.add({ projectId, worldGroupId: wgA, overview: '三大洲', createdAt: now, updatedAt: now } as any)
  await db.histories.add({ projectId, worldGroupId: wgA, summary: '上古神战', createdAt: now, updatedAt: now } as any)
  await db.historicalTimelineEvents.add({ projectId, worldGroupId: wgA, title: '封神之战', year: -1000, createdAt: now, updatedAt: now } as any)
  await db.historicalKeywords.add({ projectId, worldGroupId: wgA, keyword: '神器', createdAt: now, updatedAt: now } as any)
  await db.worldRulesProfiles.add({ projectId, worldGroupId: wgA, rules: '魔法守恒', createdAt: now, updatedAt: now } as any)
  const cultivationSystem = await db.cultivationSystems.add({
    projectId, worldGroupId: wgA, name: '青云剑修', description: '以灵气淬剑',
    stages: JSON.stringify([
      { id: 'qi', name: '炼气', parentStageIds: [] },
      { id: 'foundation', name: '筑基', parentStageIds: ['qi'], breakthrough: '筑成道基' },
    ]),
    createdAt: now, updatedAt: now,
  }) as number

  // ── worldNodes(树 + portalsJSON 自引用,wgA) ──
  const rootWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: null, name: '主世界', description: '起点', sortOrder: 0, createdAt: now, updatedAt: now } as any) as number
  const mirrorWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: rootWorld, name: '镜界', description: '镜中', sortOrder: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldNodes.update(rootWorld, { portalsJSON: JSON.stringify([{ name: '镜门', targetWorldId: mirrorWorld, x: 1, y: 2 }]) })

  // ── importantLocations(树) ──
  const locParent = await db.importantLocations.add({ projectId, parentId: null, name: '青云山', type: 'mountain', createdAt: now, updatedAt: now } as any) as number
  await db.importantLocations.add({ projectId, parentId: locParent, name: '青云峰', type: 'peak', createdAt: now, updatedAt: now } as any)

  // ── 角色(homeWorldScoped:一个挂 wgA,一个跨世界) ──
  const char1 = await db.characters.add({
    projectId, homeWorldGroupId: wgA, name: '林惊羽', role: 'protagonist', personality: '坚毅',
    cultivationSystemId: cultivationSystem, cultivationStageId: 'qi',
    createdAt: now, updatedAt: now,
  } as any) as number
  const char2 = await db.characters.add({ projectId, isCrossWorld: true, name: '苏长歌', role: 'supporting', createdAt: now, updatedAt: now } as any) as number
  await db.characterRelations.add({ projectId, fromCharacterId: char1, toCharacterId: char2, type: 'ally', description: '同门', createdAt: now, updatedAt: now } as any)
  await db.workCharacterBindings.add({
    projectId,
    workId,
    characterId: char1,
    role: 'protagonist',
    arc: '从复仇者到守护者',
    createdAt: now,
    updatedAt: now,
  })
  const characterDrivenPlan = await db.characterDrivenPlans.add({
    projectId,
    name: '林惊羽角色驱动方案',
    arcs: JSON.stringify([{
      characterId: char1,
      name: '林惊羽',
      role: '主角',
      initialState: '孤身复仇',
      targetState: '守护同门',
    }]),
    userHint: '服务复仇主线',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.works.update(workId, { activeCharacterDrivenPlanId: characterDrivenPlan })
  await db.projects.update(projectId, {
    activeCharacterDrivenPlanId: characterDrivenPlan,
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
    worldCode: 'world-full-fixture',
    worldVersion: 1,
  })

  // ── 大纲(树,wgA)+ 章节 + 细纲 + 情感卡 ──
  const vol = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: null, type: 'volume', title: '第一卷', summary: '开篇', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapNode = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: vol, type: 'chapter', title: '第1章', summary: '觉醒', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapter = await db.chapters.add({ projectId, outlineNodeId: chapNode, title: '第1章', content: '<p>废墟中睁眼</p>', wordCount: 6, status: 'draft', order: 0, createdAt: now, updatedAt: now } as any) as number
  await db.detailedOutlines.add({ projectId, outlineNodeId: chapNode, openingHook: '承接', endingCliffhanger: '黑影', appearingCharacterIds: [char1], scenes: [{ sceneId: 's1', title: '苏醒', summary: '醒来', characterIds: [char1], location: '废墟', conflict: '失忆' }], createdAt: now, updatedAt: now } as any)

  // ── WORLD-2D/2E 可执行叙事与不可变发布 ──
  const narrativeModule = await db.narrativeModules.add({
    projectId,
    kind: 'main',
    title: '青云主线',
    description: '从山门启程',
    status: 'ready',
    sourceProjection: 'outline',
    sourceRefId: chapNode,
    entryNodeKey: 'entry',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.narrativeNodes.add({
    projectId,
    moduleId: narrativeModule,
    key: 'entry',
    kind: 'entry',
    title: '踏入山门',
    summary: '从主线入口开始',
    conditionJson: '{}',
    effectsJson: '[]',
    successorKeysJson: '[]',
    sourceOutlineNodeId: chapNode,
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.narrativeNodes.add({
    projectId, moduleId: narrativeModule, key: 'ending', kind: 'ending',
    title: '抵达青云峰', summary: '全表往返结局', conditionJson: '{}', effectsJson: '[]',
    successorKeysJson: '[]', sourceOutlineNodeId: chapNode, order: 1, createdAt: now, updatedAt: now,
  })
  await db.narrativeBeats.add({
    projectId, moduleId: narrativeModule, nodeKey: 'entry', beatKey: 'arrival', kind: 'narration',
    speakerCharacterId: null, text: '林惊羽踏入青云山门。', order: 0, createdAt: now, updatedAt: now,
  })
  await db.narrativeChoices.add({
    projectId, moduleId: narrativeModule, sourceNodeKey: 'entry', choiceKey: 'climb',
    text: '登上青云峰', description: '', unavailableReason: '', targetNodeKey: 'ending',
    displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]',
    order: 0, createdAt: now, updatedAt: now,
  })
  await db.works.update(workId, { activeNarrativeModuleId: narrativeModule })
  const releaseManifest = JSON.stringify({
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: 'world-full-fixture',
    worldName: '全量世界',
    workTitle: '全量作品',
    selectedTables: ['narrativeModules', 'narrativeNodes'],
    selectedNarrativeModules: [{ exportId: 0, kind: 'main', title: '青云主线' }],
    dependencies: [],
    records: {},
    portableProject: {},
  })
  const worldRevision = await db.worldRevisions.add({
    projectId,
    worldId,
    parentRevisionId: null,
    revision: 1,
    label: '初始修订',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldRelease = await db.worldReleases.add({
    projectId,
    worldId,
    revisionId: worldRevision,
    version: 1,
    label: '世界 v1',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    sourceWorldCode: 'world-full-fixture',
    createdAt: now,
  } as any) as number
  const gameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-story', productType: 'storygame',
    title: '青云山门', description: '全表往返游戏定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const interactionCharacterProfile = await db.interactionCharacterProfiles.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition, characterId: char1,
    participantKey: 'lin-jingyu', roleLabel: '同行守门人', voiceRules: '克制、直接，不泄露未获知的秘密。',
    initialKnowledgeJson: JSON.stringify([
      { key: 'mountain.gate', content: '青云山门将在日落时关闭。', visibility: 'public', importance: 2 },
      { key: 'hidden.oath', content: '林惊羽曾在镜界立下秘密誓言。', visibility: 'private', importance: 5 },
    ]),
    relationshipDimensionsJson: JSON.stringify([
      { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 1, largeChangeThreshold: 3 },
    ]),
    maxMemoryEntries: 24, createdAt: now, updatedAt: now,
  }) as number
  const interactionSceneTemplate = await db.interactionSceneTemplates.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition,
    sceneKey: 'mountain-gate-reunion', title: '山门重逢', purpose: '确认双方是否仍愿意同行。',
    location: '青云山门', timeLabel: '日落前', participantKeysJson: '["lin-jingyu"]',
    publicKnowledgeKeysJson: '["mountain.gate"]', goalsJson: '["完成重逢"]',
    endingConditionsJson: '["承诺同行或明确拒绝"]', safetyBoundariesJson: '["不替玩家决定情感"]',
    openingNodeKey: 'entry', endingNodeKey: 'ending', maxTurns: 20, directorBudget: 1,
    order: 0, createdAt: now, updatedAt: now,
  }) as number
  const gameRelease = await db.gameReleases.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition, worldReleaseId: worldRelease,
    version: 1, label: '青云山门 v1',
    manifestJson: JSON.stringify({ schema: 'storyforge.game-release', version: 1 }),
    contentHash: 'fixture-game-release-hash', createdAt: now,
  }) as number
  const adventureGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-adventure', productType: 'adventure',
    title: '青云山门 · 冒险版', description: '全表往返文字冒险定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative","adventure"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.adventureModules.add({
    projectId, worldId, workId, gameDefinitionId: adventureGameDefinition,
    contentJson: JSON.stringify({
      version: 1, initialLocationKey: 'gate', playerKey: 'player',
      locations: [{ key: 'gate', title: '青云山门', description: '山门前云雾缭绕。', tags: [] }],
      objects: [], items: [], abilities: [], conditions: [], resources: [], quests: [], actions: [], initialInventory: [],
    }),
    createdAt: now, updatedAt: now,
  })
  const avgGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-avg', productType: 'avg',
    title: '青云山门 · 演出版', description: '全表往返 AVG 定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative","presentation"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.avgPresentationModules.add({
    projectId, worldId, workId, gameDefinitionId: avgGameDefinition,
    contentJson: JSON.stringify({ version: 1, cues: [] }), createdAt: now, updatedAt: now,
  })
  const narrativeSimulationDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-narrative-simulation',
    productType: 'narrative-simulation', title: '青云山门 · 治理模拟',
    description: '全表往返叙事模拟定义', status: 'draft', narrativeModuleId: narrativeModule,
    enabledCapabilitiesJson: '["narrative","simulation"]', initialVariablesJson: '{}',
    rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.narrativeSimulationModules.add({
    projectId, worldId, workId, gameDefinitionId: narrativeSimulationDefinition,
    contentJson: JSON.stringify(createNarrativeSimulationAcceptanceContent()), createdAt: now, updatedAt: now,
  })
  const openWorldGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-open-world', productType: 'text-open-world',
    title: '青云山门 · 开放世界', description: '全表往返开放世界定义', status: 'draft',
    narrativeModuleId: narrativeModule,
    enabledCapabilitiesJson: '["narrative","interaction","adventure","simulation","open-world"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.openWorldModules.add({
    projectId, worldId, workId, gameDefinitionId: openWorldGameDefinition,
    contentJson: JSON.stringify({ version: 1, regions: [] }), createdAt: now, updatedAt: now,
  })
  const avgMediaData = new TextEncoder().encode('full-fixture-avg-media').buffer
  const avgMediaDigest = await crypto.subtle.digest('SHA-256', avgMediaData)
  const avgMediaHash = Array.from(new Uint8Array(avgMediaDigest), byte => byte.toString(16).padStart(2, '0')).join('')
  const avgMediaAsset = await db.avgMediaAssets.add({
    projectId, worldId, workId, assetKey: 'fixture.background', version: 1, kind: 'background',
    name: '全表往返背景', mimeType: 'image/svg+xml', byteSize: avgMediaData.byteLength,
    width: 320, height: 180, durationMs: null, contentHash: avgMediaHash,
    source: 'StoryForge test fixture', license: 'CC0 test fixture', altText: '青云山门测试背景',
    characterTag: '', sceneTag: 'gate', createdAt: now, updatedAt: now,
  }) as number
  await db.avgMediaBlobs.add({
    projectId, worldId, workId, mediaAssetId: avgMediaAsset, data: avgMediaData, createdAt: now,
  })
  await db.emotionBeatCards.add({ projectId, chapterId: chapter, overallArc: '低落→振奋', beats: '[]', createdAt: now, updatedAt: now } as any)
  await db.cultivationProgress.add({
    projectId,
    worldGroupId: wgA,
    characterId: char1,
    characterName: '林惊羽',
    cultivationSystemId: cultivationSystem,
    cultivationSystemName: '青云剑修',
    stageId: 'qi',
    stageName: '炼气',
    transition: 'enter',
    sourceChapterId: chapter,
    sourceChapterTitle: '第1章',
    sourceQuote: '废墟中睁眼',
    sourceOffset: 0,
    trigger: '苏醒',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  })

  // ── 下游产物 ──
  await db.foreshadows.add({ projectId, name: '神秘玉佩', type: 'item', status: 'planted', description: '身世之谜', createdAt: now, updatedAt: now } as any)
  const storyArc = await db.storyArcs.add({
    projectId, type: 'main', name: '复仇线', stages: '[]', createdAt: now, updatedAt: now,
  } as any) as number
  await db.storylineProgress.add({
    projectId,
    arcId: storyArc,
    currentStageId: null,
    status: 'active',
    progressNote: '主角已开始追查旧案',
    lastActiveChapterId: chapter,
    lastActiveChapterTitle: '第1章',
    involvedEntities: JSON.stringify(['林惊羽']),
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  // 全表 FK 往返种子复用同一 Arc 覆盖 A/B 两个字段；“两端必须不同”的产品约束
  // 由 storyline-progress 领域解析/采纳测试单独锁定。
  await db.storylineCrossings.add({
    projectId,
    arcIdA: storyArc,
    arcIdB: storyArc,
    chapterId: chapter,
    chapterTitle: '第1章',
    note: '全表往返 FK 覆盖种子',
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  await db.stateCards.add({ projectId, category: 'character', entityName: '林惊羽', fields: JSON.stringify([{ key: '境界', value: '炼气一层' }]), createdAt: now, updatedAt: now } as any)
  await db.itemLedger.add({ projectId, itemName: '青锋剑', heldByName: '林惊羽', characterId: char1, action: 'gain', quantity: 1, chapterId: chapter, chapterTitle: '第1章', createdAt: now, updatedAt: now } as any)
  await db.storyTimelineEvents.add({ projectId, chapterId: chapter, title: '获得青锋剑', createdAt: now, updatedAt: now } as any)
  await db.notes.add({ projectId, title: '灵感', content: '记一笔', createdAt: now, updatedAt: now } as any)

  // ── 参考书 + 分块分析(creativeRules 引用 reference) ──
  const ref1 = await db.references.add({ projectId, title: '斗破苍穹', author: '天蚕土豆', type: 'story', note: '参考爽点', createdAt: now, updatedAt: now } as any) as number
  const referenceRun = await db.referenceAnalysisRuns.add({
    projectId, referenceId: ref1, version: 1, status: 'active', depth: 'quick',
    sourceFilename: '斗破苍穹.txt', fileHash: 'full-project-reference', totalChars: 100,
    sourceKind: 'unknown', usageScope: 'analysis-only', rightsNote: '测试种子',
    rightsConfirmed: false, rightsDeclaredAt: now, expectedChunks: 1, completedChunks: 1,
    progress: 100, completedAt: now, activatedAt: now, createdAt: now, updatedAt: now,
  } as any) as number
  await db.referenceChunkAnalysis.add({
    referenceId: ref1, analysisRunId: referenceRun, chunkIndex: 0,
    openingTechnique: '天才陨落钩子', createdAt: now, updatedAt: now,
  } as any)
  await db.creativeRules.add({ projectId, citedReferenceIds: [ref1], content: '多爽点', createdAt: now, updatedAt: now } as any)

  // ── 词条(树,wgA) ──
  const cat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: null, name: '势力', order: 0, createdAt: now, updatedAt: now } as any) as number
  const subCat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: cat, name: '宗门', order: 0, createdAt: now, updatedAt: now } as any) as number
  const codexEntry = await db.codexEntries.add({
    projectId, worldGroupId: wgA, categoryId: subCat, name: '青云宗', summary: '正道魁首',
    importantLocationId: locParent,
    createdAt: now, updatedAt: now,
  } as any) as number
  // 全表 FK 往返只验证 codexEntries ID 重映射；race 类别语义由角色关联测试单独覆盖。
  await db.characters.update(char1, { raceEntryId: codexEntry })

  // ── FB-5 文风画像 ──
  await db.userStyleProfiles.add({ projectId, profile: '简洁明快', enabled: true, createdAt: now, updatedAt: now } as any)

  // ── IDEA-1 / CM-1 增量灵感工作区 ──
  const inspirationFragmentId = 'idea-seed-old-city'
  await db.inspirationWorkspaces.add({
    projectId,
    fragments: JSON.stringify([{
      id: inspirationFragmentId,
      text: '旧城每逢暴雨都会忘记一个人',
      label: '遗忘规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: JSON.stringify([{
      id: 'idea-version-seed',
      parentVersionId: null,
      mode: 'single',
      fragmentIds: [inspirationFragmentId],
      resultJson: JSON.stringify({ storyCore: { logline: '守塔人保存被雨抹去的名字' } }),
      createdAt: now,
    }]),
    createdAt: now,
    updatedAt: now,
  })

  // ── PLATFORM-2 / AGENT-1 可审计对话事件 ──
  const agentConversation = await db.agentConversations.add({
    projectId,
    worldGroupId: wgA,
    title: '建立主世界与主角',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.agentEvents.add({
    projectId,
    conversationId: agentConversation,
    sequence: 1,
    kind: 'message',
    role: 'user',
    content: '建立主世界与主角',
    payload: '{}',
    createdAt: now,
  })
  const harnessContract = {
    version: 1,
    objective: '生成第一卷卷纲候选',
    workflowKind: 'direct-generation',
    scope: { projectId, worldGroupId: wgA, outlineNodeIds: [vol] },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'outline.terminal',
      kind: 'terminal',
      verifier: 'terminal-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
  const harnessContractHash = await hashCanonicalValue(harnessContract)
  const agentRun = await db.agentRuns.add({
    projectId,
    workId,
    simulationSessionId: null,
    worldGroupId: wgA,
    conversationId: agentConversation,
    status: 'planned',
    contractVersion: 1,
    contractJson: canonicalStringify(harnessContract),
    contractHash: harnessContractHash,
    generation: 1,
    lastSequence: 0,
    projectionJson: '{}',
    projectionHash: '0'.repeat(64),
    terminalReceiptHash: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const harnessEvents: AnyAgentRunEventV1[] = [{
    version: 1 as const,
    runId: agentRun,
    sequence: 1,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'run.created' as const,
    payload: { objectiveHash: await hashCanonicalValue(harnessContract.objective) },
    createdAt: now,
  }, {
    version: 1 as const,
    runId: agentRun,
    sequence: 2,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'contract.accepted' as const,
    payload: { contractJson: canonicalStringify(harnessContract) },
    createdAt: now,
  }]
  const beforeCheckpoint = replayAgentRunEventsV1(harnessEvents)
  const checkpointProjectionBody = toAgentRunProjectionBodyV1(beforeCheckpoint)
  const checkpointProjectionHash = await hashCanonicalValue(checkpointProjectionBody)
  const checkpointHash = await hashCanonicalValue({
    version: 1,
    generation: 1,
    throughSequence: 2,
    projectionHash: checkpointProjectionHash,
    resumePayloadHash: null,
  })
  const agentRunCheckpoint = await db.agentRunCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    runId: agentRun,
    throughSequence: 2,
    generation: 1,
    contractHash: harnessContractHash,
    checkpointHash,
    projectionJson: canonicalStringify(checkpointProjectionBody),
    projectionHash: checkpointProjectionHash,
    resumePayloadJson: null,
    resumePayloadHash: null,
    createdAt: now,
  }) as number
  harnessEvents.push({
    version: 1,
    runId: agentRun,
    sequence: 3,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'checkpoint.created',
    payload: { throughSequence: 2, checkpointHash },
    createdAt: now,
  })
  await db.agentRunEvents.bulkAdd(harnessEvents.map(event => ({
    projectId: event.projectId,
    worldGroupId: event.worldGroupId,
    runId: event.runId,
    sequence: event.sequence,
    generation: event.generation,
    contractHash: event.contractHash,
    type: event.type,
    payloadJson: canonicalStringify(event.payload),
    createdAt: event.createdAt,
  })))
  const harnessProjection = replayAgentRunEventsV1(harnessEvents)
  const harnessProjectionBody = toAgentRunProjectionBodyV1(harnessProjection)
  await db.agentRuns.update(agentRun, {
    lastSequence: harnessProjection.lastSequence,
    projectionJson: canonicalStringify(harnessProjectionBody),
    projectionHash: await hashCanonicalValue(harnessProjectionBody),
  })
  const exactArtifactContent = '{"fixture":"seed-full-project"}'
  await db.agentRunArtifacts.add({
    projectId,
    artifactKind: 'context-packet',
    contentHash: await sha256Text(exactArtifactContent),
    encoding: 'utf-8',
    byteLength: new TextEncoder().encode(exactArtifactContent).byteLength,
    content: exactArtifactContent,
    retentionState: 'available',
    pruneReceiptJson: null,
    pruneReceiptHash: null,
    createdAt: now,
    updatedAt: now,
  })

  // ── FLOW-2 独立节点文档与可见运行记录 ──
  const nodeFlow = await db.nodeFlows.add({
    projectId,
    worldGroupId: wgA,
    name: '主角生成图',
    description: '全表往返覆盖',
    graphJson: JSON.stringify({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.nodeRuns.add({
    projectId,
    flowId: nodeFlow,
    status: 'completed',
    inputSnapshotsJson: JSON.stringify({}),
    nodeResultsJson: JSON.stringify({}),
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  })

  // ── SIM-1 共享互动运行时（父子分支 + 事件 + 检查点） ──
  const simulationParent = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-parent',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const simulationChild = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役 · 分支',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-child',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: simulationParent,
    parentThroughSequence: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.simulationEvents.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    sequence: 1,
    type: 'narrative.recorded',
    actorKey: null,
    targetKey: null,
    payloadJson: JSON.stringify({ text: '林惊羽踏入青云山门。' }),
    createdAt: now,
  })
  await db.simulationCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    throughSequence: 1,
    name: '入山',
    stateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [{ eventSequence: 1, text: '林惊羽踏入青云山门。' }],
      lastSequence: 1,
    }),
    stateHash: 'fixture-hash',
    createdAt: now,
  })

  // ── NS-4 时序事实账本（带分类型 FK，供全表往返覆盖） ──
  const temporalFact = await db.temporalFacts.add({ projectId, worldGroupId: wgA, characterId: char1, subjectName: '林惊羽', predicate: 'powerStage', factKind: 'state', value: '炼气一层', sourceType: 'chapter', sourceChapterId: chapter, validFromChapterId: chapter, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any) as number

  // ── CONSISTENCY-2 角色认知账本（覆盖角色/章节/世界/事实四类 FK） ──
  await db.knowledgeLedger.add({
    projectId, worldGroupId: wgA, characterId: char1, characterName: '林惊羽',
    knowledgeKey: 'self.power_stage', statement: '林惊羽已达到炼气一层',
    factId: temporalFact, action: 'learn', sourceType: 'chapter', sourceChapterId: chapter,
    sourceQuote: '废墟中睁眼', status: 'confirmed', createdAt: now, updatedAt: now,
  })

  // 旧共享种子最初只带 projectId；在全量备份边界前按 PROJECT_TABLES
  // 为每个受治理记录补齐 v4 World/Work owner，避免物理 ID 或隐式活动作品泄漏。
  for (const spec of PROJECT_TABLES) {
    const locator = spec.domainOwner?.locator
    if (['projects', 'worlds', 'works'].includes(spec.name)) continue
    let rows: any[] = []
    if (spec.owner === 'project') rows = await spec.table.where('projectId').equals(projectId).toArray()
    else if (spec.projectResolver) {
      const parentIds = await spec.projectResolver(projectId)
      const link = (spec.exportRemap ?? []).find(remap => (
        PROJECT_TABLES.find(candidate => candidate.name === remap.remapVia)?.owner === 'project'
      ))
      if (parentIds.length && link) rows = await spec.table.where(link.field).anyOf(parentIds).toArray()
    }
    if (locator?.kind === 'field' && (locator.owner === 'world' || locator.owner === 'work')) {
      for (const row of rows) {
        if (row.id != null && (row as any)[locator.field] == null) {
          await spec.table.update(row.id, { [locator.field]: locator.owner === 'world' ? worldId : workId })
        }
      }
    } else if (locator?.kind === 'exclusive-fields') {
      for (const row of rows) {
        if (row.id != null && (row as any)[locator.worldField] == null && (row as any)[locator.workField] == null) {
          await spec.table.update(row.id, { [locator.workField]: workId, [locator.worldField]: null })
        }
      }
    }
  }

  // 新媒介能力必须与历史 82 表在同一个真实项目中完成严格往返，不能只靠孤立夹具。
  // 先完成旧记录 owner 补齐，再通过正式领域服务创建两个目标 Work 及其来源清单。
  const adaptationProducts = await seedAdaptationProducts({ projectId, worldId, workId })
  // createAdaptation() 模拟真实交互会切换当前 Work；全量夹具的基准身份仍是最早的
  // 小说 Work，因此恢复指针及旧 fixture 的项目兼容镜像，不改变新增目标 Work。
  const mirroredProject = await db.projects.get(projectId) as any
  const restoredProject = {
    ...mirroredProject,
    name: '全量作品',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '全表往返',
    targetWordCount: 100000,
    activeWorldId: worldId,
    activeWorkId: workId,
    activeCharacterDrivenPlanId: characterDrivenPlan,
    updatedAt: now,
  }
  for (const key of ['status', 'currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId', 'communityOrigin']) delete restoredProject[key]
  await db.projects.put(restoredProject)

  return {
    projectId, wgA, wgB, char1, char2, vol, chapNode, chapter, temporalFact, ref1,
    cat, subCat, rootWorld, mirrorWorld, locParent, cultivationSystem, codexEntry,
    characterDrivenPlan, simulationParent, simulationChild, worldId, workId,
    narrativeModule, worldRevision, worldRelease, gameDefinition, gameRelease,
    adventureGameDefinition, avgGameDefinition, narrativeSimulationDefinition, openWorldGameDefinition, avgMediaAsset,
    interactionCharacterProfile, interactionSceneTemplate, agentRun, agentRunCheckpoint,
    adaptationProducts,
  }
}

/** 所有 exportable 的项目级表名(可按 projectId 查;排除 projects 与 direct-child referenceChunkAnalysis) */
export const EXPORTABLE_PROJECT_TABLES = PROJECT_TABLES
  .filter(s => s.exportable && s.name !== 'projects' && s.name !== 'referenceChunkAnalysis')
  .map(s => s.name)
