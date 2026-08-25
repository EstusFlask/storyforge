import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  GitCompareArrows,
  ImagePlus,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
} from 'lucide-react'
import type {
  CharacterInteractionBriefGuestV1,
  CharacterInteractionBriefV1,
  CharacterInteractionProductionRecordV1,
  CharacterInteractionProductionStepKeyV1,
  CharacterInteractionWorldSourceCatalogV1,
  CharacterInteractionWorldSourceTableV1,
  WorkspaceScope,
  WorldRelease,
} from '../../lib/types'
import { CHARACTER_INTERACTION_PRODUCTION_STEPS_V1 } from '../../lib/types'
import { listWorldReleases } from '../../lib/world-engine/releases'
import { loadCharacterInteractionWorldSourceCatalogV1 } from '../../lib/character-interaction/world-source'
import {
  buildCharacterInteractionBriefV1,
  confirmCharacterInteractionBriefV1,
  createCharacterInteractionProductionV1,
  listCharacterInteractionProductionsV1,
  type CharacterInteractionBriefInputV1,
  type CharacterInteractionProductionBundleV1,
} from '../../lib/character-interaction/production'
import {
  attachCharacterInteractionMediaAssetV1,
  confirmCharacterInteractionStepCandidateV1,
  degradeCharacterInteractionMediaAssetV1,
  generateCharacterInteractionStepCandidateV1,
  publishCharacterInteractionProductReleaseV1,
  prepareCharacterInteractionWorldUpgradeCandidateV1,
  applyCharacterInteractionWorldUpgradeV1,
  recoverInterruptedCharacterInteractionProductionsV1,
  readCharacterInteractionProductionDetailsV1,
  type CharacterInteractionProductionDetailsV1,
} from '../../lib/character-interaction/production-pipeline'
import {
  CHARACTER_INTERACTION_AI_PRODUCTION_STEPS_V1,
  runCharacterInteractionProductionStepV1,
  type CharacterInteractionAIProductionStepV1,
} from '../../lib/character-interaction/production-harness'
import { useAIConfigStore } from '../../stores/ai-config'

type OptionalSourceTable = Exclude<
  CharacterInteractionWorldSourceTableV1,
  'characters' | 'workCharacterBindings' | 'characterRelations'
>

const OPTIONAL_GROUPS: ReadonlyArray<{ table: OptionalSourceTable; label: string }> = [
  { table: 'importantLocations', label: '地点' },
  { table: 'worldRulesProfiles', label: '世界规则' },
  { table: 'worldviews', label: '世界观' },
  { table: 'codexEntries', label: '设定词条' },
  { table: 'storyCores', label: '故事核心' },
  { table: 'storyArcs', label: '故事线' },
  { table: 'outlineNodes', label: '大纲子图' },
  { table: 'narrativeModules', label: '叙事模块' },
]

interface BriefFormState {
  title: string
  userInstruction: string
  userRole: CharacterInteractionBriefInputV1['userRole']
  storyMode: CharacterInteractionBriefInputV1['storyMode']
  timeContext: string
  locationContext: string
  historicalContext: string
  chatGoal: string
  desiredDirections: string
  safetyBoundaries: string
  publicKnowledge: string
  privateKnowledge: string
  prohibitedDisclosure: string
  sceneCount: number
  maxTurnsPerScene: number
  directorBudget: number
  endingStrategy: CharacterInteractionBriefV1['runtime']['endingStrategy']
  mediaTier: CharacterInteractionBriefInputV1['mediaTier']
  allowWorldFeedbackCandidate: boolean
}

const EMPTY_FORM: BriefFormState = {
  title: '未命名角色互动',
  userInstruction: '',
  userRole: 'self',
  storyMode: 'new-event',
  timeContext: '原故事终局之后',
  locationContext: '',
  historicalContext: '',
  chatGoal: '',
  desiredDirections: '',
  safetyBoundaries: '不推翻已发布世界事实',
  publicKnowledge: '',
  privateKnowledge: '',
  prohibitedDisclosure: '',
  sceneCount: 1,
  maxTurnsPerScene: 80,
  directorBudget: 12,
  endingStrategy: 'open-ended',
  mediaTier: 'text-core',
  allowWorldFeedbackCandidate: false,
}

function lines(value: string): string[] {
  return [...new Set(value.split('\n').map(item => item.trim()).filter(Boolean))]
}

