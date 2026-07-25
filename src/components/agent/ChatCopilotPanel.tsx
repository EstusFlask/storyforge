import { useEffect, useRef } from 'react'
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
  const copilot = useWorldOriginCopilot({ project, worldGroupId })
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

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
                MVP
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
        <div className="mt-3 flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 p-2 text-[11px] leading-4 text-text-secondary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          当前只处理“世界来源”。生成阶段只读；写入必须经过你的明确确认。
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
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

        {copilot.candidate && (
          <section className="rounded-lg border border-accent/30 bg-bg-base p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                待确认 · 世界来源
              </div>
              <span className="text-[10px] text-text-muted">
                {copilot.candidate.contextSources.length} 个上下文源
              </span>
            </div>
            <textarea
              aria-label="世界来源候选"
              value={copilot.candidate.draft}
              disabled={copilot.busy}
              onChange={event => copilot.updateCandidate(event.target.value)}
              className="h-56 w-full resize-y rounded border border-border bg-bg-surface p-2 text-xs leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              采纳前会再次检查空值、长度、无变化与来源是否过期。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={copilot.busy}
                onClick={copilot.rejectCandidate}
                className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                拒绝
              </button>
              <button
                type="button"
                disabled={copilot.busy}
                onClick={copilot.adoptCandidate}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
              >
                {copilot.busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                采纳
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
            : '例如：保留现有设定，补充文明诞生的关键事件…'}
          className="w-full resize-none rounded-md border border-border bg-bg-base px-3 py-2 text-xs leading-5 text-text-primary outline-none focus:border-accent disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Enter 发送 · Shift+Enter 换行</span>
          <button
            type="submit"
            aria-label="生成世界来源候选"
            disabled={copilot.busy || Boolean(copilot.candidate) || !copilot.authorRequest.trim()}
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
