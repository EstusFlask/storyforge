import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import type {
  TtrpgWorldSourceCatalogDependencyV1,
  TtrpgWorldSourceCatalogNarrativeModuleV1,
  TtrpgWorldSourceCatalogRecordV1,
  TtrpgWorldSourceCatalogV1,
  TtrpgWorldSourceNarrativeSubgraphV1,
  TtrpgWorldSourceRecordSelectionV1,
  TtrpgWorldSourceRecordTableV1,
  TtrpgWorldSourceSelectionV1,
  UnfrozenTtrpgWorldSourceSelectionV1,
  WorkspaceScope,
  WorldRelease,
  WorldReleaseManifestV2,
} from '../types'
import {
  TTRPG_WORLD_SOURCE_CONTRACT_VERSION,
  TTRPG_WORLD_SOURCE_MAPPING_VERSION,
  TTRPG_WORLD_SOURCE_RECORD_TABLES,
  TTRPG_WORLD_SOURCE_TREE_TABLES,
} from '../types'
import { assertReleaseUnchanged } from '../world-engine/releases'
import { resolveScope } from '../world-engine/scope'

const SHA256 = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const NARRATIVE_TABLES = new Set(['narrativeModules', 'narrativeNodes', 'narrativeBeats', 'narrativeChoices'])
const RECORD_TABLES = new Set<string>(TTRPG_WORLD_SOURCE_RECORD_TABLES)
const TREE_TABLES = new Set<string>(TTRPG_WORLD_SOURCE_TREE_TABLES)
const GROUNDING_ANCHOR_TABLES = new Set<TtrpgWorldSourceRecordTableV1>([
  'worldviews', 'worldRulesProfiles', 'powerSystems', 'cultivationSystems', 'geographies',
  'histories', 'historicalTimelineEvents', 'historicalKeywords', 'worldGroups', 'worldNodes',
  'importantLocations', 'codexEntries', 'characters', 'storyCores', 'storyArcs',
  'outlineNodes', 'detailedOutlines',
])

interface LoadedTtrpgWorldSourceV1 {
  release: WorldRelease
  manifest: WorldReleaseManifestV2
  catalog: TtrpgWorldSourceCatalogV1
}

function fail(message: string): never {
  throw new Error(`[ttrpg-world-source] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function nonEmptyText(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label} 为空或过长`)
  return normalized
}