function formToInput(form: BriefFormState, guests: CharacterInteractionBriefGuestV1[]): CharacterInteractionBriefInputV1 {
  return {
    title: form.title,
    userInstruction: form.userInstruction,
    userRole: form.userRole,
    guests,
    storyMode: form.storyMode,
    timeContext: form.timeContext,
    locationContext: form.locationContext,
    historicalContext: form.historicalContext,
    chatGoal: form.chatGoal,
    desiredDirections: lines(form.desiredDirections),
    safetyBoundaries: lines(form.safetyBoundaries),
    publicKnowledge: lines(form.publicKnowledge),
    privateKnowledge: lines(form.privateKnowledge),
    prohibitedDisclosure: lines(form.prohibitedDisclosure),
    sceneCount: form.sceneCount,
    maxTurnsPerScene: form.maxTurnsPerScene,
    directorBudget: form.directorBudget,
    endingStrategy: form.endingStrategy,
    mediaTier: form.mediaTier,
    allowWorldFeedbackCandidate: form.allowWorldFeedbackCandidate,
  }
}

function briefToForm(brief: CharacterInteractionBriefV1): BriefFormState {
  return {
    title: brief.title,
    userInstruction: brief.userInstruction,
    userRole: brief.userRole,
    storyMode: brief.setting.storyMode,
    timeContext: brief.setting.timeContext,
    locationContext: brief.setting.locationContext,
    historicalContext: brief.setting.historicalContext,
    chatGoal: brief.setting.chatGoal,
    desiredDirections: brief.setting.desiredDirections.join('\n'),
    safetyBoundaries: brief.setting.safetyBoundaries.join('\n'),
    publicKnowledge: brief.knowledgePolicy.publicKnowledge.join('\n'),
    privateKnowledge: brief.knowledgePolicy.privateKnowledge.join('\n'),
    prohibitedDisclosure: brief.knowledgePolicy.prohibitedDisclosure.join('\n'),
    sceneCount: brief.runtime.sceneCount,
    maxTurnsPerScene: brief.runtime.maxTurnsPerScene,
    directorBudget: brief.runtime.directorBudget,
    endingStrategy: brief.runtime.endingStrategy,
    mediaTier: brief.media.tier,
    allowWorldFeedbackCandidate: brief.worldFeedback.allowCandidate,
  }
}

function productionKey(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `interaction:${Date.now().toString(36)}:${random}`
}

