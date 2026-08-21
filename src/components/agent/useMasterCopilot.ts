import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../lib/agent/conversations'
import {
  adoptMasterCandidate,
  createMasterAgentPlan,
  executeMasterAgentPlan,
  type ExecutedMasterCandidate,
  type PinnedMasterAgentTaskV1,
  type MasterCandidatePayload,
} from '../../lib/agent/orchestrator'
import {
  findResumableMasterAgentRunV1,
  isMasterAgentDurableHarnessEnabledV1,
  runDurableMasterAgentPlanV1,
} from '../../lib/agent/run/master-durable'
import {
  commitMasterAgentCandidateAdoptionV1,
  recoverPendingMasterAgentAdoptionsV1,
  rejectMasterAgentCandidateV1,
} from '../../lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../lib/agent/run/master-verification'
import type { AgentEvent, Project, WorkspaceScope } from '../../lib/types'
import { parseAgentEventPayload } from '../../lib/types'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import { useAIConfigStore } from '../../stores/ai-config'
import { revalidateStoryArcCreativeDraftV1 } from '../../lib/agent/story-arc-copilot'
import { revalidateOutlineCreativeDraftV1 } from '../../lib/agent/outline-copilot'
import { revalidateProseCreativeDraftV1 } from '../../lib/agent/prose-copilot'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import {
  CandidateDraftSyncErrorV1,
  flushCandidateDraftV1,
  flushCandidateDraftsV1,
  hasPendingCandidateDraftsV1,
  queueCandidateDraftV1,
} from '../../lib/agent/candidate-draft-coordinator'
import type { CreativeArtifactV1 } from '../../lib/agent/creative-reliability'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
}

const MASTER_COPILOT_SYNC_EVENT = 'storyforge:master-copilot-sync-v1'
const MASTER_COPILOT_SCOPE_OWNERS = new Map<string, symbol>()

interface MasterCopilotSyncDetail {
  scopeKey: string
  busy: boolean
}

function notifyMasterCopilotSync(scopeKey: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<MasterCopilotSyncDetail>(MASTER_COPILOT_SYNC_EVENT, {
    detail: {
      scopeKey,
      busy: MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey),
    },
  }))
}

function claimMasterCopilotScope(scopeKey: string): symbol | null {
  if (MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey)) return null
  const owner = Symbol(scopeKey)
  MASTER_COPILOT_SCOPE_OWNERS.set(scopeKey, owner)
  notifyMasterCopilotSync(scopeKey)
  return owner
}

function releaseMasterCopilotScope(scopeKey: string, owner: symbol): void {
  if (MASTER_COPILOT_SCOPE_OWNERS.get(scopeKey) !== owner) return
  MASTER_COPILOT_SCOPE_OWNERS.delete(scopeKey)
  notifyMasterCopilotSync(scopeKey)
}

export interface PendingMasterCandidate {
  event: AgentEvent
  payload: MasterCandidatePayload
}

function revalidateCandidateCreativeArtifactV1(input: {
  draft: string
  creativeArtifact: CreativeArtifactV1
  payload: Readonly<Record<string, unknown>>
}): CreativeArtifactV1 {
  const payload = input.payload as unknown as MasterCandidatePayload
  if (payload.skillId === 'outline.story-arcs' && payload.storyArcKind) {
    return revalidateStoryArcCreativeDraftV1({
      draft: input.draft,
      snapshot: payload.baseSnapshot as Parameters<typeof revalidateStoryArcCreativeDraftV1>[0]['snapshot'],
      kind: payload.storyArcKind,
      previousArtifact: input.creativeArtifact,
    })
  }
  if (payload.agentId === 'outline' && payload.outlineMode) {
    return revalidateOutlineCreativeDraftV1({
      draft: input.draft,
      snapshot: payload.baseSnapshot as Parameters<typeof revalidateOutlineCreativeDraftV1>[0]['snapshot'],
      previousArtifact: input.creativeArtifact,
    })
  }
  if (payload.agentId === 'prose' && payload.informationBoundary) {
    return revalidateProseCreativeDraftV1({
      draft: input.draft,
      informationBoundary: payload.informationBoundary,
      previousArtifact: input.creativeArtifact,
    })
  }
  return input.creativeArtifact
}