function portableId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail(`${label} 必须是非负便携 ID`)
  return Number(value)
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) fail(`${label} 必须是正整数`)
  return Number(value)
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${label} 必须是 SHA-256`)
  return value
}

function stableKey(value: unknown, label: string): string {
  const parsed = nonEmptyText(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function portableIdArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20_000) fail(`${label} 必须是非空有界数组`)
  const parsed = value.map((item, index) => portableId(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed.sort((left, right) => left - right)
}

function stableKeyArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20_000) fail(`${label} 必须是非空有界数组`)
  const parsed = value.map((item, index) => stableKey(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed.sort()
}

function manifestRows(manifest: WorldReleaseManifestV2, table: string): Record<string, unknown>[] {
  const values = manifest.records[table] ?? []
  if (!Array.isArray(values)) fail(`WorldRelease records.${table} 不是数组`)
  return values.map((value, index) => record(value, `WorldRelease ${table}[${index}]`))
}

function strictRowExportId(row: Record<string, unknown>, table: string, index: number): number {
  // Strict v4 exports deliberately encode some portable references as the
  // record's position in the immutable release array (for example character
  // relation endpoints). The position is release-scoped, not a source Dexie
  // id: worldReleaseId + contentHash + mappingVersion keep it stable for the
  // lifetime of the frozen source. A later release is migrated explicitly.
  return portableId(row._exportId ?? index, `${table}[${index}] release coordinate`)
}

function nullablePortableId(value: unknown, label: string): number | null {
  return value == null ? null : portableId(value, label)
}

function jsonValue(value: unknown, fallback: unknown, label: string): unknown {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown }
  catch { fail(`${label} 不是合法 JSON`) }
}

function numberArrayFromUnknown(value: unknown): number[] {
  const parsed = jsonValue(value, [], '便携引用数组')
  if (!Array.isArray(parsed)) return []
  return parsed.filter(item => Number.isInteger(item) && Number(item) >= 0).map(Number)
}

function dependency(
  dependencies: TtrpgWorldSourceCatalogDependencyV1[],
  table: TtrpgWorldSourceRecordTableV1,
  value: unknown,
): void {
  if (value == null) return
  dependencies.push({ table, exportId: portableId(value, `${table} 便携引用`) })
}

function rowDependencies(
  table: TtrpgWorldSourceRecordTableV1,
  row: Record<string, unknown>,
  sourceWorkExportId: number,
): TtrpgWorldSourceCatalogDependencyV1[] {
  const result: TtrpgWorldSourceCatalogDependencyV1[] = []
  if (row._worldGroupExportId != null) dependency(result, 'worldGroups', row._worldGroupExportId)
  if (row._homeWorldGroupExportId != null) dependency(result, 'worldGroups', row._homeWorldGroupExportId)

  if (table === 'worldGroupLinks') {
    dependency(result, 'worldGroups', row._fromGroupExportId)
    dependency(result, 'worldGroups', row._toGroupExportId)
  } else if (table === 'characterRelations') {
    dependency(result, 'characters', row._fromCharacterIndex)
    dependency(result, 'characters', row._toCharacterIndex)
  } else if (table === 'workCharacterBindings') {
    if (portableId(row._workExportId, 'workCharacterBindings._workExportId') !== sourceWorkExportId) {
      fail('workCharacterBindings 引用了冻结包中的其它 Work')
    }
    dependency(result, 'characters', row._characterExportId)
  } else if (table === 'characters') {
    if (row._raceEntryExportId != null) dependency(result, 'codexEntries', row._raceEntryExportId)
    if (row._cultivationSystemExportId != null) dependency(result, 'cultivationSystems', row._cultivationSystemExportId)
  } else if (table === 'codexEntries') {
    dependency(result, 'codexCategories', row._categoryExportId)
    if (row._cultivationSystemExportId != null) dependency(result, 'cultivationSystems', row._cultivationSystemExportId)
    if (row._importantLocationExportId != null) dependency(result, 'importantLocations', row._importantLocationExportId)
  } else if (table === 'detailedOutlines') {
    dependency(result, 'outlineNodes', row._outlineExportId)
    for (const value of numberArrayFromUnknown(row._appearingCharacterIndexes)) dependency(result, 'characters', value)
    for (const value of numberArrayFromUnknown(row._sceneCharacterIndexes)) dependency(result, 'characters', value)
  }
  if (TREE_TABLES.has(table) && row._parentExportId != null) dependency(result, table, row._parentExportId)
  if (table === 'worldNodes') {
    const portals = jsonValue(row.portalsJSON, [], 'worldNodes.portalsJSON')
    if (Array.isArray(portals)) {
      for (const [index, item] of portals.entries()) {
        const portal = record(item, `worldNodes.portalsJSON[${index}]`)
        if (portal.targetWorldId != null) dependency(result, 'worldNodes', portal.targetWorldId)
      }
    }
  }
  return [...new Map(result.map(item => [`${item.table}:${item.exportId}`, item])).values()]
    .sort((left, right) => left.table.localeCompare(right.table) || left.exportId - right.exportId)
}

function labelFor(table: TtrpgWorldSourceRecordTableV1, row: Record<string, unknown>, exportId: number): string {
  const candidates = [row.name, row.title, row.label, row.summary, row.overview, row.theme, row.builtInKey]
  const found = candidates.find(value => typeof value === 'string' && value.trim())
  return typeof found === 'string' ? found.trim().slice(0, 500) : `${table}#${exportId}`
}

function summaryFor(row: Record<string, unknown>): string {
  const candidates = [
    row.summary, row.description, row.shortDescription, row.globalNote, row.logline,
    row.centralConflict, row.overview, row.background, row.significance, row.arc,
  ]
  const found = candidates.find(value => typeof value === 'string' && value.trim())
  return typeof found === 'string' ? found.trim().slice(0, 4_000) : ''
}

