import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  acceptTtrpgAuthorPreviewV1,
  buildTtrpgProductionPreviewV1,
  confirmTtrpgProductionBriefV1,
  createTtrpgDevelopmentProductionV1,
  listTtrpgProductionsV1,
  readTtrpgProductionDetailsV1,
  type TtrpgProductionDetailsV1,
} from '../../lib/ttrpg/production-service'
import {
  acceptTtrpgGeneratedMediaCandidateV1,
  acceptTtrpgProductionMediaAssetV1,
  requestConfiguredTtrpgProductionMediaCandidateV1,
  type TtrpgProductionMediaCandidateV1,
} from '../../lib/ttrpg/production-media'
import type {
  GameProductionSourceOptionsV1,
  GameProductionSourceSelectionV1,
  TtrpgDevelopmentSourceFixtureKeyV1,
  TtrpgProductionRecordV1,
  TtrpgProductionSourceCatalogV1,
  TtrpgProductionSourceSelectionV1,
  WorkspaceScope,
  WorldGameProductionHandoffV2,
} from '../../lib/types'
import { createPlayableGameInstance } from '../../lib/world-engine/instances'
import TtrpgProductionWizard, {
  createDefaultTtrpgProductionWizardValueV2,
  toTtrpgProductionBriefDraftInputV2,
  type TtrpgProductionWizardValueV2,
} from './TtrpgProductionWizard'

const FIXTURES: Array<{
  key: TtrpgDevelopmentSourceFixtureKeyV1
  title: string
  summary: string
}> = [
  { key: 'rank-lite-mist-harbor', title: '雾港 · D/C/B/A 轻量团', summary: '快速车卡、d20 判定、悬疑节点与文字 fallback。' },
  { key: 'd20-fantasy-floodgate', title: '潮门要塞 · d20 奇幻团', summary: '1～20 级、优劣势、战斗资源与多角色队伍。' },
  { key: 'd100-investigation-archive', title: '封蜡档案 · d100 调查团', summary: '百分检定、困难/极难成功、线索冗余与失败推进。' },
  { key: 'incomplete-text-fallback', title: '缺项来源 · 降级演练', summary: '验证产品补设定和纯文字降级是否明确可控。' },
]

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', 'source-frozen': '来源已冻结', 'brief-confirmed': 'Brief 已确认',
  building: '生产中', 'preview-ready': '可试玩', 'release-ready': '可发布',
  released: '已发布', failed: '失败', archived: '已归档',
}

function sourceFacets(input: {
  catalog: TtrpgProductionSourceCatalogV1
  selection: TtrpgProductionSourceSelectionV1
}): {
  options: GameProductionSourceOptionsV1
  selection: GameProductionSourceSelectionV1
} {
  const option = (rows: TtrpgProductionSourceCatalogV1['characters']) => rows.map((row, exportId) => ({
    exportId, label: row.name, summary: row.description, kind: row.tags[0] ?? null,
  }))
  const ids = <T extends { sourceKey: string }>(selected: string[], rows: T[]) =>
    selected.map(key => rows.findIndex(row => row.sourceKey === key)).filter(id => id >= 0)
  return {
    options: {
      narrativeModules: [{ exportId: 0, label: input.catalog.narrative.title, summary: input.catalog.summary, kind: input.catalog.narrative.moduleKind }],
      characters: option(input.catalog.characters),
      importantLocations: option(input.catalog.locations),
      artifacts: option(input.catalog.artifacts),
      codexEntries: [],
      storyArcs: input.catalog.storyArcs.map((row, exportId) => ({ exportId, label: row.name, summary: row.description, kind: row.kind })),
      avgMediaAssets: [],
    },
    selection: {
      narrativeModuleExportIds: [0],
      characterExportIds: ids(input.selection.characterKeys, input.catalog.characters),
      importantLocationExportIds: ids(input.selection.locationKeys, input.catalog.locations),
      artifactExportIds: ids(input.selection.artifactKeys, input.catalog.artifacts),
      codexEntryExportIds: [],
      storyArcExportIds: ids(input.selection.storyArcKeys, input.catalog.storyArcs),
      avgMediaAssetExportIds: [],
    },
  }
}

