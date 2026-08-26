import { FileText } from 'lucide-react'
import type { ChapterPlanReconciliation } from '../../lib/types'
import ReconciliationTable, { type ReconciliationActionMap } from './ReconciliationTable'

interface Props {
  summary?: string
  hasText: boolean
  memoryBusy: boolean
  reconciliationBusy?: 'actual-progress' | 'outline' | null
  reconciliationError?: string
  chapterTitle?: string
  nextChapterTitle?: string
  reconciliation?: ChapterPlanReconciliation
  reconciliationCurrent: boolean
  onGenerateMemory: () => void
  onConfirmActualProgress?: () => void
  onApplyOutlineCandidate?: () => void
  onSaveReconciliation?: (actions: ReconciliationActionMap) => Promise<void>
  onForeshadowReconciliation?: (item: { section: string; index: number; text: string }) => Promise<void>
}

export default function ChapterMemoryPanel({
  summary,
  hasText,
  memoryBusy,
  reconciliationBusy = null,
  reconciliationError = '',
  chapterTitle = '',
  nextChapterTitle,
  reconciliation,
  reconciliationCurrent,
  onGenerateMemory,
  onConfirmActualProgress,
  onApplyOutlineCandidate,
  onSaveReconciliation,
  onForeshadowReconciliation,
}: Props) {
  const reconciliationStale = reconciliation
    && !reconciliationCurrent
    && (reconciliation.reviewStatus === 'pending' || reconciliation.reviewStatus === 'confirmed-constraint')

  return (
    <>
      {(summary || hasText) && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-text-muted">📝 章节摘要</p>
            <button
              type="button"
              onClick={onGenerateMemory}
              disabled={!hasText || memoryBusy}
              title="一次生成章节摘要、连续性交接记忆、计划-正文对账"
              className="flex items-center gap-1 text-xs text-text-muted hover:text-accent disabled:opacity-50 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {memoryBusy ? '生成中...' : summary ? '刷新章节记忆' : '生成章节记忆'}
            </button>
          </div>
          {summary
            ? <p className="text-sm text-text-secondary">{summary}</p>
            : <p className="text-xs text-text-muted/60">改完正文后生成章节记忆，让后续章节获得可校验的前情与交接约束。</p>}
        </div>
      )}

      {/* Stale Reconciliation Warning */}
      {reconciliationStale && (
        <div className="mb-3 px-3 py-2 text-xs text-text-muted bg-bg-elevated border border-border rounded-lg">
          计划对账已因正文或章纲变化而失效；刷新章节记忆后再处理。
        </div>
      )}

      {/* 新逐条对账契约；已处理历史仅供回看，不再作为当前下游约束。 */}
      {reconciliation && onSaveReconciliation && onForeshadowReconciliation && (
        reconciliationCurrent
        || reconciliation.reviewStatus === 'applied-outline'
        || reconciliation.reviewStatus === 'dismissed'
      ) && (
        <div className="mb-3 space-y-2">
          {!reconciliationCurrent && (
            <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
              这是已经处理的历史对账记录，不再作为当前下游约束；如正文或章纲已经变化，请重新生成章节记忆。
            </p>
          )}
          <ReconciliationTable
            reconciliation={reconciliation}
            chapterTitle={chapterTitle}
            nextChapterTitle={nextChapterTitle}
            onSave={onSaveReconciliation}
            onForeshadow={onForeshadowReconciliation}
          />
        </div>
      )}

      {/* 兼容旧调用方的原子动作契约，避免合并期间丢失忙碌态与错误反馈。 */}
      {reconciliation
        && reconciliationCurrent
        && (!onSaveReconciliation || !onForeshadowReconciliation)
        && (
          <div className="mb-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-amber-300">计划—正文对账</p>
              <span className="text-[10px] text-text-muted">
                {reconciliation.reviewStatus === 'pending' ? '待确认' : '已处理'}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-text-secondary">
              {([
                ['已完成', reconciliation.completedGoals],
                ['未完成', reconciliation.unfinishedGoals],
                ['实际偏移', reconciliation.deviations],
                ['新增约束', reconciliation.newConstraints],
                ['下一章影响', reconciliation.nextChapterImpacts],
              ] as const).flatMap(([label, items]) => items.map((item, index) => (
                <div key={`${label}:${index}`}>
                  <p><span className="text-amber-300/80">{label}：</span>{item.text}</p>
                  {item.evidenceQuotes[0] && (
                    <p className="pl-3 text-[11px] text-text-muted">证据：“{item.evidenceQuotes[0].quote}”</p>
                  )}
                </div>
              )))}
            </div>
            {reconciliation.reviewStatus === 'pending' && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onConfirmActualProgress}
                    disabled={reconciliationBusy != null || !onConfirmActualProgress}
                    className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
                  >
                    {reconciliationBusy === 'actual-progress' ? '正在附加实际进展约束...' : '确认并附加实际进展约束'}
                  </button>
                  {reconciliation.proposedOutlineSummary && (
                    <button
                      type="button"
                      onClick={onApplyOutlineCandidate}
                      disabled={reconciliationBusy != null || !onApplyOutlineCandidate}
                      className="px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:cursor-wait disabled:opacity-50"
                    >
                      {reconciliationBusy === 'outline' ? '正在更新本章章纲...' : '用候选更新本章章纲'}
                    </button>
                  )}
                </div>
                {reconciliationError && (
                  <p className="mt-2 text-xs text-error" role="alert">{reconciliationError}</p>
                )}
              </>
            )}
          </div>
        )}
    </>
  )
}