function stableKeyFor(row: Record<string, unknown>): string | null {
  const value = [row.key, row.code, row.builtInKey, row.sceneId]
    .find(candidate => typeof candidate === 'string' && STABLE_KEY.test(candidate))
  return typeof value === 'string' ? value : null
}

function catalogRecord(
  table: TtrpgWorldSourceRecordTableV1,
  row: Record<string, unknown>,
  index: number,
  sourceWorkExportId: number,
): TtrpgWorldSourceCatalogRecordV1 {
  const exportId = strictRowExportId(row, table, index)
  return {
    exportId,
    stableKey: stableKeyFor(row),
    label: labelFor(table, row, exportId),
    summary: summaryFor(row),
    parentExportId: TREE_TABLES.has(table)
      ? nullablePortableId(row._parentExportId, `${table}[${index}]._parentExportId`)
      : null,
    dependencies: rowDependencies(table, row, sourceWorkExportId),
  }
}

function portableRoots(manifest: WorldReleaseManifestV2): {
  worldExportId: number
  workExportId: number
} {
  const portable = record(manifest.portableProject, 'portableProject')
  if (typeof portable.version !== 'number' || !Number.isInteger(portable.version) || portable.version < 4) {
    fail('portableProject 必须是严格 v4+ 快照')
  }
  const ownership = record(portable.ownership, 'portableProject.ownership')
  exact(ownership, ['contractVersion', 'worldExportId', 'workExportId'], 'portableProject.ownership')
  if (ownership.contractVersion !== 1) fail('portableProject ownership contractVersion 无效')
  const worldExportId = portableId(ownership.worldExportId, 'sourceWorldExportId')
  const workExportId = portableId(ownership.workExportId, 'sourceWorkExportId')
  if (!Array.isArray(portable.worlds) || !Array.isArray(portable.works)) fail('portableProject 缺少 World/Work 根')
  const world = portable.worlds.map((item, index) => record(item, `portableProject.worlds[${index}]`))
    .find(item => item._exportId === worldExportId)
  const work = portable.works.map((item, index) => record(item, `portableProject.works[${index}]`))
    .find(item => item._exportId === workExportId)
  if (!world || !work) fail('portableProject ownership 指向不存在的 World/Work 根')
  if (world.code !== manifest.worldCode) fail('portable World code 与 Manifest 不一致')
  if (work._worldExportId !== worldExportId) fail('portable Work 不属于选定 World')
  return { worldExportId, workExportId }
}

function narrativeCatalog(manifest: WorldReleaseManifestV2): TtrpgWorldSourceCatalogNarrativeModuleV1[] {
  const moduleRows = manifestRows(manifest, 'narrativeModules')
  const nodeRows = manifestRows(manifest, 'narrativeNodes')
  return manifest.selectedNarrativeModules.map((selected, index) => {
    const module = moduleRows.find((row, rowIndex) => strictRowExportId(row, 'narrativeModules', rowIndex) === selected.exportId)
    if (!module || module.kind !== selected.kind || module.title !== selected.title) {
      fail(`selectedNarrativeModules[${index}] 便携身份不一致`)
    }
    const nodeKeys = nodeRows.filter(row => row._moduleExportId === selected.exportId)
      .map((row, rowIndex) => stableKey(row.key, `narrativeNodes[${rowIndex}].key`)).sort()
    if (new Set(nodeKeys).size !== nodeKeys.length) fail(`叙事模块 ${selected.exportId} 包含重复 node key`)
    const entryNodeKey = stableKey(module.entryNodeKey, `narrativeModules[${index}].entryNodeKey`)
    if (!nodeKeys.includes(entryNodeKey)) fail(`叙事模块 ${selected.exportId} 的入口节点未冻结`)
    return { ...selected, entryNodeKey, nodeKeys }
  }).sort((left, right) => left.exportId - right.exportId)
}

