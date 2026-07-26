import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
  type PreparedCharacterCopilot,
} from '../../lib/agent/character-copilot'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../lib/generation/generation-node'
import type { Project } from '../../lib/types'
import { useCharacterStore } from '../../stores/character'
import type { CopilotMessage } from './useWorldOriginCopilot'

export interface CharacterCandidate {
  node: PreparedCharacterCopilot['node']
  draft: string
  contextSources: string[]
  scopeKey: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
}

export function useCharacterCopilot(input: {
  project: Project
  worldGroupId: number | null
}) {
  const { project, worldGroupId } = input
  const [authorRequest, setAuthorRequest] = useState('')
  const [messages, setMessages] = useState<CopilotMessage[]>([{
    id: 1,
    role: 'assistant',
    content: '请描述一个新角色。我会结合当前世界和可见角色生成结构化候选，确认后才新增角色主档。',
  }])
  const [candidate, setCandidate] = useState<CharacterCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const scopeKey = `${project.id}:${worldGroupId ?? 'global'}`
  const priorScopeKey = useRef(scopeKey)

  const appendMessage = useCallback((role: CopilotMessage['role'], content: string) => {
    sequence.current += 1
    setMessages(current => [...current, { id: sequence.current, role, content }])
  }, [])

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
      content: '项目或世界已经切换，旧角色候选和对话记录已作废。',
    }])
  }, [scopeKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const submit = useCallback(async () => {
    const request = authorRequest.trim()
    if (!request || busy || candidate) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setAuthorRequest('')
    appendMessage('user', request)
    try {
      const prepared = await prepareCharacterCopilot({
        projectId: project.id!,
        worldGroupId,
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
        contextSources: prepared.contextSources,
        scopeKey,
      })
      appendMessage(
        'assistant',
        '角色候选已生成。你可以检查或编辑结构化 JSON；确认只新增眼前这份候选，不会再次调用模型。',
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
    worldGroupId,
  ])

  const updateCandidate = useCallback((draft: string) => {
    setCandidate(current => current ? { ...current, draft } : null)
  }, [])

  const rejectCandidate = useCallback(() => {
    if (!candidate || busy) return
    setCandidate(null)
    appendMessage('assistant', '角色候选已拒绝，没有新增角色。')
  }, [appendMessage, busy, candidate])

  const adoptCandidate = useCallback(async () => {
    if (!candidate || busy) return
    if (candidate.scopeKey !== scopeKey) {
      setCandidate(null)
      appendMessage('assistant', '当前项目或世界已经变化，旧候选已作废。请重新生成。')
      return
    }
    setBusy(true)
    try {
      const visibleCandidate = parseCharacterCandidateDraft(candidate.draft)
      const result = await adoptGenerationNodeOutput(candidate.node, visibleCandidate)
      if (!result.adopted) {
        appendMessage(
          'assistant',
          `候选没有通过确定性检查：${result.gate?.issues.map(issue => issue.message).join('；') || '当前节点不可写入。'}`,
        )
        return
      }
      await useCharacterStore.getState().loadAll(project.id!)
      setCandidate(null)
      appendMessage(
        'assistant',
        `已新增角色“${visibleCandidate.name}”，角色相关面板已同步刷新。`,
      )
    } catch (error) {
      appendMessage('assistant', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [appendMessage, busy, candidate, project.id, scopeKey])

  return {
    authorRequest,
    setAuthorRequest,
    messages,
    candidate,
    busy,
    submit,
    updateCandidate,
    rejectCandidate,
    adoptCandidate,
  }
}
