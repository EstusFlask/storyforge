import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, Check, Film, Images, X } from 'lucide-react'
import type {
  AdaptationSourceSelectionV1,
  ComicTargetSpecV1,
  ScreenplayTargetSpecV1,
  WorkspaceScope,
} from '../../lib/types'
import {
  createAdaptation,
  listAdaptationSourceOptions,
  previewAdaptationSourceSelection,
  type AdaptationSourceOptionCatalogV1,
  type AdaptationSourceSelectionPreviewV1,
} from '../../lib/adaptation/source-manifest'

interface Props {
  sourceScope: WorkspaceScope
  onClose: () => void
  onCreated: () => Promise<void> | void
}

type SelectionMode = AdaptationSourceSelectionV1['mode']

export default function AdaptWorkWizard({ sourceScope, onClose, onCreated }: Props) {
  const [catalog, setCatalog] = useState<AdaptationSourceOptionCatalogV1 | null>(null)
  const [medium, setMedium] = useState<'screenplay' | 'comic'>('screenplay')
  const [title, setTitle] = useState('')
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('entire-work')
  const [outlineId, setOutlineId] = useState<number | null>(null)
  const [startChapterId, setStartChapterId] = useState<number | null>(null)
  const [endChapterId, setEndChapterId] = useState<number | null>(null)
  const [chapterIds, setChapterIds] = useState<number[]>([])
  const [screenFormat, setScreenFormat] = useState<ScreenplayTargetSpecV1['format']>('film')
  const [episodeCount, setEpisodeCount] = useState(12)
  const [minutes, setMinutes] = useState(100)
  const [comicChapters, setComicChapters] = useState(1)
  const [pagesPerChapter, setPagesPerChapter] = useState(24)
  const [artStyle, setArtStyle] = useState('电影感分镜，清晰线稿，统一角色造型与光色')
  const [preview, setPreview] = useState<AdaptationSourceSelectionPreviewV1 | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void listAdaptationSourceOptions(sourceScope).then(loaded => {
      if (cancelled) return
      setCatalog(loaded)
      setTitle(`${loaded.workTitle} · 电影剧本`)
      setOutlineId(loaded.outlines[0]?.id ?? null)
      setStartChapterId(loaded.chapters[0]?.id ?? null)
      setEndChapterId(loaded.chapters[loaded.chapters.length - 1]?.id ?? null)
      setChapterIds(loaded.chapters.map(chapter => chapter.id))
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '读取来源失败') })
    return () => { cancelled = true }
  }, [sourceScope])

  useEffect(() => {
    if (!catalog) return
    setTitle(`${catalog.workTitle} · ${medium === 'screenplay' ? '电影剧本' : '漫画'}`)
  }, [catalog, medium])

  const selection = useMemo<AdaptationSourceSelectionV1 | null>(() => {
    if (selectionMode === 'entire-work') return { mode: 'entire-work' }
    if (selectionMode === 'outline-subtree') return outlineId == null ? null : { mode: 'outline-subtree', outlineNodeId: outlineId }
    if (selectionMode === 'chapter-range') return startChapterId == null || endChapterId == null ? null : { mode: 'chapter-range', startChapterId, endChapterId }
    return chapterIds.length ? { mode: 'chapters', chapterIds } : null
  }, [chapterIds, endChapterId, outlineId, selectionMode, startChapterId])
  const currentPreviewKey = selection ? JSON.stringify(selection) : ''

  const runPreview = async () => {
    if (!selection || busy) return
    setBusy(true); setError('')
    try {
      const next = await previewAdaptationSourceSelection({ sourceScope, selection })
      setPreview(next); setPreviewKey(currentPreviewKey)
    } catch (cause) {
      setPreview(null); setPreviewKey('')
      setError(cause instanceof Error ? cause.message : '来源范围不可用')
    } finally { setBusy(false) }
  }

  const submit = async () => {
    if (!selection || !title.trim() || previewKey !== currentPreviewKey || busy) return
    setBusy(true); setError('')
    try {
      if (medium === 'screenplay') {
        const spec: ScreenplayTargetSpecV1 = {
          format: screenFormat,
          language: 'zh-CN',
          episodeCount: screenFormat === 'film' ? null : episodeCount,
          targetMinutesPerEpisode: minutes,
          rating: 'PG-13',
          dialogueDensity: 'balanced',
          productionScale: 'standard',
          preserveVoiceOver: false,
          titlePage: { creditLine: '改编', authorDisplayName: '', contactText: '', copyrightNotice: '', draftLabel: '第一稿' },
          exportDefaults: ['fountain', 'fdx', 'pdf'],
        }
        await createAdaptation({ sourceScope, sourceWorkId: sourceScope.workId, title: title.trim(), sourceSelection: selection, medium, targetSpec: spec })
      } else {
        const spec: ComicTargetSpecV1 = {
          format: 'page-comic',
          audience: '大众',
          readingDirection: 'ltr',
          chapterCount: comicChapters,
          targetPagesPerChapter: pagesPerChapter,
          pageSize: { width: 2480, height: 3508, unit: 'px', bleed: 80 },
          colorMode: 'color',
          artStyleBrief: artStyle.trim(),
          renderCandidatesPerPanel: 3,
          imageCapabilityRequirement: { referenceImage: true, deterministicSeed: false, inpainting: false, commercialUseRequired: false, minimumWidth: 1024, minimumHeight: 1024 },
        }
        await createAdaptation({ sourceScope, sourceWorkId: sourceScope.workId, title: title.trim(), sourceSelection: selection, medium, targetSpec: spec })
      }
      await onCreated()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建改编作品失败')
    } finally { setBusy(false) }
  }

  const toggleChapter = (id: number) => {
    setChapterIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    setPreview(null); setPreviewKey('')
  }

  return <div className="sf-modal-backdrop" onMouseDown={onClose}>
    <aside className="sf-adapt-panel" onMouseDown={event => event.stopPropagation()} aria-label="创建小说改编">
      <div className="sf-modal-header"><div><div className="sf-eyebrow">ADAPT WORK</div><h2>从小说创建改编</h2><p>先冻结来源证据；创建过程不会调用 AI，也不会修改源小说。</p></div><button className="sf-icon-button" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>
      <div className="sf-adapt-body">
        <div className="sf-adapt-medium"><button className={medium === 'screenplay' ? 'active' : ''} onClick={() => { setMedium('screenplay'); setPreview(null) }}><Film className="h-4 w-4" />正规剧本</button><button className={medium === 'comic' ? 'active' : ''} onClick={() => { setMedium('comic'); setPreview(null) }}><Images className="h-4 w-4" />页漫</button></div>
        <label>目标作品名<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} /></label>
        <label>来源范围<select value={selectionMode} onChange={event => { setSelectionMode(event.target.value as SelectionMode); setPreview(null); setPreviewKey('') }}><option value="entire-work">整部小说</option><option value="outline-subtree">一个大纲子树</option><option value="chapter-range">连续章节范围</option><option value="chapters">离散章节</option></select></label>
        {selectionMode === 'outline-subtree' && <label>大纲根<select value={outlineId ?? ''} onChange={event => { setOutlineId(Number(event.target.value)); setPreview(null) }}>{catalog?.outlines.map(node => <option key={node.id} value={node.id}>{node.type} · {node.title}</option>)}</select></label>}
        {selectionMode === 'chapter-range' && <div className="sf-adapt-grid"><label>起始章节<select value={startChapterId ?? ''} onChange={event => { setStartChapterId(Number(event.target.value)); setPreview(null) }}>{catalog?.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label><label>结束章节<select value={endChapterId ?? ''} onChange={event => { setEndChapterId(Number(event.target.value)); setPreview(null) }}>{catalog?.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label></div>}
        {selectionMode === 'chapters' && <div className="sf-adapt-chapters">{catalog?.chapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={chapterIds.includes(chapter.id)} onChange={() => toggleChapter(chapter.id)} /><span>{chapter.title}</span><small>{chapter.wordCount} 字</small></label>)}</div>}
        {medium === 'screenplay' ? <div className="sf-adapt-grid"><label>规格<select value={screenFormat} onChange={event => setScreenFormat(event.target.value as ScreenplayTargetSpecV1['format'])}><option value="film">电影</option><option value="series">剧集</option><option value="short-drama">短剧</option></select></label>{screenFormat !== 'film' && <label>集数<input type="number" min={1} max={500} value={episodeCount} onChange={event => setEpisodeCount(Number(event.target.value))} /></label>}<label>单集分钟<input type="number" min={1} max={300} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label></div> : <><div className="sf-adapt-grid"><label>漫画章节<input type="number" min={1} max={500} value={comicChapters} onChange={event => setComicChapters(Number(event.target.value))} /></label><label>每章目标页数<input type="number" min={1} max={500} value={pagesPerChapter} onChange={event => setPagesPerChapter(Number(event.target.value))} /></label></div><label>全局画风方向<textarea value={artStyle} onChange={event => setArtStyle(event.target.value)} maxLength={8000} /></label></>}
        <button className="sf-adapt-preview-button" onClick={() => void runPreview()} disabled={!selection || busy}><BookOpenText className="h-4 w-4" />{busy ? '校验中…' : '校验并预览来源'}</button>
        {preview && previewKey === currentPreviewKey && <div className="sf-adapt-preview"><strong>{preview.writtenChapterCount} 个有正文章节 · {preview.totalWordCount} 字 · {preview.coverage === 'full-text' ? '含正文' : '仅纲要'}</strong><div>{preview.units.filter(unit => unit.sourceKind === 'chapter').map(unit => <span key={`${unit.order}-${unit.label}`}>{unit.label}</span>)}</div></div>}
        {error && <p className="sf-world-work-error" role="alert">{error}</p>}
      </div>
      <div className="sf-adapt-footer"><button onClick={onClose}>取消</button><button className="primary" onClick={() => void submit()} disabled={busy || !title.trim() || !preview || previewKey !== currentPreviewKey}><Check className="h-4 w-4" />创建并进入工作台</button></div>
    </aside>
  </div>
}