export function useMasterCopilot(input: {
  project: Project
  worldGroupId: number | null
}) {
  const { project, worldGroupId } = input
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [authorRequest, setAuthorRequest] = useState('')
  const [activeRequest, setActiveRequest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runtimeCandidates = useRef(new Map<number, ExecutedMasterCandidate>())
  const localCandidateDrafts = useRef(new Map<number, string>())
  const activeCandidateScope = useRef('')
  const workspaceScope = useMemo<WorkspaceScope | undefined>(() => (
    project.id != null && project.activeWorldId != null && project.activeWorkId != null
      ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
      : undefined
  ), [project.activeWorkId, project.activeWorldId, project.id])
  const scopeKey = `${project.id}:${project.activeWorldId ?? 'legacy'}:${project.activeWorkId ?? 'legacy'}:${worldGroupId ?? 'global'}`

  activeCandidateScope.current = scopeKey

  const overlayLocalCandidateDrafts = useCallback((rows: AgentEvent[]): AgentEvent[] => (
    rows.map(event => {
      if (event.id == null) return event
      const draft = localCandidateDrafts.current.get(event.id)
      return draft == null ? event : { ...event, content: draft }
    })
  ), [])

  const reload = useCallback(async (id: number) => {
    setEvents(overlayLocalCandidateDrafts(await readAgentEvents(id, workspaceScope)))
  }, [overlayLocalCandidateDrafts, workspaceScope])

  useEffect(() => {
    if (conversationId == null || typeof window === 'undefined') return
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<MasterCopilotSyncDetail>).detail
      if (detail?.scopeKey !== scopeKey) return
      setBusy(detail.busy)
      void reload(conversationId)
    }
    window.addEventListener(MASTER_COPILOT_SYNC_EVENT, handleSync)
    return () => window.removeEventListener(MASTER_COPILOT_SYNC_EVENT, handleSync)
  }, [conversationId, reload, scopeKey])

  const recordTask = useCallback(async (
    task: Parameters<NonNullable<Parameters<typeof executeMasterAgentPlan>[0]['onTask']>>[0],
    status: 'running' | 'completed' | 'failed',
    error?: string,
  ) => {
    if (conversationId == null) return
    await appendAgentEvent({
      projectId: project.id!,
      conversationId,
      kind: 'task',
      content: error || task.instruction,
      payload: { taskId: task.id, agentId: task.agentId, status, error },
      scope: workspaceScope,
    })
  }, [conversationId, project.id, workspaceScope])

  useEffect(() => {
    let active = true
    abortRef.current?.abort()
    runtimeCandidates.current.clear()
    localCandidateDrafts.current.clear()
    setBusy(MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey))
    setRecoveryAvailable(false)
    setError(null)
    setLoading(true)
    void (async () => {
      const conversation = await getOrCreateAgentConversation({
        projectId: project.id!,
        worldGroupId,
        scope: workspaceScope,
      })
      if (!active) return
      setConversationId(conversation.id!)
      if (workspaceScope) {
        const recovered = await recoverPendingMasterAgentAdoptionsV1(workspaceScope)
        for (const runId of recovered.recoveredRunIds) {
          await verifyMasterAgentRunV1({ scope: workspaceScope, runId })
        }
      }
      let rows = await readAgentEvents(conversation.id!, workspaceScope)
      if (!rows.length) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId: conversation.id!,
          kind: 'message',
          role: 'assistant',
          content: '直接告诉我你想完成什么。我会理解目标、调用需要的领域 Agent，并把结果统一交给你确认。',
          scope: workspaceScope,
        })
        rows = await readAgentEvents(conversation.id!, workspaceScope)
      }
      if (active) {
        setEvents(overlayLocalCandidateDrafts(rows))
        setRecoveryAvailable(workspaceScope
          ? await findResumableMasterAgentRunV1({
              scope: workspaceScope,
              conversationId: conversation.id!,
            }) != null
          : false)
        setLoading(false)
      }
    })().catch(error => {
      if (active) {
        console.error('[master-copilot] load failed', error)
        setLoading(false)
      }
    })
    return () => {
      active = false
      abortRef.current?.abort()
    }
  }, [overlayLocalCandidateDrafts, project.id, scopeKey, workspaceScope, worldGroupId])

  const candidateDraftPrefix = conversationId == null
    ? null
    : `${scopeKey}:conversation:${conversationId}:candidate:`
  const candidateDraftKey = useCallback((eventId: number) => {
    if (conversationId == null) throw new Error('Agent 对话尚未就绪。')
    return `${scopeKey}:conversation:${conversationId}:candidate:${eventId}`
  }, [conversationId, scopeKey])

  useEffect(() => {
    if (!candidateDraftPrefix || typeof window === 'undefined') return
    const prefix = candidateDraftPrefix
    const flush = () => { void flushCandidateDraftsV1(prefix).catch(() => undefined) }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingCandidateDraftsV1(prefix)) return
      flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flush()
    }
  }, [candidateDraftPrefix])

  const pendingCandidates = useMemo(() => {
    const resolved = new Set<number>()
    events.filter(event => event.kind === 'confirmation').forEach(event => {
      const payload = parseAgentEventPayload<{ candidateEventId?: number }>(event, {})
      if (typeof payload.candidateEventId === 'number') resolved.add(payload.candidateEventId)
    })
    return events
      .filter(event => event.kind === 'candidate' && event.id != null && !resolved.has(event.id))
      .map(event => ({
        event,
        payload: parseAgentEventPayload<MasterCandidatePayload>(event, {
          version: 1,
          taskId: '',
          agentId: 'character',
          label: '候选',
          contextSources: [],
          baseSnapshot: {},
        }),
      }))
  }, [events])

  const submitRequest = useCallback(async (
    requestOverride?: string,
    options?: { pinnedTask?: PinnedMasterAgentTaskV1 },
  ) => {
    const request = (requestOverride ?? authorRequest).trim()
    if (!request || busy || conversationId == null) return
    if (pendingCandidates.length) return
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setActiveRequest(request)
    setError(null)
    if (requestOverride === undefined) setAuthorRequest('')
    try {
      await flushPendingEditsV1()
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'user',
        content: request,
        scope: workspaceScope,
      })
      await reload(conversationId)
      const teamBudget = new AgentTeamBudgetTracker(
        useAIConfigStore.getState().agentTeamBudgetProfile,
      )
      const plan = await createMasterAgentPlan({
        projectId: project.id!,
        scope: workspaceScope,
        worldGroupId,
        request,
        budget: teamBudget,
        signal: controller.signal,
        pinnedTask: options?.pinnedTask,
      })
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'plan',
        content: plan.summary,
        payload: plan,
        scope: workspaceScope,
      })
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: `${plan.summary} 我会在后台完成 ${plan.tasks.length} 个领域任务。`,
        scope: workspaceScope,
      })
      await reload(conversationId)

      const durable = workspaceScope && isMasterAgentDurableHarnessEnabledV1()
        ? await runDurableMasterAgentPlanV1({
            scope: workspaceScope,
            worldGroupId,
            conversationId,
            plan,
            budget: teamBudget,
            signal: controller.signal,
            onTask: recordTask,
          })
        : null
      const candidates = durable
        ? durable.candidates.map(candidate => ({
            payload: candidate.payload,
            draft: candidate.draft,
            runtimeNode: candidate.runtime?.runtimeNode ?? ({} as any),
            runtimeOutput: candidate.runtime?.runtimeOutput ?? candidate.draft,
          }))
        : await executeMasterAgentPlan({
            projectId: project.id!,
            scope: workspaceScope,
            worldGroupId,
            plan,
            budget: teamBudget,
            signal: controller.signal,
            onTask: recordTask,
          })
      if (!durable) {
        for (const candidate of candidates) {
          const event = await appendAgentEvent({
            projectId: project.id!,
            conversationId,
            kind: 'candidate',
            content: candidate.draft,
            payload: candidate.payload,
            scope: workspaceScope,
          })
          runtimeCandidates.current.set(event.id!, candidate)
        }
      } else {
        for (const candidate of durable.candidates) {
          if (candidate.event.id != null && candidate.runtime) {
            runtimeCandidates.current.set(candidate.event.id, candidate.runtime)
          }
        }
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
          content: [
          `后台领域 Agent 已完成，生成了 ${candidates.length} 份候选。请检查、编辑并决定是否采纳。`,
          `本轮团队约使用 ${teamBudget.snapshot().usedTokens.toLocaleString()} / `
          + `${teamBudget.snapshot().maxTokens.toLocaleString()} tokens，`
          + `${teamBudget.snapshot().calls} 次调用，`
          + `Canon 受控打回 ${teamBudget.snapshot().canonRetries} 次。`,
          ].join(' '),
          scope: workspaceScope,
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error)
        setError(message)
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'error',
          content: message,
          scope: workspaceScope,
        })
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: `本轮没有完成：${message}`,
          scope: workspaceScope,
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setActiveRequest(null)
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      await reload(conversationId)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [
    authorRequest,
    busy,
    conversationId,
    pendingCandidates.length,
    project.id,
    recordTask,
    reload,
    scopeKey,
    worldGroupId,
    workspaceScope,
  ])

  const submit = useCallback(() => submitRequest(), [submitRequest])

  const submitTargetedRequest = useCallback((
    request: string,
    pinnedTask: PinnedMasterAgentTaskV1,
  ) => submitRequest(request, { pinnedTask }), [submitRequest])

  const resume = useCallback(async () => {
    if (busy || conversationId == null || !workspaceScope) return
    const runId = await findResumableMasterAgentRunV1({
      scope: workspaceScope,
      conversationId,
    })
    if (runId == null) {
      setRecoveryAvailable(false)
      return
    }
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await runDurableMasterAgentPlanV1({
        scope: workspaceScope,
        worldGroupId,
        runId,
        signal: controller.signal,
        onTask: recordTask,
      })
      for (const candidate of result.candidates) {
        if (candidate.event.id != null && candidate.runtime) {
          runtimeCandidates.current.set(candidate.event.id, candidate.runtime)
        }
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: `已从中断处恢复本轮执行，当前生成了 ${result.candidates.length} 份候选。请检查并确认。`,
        scope: workspaceScope,
      })
      setRecoveryAvailable(false)
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error))
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: `恢复本轮失败：${errorMessage(error)}`,
          scope: workspaceScope,
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      await reload(conversationId)
      setRecoveryAvailable(await findResumableMasterAgentRunV1({
        scope: workspaceScope,
        conversationId,
      }) != null)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [busy, conversationId, project.id, recordTask, reload, scopeKey, worldGroupId, workspaceScope])

  const updateCandidate = useCallback((eventId: number, draft: string): Promise<void> => {
    const key = candidateDraftKey(eventId)
    const editingScope = scopeKey
    localCandidateDrafts.current.set(eventId, draft)
    setEvents(current => current.map(event => event.id === eventId
      ? { ...event, content: draft }
      : event))
    setError(null)
    queueCandidateDraftV1({
      key,
      draft,
      persist: persistedDraft => updateAgentEventCandidate(
        eventId,
        project.id!,
        persistedDraft,
        workspaceScope,
        {
          revalidateCreativeArtifact: ({ creativeArtifact, payload }) => (
            revalidateCandidateCreativeArtifactV1({
              draft: persistedDraft,
              creativeArtifact,
              payload,
            })
          ),
        },
      ),
      onSynced: (persistedDraft, result) => {
        if (activeCandidateScope.current !== editingScope) return
        const currentDraft = localCandidateDrafts.current.get(eventId)
        if (currentDraft === persistedDraft) localCandidateDrafts.current.delete(eventId)
        const nextPayload = typeof result === 'string' ? result : null
        setEvents(current => current.map(event => event.id === eventId
          ? {
              ...event,
              content: localCandidateDrafts.current.get(eventId) ?? persistedDraft,
              ...(nextPayload ? { payload: nextPayload } : {}),
            }
          : event))
        notifyMasterCopilotSync(editingScope)
      },
      onError: syncError => {
        if (activeCandidateScope.current === editingScope) setError(syncError.message)
      },
    })
    return Promise.resolve()
  }, [candidateDraftKey, project.id, scopeKey, workspaceScope])

  const resolveCandidate = useCallback(async (
    candidate: PendingMasterCandidate,
    decision: 'adopted' | 'rejected',
  ) => {
    if (busy || conversationId == null || candidate.event.id == null) return
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    setBusy(true)
    setError(null)
    let shouldReload = false
    try {
      await flushCandidateDraftV1(candidateDraftKey(candidate.event.id))
      const persistedEvents = await readAgentEvents(conversationId, workspaceScope)
      const persistedEvent = persistedEvents.find(event => event.id === candidate.event.id && event.kind === 'candidate')
      if (!persistedEvent) throw new Error('待确认候选在同步后不存在。')
      const persistedCandidate: PendingMasterCandidate = {
        event: persistedEvent,
        payload: parseAgentEventPayload<MasterCandidatePayload>(persistedEvent, {
          version: 1,
          taskId: '',
          agentId: 'character',
          label: '候选',
          contextSources: [],
          baseSnapshot: {},
        }),
      }
      shouldReload = true
      let message = '候选已拒绝，没有写入项目。'
      let terminalMessage: string | null = null
      const durableCandidate = persistedCandidate.payload.runId != null && persistedCandidate.payload.runStepId
      if (durableCandidate && decision === 'adopted') {
        const adoption = await commitMasterAgentCandidateAdoptionV1({
          scope: workspaceScope!,
          runId: persistedCandidate.payload.runId!,
          candidateEventId: persistedCandidate.event.id!,
          runtime: runtimeCandidates.current.get(persistedCandidate.event.id!),
        })
        message = adoption.message
        const verification = await verifyMasterAgentRunV1({
          scope: workspaceScope!,
          runId: persistedCandidate.payload.runId!,
        })
        if (verification.accepted) {
          // Keep the business-adoption message stable for existing callers and
          // surface terminal verification as a separate auditable event.
          terminalMessage = '本轮所有步骤均已通过终态校验。'
        } else if (!verification.codes.includes('run-not-ready')) {
          message = `${message} 终态校验未通过：${verification.codes.join('、')}。`
        }
      } else if (durableCandidate) {
        await rejectMasterAgentCandidateV1({
          scope: workspaceScope!,
          runId: persistedCandidate.payload.runId!,
          candidateEventId: persistedCandidate.event.id!,
        })
      } else if (decision === 'adopted') {
        message = await adoptMasterCandidate({
          projectId: project.id!,
          scope: workspaceScope,
          worldGroupId,
          event: persistedCandidate.event,
          payload: persistedCandidate.payload,
          draft: persistedCandidate.event.content,
          runtime: runtimeCandidates.current.get(persistedCandidate.event.id!),
        })
      }
      if (!durableCandidate) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'confirmation',
          content: message,
          payload: { candidateEventId: persistedCandidate.event.id, decision },
          scope: workspaceScope,
        })
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: message,
        scope: workspaceScope,
      })
      if (terminalMessage) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: terminalMessage,
          scope: workspaceScope,
        })
      }
      runtimeCandidates.current.delete(persistedCandidate.event.id!)
      localCandidateDrafts.current.delete(persistedCandidate.event.id!)
      return true
    } catch (error) {
      setError(errorMessage(error))
      if (error instanceof CandidateDraftSyncErrorV1) return false
      shouldReload = true
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: errorMessage(error),
        scope: workspaceScope,
      })
      return false
    } finally {
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      if (shouldReload) await reload(conversationId)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [busy, candidateDraftKey, conversationId, project.id, reload, scopeKey, workspaceScope, worldGroupId])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return {
    authorRequest,
    activeRequest,
    setAuthorRequest,
    events,
    pendingCandidates,
    busy,
    loading,
    recoveryAvailable,
    error,
    submit,
    submitRequest,
    submitTargetedRequest,
    resume,
    stop,
    updateCandidate,
    adoptCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'adopted'),
    rejectCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'rejected'),
  }
}

export type MasterCopilotController = ReturnType<typeof useMasterCopilot>
