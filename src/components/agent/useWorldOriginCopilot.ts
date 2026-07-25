import { useCallback, useEffect, useRef, useState } from 'react'
import {
  prepareWorldOriginCopilot,
  type PreparedWorldOriginCopilot,
} from '../../lib/agent/world-origin-copilot'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../lib/generation/generation-node'
import type { Project } from '../../lib/types'
import { useWorldviewStore } from '../../stores/worldview'

export interface CopilotMessage {
  id: number
  role: 'assistant' | 'user'
  content: string
}

export interface WorldOriginCandidate {
  node: PreparedWorldOriginCopilot['node']
  draft: string
  contextSources: string[]
  scopeKey: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
}

export function useWorldOriginCopilot(input: {
  project: Project
  worldGroupId: number | null
}) {
  const { project, worldGroupId } = input
  const [authorRequest, setAuthorRequest] = useState('')
  const [messages, setMessages] = useState<CopilotMessage[]>([{
    id: 1,
    role: 'assistant',
    content: '我会读取当前项目与世界的已登记设定，为“世界来源”生成一份候选。只有你明确采纳后才会写入。',
  }])
  const [candidate, setCandidate] = useState<WorldOriginCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const scopeKey = `${project.id}:${worldGroupId ?? 'global'}`
  const priorScopeKey = useRef(scopeKey)

  const appendMessage = useCallback((role: CopilotMessage['role'], content: string) => {
    sequence.current += 1
    const next = { id: sequence.current, role, content }
    setMessages(current => [...current, next])
  }, [])

  useEffect(() => {
    if (priorScopeKey.current === scopeKey) return
    priorScopeKey.current = scopeKey
    abortRef.current?.abort()
    setBusy(false)
    setCandidate(null)
    setAuthorRequest('')
    appendMessage('assistant', '作用域已经切换，旧候选已作废。请针对当前世界重新生成。')
  }, [appendMessage, scopeKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const submit = useCallback(async () => {
    const request = authorRequest.trim()
    if (!request || busy || candidate) return
    if (project.enableMultiWorld && worldGroupId == null) {
      appendMessage('assistant', '请先在工作区选择一个世界，再生成候选。')
      return
    }
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setAuthorRequest('')
    appendMessage('user', request)
    try {
      const prepared = await prepareWorldOriginCopilot({
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
        draft: result.output,
        contextSources: prepared.contextSources,
        scopeKey,
      })
      appendMessage(
        'assistant',
        '候选已生成。你可以直接编辑下方内容；“采纳”只会写入这份可见候选，不会再次调用模型。',
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
    project.enableMultiWorld,
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
    appendMessage('assistant', '候选已拒绝，没有写入项目。')
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
      const result = await adoptGenerationNodeOutput(candidate.node, candidate.draft)
      if (!result.adopted) {
        appendMessage(
          'assistant',
          `候选没有通过确定性检查：${result.gate?.issues.map(issue => issue.message).join('；') || '当前节点不可写入。'}`,
        )
        return
      }
      await useWorldviewStore.getState().loadAll(project.id!, worldGroupId)
      setCandidate(null)
      appendMessage('assistant', '已采纳到“世界观 → 世界起源 → 世界来源”，相关面板已同步刷新。')
    } catch (error) {
      appendMessage('assistant', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [appendMessage, busy, candidate, project.id, scopeKey, worldGroupId])

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
