import { useEffect, useMemo, useState } from 'react'
import { Check, Play, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import type { AdaptationBriefV1, AdaptationPlanSectionV1, AdaptationPlanV1, AdaptationProject, AdaptationSourceUnit, WorkspaceScope } from '../../lib/types'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../lib/adaptation/source-manifest'
import {
  adoptAdaptationCandidateV1,
  generateAdaptationCandidateV1,
  readPendingAdaptationCandidateV1,
  rejectAdaptationCandidateV1,
  type AdaptationCandidateKindV1,
} from '../../lib/agent/run/adaptation-durable'
import { db } from '../../lib/db/schema'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'

interface Props {
  scope: WorkspaceScope
  adaptation: AdaptationProject
  sourceUnits: AdaptationSourceUnit[]
  onChanged: (root: AdaptationProject) => Promise<void> | void
}

function lines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(Boolean)
}

function textLines(values: string[]): string {
  return values.join('\n')
}

function initialBrief(root: AdaptationProject): AdaptationBriefV1 {
  return root.brief ?? {
    version: 1,
    coreTheme: '', dominantEmotion: '', mustKeep: [], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
    audience: root.medium === 'screenplay' ? '大众影视观众' : root.targetSpec.audience,
    rating: root.medium === 'screenplay' ? root.targetSpec.rating : '大众',
    targetScale: root.medium === 'screenplay'
      ? `${root.targetSpec.format === 'film' ? '电影' : `${root.targetSpec.episodeCount} 集`}，单集 ${root.targetSpec.targetMinutesPerEpisode} 分钟`
      : `${root.targetSpec.chapterCount} 章，每章约 ${root.targetSpec.targetPagesPerChapter} 页`,
    narrativePerspective: '', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
  }
}

function initialPlan(root: AdaptationProject, units: AdaptationSourceUnit[]): AdaptationPlanV1 {
  if (root.plan) return root.plan
  const sourceUnitKeys = units.filter(unit => unit.sourceKind === 'chapter').map(unit => unit.sourceUnitKey)
  const count = root.medium === 'screenplay' && root.targetSpec.format !== 'film'
    ? root.targetSpec.episodeCount ?? 1
    : root.medium === 'comic' ? root.targetSpec.chapterCount : 3
  return {
    version: 1,
    premise: '',
    sections: Array.from({ length: Math.max(1, Math.min(count, 24)) }, (_, index) => ({
      stableKey: root.medium === 'screenplay' && root.targetSpec.format === 'film' ? `act-${index + 1}` : `section-${index + 1}`,
      title: root.medium === 'screenplay' && root.targetSpec.format === 'film' ? `第${index + 1}幕` : `第${index + 1}部分`,
      summary: '', order: index,
      episodeNumber: root.medium === 'screenplay' && root.targetSpec.format !== 'film' ? index + 1 : 1,
      sourceUnitKeys,
    })),
    globalAssumptions: [],
  }
}