async function loadVerified(input: { scope: WorkspaceScope; worldReleaseId: number }): Promise<LoadedTtrpgWorldSourceV1> {
  const scope = await resolveScope({ scope: input.scope })
  const release = await db.worldReleases.get(positiveId(input.worldReleaseId, 'worldReleaseId'))
  if (!release || release.projectId !== scope.projectId || release.worldId !== scope.worldId) {
    fail('WorldRelease 不属于当前 World')
  }
  await assertReleaseUnchanged(release.id!)
  let manifest: WorldReleaseManifestV2
  try { manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2 }
  catch { fail('WorldRelease manifest 不是合法 JSON') }
  if (manifest.schema !== 'storyforge.world-package' || manifest.version !== 2) {
    fail('只能消费 WorldReleaseManifestV2')
  }
  if (manifest.worldCode !== release.sourceWorldCode) fail('Release sourceWorldCode 与 Manifest 不一致')
  const selectedTables = manifest.selectedTables
  if (!Array.isArray(selectedTables) || new Set(selectedTables).size !== selectedTables.length) fail('selectedTables 无效或重复')
  if (!Array.isArray(manifest.dependencies)) fail('Manifest dependencies 无效')
  const dependencyByTable = new Map(manifest.dependencies.map(item => [item.table, item]))
  if (dependencyByTable.size !== manifest.dependencies.length) fail('Manifest dependencies 表重复')
  for (const table of selectedTables) {
    const rows = manifestRows(manifest, table)
    const dependencyRow = dependencyByTable.get(table)
    if (!dependencyRow || dependencyRow.rowCount !== rows.length || !SHA256.test(dependencyRow.contentHash)) {
      fail(`Manifest dependency 与 records.${table} 不一致`)
    }
    if (await hashCanonicalValue(rows) !== dependencyRow.contentHash) fail(`records.${table} contentHash 校验失败`)
  }
  if ([...dependencyByTable.keys()].some(table => !selectedTables.includes(table))) fail('Manifest dependencies 包含未选表')
  const roots = portableRoots(manifest)
  const tables = TTRPG_WORLD_SOURCE_RECORD_TABLES.filter(table => selectedTables.includes(table)).map(table => {
    const rows = manifestRows(manifest, table)
    const records = rows.map((row, index) => catalogRecord(table, row, index, roots.workExportId))
      .sort((left, right) => left.exportId - right.exportId)
    if (new Set(records.map(item => item.exportId)).size !== records.length) fail(`${table} 包含重复便携 ID`)
    return { table, records }
  })
  const catalog: TtrpgWorldSourceCatalogV1 = {
    schema: 'storyforge.ttrpg-world-source-catalog',
    version: 1,
    productType: 'ttrpg',
    contractVersion: TTRPG_WORLD_SOURCE_CONTRACT_VERSION,
    worldReleaseId: release.id!,
    sourceWorldCode: manifest.worldCode,
    worldContentHash: release.contentHash,
    sourceWorldExportId: roots.worldExportId,
    sourceWorkExportId: roots.workExportId,
    sourceMappingVersion: TTRPG_WORLD_SOURCE_MAPPING_VERSION,
    tables,
    narrativeModules: narrativeCatalog(manifest),
    unselectableReleaseTables: [],
    excludedReleaseTables: selectedTables.filter(table => !RECORD_TABLES.has(table) && !NARRATIVE_TABLES.has(table)).sort(),
  }
  return { release, manifest, catalog }
}

export async function loadTtrpgWorldSourceCatalogV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<TtrpgWorldSourceCatalogV1> {
  return (await loadVerified(input)).catalog
}

function parseRecordSelection(value: unknown, index: number): TtrpgWorldSourceRecordSelectionV1 {
  const row = record(value, `recordSelections[${index}]`)
  exact(row, ['table', 'granularity', 'exportIds'], `recordSelections[${index}]`)
  if (typeof row.table !== 'string' || !RECORD_TABLES.has(row.table)) fail(`recordSelections[${index}].table 不受 TTRPG 契约支持`)
  if (!['whole-table', 'record-set', 'tree-subgraph', 'dependency-closure'].includes(String(row.granularity))) {
    fail(`recordSelections[${index}].granularity 无效`)
  }
  if (row.granularity === 'tree-subgraph' && !TREE_TABLES.has(row.table)) {
    fail(`recordSelections[${index}] 只有树表可使用 tree-subgraph`)
  }
  return {
    table: row.table as TtrpgWorldSourceRecordTableV1,
    granularity: row.granularity as TtrpgWorldSourceRecordSelectionV1['granularity'],
    exportIds: portableIdArray(row.exportIds, `recordSelections[${index}].exportIds`),
  }
}