function wizardForSource(
  catalog: TtrpgProductionSourceCatalogV1,
  selection: GameProductionSourceSelectionV1,
): TtrpgProductionWizardValueV2 {
  const value = createDefaultTtrpgProductionWizardValueV2()
  value.ruleOrigin = catalog.ruleProfileKey === 'rank-lite'
    ? 'builtin-rank-lite'
    : catalog.ruleProfileKey === 'd20-fantasy'
      ? 'builtin-d20-fantasy'
      : catalog.ruleProfileKey === 'd100-investigation'
        ? 'builtin-d100-investigation'
        : 'builtin-storyforge'
  value.progressionMode = catalog.ruleProfileKey === 'rank-lite' ? 'rank-lite' : 'rule-native'
  value.startingLevelOrTier = catalog.ruleProfileKey === 'rank-lite'
    ? 'C'
    : catalog.ruleProfileKey === 'd20-fantasy' ? '1' : '规则默认'
  value.instruction = `依据“${catalog.title}”制作并主持一场完整跑团。${catalog.summary}`
  value.background = catalog.summary
  value.coreConflict = catalog.storyArcs[0]?.description ?? catalog.summary
  value.seats = selection.characterExportIds.slice(0, 4).map((exportId, index) => ({
    seatKey: `player.${index + 1}`,
    label: catalog.characters[exportId]?.name ?? `玩家 ${index + 1}`,
    controller: index === 0 ? 'human' : 'ai',
    role: 'player', characterMode: 'world-template', sourceCharacterExportId: exportId,
    characterName: catalog.characters[exportId]?.name ?? '', rankTier: null, privateGoal: '',
  }))
  if (!value.seats.length) {
    value.seats = [{
      seatKey: 'player.1', label: '玩家 1', controller: 'human', role: 'player',
      characterMode: 'ai-generated', sourceCharacterExportId: null,
      characterName: '', rankTier: null, privateGoal: '',
    }]
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function TtrpgProductionWorkspace(props: {
  scope: WorkspaceScope
  worldGroupId: number | null
  initialWorldHandoff?: WorldGameProductionHandoffV2 | null
  onSessionCreated?: (sessionId: number) => void
}) {
  const [productions, setProductions] = useState<TtrpgProductionRecordV1[]>([])
  const [productionId, setProductionId] = useState<number | null>(null)
  const [details, setDetails] = useState<TtrpgProductionDetailsV1 | null>(null)
  const [fixtureKey, setFixtureKey] = useState<TtrpgDevelopmentSourceFixtureKeyV1>('d100-investigation-archive')
  const [title, setTitle] = useState('封蜡档案调查团')
  const [premise, setPremise] = useState('调查被改写的证词，在压力失控前找出真正的航行记录。')
  const [toneText, setToneText] = useState('调查、克制、团队协作')
  const [wizard, setWizard] = useState(createDefaultTtrpgProductionWizardValueV2)
  const [initializedSourceId, setInitializedSourceId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [mediaRightsConfirmed, setMediaRightsConfirmed] = useState(false)
  const [generatedMediaCandidate, setGeneratedMediaCandidate] = useState<TtrpgProductionMediaCandidateV1 | null>(null)
  const [generatedMediaPreviewUrl, setGeneratedMediaPreviewUrl] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async (preferredId?: number | null) => {
    const rows = await listTtrpgProductionsV1(props.scope)
    setProductions(rows)
    const selectedId = preferredId ?? productionId ?? rows[0]?.id ?? null
    setProductionId(selectedId)
    setDetails(selectedId == null ? null : await readTtrpgProductionDetailsV1(props.scope, selectedId))
  }, [productionId, props.scope])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!generatedMediaCandidate) {
      setGeneratedMediaPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(new Blob(
      [generatedMediaCandidate.candidate.data],
      { type: generatedMediaCandidate.candidate.mimeType },
    ))
    setGeneratedMediaPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [generatedMediaCandidate])

  const source = useMemo(() => {
    const row = details?.sourceSelections.find(item => item.id === details.production.activeSourceSelectionId)
    if (!row) return null
    try {
      const catalog = JSON.parse(row.sourceCatalogJson) as TtrpgProductionSourceCatalogV1
      const productSelection = JSON.parse(row.selectionJson) as TtrpgProductionSourceSelectionV1
      const facets = sourceFacets({ catalog, selection: productSelection })
      return { row, catalog, productSelection, options: facets.options, sourceSelection: facets.selection }
    } catch { return null }
  }, [details])

  useEffect(() => {
    if (!source || source.row.id === initializedSourceId) return
    setWizard(wizardForSource(source.catalog, source.sourceSelection))
    setTitle(details?.production.title ?? source.catalog.title)
    setPremise(source.catalog.storyArcs[0]?.description ?? source.catalog.summary)
    setInitializedSourceId(source.row.id ?? null)
  }, [details?.production.title, initializedSourceId, source])

  const currentBuild = details?.builds.find(row => row.id === details.production.currentBuildId) ?? null
  const currentMedia = useMemo(() => {
    if (!currentBuild || !details) return []
    return details.mediaAssets
      .filter(row => row.buildId === currentBuild.id && row.status !== 'superseded')
      .sort((left, right) => Number(right.productionRequired) - Number(left.productionRequired)
        || left.kind.localeCompare(right.kind) || left.slotKey.localeCompare(right.slotKey))
  }, [currentBuild, details])
  const availableMediaCount = currentMedia.filter(row => row.status === 'available').length
  const missingRequiredMediaCount = currentMedia.filter(row => row.productionRequired && row.status !== 'available').length

  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await task() } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const createProduction = () => run(async () => {
    const key = `ttrpg.${fixtureKey}.${crypto.randomUUID()}`
    const created = await createTtrpgDevelopmentProductionV1({
      scope: props.scope, fixtureKey, productionKey: key, title,
    })
    setInitializedSourceId(null)
    await refresh(created.production.id)
    setMessage('已冻结一份跑团专属开发来源。后续修改不会偷读世界引擎活动工作表。')
  })

  const confirmBrief = () => run(async () => {
    if (!details || !source) throw new Error('请先冻结产品来源')
    if (!wizard.confirmAll) throw new Error('请在向导第 9 步完成全部作者确认')
    const tones = toneText.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean)
    await confirmTtrpgProductionBriefV1({
      scope: props.scope, productionId: details.production.id!, title,
      premise, tone: tones.length ? tones : ['角色驱动'],
      scale: {
        scope: wizard.targetSessions > 4 ? 'campaign' : 'short-arc',
        targetPlayMinutes: wizard.targetSessions * wizard.targetSessionMinutes,
        targetEndingCount: wizard.targetEndingCount,
      },
      contentBoundaries: wizard.linesText.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      confirmDefaultMappings: true,
      draft: toTtrpgProductionBriefDraftInputV2({
        value: wizard, sourceOptions: source.options, sourceSelection: source.sourceSelection,
        openingSituation: premise,
      }),
    })
    await refresh(details.production.id)
    setMessage('Brief 已作为新 revision 冻结；旧 Build 如存在会显式失效。')
  })

  const buildPreview = () => run(async () => {
    if (!details) throw new Error('请先建立生产任务')
    const build = await buildTtrpgProductionPreviewV1({ scope: props.scope, productionId: details.production.id! })
    await refresh(details.production.id)
    setMessage(`Build #${build.buildNumber} 已通过规则、战役图、线索、车卡与反例验证，可以开桌试玩。`)
  })

  const acceptPreview = () => run(async () => {
    if (!details || !currentBuild) throw new Error('当前没有可确认的 Build')
    await acceptTtrpgAuthorPreviewV1({
      scope: props.scope, productionId: details.production.id!, buildId: currentBuild.id!,
    })
    await refresh(details.production.id)
    setMessage('作者已确认当前试玩 Build；开发来源仍不具备正式发布资格。')
  })

  const startPreview = () => run(async () => {
    if (!currentBuild) throw new Error('当前没有可试玩 Build')
    const session = await createPlayableGameInstance({
      scope: props.scope,
      source: { kind: 'ttrpg-build', ttrpgBuildId: currentBuild.id!, expectedBuildHash: currentBuild.buildHash },
      title: `${details?.production.title ?? title} · 试玩`,
      worldGroupId: props.worldGroupId,
    })
    setMessage(`试玩桌 #${session.id} 已建立，进入主持与游玩。`)
    props.onSessionCreated?.(session.id!)
  })

  const importMedia = (row: typeof currentMedia[number], file: File) => run(async () => {
    if (!currentBuild) throw new Error('当前没有可绑定媒资的 Build')
    if (!mediaRightsConfirmed) throw new Error('请先确认你拥有该素材的使用与商业化权利')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('当前生产素材只接受 PNG、JPEG 或 WebP 图片')
    }
    await acceptTtrpgProductionMediaAssetV1({
      scope: props.scope,
      buildId: currentBuild.id!,
      slotKey: row.slotKey,
      expectedSpecHash: row.specHash,
      data: await file.arrayBuffer(),
      declaredMimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
      provider: null,
      rights: {
        sourceKind: 'author-owned-import',
        license: 'author-owned-or-author-authorized',
        attribution: file.name,
        authorConfirmed: true,
      },
    })
    await refresh(details!.production.id)
    setMessage(`已验收 ${row.slotKey}：真实类型、尺寸、内容哈希与版权确认均已记录。`)
  })

  const generateMediaCandidate = (row: typeof currentMedia[number]) => run(async () => {
    if (!currentBuild) throw new Error('当前没有可生成媒资的 Build')
    const value = await requestConfiguredTtrpgProductionMediaCandidateV1({
      scope: props.scope,
      buildId: currentBuild.id!,
      slotKey: row.slotKey,
      expectedSpecHash: row.specHash,
    })
    setGeneratedMediaCandidate(value)
    setMessage(`已生成 ${row.slotKey} 的内存候选；尚未写入 Build，请检查画面后决定采用或丢弃。`)
  })

  const acceptGeneratedMedia = () => run(async () => {
    if (!generatedMediaCandidate) throw new Error('当前没有待采用候选')
    if (!mediaRightsConfirmed) throw new Error('请先确认供应商条款和当前作品使用权利')
    const slotKey = generatedMediaCandidate.slotKey
    await acceptTtrpgGeneratedMediaCandidateV1({
      scope: props.scope,
      value: generatedMediaCandidate,
      authorConfirmed: true,
    })
    setGeneratedMediaCandidate(null)
    await refresh(details!.production.id)
    setMessage(`已采用 ${slotKey} 的 AI 候选并冻结其回执、版权策略和内容哈希。`)
  })

  return <div className="space-y-5 p-5" data-testid="ttrpg-production-workspace">
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary"><Sparkles className="h-4 w-4 text-accent" />跑团专属生产线</div>
          <p className="mt-2 max-w-4xl text-[11px] leading-5 text-text-muted">冻结来源 → 完整 Brief → 规则/车卡/战役/媒资计划 Build → 真实开桌试玩 → 作者确认。当前提供三套完整开发来源来继续上层施工；最终 WorldRelease 适配器接入后，沿用同一生产协议开放正式发布。</p>
        </div>
        <span className="rounded bg-warning/10 px-3 py-1.5 text-[10px] text-warning">开发 Build 可试玩 · 正式发布锁定</span>
      </div>
      {props.initialWorldHandoff && <p className="mt-3 rounded border border-warning/30 bg-warning/5 p-3 text-[10px] leading-5 text-warning" data-testid="ttrpg-world-handoff-pending">已收到世界引擎制作意图。当前不会降级读取活动工作表；待最终世界适配器完成后，把该冻结 Release 转换为跑团专属来源选择。</p>}
    </section>

    <section className="grid gap-4 rounded-lg border border-border bg-bg-elevated p-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1.2fr)]">
      <div className="space-y-3">
        <label className="grid gap-1 text-[10px] text-text-muted">已有生产任务
          <select data-testid="ttrpg-production-select" value={productionId ?? ''} onChange={event => { const id = Number(event.target.value) || null; setProductionId(id); setInitializedSourceId(null); void refresh(id) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
            <option value="">新建生产任务</option>
            {productions.map(row => <option key={row.id} value={row.id}>{row.title} · {STATUS_LABEL[row.status] ?? row.status}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[10px] text-text-muted">开发来源
          <select data-testid="ttrpg-development-fixture" value={fixtureKey} onChange={event => setFixtureKey(event.target.value as TtrpgDevelopmentSourceFixtureKeyV1)} disabled={busy || details != null} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
            {FIXTURES.map(row => <option key={row.key} value={row.key}>{row.title}</option>)}
          </select>
        </label>
        <p className="text-[10px] leading-5 text-text-muted">{FIXTURES.find(row => row.key === fixtureKey)?.summary}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-[10px] text-text-muted">战役标题<input data-testid="ttrpg-production-title" value={title} onChange={event => setTitle(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label>
        <label className="grid gap-1 text-[10px] text-text-muted">基调<input value={toneText} onChange={event => setToneText(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label>
        <label className="grid gap-1 text-[10px] text-text-muted md:col-span-2">开场与核心问题<textarea data-testid="ttrpg-production-premise" rows={3} value={premise} onChange={event => setPremise(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label>
        {!details && <button data-testid="ttrpg-freeze-source" disabled={busy || !title.trim()} onClick={createProduction} className="flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40 md:col-span-2"><Plus className="h-4 w-4" />冻结开发来源并开始制作</button>}
      </div>
    </section>

    {details && source && <>
      <section className="grid gap-3 rounded-lg border border-border bg-bg-elevated p-4 md:grid-cols-4" data-testid="ttrpg-source-summary">
        <div><div className="text-[9px] text-text-muted">来源</div><strong className="text-xs">{source.catalog.title}</strong></div>
        <div><div className="text-[9px] text-text-muted">角色 / 地点</div><strong className="text-xs">{source.productSelection.characterKeys.length} / {source.productSelection.locationKeys.length}</strong></div>
        <div><div className="text-[9px] text-text-muted">规则</div><strong className="text-xs">{source.catalog.ruleProfileKey}</strong></div>
        <div><div className="text-[9px] text-text-muted">冻结 hash</div><code className="text-[9px]">{source.row.selectionHash.slice(0, 16)}…</code></div>
      </section>
      <TtrpgProductionWizard scope={props.scope} value={wizard} onChange={setWizard} sourceOptions={source.options} sourceSelection={source.sourceSelection} sourceLabel="跑团专属冻结来源" />
      <section className="rounded-lg border border-border bg-bg-elevated p-5" data-testid="ttrpg-production-actions">
        <div className="flex flex-wrap gap-2">
          <button data-testid="ttrpg-confirm-brief" disabled={busy || !wizard.confirmAll} onClick={confirmBrief} className="rounded border border-accent px-3 py-2 text-xs text-accent disabled:opacity-40">确认并冻结 Brief</button>
          <button data-testid="ttrpg-build-preview" disabled={busy || details.production.activeBriefId == null || details.production.status === 'building'} onClick={buildPreview} className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{busy && details.production.status === 'building' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}生成完整 Build</button>
          <button data-testid="ttrpg-start-preview" disabled={busy || !currentBuild || !['preview-ready', 'validated', 'release-ready'].includes(currentBuild.status)} onClick={startPreview} className="flex items-center gap-2 rounded bg-success px-3 py-2 text-xs text-white disabled:opacity-40"><Play className="h-4 w-4" />开桌试玩</button>
          <button data-testid="ttrpg-accept-preview" disabled={busy || currentBuild?.status !== 'preview-ready'} onClick={acceptPreview} className="flex items-center gap-2 rounded border border-success px-3 py-2 text-xs text-success disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />作者确认试玩</button>
          <button disabled={busy} onClick={() => void refresh(details.production.id)} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-muted"><RefreshCw className="h-4 w-4" />刷新</button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          {details.steps.slice().sort((a, b) => a.attempt - b.attempt).map(step => <div key={step.id} className="rounded border border-border bg-bg-base p-2 text-[9px] text-text-muted">{step.status === 'completed' ? <CheckCircle2 className="mb-1 h-3 w-3 text-success" /> : <Circle className="mb-1 h-3 w-3" />}<strong className="block text-[10px] text-text-primary">{step.stepKey}</strong>attempt {step.attempt} · {step.status}</div>)}
        </div>
        {currentBuild && <div className="mt-4 rounded border border-border bg-bg-base p-3 text-[10px] leading-5 text-text-muted"><strong className="text-text-primary">Build #{currentBuild.buildNumber} · {currentBuild.status}</strong><br />规则 {currentBuild.rulePackHash.slice(0, 12)}… · 战役 {currentBuild.campaignHash.slice(0, 12)}… · Build {currentBuild.buildHash.slice(0, 12)}…</div>}
      </section>
      {currentBuild && <section className="rounded-lg border border-border bg-bg-elevated p-5" data-testid="ttrpg-production-media-ledger">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary"><ImagePlus className="h-4 w-4 text-accent" />生产媒资账本</div>
            <p className="mt-1 text-[10px] leading-5 text-text-muted">每个槽位保留规格、文字 fallback、素材版本、内容哈希与权利证据。开发试玩允许缺图；正式发布会阻止任何生产期必需槽位缺失。</p>
          </div>
          <div className="rounded border border-border bg-bg-base px-3 py-2 text-[10px] text-text-muted">
            已完成 <strong className="text-success">{availableMediaCount}</strong> / {currentMedia.length}
            {' · '}必需缺失 <strong className={missingRequiredMediaCount ? 'text-warning' : 'text-success'}>{missingRequiredMediaCount}</strong>
          </div>
        </div>
        <label className="mt-3 flex items-start gap-2 rounded border border-warning/20 bg-warning/5 p-3 text-[10px] leading-5 text-warning">
          <input data-testid="ttrpg-media-rights-confirm" type="checkbox" checked={mediaRightsConfirmed} onChange={event => setMediaRightsConfirmed(event.target.checked)} />
          我确认上传素材由我拥有或已获授权；采用 AI 候选时，我也确认已审阅对应供应商条款和当前作品使用权。系统会把确认与素材版本一起记录。
        </label>
        <div className="mt-3 grid max-h-[28rem] gap-2 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
          {currentMedia.map(row => <article key={row.id} className="rounded border border-border bg-bg-base p-3 text-[10px]" data-testid={`ttrpg-media-slot-${row.slotKey}`}>
            <div className="flex items-start justify-between gap-2">
              <div><strong className="text-text-primary">{row.slotKey}</strong><div className="mt-1 text-text-muted">{row.kind} · {row.width ?? '自适应'}×{row.height ?? '自适应'}</div></div>
              <span className={`rounded px-2 py-1 text-[9px] ${row.status === 'available' ? 'bg-success/10 text-success' : row.productionRequired ? 'bg-warning/10 text-warning' : 'bg-bg-elevated text-text-muted'}`}>{row.status === 'available' ? `v${row.version} 已验收` : row.productionRequired ? '必需 · 待素材' : '可文字降级'}</span>
            </div>
            <p className="mt-2 line-clamp-3 leading-5 text-text-muted">{row.altText} · fallback：{row.fallbackText}</p>
            {row.contentHash && <code className="mt-2 block text-[9px] text-text-muted">{row.contentHash.slice(0, 20)}…</code>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => void generateMediaCandidate(row)} className="rounded border border-accent px-2 py-2 text-[10px] text-accent disabled:opacity-40"><Sparkles className="mr-1 inline h-3.5 w-3.5" />AI 候选</button>
              <label className={`flex cursor-pointer items-center justify-center gap-1 rounded border px-2 py-2 ${mediaRightsConfirmed && !busy ? 'border-accent text-accent' : 'pointer-events-none border-border text-text-muted opacity-50'}`}>
                <ImagePlus className="h-3.5 w-3.5" />{row.status === 'available' ? '导入新版' : '导入验收'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy || !mediaRightsConfirmed} onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) void importMedia(row, file)
                  event.currentTarget.value = ''
                }} />
              </label>
            </div>
          </article>)}
          {currentMedia.length === 0 && <p className="text-[10px] text-text-muted">当前 Brief 未要求美术素材；运行时保持纯文字表现。</p>}
        </div>
        {generatedMediaCandidate && <div className="mt-4 grid gap-4 rounded border border-accent/30 bg-accent/5 p-4 md:grid-cols-[minmax(14rem,0.8fr)_minmax(18rem,1.2fr)]" data-testid="ttrpg-generated-media-candidate">
          <div className="overflow-hidden rounded border border-border bg-bg-base">
            {generatedMediaPreviewUrl && <img src={generatedMediaPreviewUrl} alt={`候选：${generatedMediaCandidate.slotKey}`} className="h-full max-h-80 w-full object-contain" />}
          </div>
          <div className="text-[10px] leading-5 text-text-muted">
            <strong className="text-xs text-text-primary">待采用候选 · {generatedMediaCandidate.slotKey}</strong>
            <p className="mt-2">Adapter：{generatedMediaCandidate.candidate.adapterId}<br />MIME：{generatedMediaCandidate.candidate.mimeType} · {generatedMediaCandidate.candidate.byteSize} bytes<br />内容 hash：{generatedMediaCandidate.candidate.contentHash.slice(0, 24)}…<br />回执：{generatedMediaCandidate.providerReceiptHash.slice(0, 24)}…</p>
            <p className="mt-2 text-warning">候选仍只在内存中。采用后才会写入素材账本；丢弃不会留下正式素材记录。</p>
            <div className="mt-3 flex gap-2">
              <button data-testid="ttrpg-accept-generated-media" disabled={busy || !mediaRightsConfirmed} onClick={acceptGeneratedMedia} className="rounded bg-success px-3 py-2 text-[10px] text-white disabled:opacity-40">确认采用</button>
              <button disabled={busy} onClick={() => setGeneratedMediaCandidate(null)} className="rounded border border-border px-3 py-2 text-[10px] text-text-muted">丢弃候选</button>
            </div>
          </div>
        </div>}
      </section>}
    </>}

    {(message || error) && <div role="status" className={`rounded border p-3 text-xs ${error ? 'border-error/30 bg-error/5 text-error' : 'border-success/30 bg-success/5 text-success'}`}>{error || message}</div>}
    <section className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-[10px] leading-5 text-warning"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" />正式出口边界</div>开发 fixture 的 Build 只能试玩和验证，不能生成 Product Release。世界引擎适配器最终接入时必须重新冻结真实 WorldRelease 来源并重新 Build；不会把开发来源伪装成正式世界发布。</section>
  </div>
}
