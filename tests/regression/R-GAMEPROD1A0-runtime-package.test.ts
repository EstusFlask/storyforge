import { describe, expect, it } from 'vitest'
import {
  createGameReleaseManifestV2,
  gameRuntimePackageFromReleaseV1,
  parseGameRuntimePackageV2,
  verifyGameReleaseManifestV2,
} from '../../src/lib/game-production/runtime-package'
import {
  canonicalGameProductionJsonV2,
  hashGameProductionValueV2,
} from '../../src/lib/game-production/hash'
import { parseAnyGameReleaseManifestVersion } from '../../src/lib/text-game/releases'
import type {
  GameReleaseManifestV1,
  GameRuntimePackageV2,
  WorldGameSourceSelectionV2,
} from '../../src/lib/types'

const HASH = 'a'.repeat(64)

function selection(): WorldGameSourceSelectionV2 {
  return {
    schema: 'storyforge.world-game-source',
    version: 2,
    productType: 'storygame',
    worldContentHash: HASH,
    narrativeModuleExportIds: [2],
    characterExportIds: [],
    characterRelationExportIds: [],
    importantLocationExportIds: [],
    artifactExportIds: [],
    codexEntryExportIds: [],
    storyArcExportIds: [],
    avgMediaAssetExportIds: [],
    productSource: { kind: 'storygame', narrativeModuleExportIds: [2] },
  }
}

function runtimePackage(): GameRuntimePackageV2 {
  return {
    schema: 'storyforge.game-runtime-package',
    version: 2,
    productType: 'storygame',
    definition: {
      gameKey: 'game.harbor',
      title: '雾港终章',
      description: '一个可验证的最小发布包。',
      enabledCapabilities: ['narrative'],
      rulesetVersion: 1,
      initialVariables: {},
    },
    sourceWorld: { contentHash: HASH, selection: selection() },
    narrative: {
      moduleKind: 'main',
      moduleTitle: '港口余烬',
      entryNodeKey: 'ending.home',
      nodes: [{
        key: 'ending.home',
        kind: 'ending',
        title: '归港',
        summary: '故事在雾散时结束。',
        conditionJson: '{}',
        effectsJson: '[]',
        successorKeys: [],
      }],
      beats: [{
        beatKey: 'beat.home',
        nodeKey: 'ending.home',
        kind: 'narration',
        speakerKey: null,
        text: '灯塔重新亮起。',
        order: 0,
      }],
      choices: [],
    },
  }
}

describe('R-GAMEPROD-1A0 · RuntimePackage/Release v2', () => {
  it('严格解析并冻结 Preview/Release 共用的产品包', async () => {
    const parsed = parseGameRuntimePackageV2(runtimePackage())
    const release = await createGameReleaseManifestV2({
      runtimePackage: parsed,
      productionProvenance: {
        productionKey: 'prod.harbor',
        buildNumber: 1,
        buildManifestHash: 'b'.repeat(64),
        rootTerminalReceiptHash: 'c'.repeat(64),
      },
    })

    expect(release.packageHash).toBe(await hashGameProductionValueV2(parsed))
    await expect(verifyGameReleaseManifestV2(JSON.stringify(release))).resolves.toEqual(release)
    expect(parseAnyGameReleaseManifestVersion(JSON.stringify(release))).toEqual(release)
  })

  it('拒绝未知字段、产品模块不一致和被篡改的 packageHash', async () => {
    expect(() => parseGameRuntimePackageV2({ ...runtimePackage(), hidden: true })).toThrow(/字段不符合合同/)
    expect(() => parseGameRuntimePackageV2({
      ...runtimePackage(),
      definition: { ...runtimePackage().definition, enabledCapabilities: ['narrative', 'presentation'] },
    })).toThrow(/enabledCapabilities/)

    const release = await createGameReleaseManifestV2({ runtimePackage: runtimePackage(), productionProvenance: null })
    await expect(verifyGameReleaseManifestV2({
      ...release,
      runtimePackage: {
        ...release.runtimePackage,
        definition: { ...release.runtimePackage.definition, title: '被替换' },
      },
    })).rejects.toThrow(/packageHash/)
  })

  it('在 Preview 创建前拒绝运行时不支持的节点类型和叙事子对象额外字段', () => {
    const invalidKind = runtimePackage()
    invalidKind.narrative.nodes[0].kind = 'event' as never
    expect(() => parseGameRuntimePackageV2(invalidKind)).toThrow(/nodes\[0\]\.kind 无效/)

    const hiddenNodeData = runtimePackage()
    hiddenNodeData.narrative.nodes[0] = {
      ...hiddenNodeData.narrative.nodes[0],
      gmSecret: '不能混入发布叙事节点',
    } as never
    expect(() => parseGameRuntimePackageV2(hiddenNodeData)).toThrow(/nodes\[0\] 字段不符合合同/)
  })

  it('把历史 Release v1 投影到同一 RuntimePackage 而不修改旧清单', () => {
    const pkg = runtimePackage()
    const legacy: GameReleaseManifestV1 = {
      schema: 'storyforge.game-release',
      version: 1,
      productType: 'storygame',
      definition: {
        ...pkg.definition,
        source: null,
      },
      worldRelease: { contentHash: HASH, narrativeModuleExportId: 2 },
      narrative: pkg.narrative,
    }
    const resolved = gameRuntimePackageFromReleaseV1(legacy)

    expect(resolved.sourceWorld.selection).toMatchObject({
      version: 2,
      productType: 'storygame',
      narrativeModuleExportIds: [2],
    })
    expect(legacy.version).toBe(1)
  })

  it('canonical-json-v2 规范化 Unicode/key 顺序并拒绝非 JSON 数字和 undefined', () => {
    expect(canonicalGameProductionJsonV2({ z: 'e\u0301', a: 1 })).toBe('{"a":1,"z":"é"}')
    expect(() => canonicalGameProductionJsonV2({ value: Number.NaN })).toThrow(/NaN/)
    expect(() => canonicalGameProductionJsonV2({ value: undefined })).toThrow(/undefined/)

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => canonicalGameProductionJsonV2(cycle)).toThrow(/循环引用/)

    const sparse = Array<string>(1)
    expect(() => canonicalGameProductionJsonV2(sparse)).toThrow(/稀疏数组/)
    expect(() => canonicalGameProductionJsonV2({ '\u00e9': 1, 'e\u0301': 2 })).toThrow(/重复对象 key/)
  })

  it('规范化来源集合顺序，并拒绝产品专属来源越过通用选择边界', () => {
    const unordered = runtimePackage()
    unordered.sourceWorld.selection.narrativeModuleExportIds = [3, 2]
    unordered.sourceWorld.selection.productSource = { kind: 'storygame', narrativeModuleExportIds: [2] }
    expect(parseGameRuntimePackageV2(unordered).sourceWorld.selection.narrativeModuleExportIds).toEqual([2, 3])

    const escaped = runtimePackage()
    escaped.sourceWorld.selection.productSource = { kind: 'storygame', narrativeModuleExportIds: [99] }
    expect(() => parseGameRuntimePackageV2(escaped)).toThrow(/超出通用来源选择/)
  })

  it('在解析阶段拒绝不可稳定发布的初始变量', () => {
    const pkg = runtimePackage()
    pkg.definition.initialVariables = { invalid: undefined }
    expect(() => parseGameRuntimePackageV2(pkg)).toThrow(/undefined/)
  })
})