function parseNarrativeSubgraph(value: unknown, index: number): TtrpgWorldSourceNarrativeSubgraphV1 {
  const row = record(value, `narrativeSubgraphs[${index}]`)
  exact(row, ['moduleExportId', 'nodeKeys'], `narrativeSubgraphs[${index}]`)
  return {
    moduleExportId: portableId(row.moduleExportId, `narrativeSubgraphs[${index}].moduleExportId`),
    nodeKeys: stableKeyArray(row.nodeKeys, `narrativeSubgraphs[${index}].nodeKeys`),
  }
}

function parseSelectionBody(value: Record<string, unknown>, frozen: boolean): UnfrozenTtrpgWorldSourceSelectionV1 {
  exact(value, [
    'schema', 'version', 'productType', 'contractVersion', 'worldReleaseId', 'sourceWorldCode',
    'worldContentHash', 'sourceWorldExportId', 'sourceWorkExportId', 'sourceMappingVersion',
    'recordSelections', 'narrativeSubgraphs', ...(frozen ? ['selectionHash'] : []),
  ], 'TtrpgWorldSourceSelectionV1')
  if (value.schema !== 'storyforge.ttrpg-world-source-selection' || value.version !== 1
    || value.productType !== 'ttrpg' || value.contractVersion !== TTRPG_WORLD_SOURCE_CONTRACT_VERSION
    || value.sourceMappingVersion !== TTRPG_WORLD_SOURCE_MAPPING_VERSION) {
    fail('SourceSelection 协议身份无效')
  }
  if (!Array.isArray(value.recordSelections) || value.recordSelections.length > TTRPG_WORLD_SOURCE_RECORD_TABLES.length) {
    fail('recordSelections 必须是有界数组')
  }
  if (!Array.isArray(value.narrativeSubgraphs) || value.narrativeSubgraphs.length > 1_000) {
    fail('narrativeSubgraphs 必须是有界数组')
  }
  const recordSelections = value.recordSelections.map(parseRecordSelection)
    .sort((left, right) => left.table.localeCompare(right.table))
  if (new Set(recordSelections.map(item => item.table)).size !== recordSelections.length) fail('recordSelections 不允许重复表')
  const narrativeSubgraphs = value.narrativeSubgraphs.map(parseNarrativeSubgraph)
    .sort((left, right) => left.moduleExportId - right.moduleExportId)
  if (new Set(narrativeSubgraphs.map(item => item.moduleExportId)).size !== narrativeSubgraphs.length) {
    fail('narrativeSubgraphs 不允许重复模块')
  }
  if (!recordSelections.some(item => GROUNDING_ANCHOR_TABLES.has(item.table)) && narrativeSubgraphs.length === 0) {
    fail('TTRPG SourceSelection 至少需要一个世界语义锚点')
  }
  return {
    schema: 'storyforge.ttrpg-world-source-selection', version: 1, productType: 'ttrpg', contractVersion: 1,
    worldReleaseId: positiveId(value.worldReleaseId, 'worldReleaseId'),
    sourceWorldCode: nonEmptyText(value.sourceWorldCode, 'sourceWorldCode', 200),
    worldContentHash: hash(value.worldContentHash, 'worldContentHash'),
    sourceWorldExportId: portableId(value.sourceWorldExportId, 'sourceWorldExportId'),
    sourceWorkExportId: portableId(value.sourceWorkExportId, 'sourceWorkExportId'),
    sourceMappingVersion: 1,
    recordSelections,
    narrativeSubgraphs,
  }
}