export default function CharacterInteractionProductionStudio({ scope }: { scope: WorkspaceScope }) {
  const aiConfig = useAIConfigStore(state => state.config)
  const [releases, setReleases] = useState<WorldRelease[]>([])
  const [productions, setProductions] = useState<CharacterInteractionProductionRecordV1[]>([])
  const [releaseId, setReleaseId] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<CharacterInteractionWorldSourceCatalogV1 | null>(null)
  const [participants, setParticipants] = useState<number[]>([])
  const [optional, setOptional] = useState<Partial<Record<OptionalSourceTable, number[]>>>({})
  const [guests, setGuests] = useState<CharacterInteractionBriefGuestV1[]>([])
  const [form, setForm] = useState<BriefFormState>(EMPTY_FORM)
  const [current, setCurrent] = useState<CharacterInteractionProductionBundleV1 | null>(null)
  const [details, setDetails] = useState<CharacterInteractionProductionDetailsV1 | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [upgradeReleaseId, setUpgradeReleaseId] = useState<number | null>(null)
  const [upgradeCatalog, setUpgradeCatalog] = useState<CharacterInteractionWorldSourceCatalogV1 | null>(null)
  const [upgradeParticipants, setUpgradeParticipants] = useState<number[]>([])

  const refreshIndex = async () => {
    const [nextReleases, nextProductions] = await Promise.all([
      listWorldReleases(scope),
      listCharacterInteractionProductionsV1(scope),
    ])
    setReleases(nextReleases)
    setProductions(nextProductions)
    return { nextReleases, nextProductions }
  }

  const showBundle = (bundle: CharacterInteractionProductionBundleV1) => {
    setCurrent(bundle)
    setReleaseId(bundle.selection.worldReleaseId)
    setCatalog(bundle.catalog)
    setParticipants([...bundle.selection.participantCharacterExportIds])
    setOptional(Object.fromEntries(bundle.selection.recordSelections
      .filter(item => item.table !== 'characters' && item.table !== 'workCharacterBindings' && item.table !== 'characterRelations')
      .map(item => [item.table, [...item.exportIds]])) as Partial<Record<OptionalSourceTable, number[]>>)
    setGuests(bundle.brief.guests.map(item => ({ ...item })))
    setForm(briefToForm(bundle.brief))
  }

  const loadProduction = async (productionId: number) => {
    const next = await readCharacterInteractionProductionDetailsV1({ scope, productionId })
    showBundle(next)
    setDetails(next)
    return next
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void recoverInterruptedCharacterInteractionProductionsV1(scope).then(() => refreshIndex()).then(async ({ nextReleases, nextProductions }) => {
      if (cancelled) return
      if (nextProductions[0]?.id) {
        const bundle = await readCharacterInteractionProductionDetailsV1({ scope, productionId: nextProductions[0].id })
        if (!cancelled) { showBundle(bundle); setDetails(bundle) }
      } else if (nextReleases[0]?.id) {
        const nextCatalog = await loadCharacterInteractionWorldSourceCatalogV1({
          scope,
          worldReleaseId: nextReleases[0].id,
        })
        if (!cancelled) {
          setReleaseId(nextReleases[0].id)
          setCatalog(nextCatalog)
        }
      }
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.projectId, scope.worldId, scope.workId])

  const sourceLocked = current != null
  const confirmed = current?.briefRecord.status === 'confirmed'
  const characterOptions = catalog?.records.characters ?? []
  const selectedCount = participants.length + guests.length
  const setField = <K extends keyof BriefFormState>(key: K, value: BriefFormState[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
  }
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }
  const chooseRelease = (id: number) => run(async () => {
    const next = await loadCharacterInteractionWorldSourceCatalogV1({ scope, worldReleaseId: id })
    setReleaseId(id); setCatalog(next); setParticipants([]); setOptional({})
  })
  const toggleParticipant = (id: number) => {
    if (sourceLocked) return
    setParticipants(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }
  const toggleOptional = (table: OptionalSourceTable, id: number) => {
    if (sourceLocked) return
    setOptional(previous => {
      const ids = previous[table] ?? []
      return { ...previous, [table]: ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id] }
    })
  }
  const addGuest = () => {
    if (sourceLocked || selectedCount >= 8) return
    setGuests(previous => [...previous, {
      guestKey: `guest:custom-${Date.now().toString(36)}-${previous.length + 1}`,
      name: '', relationToWorld: '', profile: '',
    }])
  }
  const updateGuest = (index: number, patch: Partial<CharacterInteractionBriefGuestV1>) => {
    if (sourceLocked) return
    setGuests(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const freeze = () => run(async () => {
    if (!releaseId) throw new Error('请先选择 WorldRelease。')
    const bundle = await createCharacterInteractionProductionV1({
      scope,
      productionKey: productionKey(),
      worldReleaseId: releaseId,
      participantCharacterExportIds: participants,
      optionalRecordSelections: OPTIONAL_GROUPS.flatMap(({ table }) => (
        optional[table]?.length ? [{ table, exportIds: optional[table]! }] : []
      )),
      brief: formToInput(form, guests),
    })
    showBundle(bundle)
    setDetails(null)
    await refreshIndex()
    setMessage('SourceSelection 已冻结，生产根与 Brief 草稿已原子保存；正式 AI 和产品表写入仍被阻止。')
  })
  const confirm = () => run(async () => {
    if (!current) return
    const nextBrief = buildCharacterInteractionBriefV1({
      catalog: current.catalog,
      selection: current.selection,
      brief: formToInput(form, guests),
    })
    const bundle = await confirmCharacterInteractionBriefV1({
      scope,
      productionId: current.production.id,
      brief: nextBrief,
    })
    showBundle(bundle)
    setDetails(await readCharacterInteractionProductionDetailsV1({ scope, productionId: bundle.production.id }))
    await refreshIndex()
    setMessage('Brief 已确认并追加不可变 revision；Run Contract 已冻结为候选只写、禁止世界回写。')
  })
  const reset = () => {
    setCurrent(null); setDetails(null); setParticipants([]); setOptional({}); setGuests([]); setForm(EMPTY_FORM)
    const latest = releases[0]
    if (latest?.id) void chooseRelease(latest.id)
  }

  const selectedSummary = useMemo(() => current?.selection.recordSelections
    .map(item => `${item.table}:${item.exportIds.length}`).join(' · ') ?? '', [current])

  const latestStep = (stepKey: CharacterInteractionProductionStepKeyV1) => details?.steps
    .filter(item => item.stepKey === stepKey)
    .sort((left, right) => right.attempt - left.attempt)[0] ?? null
  const runStep = (stepKey: CharacterInteractionProductionStepKeyV1) => run(async () => {
    if (!current) return
    await generateCharacterInteractionStepCandidateV1({ scope, productionId: current.production.id, stepKey })
    await loadProduction(current.production.id)
    setMessage(`${stepKey} 候选已持久化；请检查后人工确认。`)
  })
  const runAIStep = (stepKey: CharacterInteractionAIProductionStepV1) => run(async () => {
    if (!current) return
    const result = await runCharacterInteractionProductionStepV1({
      scope,
      productionId: current.production.id,
      stepKey,
      authorDirection: form.userInstruction,
      aiConfig,
    })
    await loadProduction(current.production.id)
    setMessage(`${stepKey} AI 候选已通过冻结来源校验并持久化（Run ${result.snapshot.run.id}）；仍需作者确认。`)
  })
  const confirmStep = (stepKey: CharacterInteractionProductionStepKeyV1) => run(async () => {
    if (!current) return
    const step = latestStep(stepKey)
    if (!step?.candidateArtifactId) throw new Error('当前步骤没有等待确认的候选。')
    await confirmCharacterInteractionStepCandidateV1({
      scope, productionId: current.production.id, artifactId: step.candidateArtifactId,
    })
    await loadProduction(current.production.id)
    await refreshIndex()
    setMessage(`${stepKey} 已由作者确认。`)
  })
  const attachMedia = (slotKey: string, specHash: string, file: File) => run(async () => {
    if (!current) return
    await attachCharacterInteractionMediaAssetV1({
      scope, productionId: current.production.id, slotKey, expectedSpecHash: specHash,
      data: await file.arrayBuffer(), mimeType: file.type,
      rights: { sourceKind: 'author-owned-import', license: 'author-owned', authorConfirmed: true },
    })
    await loadProduction(current.production.id)
    await refreshIndex()
    setMessage(`媒资 ${slotKey} 已通过内容哈希校验并绑定。`)
  })
  const degradeMedia = (slotKey: string, specHash: string) => run(async () => {
    if (!current) return
    await degradeCharacterInteractionMediaAssetV1({
      scope, productionId: current.production.id, slotKey, expectedSpecHash: specHash,
      reason: '作者确认当前版本使用文字 fallback；后续通过新制作版本补充媒资。',
    })
    await loadProduction(current.production.id)
    await refreshIndex()
    setMessage(`媒资 ${slotKey} 已显式降级为文字 fallback。`)
  })
  const publish = () => run(async () => {
    if (!current) return
    const result = await publishCharacterInteractionProductReleaseV1({ scope, productionId: current.production.id })
    await loadProduction(current.production.id)
    await refreshIndex()
    setMessage(`CharacterInteraction Product Release v${result.productRelease.version} 已发布，可在玩家模式创建正式 Instance。`)
  })
  const upgradeCandidate = details?.artifacts.filter(item => item.kind === 'world-upgrade-plan' && item.status === 'candidate')
    .sort((left, right) => right.revision - left.revision)[0] ?? null
  const prepareUpgrade = () => run(async () => {
    if (!current || !upgradeReleaseId) return
    const [artifact, nextCatalog] = await Promise.all([
      prepareCharacterInteractionWorldUpgradeCandidateV1({
        scope, productionId: current.production.id, newWorldReleaseId: upgradeReleaseId,
      }),
      loadCharacterInteractionWorldSourceCatalogV1({ scope, worldReleaseId: upgradeReleaseId }),
    ])
    const plan = JSON.parse(artifact.payloadJson) as { participantMappings: Array<{ newExportId: number | null }> }
    setUpgradeCatalog(nextCatalog)
    setUpgradeParticipants(plan.participantMappings.map(item => item.newExportId).filter((id): id is number => id != null))
    await loadProduction(current.production.id)
    setMessage('世界升级方案已冻结为候选；旧 Production、Product Release 和存档仍绑定原版本。')
  })
  const applyUpgrade = () => run(async () => {
    if (!current || !upgradeCandidate) return
    const next = await applyCharacterInteractionWorldUpgradeV1({
      scope, productionId: current.production.id, upgradeArtifactId: upgradeCandidate.id!,
      productionKey: productionKey(), participantCharacterExportIds: upgradeParticipants.length ? upgradeParticipants : undefined,
    })
    showBundle(next)
    setDetails(await readCharacterInteractionProductionDetailsV1({ scope, productionId: next.production.id }))
    setUpgradeReleaseId(null); setUpgradeCatalog(null); setUpgradeParticipants([])
    await refreshIndex()
    setMessage('已从升级候选创建新的 Production；原版本保持不可变，新版本需要重新确认 Brief 与生产。')
  })

  if (loading) return <div className="storygame-author-empty"><Loader2 className="h-7 w-7 animate-spin" /><h2>加载角色互动生产来源…</h2></div>

  return <div className="storygame-author">
    <aside className="storygame-author-sidebar">
      <div className="storygame-author-sidebar-head"><strong>正式制作</strong><ShieldCheck className="h-4 w-4 text-accent" /></div>
      <div className="storygame-author-game-list">{productions.map(item => <button key={item.id} className={item.id === current?.production.id ? 'active' : ''} onClick={() => void run(async () => { await loadProduction(item.id!) })}><strong>{item.title}</strong><small>{item.status}</small></button>)}</div>
      <button className="storygame-author-create" disabled={busy} onClick={reset}><FilePlus2 className="h-3.5 w-3.5" />新建来源选择</button>
      <p>每个制作项目永久绑定一个 WorldRelease。升级世界版本会新建制作项目，不会热替换旧产品或存档。</p>
    </aside>
    <main className="storygame-author-main">
      {message && <div className="storygame-author-notice success"><CheckCircle2 className="h-4 w-4" /><span>{message}</span></div>}
      {error && <div className="storygame-author-notice error"><AlertTriangle className="h-4 w-4" /><span>{error}</span></div>}
      <div className="storygame-author-toolbar"><div><strong>{current?.production.title ?? '角色互动来源与 Brief'}</strong><span>{sourceLocked ? `Selection ${current.selection.selectionHash.slice(0, 12)}…` : '冻结来源之前保持零产品写入'}</span></div><nav><button className="active">来源与设定</button></nav></div>
      <section className="storygame-author-pane">
        <div className="storygame-author-heading"><div><small>SOURCE / WORLD RELEASE</small><h2>选择不可变世界版本</h2></div>{sourceLocked && <LockKeyhole className="h-5 w-5 text-accent" />}</div>
        {!releases.length ? <article className="storygame-author-contract"><AlertTriangle className="h-5 w-5" /><div><strong>当前 World 尚无正式发布</strong><p>请先在世界引擎冻结 WorldRevision 并发布 WorldRelease；角色互动不会读取活动工作表代替它。</p></div></article> : <>
          <label>WorldRelease<select disabled={sourceLocked || busy} value={releaseId ?? ''} onChange={event => void chooseRelease(Number(event.target.value))}><option value="">选择正式发布</option>{releases.map(item => <option key={item.id} value={item.id}>v{item.version} · {item.label} · {item.contentHash.slice(0, 12)}</option>)}</select></label>
          {catalog && <article className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>{catalog.sourceWorldName} / {catalog.sourceWorkTitle}</strong><p>WorldRelease v{catalog.worldReleaseVersion} · {catalog.worldContentHash}；缺失表：{catalog.unavailableTables.join('、') || '无'}。</p></div></article>}
        </>}

        {catalog && <>
          <div className="storygame-author-heading"><div><small>REQUIRED / PARTICIPANTS</small><h2>选择 1..8 个世界角色</h2></div><span>{selectedCount}/8 人</span></div>
          <div className="storygame-author-json-grid">{characterOptions.map(item => <label key={item.exportId} className="storygame-author-contract"><input type="checkbox" disabled={sourceLocked || (selectedCount >= 8 && !participants.includes(item.exportId))} checked={participants.includes(item.exportId)} onChange={() => toggleParticipant(item.exportId)} /><div><strong>{item.label}</strong><p>{item.summary || `便携角色 ID ${item.exportId}`}</p></div></label>)}</div>

          <div className="storygame-author-heading"><div><small>OPTIONAL / EXACT SUBSET</small><h2>补充地点、规则、Lore 与故事来源</h2></div><span>父树与引用自动闭包</span></div>
          {OPTIONAL_GROUPS.map(({ table, label }) => (catalog.records[table]?.length ?? 0) > 0 && <article className="storygame-author-card" key={table}><div className="storygame-author-card-head"><strong>{label}</strong><code>{table}</code></div><div className="storygame-author-json-grid">{catalog.records[table]!.map(item => <label key={item.exportId}><span><input type="checkbox" disabled={sourceLocked} checked={(optional[table] ?? []).includes(item.exportId)} onChange={() => toggleOptional(table, item.exportId)} /> {item.label}</span><small>{item.summary}</small></label>)}</div></article>)}

          <div className="storygame-author-heading"><div><small>PRODUCT ONLY / GUESTS</small><h2>原创参与者</h2></div><button disabled={sourceLocked || selectedCount >= 8} onClick={addGuest}><UserRoundPlus className="h-3.5 w-3.5" />添加原创角色</button></div>
          {guests.map((guest, index) => <article className="storygame-author-card" key={guest.guestKey}><div className="storygame-author-card-head"><code>{guest.guestKey}</code>{!sourceLocked && <button className="danger" onClick={() => setGuests(previous => previous.filter((_, itemIndex) => itemIndex !== index))}>移除</button>}</div><div className="storygame-author-inline"><label>姓名<input disabled={sourceLocked} value={guest.name} onChange={event => updateGuest(index, { name: event.target.value })} /></label><label>与原世界的关联<input disabled={sourceLocked} value={guest.relationToWorld} onChange={event => updateGuest(index, { relationToWorld: event.target.value })} /></label></div><label>人物设定<textarea disabled={sourceLocked} rows={3} value={guest.profile} onChange={event => updateGuest(index, { profile: event.target.value })} /></label></article>)}
        </>}

        <div className="storygame-author-heading"><div><small>BRIEF / PRODUCT CONTRACT</small><h2>聊天起点、方向与运行边界</h2></div>{confirmed && <CheckCircle2 className="h-5 w-5 text-accent" />}</div>
        <div className="storygame-author-inline"><label>产品标题<input disabled={confirmed} value={form.title} onChange={event => setField('title', event.target.value)} /></label><label>用户身份<select disabled={confirmed} value={form.userRole} onChange={event => setField('userRole', event.target.value as BriefFormState['userRole'])}><option value="self">本人进入故事</option><option value="original-visitor">原创访客</option><option value="observer">观察者</option><option value="director">导演</option></select></label></div>
        <label>用户总指令<textarea disabled={confirmed} rows={4} value={form.userInstruction} onChange={event => setField('userInstruction', event.target.value)} placeholder="希望与谁聊什么、共同推动什么新故事" /></label>
        <div className="storygame-author-inline"><label>故事模式<select disabled={confirmed} value={form.storyMode} onChange={event => setField('storyMode', event.target.value as BriefFormState['storyMode'])}><option value="inherit-ending">继承原故事终局</option><option value="parallel-timeline">平行时间线</option><option value="new-event">终局后的新事件</option></select></label><label>时间<input disabled={confirmed} value={form.timeContext} onChange={event => setField('timeContext', event.target.value)} /></label><label>地点<input disabled={confirmed} value={form.locationContext} onChange={event => setField('locationContext', event.target.value)} /></label></div>
        <label>历史背景<textarea disabled={confirmed} rows={3} value={form.historicalContext} onChange={event => setField('historicalContext', event.target.value)} /></label>
        <label>聊天目标<textarea disabled={confirmed} rows={3} value={form.chatGoal} onChange={event => setField('chatGoal', event.target.value)} /></label>
        <div className="storygame-author-json-grid"><label>希望方向（每行一条）<textarea disabled={confirmed} rows={4} value={form.desiredDirections} onChange={event => setField('desiredDirections', event.target.value)} /></label><label>安全与 Canon 边界（每行一条）<textarea disabled={confirmed} rows={4} value={form.safetyBoundaries} onChange={event => setField('safetyBoundaries', event.target.value)} /></label><label>公开知识（每行一条）<textarea disabled={confirmed} rows={4} value={form.publicKnowledge} onChange={event => setField('publicKnowledge', event.target.value)} /></label><label>私密初始知识（每行一条）<textarea disabled={confirmed} rows={4} value={form.privateKnowledge} onChange={event => setField('privateKnowledge', event.target.value)} /></label><label>禁止泄露项（每行一条）<textarea disabled={confirmed} rows={4} value={form.prohibitedDisclosure} onChange={event => setField('prohibitedDisclosure', event.target.value)} /></label></div>
        <div className="storygame-author-inline"><label>场景数<input disabled={confirmed} type="number" min={1} max={24} value={form.sceneCount} onChange={event => setField('sceneCount', Number(event.target.value))} /></label><label>每场最大轮次<input disabled={confirmed} type="number" min={1} max={500} value={form.maxTurnsPerScene} onChange={event => setField('maxTurnsPerScene', Number(event.target.value))} /></label><label>导演预算<input disabled={confirmed} type="number" min={0} max={100} value={form.directorBudget} onChange={event => setField('directorBudget', Number(event.target.value))} /></label></div>
        <div className="storygame-author-inline"><label>结束策略<select disabled={confirmed} value={form.endingStrategy} onChange={event => setField('endingStrategy', event.target.value as BriefFormState['endingStrategy'])}><option value="open-ended">持续开放</option><option value="goal-complete">目标完成</option><option value="user-decides">用户决定</option></select></label><label>媒资档位<select disabled={confirmed} value={form.mediaTier} onChange={event => setField('mediaTier', event.target.value as BriefFormState['mediaTier'])}><option value="text-core">纯文字核心</option><option value="portrait-standard">标准角色头像</option><option value="voice-optional">头像与可选语音</option></select></label><label><span><input disabled={confirmed} type="checkbox" checked={form.allowWorldFeedbackCandidate} onChange={event => setField('allowWorldFeedbackCandidate', event.target.checked)} />允许形成世界回流候选</span><small>永远不会自动写回世界</small></label></div>

        {current && <article className="storygame-author-contract"><LockKeyhole className="h-5 w-5" /><div><strong>冻结来源证据</strong><p>{selectedSummary}</p><p>Selection {current.selection.selectionHash} · Brief {current.briefRecord.briefHash}{current.briefRecord.runContractHash ? ` · Run ${current.briefRecord.runContractHash}` : ''}</p></div></article>}
          <div className="storygame-author-actions">{!current ? <button className="storygame-author-create" disabled={busy || !releaseId || !participants.length} onClick={freeze}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}冻结来源并保存 Brief 草稿</button> : !confirmed ? <button className="storygame-author-create" disabled={busy} onClick={confirm}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}确认 Brief 并冻结 Run Contract</button> : <button disabled><CheckCircle2 className="h-3.5 w-3.5" />来源与 Run Contract 已冻结</button>}<button disabled={busy} onClick={() => void run(async () => { if (!current) return; await loadProduction(current.production.id); setMessage('已从不可变记录重新验证并恢复。') })}><RefreshCw className="h-3.5 w-3.5" />重新验证</button></div>
        {confirmed && details && <>
          <div className="storygame-author-heading"><div><small>CI-3 / DURABLE PRODUCTION</small><h2>候选生产与人工确认</h2></div><span>{details.production.status}</span></div>
          <article className="storygame-author-contract"><CheckCircle2 className="h-5 w-5" /><div><strong>每一步都可恢复、可重试、可拒绝</strong><p>候选只读取 characterInteractionProduction 登记源；确认后冻结 payload hash。重生成会显式失效下游，不会热改已发布产品。</p></div></article>
          <div className="storygame-version-list">{CHARACTER_INTERACTION_PRODUCTION_STEPS_V1.map((stepKey, index) => {
            const step = latestStep(stepKey)
            const previousReady = index === 0 || latestStep(CHARACTER_INTERACTION_PRODUCTION_STEPS_V1[index - 1])?.status === 'confirmed'
            const aiEnabled = CHARACTER_INTERACTION_AI_PRODUCTION_STEPS_V1.includes(stepKey as CharacterInteractionAIProductionStepV1)
            return <article key={stepKey}><div><strong>{index + 1}. {stepKey}</strong><span>{step?.status ?? 'pending'}{step ? ` · attempt ${step.attempt}` : ''}</span></div><div className="storygame-author-actions">{step?.status === 'awaiting-confirmation' ? <button disabled={busy} onClick={() => confirmStep(stepKey)}><ShieldCheck className="h-3.5 w-3.5" />确认候选</button> : step?.status === 'confirmed' ? <button disabled><CheckCircle2 className="h-3.5 w-3.5" />已确认</button> : <>{aiEnabled && <button className="storygame-author-create" disabled={busy || !previousReady} onClick={() => runAIStep(stepKey as CharacterInteractionAIProductionStepV1)}><Sparkles className="h-3.5 w-3.5" />AI 生成候选</button>}<button disabled={busy || !previousReady} onClick={() => runStep(stepKey)}><FilePlus2 className="h-3.5 w-3.5" />确定性草稿</button></>}</div></article>
          })}</div>

          <div className="storygame-author-heading"><div><small>CI-4 / MEDIA</small><h2>产品媒资与显式降级</h2></div><span>{form.mediaTier}</span></div>
          {!details.mediaAssets.filter(item => item.status !== 'superseded').length ? <article className="storygame-author-contract"><ImagePlus className="h-5 w-5" /><div><strong>当前没有活动媒资槽</strong><p>纯文字档位可直接发布；头像/语音档位会在确认 media-bible 后建立版本化槽位。</p></div></article> : <div className="storygame-version-list">{details.mediaAssets.filter(item => item.status !== 'superseded').map(asset => <article key={asset.id}><div><strong>{asset.slotKey}</strong><span>{asset.kind} · {asset.status}{asset.productionRequired ? ' · required' : ' · optional'}</span></div><div className="storygame-author-actions">{asset.status !== 'available' && <label className="storygame-author-create">导入文件<input className="hidden" type="file" accept={asset.kind === 'portrait' ? 'image/png,image/jpeg,image/webp' : 'audio/mpeg,audio/wav,audio/ogg'} onChange={event => { const file = event.target.files?.[0]; if (file) void attachMedia(asset.slotKey, asset.specHash, file) }} /></label>}{asset.status !== 'available' && asset.status !== 'degraded' && <button disabled={busy} onClick={() => degradeMedia(asset.slotKey, asset.specHash)}>使用文字 fallback</button>}</div></article>)}</div>}

          <div className="storygame-author-heading"><div><small>CI-5 / PRODUCT RELEASE</small><h2>不可变发布与正式运行</h2></div><span>{details.releases.length} 个版本</span></div>
          <div className="storygame-author-actions"><button className="storygame-author-create" disabled={busy || details.production.status !== 'release-ready'} onClick={publish}><Rocket className="h-3.5 w-3.5" />发布 CharacterInteraction Product Release</button></div>
          <div className="storygame-version-list">{details.releases.map(item => <article key={item.id}><div><strong>{item.label}</strong><span>Product Release v{item.version}</span></div><code>{item.contentHash.slice(0, 20)}…</code></article>)}</div>

          <div className="storygame-author-heading"><div><small>EXPLICIT WORLD UPGRADE</small><h2>升级到新的 WorldRelease</h2></div><GitCompareArrows className="h-5 w-5 text-accent" /></div>
          <article className="storygame-author-contract"><LockKeyhole className="h-5 w-5" /><div><strong>升级永远新建 Production</strong><p>当前制作继续绑定 WorldRelease v{current.catalog.worldReleaseVersion}；升级不会热替换已发布产品或既有 Instance。</p></div></article>
          <div className="storygame-author-inline"><label>目标 WorldRelease<select disabled={busy || !!upgradeCandidate} value={upgradeReleaseId ?? ''} onChange={event => setUpgradeReleaseId(Number(event.target.value) || null)}><option value="">选择其他正式版本</option>{releases.filter(item => item.id !== current.selection.worldReleaseId).map(item => <option key={item.id} value={item.id}>v{item.version} · {item.label}</option>)}</select></label><div className="storygame-author-actions">{!upgradeCandidate ? <button disabled={busy || !upgradeReleaseId} onClick={prepareUpgrade}><GitCompareArrows className="h-3.5 w-3.5" />生成升级候选</button> : <button className="storygame-author-create" disabled={busy || upgradeParticipants.length !== current.selection.participantCharacterExportIds.length} onClick={applyUpgrade}>确认并新建 Production</button>}</div></div>
          {upgradeCandidate && upgradeCatalog && <article className="storygame-author-card"><div className="storygame-author-card-head"><strong>确认新版本参与角色</strong><span>{upgradeParticipants.length}/{current.selection.participantCharacterExportIds.length}</span></div><div className="storygame-author-json-grid">{(upgradeCatalog.records.characters ?? []).map(item => <label key={item.exportId}><span><input type="checkbox" disabled={busy || (upgradeParticipants.length >= current.selection.participantCharacterExportIds.length && !upgradeParticipants.includes(item.exportId))} checked={upgradeParticipants.includes(item.exportId)} onChange={() => setUpgradeParticipants(previous => previous.includes(item.exportId) ? previous.filter(id => id !== item.exportId) : [...previous, item.exportId])} /> {item.label}</span><small>{item.summary}</small></label>)}</div></article>}
        </>}
      </section>
    </main>
  </div>
}
