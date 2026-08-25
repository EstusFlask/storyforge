import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterInteractionProductionStudio from '../../src/components/character-interaction/CharacterInteractionProductionStudio'

const mocks = vi.hoisted(() => ({
  listWorldReleases: vi.fn(),
  loadCatalog: vi.fn(),
  listProductions: vi.fn(),
  loadProduction: vi.fn(),
  createProduction: vi.fn(),
  buildBrief: vi.fn(),
  confirmBrief: vi.fn(),
  readDetails: vi.fn(),
}))

vi.mock('../../src/lib/world-engine/releases', () => ({ listWorldReleases: mocks.listWorldReleases }))
vi.mock('../../src/lib/character-interaction/world-source', () => ({
  loadCharacterInteractionWorldSourceCatalogV1: mocks.loadCatalog,
}))
vi.mock('../../src/lib/character-interaction/production', () => ({
  listCharacterInteractionProductionsV1: mocks.listProductions,
  loadCharacterInteractionProductionV1: mocks.loadProduction,
  createCharacterInteractionProductionV1: mocks.createProduction,
  buildCharacterInteractionBriefV1: mocks.buildBrief,
  confirmCharacterInteractionBriefV1: mocks.confirmBrief,
}))
vi.mock('../../src/lib/character-interaction/production-pipeline', () => ({
  readCharacterInteractionProductionDetailsV1: mocks.readDetails,
  generateCharacterInteractionStepCandidateV1: vi.fn(),
  confirmCharacterInteractionStepCandidateV1: vi.fn(),
  attachCharacterInteractionMediaAssetV1: vi.fn(),
  degradeCharacterInteractionMediaAssetV1: vi.fn(),
  publishCharacterInteractionProductReleaseV1: vi.fn(),
  prepareCharacterInteractionWorldUpgradeCandidateV1: vi.fn(),
  applyCharacterInteractionWorldUpgradeV1: vi.fn(),
  recoverInterruptedCharacterInteractionProductionsV1: vi.fn().mockResolvedValue([]),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const scope = { projectId: 1, worldId: 2, workId: 3 }
const hash = (value: string) => value.repeat(64).slice(0, 64)

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

function field(host: ParentNode, label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const owner = Array.from(host.querySelectorAll('label')).find(item => item.textContent?.includes(label))
  const result = owner?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')
  if (!result) throw new Error(`找不到字段:${label}`)
  return result
}

async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    if (element instanceof HTMLSelectElement) element.value = value
    else {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
    }
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return } catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

function data() {
  const catalog = {
    schema: 'storyforge.character-interaction-world-source-catalog', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    worldReleaseId: 7, worldReleaseVersion: 4, worldReleaseLabel: '旧港终局 v4',
    sourceWorldCode: 'WORLD-OLD-HARBOR', sourceWorldName: '旧港', sourceWorkTitle: '潮汐终章',
    worldContentHash: hash('a'), sourceWorldExportId: 0, sourceWorkExportId: 0,
    sourceMappingVersion: 1,
    records: {
      characters: [{ table: 'characters', exportId: 0, label: '岑星', summary: '隐居灯塔', parentExportId: null, referencedExportIds: [] }],
      importantLocations: [{ table: 'importantLocations', exportId: 0, label: '守潮灯塔', summary: '终局后的居所', parentExportId: null, referencedExportIds: [] }],
    },
    unavailableTables: [], excludedReleaseTables: [],
  } as any
  const selection = {
    schema: 'storyforge.character-interaction-world-source-selection', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    worldReleaseId: 7, sourceWorldCode: 'WORLD-OLD-HARBOR', worldContentHash: hash('a'),
    sourceWorldExportId: 0, sourceWorkExportId: 0, sourceMappingVersion: 1,
    participantCharacterExportIds: [0],
    recordSelections: [{ table: 'characters', granularity: 'single-record', exportIds: [0] }],
    guestCharacterKeys: [], selectionHash: hash('b'),
  } as any
  const brief = {
    schema: 'storyforge.character-interaction-brief', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    source: { worldReleaseId: 7, worldContentHash: hash('a'), selectionHash: hash('b') },
    title: '灯塔再会', userInstruction: '与岑星谈终局之后的新生活。', userRole: 'self',
    participants: [{ participantKey: 'world-character:0', source: 'world', displayName: '岑星', reason: '叙旧' }],
    guests: [],
    setting: { storyMode: 'new-event', timeContext: '终局后十年', locationContext: '守潮灯塔', historicalContext: '', chatGoal: '重新建立联系', desiredDirections: [], safetyBoundaries: ['不推翻终局'] },
    knowledgePolicy: { publicKnowledge: [], privateKnowledge: [], prohibitedDisclosure: [] },
    relationshipPolicy: { dimensions: ['trust'], largeChangeNeedsEvidence: true },
    runtime: { sceneCount: 1, maxTurnsPerScene: 80, directorBudget: 12, endingStrategy: 'open-ended' },
    media: { tier: 'text-core' }, worldFeedback: { allowCandidate: false, autoWriteback: false },
  } as any
  const base = {
    production: { id: 11, projectId: 1, worldId: 2, workId: 3, productionKey: 'interaction:test', title: brief.title, status: 'brief-draft', activeSourceSelectionId: 12, activeBriefId: 13, createdAt: 1, updatedAt: 1 },
    sourceRecord: { id: 12, projectId: 1, worldId: 2, workId: 3, productionId: 11, revision: 1, status: 'frozen', sourceWorldReleaseId: 7, selectionJson: '{}', selectionHash: hash('b'), worldContentHash: hash('a'), createdAt: 1 },
    selection, catalog,
    briefRecord: { id: 13, projectId: 1, worldId: 2, workId: 3, productionId: 11, sourceSelectionId: 12, revision: 1, status: 'draft', briefJson: '{}', briefHash: hash('c'), runContractJson: null, runContractHash: null, confirmedAt: null, createdAt: 1 },
    brief, runContract: null,
  } as any
  const confirmed = {
    ...base,
    production: { ...base.production, status: 'brief-confirmed', activeBriefId: 14 },
    briefRecord: { ...base.briefRecord, id: 14, revision: 2, status: 'confirmed', runContractJson: '{}', runContractHash: hash('d'), confirmedAt: 2 },
    runContract: { worldWritebackAllowed: false, writeMode: 'candidate-only' },
  }
  return { catalog, selection, brief, draft: base, confirmed }
}

describe('CHATGAME-3C · frozen source production UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    vi.clearAllMocks()
    const fixture = data()
    mocks.listWorldReleases.mockResolvedValue([{ id: 7, version: 4, label: '旧港终局 v4', contentHash: hash('a') }])
    mocks.listProductions.mockResolvedValue([])
    mocks.loadCatalog.mockResolvedValue(fixture.catalog)
    mocks.createProduction.mockResolvedValue(fixture.draft)
    mocks.buildBrief.mockReturnValue(fixture.brief)
    mocks.confirmBrief.mockResolvedValue(fixture.confirmed)
    mocks.readDetails.mockResolvedValue({ ...fixture.confirmed, steps: [], artifacts: [], mediaAssets: [], releases: [] })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })

  it('选择便携角色后先冻结来源和 Brief 草稿，再显式确认 Run Contract', async () => {
    await act(async () => { root.render(createElement(CharacterInteractionProductionStudio, { scope })); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(host.textContent).toContain('岑星'))
    const character = Array.from(host.querySelectorAll('label')).find(item => item.textContent?.includes('岑星'))!
    await click(character.querySelector('input')!)
    await change(field(host, '用户总指令'), '与岑星谈终局之后的新生活。')
    await change(field(host, '地点'), '守潮灯塔')
    await change(field(host, '聊天目标'), '重新建立联系')
    await click(button(host, '冻结来源并保存 Brief 草稿'))
    await waitFor(() => expect(mocks.createProduction).toHaveBeenCalledTimes(1))
    expect(mocks.createProduction.mock.calls[0][0]).toMatchObject({
      scope,
      worldReleaseId: 7,
      participantCharacterExportIds: [0],
    })
    expect(host.textContent).toContain('正式 AI 和产品表写入仍被阻止')
    await click(button(host, '确认 Brief 并冻结 Run Contract'))
    await waitFor(() => expect(mocks.confirmBrief).toHaveBeenCalledTimes(1))
    expect(host.textContent).toContain('来源与 Run Contract 已冻结')
    expect(host.textContent).toContain('CI-3 / DURABLE PRODUCTION')
    expect(host.textContent).toContain('AI 生成候选')
  })
})