export function parseTtrpgWorldSourceSelectionV1(value: unknown): TtrpgWorldSourceSelectionV1 {
  const row = record(value, 'TtrpgWorldSourceSelectionV1')
  const parsed = parseSelectionBody(row, true)
  return { ...parsed, selectionHash: hash(row.selectionHash, 'selectionHash') }
}

export async function freezeTtrpgWorldSourceSelectionV1(
  value: UnfrozenTtrpgWorldSourceSelectionV1,
): Promise<TtrpgWorldSourceSelectionV1> {
  const parsed = parseSelectionBody(record(value, 'TtrpgWorldSourceSelectionV1'), false)
  return { ...parsed, selectionHash: await hashCanonicalValue(parsed) }
}

export async function createTtrpgWorldSourceSelectionV1(input: {
  catalog: TtrpgWorldSourceCatalogV1
  recordSelections: TtrpgWorldSourceRecordSelectionV1[]
  narrativeSubgraphs: TtrpgWorldSourceNarrativeSubgraphV1[]
}): Promise<TtrpgWorldSourceSelectionV1> {
  const catalog = input.catalog
  if (catalog.schema !== 'storyforge.ttrpg-world-source-catalog' || catalog.version !== 1
    || catalog.productType !== 'ttrpg' || catalog.contractVersion !== 1 || catalog.sourceMappingVersion !== 1) {
    fail('TtrpgWorldSourceCatalogV1 协议身份无效')
  }
  return freezeTtrpgWorldSourceSelectionV1({
    schema: 'storyforge.ttrpg-world-source-selection', version: 1, productType: 'ttrpg', contractVersion: 1,
    worldReleaseId: catalog.worldReleaseId,
    sourceWorldCode: catalog.sourceWorldCode,
    worldContentHash: catalog.worldContentHash,
    sourceWorldExportId: catalog.sourceWorldExportId,
    sourceWorkExportId: catalog.sourceWorkExportId,
    sourceMappingVersion: 1,
    recordSelections: input.recordSelections,
    narrativeSubgraphs: input.narrativeSubgraphs,
  })
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function selectedIdsByTable(selection: TtrpgWorldSourceSelectionV1): Map<TtrpgWorldSourceRecordTableV1, Set<number>> {
  return new Map(selection.recordSelections.map(item => [item.table, new Set(item.exportIds)]))
}

function validateRecordSelection(
  catalog: TtrpgWorldSourceCatalogV1,
  selection: TtrpgWorldSourceSelectionV1,
): void {
  const tableCatalog = new Map(catalog.tables.map(item => [item.table, item.records]))
  const selected = selectedIdsByTable(selection)
  for (const group of selection.recordSelections) {
    const available = tableCatalog.get(group.table)
    if (!available) fail(`选择了未冻结到 WorldRelease 的表:${group.table}`)
    const allowed = new Set(available.map(item => item.exportId))
    if (group.exportIds.some(id => !allowed.has(id))) fail(`${group.table} 包含不属于冻结包的便携 ID`)
    if (group.granularity === 'whole-table' && !sameNumbers(group.exportIds, [...allowed].sort((a, b) => a - b))) {
      fail(`${group.table} whole-table 选择没有覆盖整表`)
    }
  }
  for (const group of selection.recordSelections) {
    const records = tableCatalog.get(group.table) ?? []
    for (const row of records.filter(item => selected.get(group.table)?.has(item.exportId))) {
      for (const ref of row.dependencies) {
        if (!selected.get(ref.table)?.has(ref.exportId)) {
          fail(`${group.table}:${row.exportId} 缺少便携依赖 ${ref.table}:${ref.exportId}`)
        }
      }
    }
  }
}

function narrativeNodeRows(manifest: WorldReleaseManifestV2, moduleExportId: number): Record<string, unknown>[] {
  return manifestRows(manifest, 'narrativeNodes').filter(row => row._moduleExportId === moduleExportId)
}

function stringArrayJson(value: unknown, label: string): string[] {
  const parsed = jsonValue(value, [], label)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) fail(`${label} 必须是字符串数组`)
  return parsed.map(item => String(item).trim())
}

