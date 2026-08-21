import { useState } from 'react'
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { PendingMasterCandidate } from '../agent/useMasterCopilot'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import { CTextarea } from '../shared/CompositionInput'
import PromptRunPanel from '../shared/PromptRunPanel'
import {
  formatWorldviewFieldGenerationRequestV1,
  type WorldviewAgentField,
} from '../../lib/agent/worldview-field-copilot'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'
import type { Project } from '../../lib/types'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'

export default function WorldviewAgentControls({
  field,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
  buttonLabel = 'AI 生成',
}: {
  field: WorldviewAgentField
  project: Project
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingWorldviewLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
  buttonLabel?: string
}) {
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [mode, setMode] = useState<FieldGenerationMode>('expand')

  const handleGenerate = async () => {
    onRunningChange(true)
    try {
      const request = formatWorldviewFieldGenerationRequestV1({
        field,
        mode,
        hint,
      })
      await copilot.submitTargetedRequest(request, {
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: request,
        promptExecution: {
          version: 1,
          moduleKey: 'worldview.dimension',
          ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
          ...(systemOverride === null ? {} : { systemOverride }),
          ...(userOverride === null ? {} : { userOverride }),
        },
      })
    } finally {
      onRunningChange(false)
    }
  }

  const blocked = copilot.loading
    || copilot.busy
    || copilot.pendingCandidates.length > 0
    || (project.enableMultiWorld === true && activeGroupId == null)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AIFieldModeTabs value={mode} onChange={setMode} />
        <input
          value={hint}
          onChange={event => setHint(event.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="flex-1 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={blocked}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 shrink-0 bg-accent/10 text-accent hover:bg-accent/20"
        >
          {copilot.busy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />}
          {buttonLabel}
        </button>
      </div>

      <PromptRunPanel
        moduleKey="worldview.dimension"
        parameterValues={parameterValues}
        onParamChange={setParameterValues}
        systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride}
        userOverride={userOverride}
        onUserOverrideChange={setUserOverride}
      />

      {copilot.error && (
        <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {hasOtherPendingCandidates && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {!candidate && otherPendingWorldviewLabel && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          “{otherPendingWorldviewLabel}”还有待确认候选，请先处理后再生成其他字段。
        </p>
      )}

      {candidate && (
        <section className="border border-accent/30 bg-bg-surface p-4 rounded-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
            <span className="text-[11px] text-text-muted">
              {candidate.payload.contextEvidence
                ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                : `${candidate.payload.contextSources.length} 个输入来源`}
            </span>
          </div>
          <CTextarea
            aria-label={`${candidate.payload.label}候选内容`}
            value={candidate.event.content}
            disabled={copilot.busy}
            onChange={event => {
              void copilot.updateCandidate(candidate.event.id!, event.target.value)
            }}
            className="min-h-48 w-full resize-y font-mono text-xs leading-5"
          />
          <HarnessEvidencePanel
            contextEvidence={candidate.payload.contextEvidence}
            lifecycle={candidate.lifecycle}
            promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={copilot.busy}
              onClick={() => { void copilot.rejectCandidate(candidate) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              拒绝
            </button>
            <button
              type="button"
              disabled={copilot.busy}
              onClick={() => { void onAdopted(candidate) }}
              className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
            >
              {copilot.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              采纳
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