export default function AdaptationSetupPanel({ scope, adaptation, sourceUnits, onChanged }: Props) {
  const [brief, setBrief] = useState(() => initialBrief(adaptation))
  const [plan, setPlan] = useState(() => initialPlan(adaptation, sourceUnits))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [candidate, setCandidate] = useState<{ runId: number; kind: 'brief' | 'plan' } | null>(null)
  const aiConfig = useAIConfigStore(state => state.config)
  useEffect(() => { setBrief(initialBrief(adaptation)); setPlan(initialPlan(adaptation, sourceUnits)) }, [adaptation.id, adaptation.revision, sourceUnits])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const kind of ['brief', 'plan'] as const) {
        const pending = await readPendingAdaptationCandidateV1({ scope, artifactKind: kind })
        if (!pending || cancelled) continue
        if (kind === 'brief') setBrief(pending.candidate.payload as AdaptationBriefV1)
        else setPlan(pending.candidate.payload as AdaptationPlanV1)
        setCandidate({ runId: pending.snapshot.run.id, kind })
        break
      }
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [scope, adaptation.id])

  const briefSaved = useMemo(() => JSON.stringify(brief) === JSON.stringify(adaptation.brief), [adaptation.brief, brief])
  const planSaved = useMemo(() => JSON.stringify(plan) === JSON.stringify(adaptation.plan), [adaptation.plan, plan])
  const briefConfirmed = adaptation.briefSourceManifestVersion === adaptation.activeSourceManifestVersion
  const planConfirmed = adaptation.planSourceManifestVersion === adaptation.activeSourceManifestVersion

  const run = async (action: () => Promise<AdaptationProject>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await onChanged(await action()) } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy(false) }
  }

  const patchBrief = <K extends keyof AdaptationBriefV1>(key: K, value: AdaptationBriefV1[K]) => setBrief(current => ({ ...current, [key]: value }))
  const patchSection = (index: number, patch: Partial<AdaptationPlanSectionV1>) => setPlan(current => ({ ...current, sections: current.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section) }))
  const generate = async (kind: Extract<AdaptationCandidateKindV1, 'brief' | 'plan'>) => {
    if (busy) return
    if (!isAIConfigReady(aiConfig)) { setError(getAIConfigRequiredMessage(aiConfig)); return }
    setBusy(true); setError('')
    try {
      const generated = await generateAdaptationCandidateV1({ scope, adaptationProjectId: adaptation.id!, artifactKind: kind, aiConfig })
      if (kind === 'brief') setBrief(generated.candidate.payload as AdaptationBriefV1)
      else setPlan(generated.candidate.payload as AdaptationPlanV1)
      setCandidate({ runId: generated.snapshot.run.id, kind })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'AI 生成失败') } finally { setBusy(false) }
  }
  const acceptCandidate = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try {
      if (candidate.kind === 'brief') await adoptAdaptationCandidateV1<'brief'>({ scope, runId: candidate.runId, authorPayload: brief })
      else await adoptAdaptationCandidateV1<'plan'>({ scope, runId: candidate.runId, authorPayload: plan })
      setCandidate(null)
      const root = await db.adaptationProjects.get(adaptation.id!)
      if (!root) throw new Error('改编项目已缺失')
      await onChanged(root)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '采纳候选失败') } finally { setBusy(false) }
  }
  const rejectCandidate = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try { await rejectAdaptationCandidateV1({ scope, runId: candidate.runId }); setCandidate(null) } catch (cause) { setError(cause instanceof Error ? cause.message : '拒绝候选失败') } finally { setBusy(false) }
  }

  return <div className="adapt-setup">
    <section className={briefConfirmed ? 'complete' : ''}>
      <header><div><span>STEP 1</span><h3>改编 Brief</h3></div>{briefConfirmed && <strong><Check className="h-4 w-4" />已按 v{adaptation.activeSourceManifestVersion} 确认</strong>}</header>
      <div className="adapt-form-grid"><label>核心主题<input value={brief.coreTheme} onChange={event => patchBrief('coreTheme', event.target.value)} /></label><label>主导情绪<input value={brief.dominantEmotion} onChange={event => patchBrief('dominantEmotion', event.target.value)} /></label><label>目标受众<input value={brief.audience} onChange={event => patchBrief('audience', event.target.value)} /></label><label>内容分级<input value={brief.rating} onChange={event => patchBrief('rating', event.target.value)} /></label><label>目标体量<input value={brief.targetScale} onChange={event => patchBrief('targetScale', event.target.value)} /></label><label>叙事视角<input value={brief.narrativePerspective} onChange={event => patchBrief('narrativePerspective', event.target.value)} /></label><label>时间上限<input value={brief.timeBudget} onChange={event => patchBrief('timeBudget', event.target.value)} /></label><label>制作成本边界<input value={brief.costLimit} onChange={event => patchBrief('costLimit', event.target.value)} /></label></div>
      <div className="adapt-form-grid"><label>必须保留（每行一项）<textarea value={textLines(brief.mustKeep)} onChange={event => patchBrief('mustKeep', lines(event.target.value))} /></label><label>可删除（每行一项）<textarea value={textLines(brief.mayCut)} onChange={event => patchBrief('mayCut', lines(event.target.value))} /></label><label>可合并（每行一项）<textarea value={textLines(brief.mayMerge)} onChange={event => patchBrief('mayMerge', lines(event.target.value))} /></label><label>允许新增（每行一项）<textarea value={textLines(brief.allowedAdditions)} onChange={event => patchBrief('allowedAdditions', lines(event.target.value))} /></label><label>可重排（每行一项）<textarea value={textLines(brief.mayReorder)} onChange={event => patchBrief('mayReorder', lines(event.target.value))} /></label><label>显式假设（每行一项）<textarea value={textLines(brief.assumptions)} onChange={event => patchBrief('assumptions', lines(event.target.value))} /></label><label>未决问题（每行一项）<textarea value={textLines(brief.unresolvedQuestions)} onChange={event => patchBrief('unresolvedQuestions', lines(event.target.value))} /></label><label>偏离来源说明<textarea value={brief.deviationNotes} onChange={event => patchBrief('deviationNotes', event.target.value)} /></label></div>
      {candidate?.kind === 'brief' && <div className="adapt-candidate"><Sparkles className="h-4 w-4" /><span>AI 候选已恢复到表单。你可以先修改，再确认采纳；尚未写入正式 Brief。</span><button onClick={() => void acceptCandidate()} disabled={busy}><Check className="h-4 w-4" />采纳并确认</button><button onClick={() => void rejectCandidate()} disabled={busy}><X className="h-4 w-4" />放弃</button></div>}
      <footer><button onClick={() => void generate('brief')} disabled={busy || !!candidate}><Sparkles className="h-4 w-4" />AI 生成候选</button><button onClick={() => void run(() => saveAdaptationBriefDraft({ adaptationProjectId: adaptation.id!, brief, expectedRevision: adaptation.revision }))} disabled={busy || briefSaved || !!candidate}><Save className="h-4 w-4" />保存草稿</button><button className="primary" onClick={() => void run(() => confirmAdaptationBrief({ adaptationProjectId: adaptation.id!, expectedRevision: adaptation.revision }))} disabled={busy || !briefSaved || briefConfirmed || !!candidate}><Check className="h-4 w-4" />作者确认 Brief</button></footer>
    </section>
    <section className={planConfirmed ? 'complete' : ''}>
      <header><div><span>STEP 2</span><h3>结构计划</h3></div>{planConfirmed && <strong><Check className="h-4 w-4" />已按 v{adaptation.activeSourceManifestVersion} 确认</strong>}</header>
      <label>一句话前提<textarea value={plan.premise} onChange={event => setPlan(current => ({ ...current, premise: event.target.value }))} /></label>
      <div className="adapt-plan-list">{plan.sections.map((section, index) => <article key={`${section.stableKey}-${index}`}><div><label>稳定 key<input value={section.stableKey} onChange={event => patchSection(index, { stableKey: event.target.value })} /></label><label>标题<input value={section.title} onChange={event => patchSection(index, { title: event.target.value })} /></label><label>集号<input type="number" min={1} value={section.episodeNumber ?? 1} onChange={event => patchSection(index, { episodeNumber: Number(event.target.value) })} /></label><button onClick={() => setPlan(current => ({ ...current, sections: current.sections.filter((_, itemIndex) => itemIndex !== index).map((item, order) => ({ ...item, order })) }))} disabled={plan.sections.length <= 1} aria-label="删除结构段"><Trash2 className="h-4 w-4" /></button></div><label>结构段摘要<textarea value={section.summary} onChange={event => patchSection(index, { summary: event.target.value })} /></label></article>)}</div>
      <button onClick={() => setPlan(current => ({ ...current, sections: [...current.sections, { stableKey: `section-${current.sections.length + 1}`, title: `第${current.sections.length + 1}部分`, summary: '', order: current.sections.length, episodeNumber: 1, sourceUnitKeys: sourceUnits.filter(unit => unit.sourceKind === 'chapter').map(unit => unit.sourceUnitKey) }] }))}><Plus className="h-4 w-4" />增加结构段</button>
      <label>全局假设（每行一项）<textarea value={textLines(plan.globalAssumptions)} onChange={event => setPlan(current => ({ ...current, globalAssumptions: lines(event.target.value) }))} /></label>
      {candidate?.kind === 'plan' && <div className="adapt-candidate"><Sparkles className="h-4 w-4" /><span>AI 计划候选已恢复到表单。修改后采纳会同时完成作者确认。</span><button onClick={() => void acceptCandidate()} disabled={busy}><Check className="h-4 w-4" />采纳并确认</button><button onClick={() => void rejectCandidate()} disabled={busy}><X className="h-4 w-4" />放弃</button></div>}
      <footer><button onClick={() => void generate('plan')} disabled={busy || !briefConfirmed || !!candidate}><Sparkles className="h-4 w-4" />AI 生成候选</button><button onClick={() => void run(() => saveAdaptationPlanDraft({ adaptationProjectId: adaptation.id!, plan, expectedRevision: adaptation.revision }))} disabled={busy || !briefConfirmed || planSaved || !!candidate}><Save className="h-4 w-4" />保存计划</button><button className="primary" onClick={() => void run(() => confirmAdaptationPlan({ adaptationProjectId: adaptation.id!, expectedRevision: adaptation.revision }))} disabled={busy || !planSaved || planConfirmed || !!candidate}><Check className="h-4 w-4" />作者确认计划</button></footer>
    </section>
    {planConfirmed && adaptation.status !== 'producing' && adaptation.status !== 'review' && <button className="adapt-start" onClick={() => void run(() => startAdaptationProduction({ adaptationProjectId: adaptation.id!, expectedRevision: adaptation.revision }))} disabled={busy}><Play className="h-4 w-4" />进入{adaptation.medium === 'screenplay' ? '场景生产' : '漫画生产'}</button>}
    {error && <p className="adapt-error" role="alert">{error}</p>}
  </div>
}