function validateNarrativeSelection(
  manifest: WorldReleaseManifestV2,
  catalog: TtrpgWorldSourceCatalogV1,
  selection: TtrpgWorldSourceSelectionV1,
): void {
  const moduleCatalog = new Map(catalog.narrativeModules.map(item => [item.exportId, item]))
  const selectedRecords = selectedIdsByTable(selection)
  for (const subgraph of selection.narrativeSubgraphs) {
    const module = moduleCatalog.get(subgraph.moduleExportId)
    if (!module) fail(`叙事模块 ${subgraph.moduleExportId} 不属于冻结包`)
    const allowed = new Set(module.nodeKeys)
    if (subgraph.nodeKeys.some(key => !allowed.has(key))) fail(`叙事模块 ${subgraph.moduleExportId} 包含未冻结 node key`)
    const selected = new Set(subgraph.nodeKeys)
    if (!selected.has(module.entryNodeKey)) fail(`叙事子图 ${subgraph.moduleExportId} 缺少入口节点`)
    const nodeRows = narrativeNodeRows(manifest, subgraph.moduleExportId)
    for (const row of nodeRows.filter(item => selected.has(String(item.key)))) {
      const successors = stringArrayJson(row.successorKeysJson, `narrativeNodes.${String(row.key)}.successorKeysJson`)
      const missing = successors.filter(key => !selected.has(key))
      if (missing.length) fail(`叙事子图 ${subgraph.moduleExportId} successor 闭包缺失:${missing.join(',')}`)
      if (row._sourceOutlineExportId != null && !selectedRecords.get('outlineNodes')?.has(portableId(row._sourceOutlineExportId, 'sourceOutline'))) {
        fail(`叙事节点 ${String(row.key)} 缺少来源 outlineNode 便携引用`)
      }
    }
    const choiceRows = manifestRows(manifest, 'narrativeChoices').filter(row => row._moduleExportId === subgraph.moduleExportId)
    for (const row of choiceRows.filter(item => selected.has(String(item.sourceNodeKey)))) {
      const target = stableKey(row.targetNodeKey, 'narrativeChoice.targetNodeKey')
      if (!selected.has(target)) fail(`叙事子图 ${subgraph.moduleExportId} choice 目标闭包缺失:${target}`)
    }
    const beatRows = manifestRows(manifest, 'narrativeBeats').filter(row => (
      row._moduleExportId === subgraph.moduleExportId && selected.has(String(row.nodeKey))
    ))
    for (const row of beatRows) {
      if (row._speakerCharacterExportId != null
        && !selectedRecords.get('characters')?.has(portableId(row._speakerCharacterExportId, 'narrativeBeat.speaker'))) {
        fail(`叙事子图 ${subgraph.moduleExportId} 缺少 speaker 角色便携引用`)
      }
    }
  }
}

export async function validateTtrpgWorldSourceSelectionV1(input: {
  scope: WorkspaceScope
  selection: unknown
}): Promise<TtrpgWorldSourceSelectionV1> {
  const selection = parseTtrpgWorldSourceSelectionV1(input.selection)
  const { selectionHash: ignoredSelectionHash, ...selectionBody } = selection
  void ignoredSelectionHash
  if (await hashCanonicalValue(selectionBody) !== selection.selectionHash) {
    fail('selectionHash 校验失败')
  }
  const loaded = await loadVerified({ scope: input.scope, worldReleaseId: selection.worldReleaseId })
  const catalog = loaded.catalog
  if (selection.sourceWorldCode !== catalog.sourceWorldCode
    || selection.worldContentHash !== catalog.worldContentHash
    || selection.sourceWorldExportId !== catalog.sourceWorldExportId
    || selection.sourceWorkExportId !== catalog.sourceWorkExportId
    || selection.sourceMappingVersion !== catalog.sourceMappingVersion) {
    fail('SourceSelection 身份与冻结 WorldRelease 不一致')
  }
  validateRecordSelection(catalog, selection)
  validateNarrativeSelection(loaded.manifest, catalog, selection)
  // Verify again after validation so callers cannot proceed if the immutable row
  // was tampered with during a long selection review.
  await assertReleaseUnchanged(loaded.release.id!)
  return structuredClone(selection)
}
