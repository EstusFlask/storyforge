import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseInspirationCandidateDraft,
  prepareInspirationCopilot,
  type PreparedInspirationCopilot,
} from '../../lib/agent/inspiration-copilot'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../lib/generation/generation-node'
import { diffInspirationResults } from '../../lib/inspiration/workspace'
import type { Project } from '../../lib/types'
import type { InspirationResultMode } from '../../lib/types/inspiration-workspace'
import { useInspirationWorkspaceStore } from '../../stores/inspiration-workspace'
import type { CopilotMessage } from './useWorldOriginCopilot'

export interface InspirationCandidate {
  node: PreparedInspirationCopilot['node']
  draft: string
  mode: InspirationResultMode
  diff: ReturnType<typeof diffInspirationResults>
  contextSources: string[]
  selectedFragmentIds: string[]
  scopeKey: string
  previousResult: PreparedInspirationCopilot['previousResult']
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
}

export function useInspirationCopilot(input: { project: Project }) {
  const { project } = input
  const workspace = useInspirationWorkspaceStore()
  const [authorRequest, setAuthorRequest] = useState('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<CopilotMessage[]>([{
    id: 1,
    role: 'assistant',
    content: '请选择已有灵感碎片，再告诉我本轮想强化的方向。我会生成结构化候选，确认后才保存为新版本。',
  }])
  const [candidate, setCandidate] = useState<InspirationCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const scopeKey = String(project.id)
  const priorScopeKey = useRef(scopeKey)

  const appendMessage = useCallback((role: CopilotMessage['role'], content: string) => {
    sequence.current += 1
    setMessages(current => [...current, { id: sequence.current, role, content }])
  }, [])

  useEffect(() => {
    let active = true
    setSelectedFragmentIds(new Set())
    void useInspirationWorkspaceStore.getState().load(project.id!).then(() => {
      if (!active) return
      const fragments = useInspirationWorkspaceStore.getState().fragments
      setSelectedFragmentIds(new Set(fragments.map(fragment => fragment.id)))
    }).catch(error => {
      if (active) appendMessage('assistant', errorMessage(error))
    })
    return () => { active = false }
  }, [appendMessage, project.id])

  useEffect(() => {
    if (priorScopeKey.current === scopeKey) return
    priorScopeKey.current = scopeKey
    abortRef.current?.abort()
    setBusy(false)
    setCandidate(null)
    setAuthorRequest('')
    sequence.current += 1
    setMessages([{
      id: sequence.current,
      role: 'assistant',
      content: '项目已经切换，旧灵感候选和对话记录已作废。',
    }])
  }, [scopeKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const toggleFragment = useCallback((fragmentId: string) => {
    if (busy || candidate) return
    setSelectedFragmentIds(current => {
      const next = new Set(current)
      if (next.has(fragmentId)) next.delete(fragmentId)
      else next.add(fragmentId)
      return next
    })
  }, [busy, candidate])

  const submit = useCallback(async () => {
    const request = authorRequest.trim()
    if (!request || busy || candidate) return
    if (selectedFragmentIds.size === 0) {
      appendMessage('assistant', '请先勾选至少一条已保存灵感碎片。新增来源仍在“项目 → 灵感反推”中明确保存。')
      return
    }
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setAuthorRequest('')
    appendMessage('user', request)
    try {
      const prepared = await prepareInspirationCopilot({
        projectId: project.id!,
        selectedFragmentIds: [...selectedFragmentIds],
        authorRequest: request,
        signal: controller.signal,
      })
      const result = await runGenerationNode(prepared.node, prepared.prepared)
      if (controller.signal.aborted) return
      if (result.gate?.status === 'blocked') {
        appendMessage(
          'assistant',
          `候选没有通过确定性检查：${result.gate.issues.map(issue => issue.message).join('；')}`,
        )
        return
      }
      setCandidate({
        node: prepared.node,
        draft: JSON.stringify(result.output, null, 2),
        mode: prepared.mode,
        diff: diffInspirationResults(prepared.previousResult ?? {}, result.output),
        contextSources: prepared.contextSources,
        selectedFragmentIds: prepared.selectedFragmentIds,
        scopeKey,
        previousResult: prepared.previousResult,
      })
      appendMessage(
        'assistant',
        '反推候选已生成。你可以检查或编辑结构化 JSON；确认只保存眼前这份候选，不会再次调用模型。',
      )
    } catch (error) {
      if (!controller.signal.aborted) appendMessage('assistant', errorMessage(error))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }, [
    appendMessage,
    authorRequest,
    busy,
    candidate,
    project.id,
    scopeKey,
    selectedFragmentIds,
  ])

  const updateCandidate = useCallback((draft: string) => {
    setCandidate(current => {
      if (!current) return null
      try {
        const visibleCandidate = parseInspirationCandidateDraft(draft, current.mode)
        return {
          ...current,
          draft,
          diff: diffInspirationResults(current.previousResult ?? {}, visibleCandidate),
        }
      } catch {
        // 编辑中的 JSON 可以暂时不完整；确认时仍会拒绝无效结构。
        return { ...current, draft }
      }
    })
  }, [])

  const rejectCandidate = useCallback(() => {
    if (!candidate || busy) return
    setCandidate(null)
    appendMessage('assistant', '灵感候选已拒绝，没有新增确认版本。')
  }, [appendMessage, busy, candidate])

  const adoptCandidate = useCallback(async () => {
    if (!candidate || busy) return
    if (candidate.scopeKey !== scopeKey) {
      setCandidate(null)
      appendMessage('assistant', '当前项目已经变化，旧候选已作废。请重新生成。')
      return
    }
    setBusy(true)
    try {
      const visibleCandidate = parseInspirationCandidateDraft(candidate.draft, candidate.mode)
      const result = await adoptGenerationNodeOutput(candidate.node, visibleCandidate)
      if (!result.adopted) {
        appendMessage(
          'assistant',
          `候选没有通过确定性检查：${result.gate?.issues.map(issue => issue.message).join('；') || '当前节点不可写入。'}`,
        )
        return
      }
      setCandidate(null)
      appendMessage(
        'assistant',
        `已保存为新的${candidate.mode === 'multiworld' ? '多世界' : '单世界'}灵感版本；项目主档尚未自动采纳。`,
      )
    } catch (error) {
      appendMessage('assistant', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [appendMessage, busy, candidate, scopeKey])

  return {
    authorRequest,
    setAuthorRequest,
    selectedFragmentIds,
    messages,
    candidate,
    busy,
    loading: workspace.loading || (
      workspace.workspace != null
      && workspace.workspace.projectId !== project.id
    ),
    fragments: workspace.workspace?.projectId === project.id ? workspace.fragments : [],
    versions: workspace.workspace?.projectId === project.id ? workspace.versions : [],
    mode: (project.enableMultiWorld ? 'multiworld' : 'single') as InspirationResultMode,
    toggleFragment,
    submit,
    updateCandidate,
    rejectCandidate,
    adoptCandidate,
  }
}
