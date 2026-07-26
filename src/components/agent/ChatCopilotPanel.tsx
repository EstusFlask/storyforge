import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { Project } from '../../lib/types'
import { useCharacterCopilot } from './useCharacterCopilot'
import { useInspirationCopilot } from './useInspirationCopilot'
import { useWorldOriginCopilot } from './useWorldOriginCopilot'

interface Props {
  project: Project
  worldGroupId: number | null
  worldName: string
  onClose: () => void
}

export default function ChatCopilotPanel({
  project,
  worldGroupId,
  worldName,
  onClose,
}: Props) {
  const [domain, setDomain] = useState<'world-origin' | 'inspiration' | 'character'>('world-origin')
  const worldCopilot = useWorldOriginCopilot({ project, worldGroupId })
  const inspirationCopilot = useInspirationCopilot({ project })
  const characterCopilot = useCharacterCopilot({ project, worldGroupId })
  const copilot = domain === 'world-origin'
    ? worldCopilot
    : domain === 'inspiration'
      ? inspirationCopilot
      : characterCopilot
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const domainLocked = (
    worldCopilot.busy
    || inspirationCopilot.busy
    || characterCopilot.busy
    || Boolean(worldCopilot.candidate)
    || Boolean(inspirationCopilot.candidate)
    || Boolean(characterCopilot.candidate)
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [copilot.messages, copilot.candidate])

  return (
    <aside
      aria-label="AI 对话副驾"
      className="fixed inset-y-0 right-0 z-30 flex h-full w-[min(24rem,calc(100vw-3rem))] shrink-0 flex-col border-l border-border bg-bg-surface shadow-xl lg:static lg:z-auto lg:w-[24rem] lg:shadow-none"
    >
      <header className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Bot className="h-4 w-4 text-accent" />
              AI 对话副驾
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                27.1-d
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-text-muted" title={`${project.name} · ${worldName}`}>
              {project.name} · {worldName}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭 AI 对话副驾"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div aria-label="对话领域" className="mt-3 grid grid-cols-3 gap-1 rounded-md bg-bg-base p-1">
          <button
            type="button"
            aria-pressed={domain === 'world-origin'}
            disabled={domainLocked && domain !== 'world-origin'}
            onClick={() => setDomain('world-origin')}
            className={`rounded px-2 py-1.5 text-xs ${
              domain === 'world-origin'
                ? 'bg-bg-surface font-medium text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            } disabled:opacity-40`}
          >
            世界来源
          </button>
          <button
            type="button"
            aria-pressed={domain === 'inspiration'}
            disabled={domainLocked && domain !== 'inspiration'}
            onClick={() => setDomain('inspiration')}
            className={`rounded px-2 py-1.5 text-xs ${
              domain === 'inspiration'
                ? 'bg-bg-surface font-medium text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            } disabled:opacity-40`}
          >
            灵感反推
          </button>
          <button
            type="button"
            aria-pressed={domain === 'character'}
            disabled={domainLocked && domain !== 'character'}
            onClick={() => setDomain('character')}
            className={`rounded px-2 py-1.5 text-xs ${
              domain === 'character'
                ? 'bg-bg-surface font-medium text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            } disabled:opacity-40`}
          >
            角色生成
          </button>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 p-2 text-[11px] leading-4 text-text-secondary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          {domain === 'world-origin'
            ? '当前处理“世界来源”。生成阶段只读；写入必须经过你的明确确认。'
            : domain === 'inspiration'
              ? '只读取你勾选的已保存碎片；确认后仅新增灵感版本，不自动改动项目主档。'
              : '只读取当前世界观与可见角色；确认后新增一个角色，不改已有角色或其他模块。'}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {domain === 'inspiration' && (
          <section aria-label="灵感来源选择" className="rounded-lg border border-border/70 bg-bg-base p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary">本轮来源碎片</span>
              <span className="text-[10px] text-text-muted">
                已选 {inspirationCopilot.selectedFragmentIds.size}/{inspirationCopilot.fragments.length}
              </span>
            </div>
            {inspirationCopilot.loading ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取灵感工作区…
              </div>
            ) : inspirationCopilot.fragments.length === 0 ? (
              <p className="mt-2 text-[11px] leading-4 text-text-muted">
                暂无已保存碎片。请先在“项目 → 灵感反推”中保存来源，再回到这里生成候选。
              </p>
            ) : (
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
                {inspirationCopilot.fragments.map(fragment => (
                  <label
                    key={fragment.id}
                    className="flex cursor-pointer items-start gap-2 rounded border border-border/60 px-2 py-1.5 hover:bg-bg-hover"
                  >
                    <input
                      type="checkbox"
                      checked={inspirationCopilot.selectedFragmentIds.has(fragment.id)}
                      disabled={domainLocked}
                      onChange={() => inspirationCopilot.toggleFragment(fragment.id)}
                      className="mt-0.5 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-text-secondary">
                        {fragment.label || fragment.sourceKind}
                      </span>
                      <span className="line-clamp-2 block text-[10px] leading-4 text-text-muted">
                        {fragment.text}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {copilot.messages.map(message => (
          <div
            key={message.id}
            className={`max-w-[92%] rounded-lg px-3 py-2 text-xs leading-5 ${
              message.role === 'user'
                ? 'ml-auto bg-accent text-white'
                : 'border border-border/70 bg-bg-base text-text-secondary'
            }`}
          >
            {message.content}
          </div>
        ))}

        {copilot.busy && !copilot.candidate && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取当前项目并生成候选…
          </div>
        )}

        {domain === 'world-origin' && worldCopilot.candidate && (
          <section className="rounded-lg border border-accent/30 bg-bg-base p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                待确认 · 世界来源
              </div>
              <span className="text-[10px] text-text-muted">
                {worldCopilot.candidate.contextSources.length} 个上下文源
              </span>
            </div>
            <textarea
              aria-label="世界来源候选"
              value={worldCopilot.candidate.draft}
              disabled={worldCopilot.busy}
              onChange={event => worldCopilot.updateCandidate(event.target.value)}
              className="h-56 w-full resize-y rounded border border-border bg-bg-surface p-2 text-xs leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              采纳前会再次检查空值、长度、无变化与来源是否过期。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={worldCopilot.busy}
                onClick={worldCopilot.rejectCandidate}
                className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                拒绝
              </button>
              <button
                type="button"
                disabled={worldCopilot.busy}
                onClick={worldCopilot.adoptCandidate}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
              >
                {worldCopilot.busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                采纳
              </button>
            </div>
          </section>
        )}
        {domain === 'inspiration' && inspirationCopilot.candidate && (
          <section className="rounded-lg border border-accent/30 bg-bg-base p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                待确认 · 灵感反推版本
              </div>
              <span className="text-[10px] text-text-muted">
                {inspirationCopilot.candidate.contextSources.length} 个上下文源
              </span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1 text-[10px] text-text-muted">
              <span className="rounded bg-bg-surface px-1.5 py-0.5">
                {inspirationCopilot.candidate.selectedFragmentIds.length} 条来源
              </span>
              <span className="rounded bg-bg-surface px-1.5 py-0.5">
                {inspirationCopilot.candidate.diff.length} 项差异（最多展示 24）
              </span>
              <span className="rounded bg-bg-surface px-1.5 py-0.5">
                {inspirationCopilot.candidate.mode === 'multiworld' ? '多世界' : '单世界'}
              </span>
            </div>
            {inspirationCopilot.candidate.diff.length > 0 && (
              <div aria-label="灵感候选差异" className="mb-2 max-h-20 overflow-y-auto rounded border border-border/60 p-2">
                {inspirationCopilot.candidate.diff.slice(0, 8).map(item => (
                  <div key={item.path} className="truncate text-[10px] leading-4 text-text-muted">
                    {item.path}：{item.before || '（空）'} → {item.after || '（空）'}
                  </div>
                ))}
              </div>
            )}
            <textarea
              aria-label="灵感反推候选 JSON"
              value={inspirationCopilot.candidate.draft}
              disabled={inspirationCopilot.busy}
              onChange={event => inspirationCopilot.updateCandidate(event.target.value)}
              className="h-64 w-full resize-y rounded border border-border bg-bg-surface p-2 font-mono text-[11px] leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              采纳前会重新解析眼前 JSON，并检查结构、长度与来源工作区是否过期。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={inspirationCopilot.busy}
                onClick={inspirationCopilot.rejectCandidate}
                className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                拒绝
              </button>
              <button
                type="button"
                disabled={inspirationCopilot.busy}
                onClick={inspirationCopilot.adoptCandidate}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
              >
                {inspirationCopilot.busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                保存版本
              </button>
            </div>
          </section>
        )}
        {domain === 'character' && characterCopilot.candidate && (
          <section className="rounded-lg border border-accent/30 bg-bg-base p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                待确认 · 新角色
              </div>
              <span className="text-[10px] text-text-muted">
                {characterCopilot.candidate.contextSources.length} 个上下文源
              </span>
            </div>
            <textarea
              aria-label="角色候选 JSON"
              value={characterCopilot.candidate.draft}
              disabled={characterCopilot.busy}
              onChange={event => characterCopilot.updateCandidate(event.target.value)}
              className="h-72 w-full resize-y rounded border border-border bg-bg-surface p-2 font-mono text-[11px] leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              确认前会重新检查字段、三轴、同名角色与角色名单是否过期。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={characterCopilot.busy}
                onClick={characterCopilot.rejectCandidate}
                className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                拒绝
              </button>
              <button
                type="button"
                disabled={characterCopilot.busy}
                onClick={characterCopilot.adoptCandidate}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
              >
                {characterCopilot.busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                新增角色
              </button>
            </div>
          </section>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        className="border-t border-border/70 p-3"
        onSubmit={event => {
          event.preventDefault()
          void copilot.submit()
        }}
      >
        <textarea
          aria-label="给 AI 对话副驾的要求"
          value={copilot.authorRequest}
          disabled={copilot.busy || Boolean(copilot.candidate)}
          maxLength={1000}
          rows={3}
          onChange={event => copilot.setAuthorRequest(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void copilot.submit()
            }
          }}
          placeholder={copilot.candidate
            ? '请先采纳或拒绝当前候选'
            : domain === 'world-origin'
              ? '例如：保留现有设定，补充文明诞生的关键事件…'
              : domain === 'inspiration'
                ? '例如：保留潮汐城市意象，强化角色冲突与开篇钩子…'
                : '例如：设计一名守灯人，克制寡言，与现有主角存在旧怨…'}
          className="w-full resize-none rounded-md border border-border bg-bg-base px-3 py-2 text-xs leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
          <button
            type="submit"
            aria-label={domain === 'world-origin'
              ? '生成世界来源候选'
              : domain === 'inspiration'
                ? '生成灵感反推候选'
                : '生成角色候选'}
            disabled={
              copilot.busy
              || Boolean(copilot.candidate)
              || !copilot.authorRequest.trim()
              || (domain === 'inspiration' && inspirationCopilot.selectedFragmentIds.size === 0)
            }
            className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            {copilot.busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />}
            生成候选
          </button>
        </div>
      </form>
    </aside>
  )
}
