import { Check, Download, FileJson, Printer, RefreshCw, X } from 'lucide-react'
import type {
  AdaptationProject,
  ComicMediaAsset,
  ComicVisualSubject,
  Work,
  WorkspaceScope,
} from '../../lib/types'
import { completeAdaptationProductionV1 } from '../../lib/adaptation/completion'
import type { ComicQualityReportV1 } from '../../lib/comic/qa'
import { renderComicStoryboardTextV1 } from '../../lib/comic/renderers'
import type { ComicPageGroup, ComicStudioAction } from './studio-model'

interface Props {
  scope: WorkspaceScope
  work: Work
  adaptation: AdaptationProject & { medium: 'comic' }
  groups: ComicPageGroup[]
  subjects: ComicVisualSubject[]
  assets: ComicMediaAsset[]
  quality: ComicQualityReportV1 | null
  busy: boolean
  runQuality: () => Promise<void>
  exportArchive: (format: 'png-zip' | 'webp-zip' | 'cbz') => Promise<void>
  exportPdf: () => Promise<void>
  downloadText: (filename: string, content: string, type?: string) => void
  safeName: (value: string) => string
  act: ComicStudioAction
}

export default function ComicQaPanel({
  scope,
  work,
  adaptation,
  groups,
  subjects,
  assets,
  quality,
  busy,
  runQuality,
  exportArchive,
  exportPdf,
  downloadText,
  safeName,
  act,
}: Props) {
  return (
    <section className="comic-qa">
      <header>
        <div>
          <strong>确定性 QA</strong>
          <small>
            {quality
              ? `${quality.pageCount} 页 · ${quality.panelCount} 格 · ${quality.selectedPanelCount} 格已选片`
              : '点击重新检查生成报告'}
          </small>
        </div>
        <button onClick={() => void runQuality()}>
          <RefreshCw />
          重新检查
        </button>
      </header>
      {quality && (
        <>
          <div className={`comic-qa-summary ${quality.canFormalExport ? 'valid' : 'invalid'}`}>
            {quality.canFormalExport ? <Check /> : <X />}
            <strong>{quality.canFormalExport ? '可正式导出' : '正式导出已阻止'}</strong>
            <span>
              {quality.issues.filter((issue) => issue.level === 'error').length} 个错误 ·{' '}
              {quality.issues.filter((issue) => issue.level === 'warning').length} 个警告
            </span>
          </div>
          <ul>
            {quality.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={issue.level}>
                <code>{issue.code}</code>
                <span>{issue.message}</span>
                <small>{[issue.pageKey, issue.panelKey].filter(Boolean).join(' / ')}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="comic-export-grid">
        <button
          onClick={() => downloadText(
            `${safeName(work.title)}-分镜脚本.md`,
            renderComicStoryboardTextV1({
              title: work.title,
              targetSpec: adaptation.targetSpec,
              pages: groups.map((group) => ({ ...group, assetDataUrls: {} })),
            }),
          )}
        >
          <Download />
          分镜脚本
        </button>
        <button
          onClick={() => downloadText(
            `${safeName(work.title)}-结构.json`,
            JSON.stringify({
              version: 1,
              work: { title: work.title },
              adaptation: {
                targetSpec: adaptation.targetSpec,
                sourceManifestHash: adaptation.activeSourceManifestHash,
              },
              pages: groups,
              visualSubjects: subjects,
              mediaAssets: assets.map(({ blobObjectId: _blobObjectId, ...asset }) => asset),
            }, null, 2),
            'application/json;charset=utf-8',
          )}
        >
          <FileJson />
          结构 JSON
        </button>
        <button onClick={() => void exportArchive('png-zip')} disabled={busy}>
          <Download />
          PNG ZIP
        </button>
        <button onClick={() => void exportArchive('webp-zip')} disabled={busy}>
          <Download />
          WebP ZIP
        </button>
        <button onClick={() => void exportArchive('cbz')} disabled={busy}>
          <Download />
          CBZ
        </button>
        <button onClick={() => void exportPdf()} disabled={busy}>
          <Printer />
          PDF 打印
        </button>
        <button
          className="primary"
          onClick={() => void act(
            () => completeAdaptationProductionV1({ scope, expectedRevision: adaptation.revision }),
            '漫画已通过正式 QA 并完稿',
          )}
          disabled={busy || adaptation.status === 'complete'}
        >
          <Check />
          {adaptation.status === 'complete' ? '已完稿' : '标记正式完稿'}
        </button>
      </div>
    </section>
  )
}
