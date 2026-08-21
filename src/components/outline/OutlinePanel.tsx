import { useState, useEffect, useMemo, useCallback } from 'react'
import { useOutlineStore } from '../../stores/outline'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { assembleContext } from '../../lib/registry/assemble-context'
import { resolveOutlineGenerationSourceKeysV2 } from '../../lib/outline/harness'
import {
  parseChapterOutlineOutput, parseVolumeOutlineOutput,
  type ParsedVolume, type ParsedChapter,
} from '../../lib/ai/parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import { getTopLevelVolumes } from '../../lib/outline/selectors'
import { normalizeOutlineNode } from '../../lib/outline/normalize'
import PromptRunPanel from '../shared/PromptRunPanel'
import PanelLayout from '../shared/PanelLayout'
import { CInput } from '../shared/CompositionInput'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import type { Project, StoryStructure } from '../../lib/types'
import { STORY_STRUCTURES } from '../../lib/types/outline'
import OutlineVolumeSidebar from './OutlineVolumeSidebar'
import OutlineVolumeDetail from './OutlineVolumeDetail'
import OutlineGenerationRequestPanel from './OutlineGenerationRequestPanel'
import OutlineGenerationResultPanel from './OutlineGenerationResultPanel'
import { useOutlineBatchGeneration } from './useOutlineBatchGeneration'
import { useOutlineGenerationController } from './useOutlineGenerationController'
import { useOutlineChapterCountEstimate } from './useOutlineChapterCountEstimate'
import { useOutlineChapterDrag } from './useOutlineChapterDrag'
import { decodeGenerationOperation } from '../../lib/outline/generation-request'
import { useInitialRecordTarget } from '../shared/initial-record-target'

interface Props {
  project: Project
  onOpenChapter?: (nodeId: number) => void
  initialNodeId?: number | null
}

export default function OutlinePanel({ project, onOpenChapter, initialNodeId }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const { nodes, loadAll, addNode, updateNode, deleteNode, reorderNodes, insertNodeAt, moveNodeToParent } = useOutlineStore()
  const worldGroups = useWorldGroupStore(s => s.groups)
  const aiConfig = useAIConfigStore(s => s.config)
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [promptPanelOpen, setPromptPanelOpen] = useState(false)
  const { activeChapterDrag, beginChapterDrag, clearActiveChapterDrag, getActiveChapterDrag } = useOutlineChapterDrag()

  // 采纳预览
  const [previewVolumes, setPreviewVolumes] = useState<ParsedVolume[] | null>(null)
  const [previewChapters, setPreviewChapters] = useState<ParsedChapter[] | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<number | null>(null)
  const clearGenerationPreview = useCallback(() => {
    setPreviewVolumes(null)
    setPreviewChapters(null)
    setPreviewTargetId(null)
  }, [])

  const ai = useAIStream(createAISessionKey(project.id!, 'outline.generate'))

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const normalizedNodes = useMemo(() => nodes.map(normalizeOutlineNode), [nodes])
  const volumes = getTopLevelVolumes(normalizedNodes)
  const selectedVol = volumes.find(v => v.id === selectedVolId) || null
  const initialTargetVolumeId = useMemo(() => {
    if (initialNodeId == null) return null
    const byId = new Map(normalizedNodes.filter(node => node.id != null).map(node => [node.id!, node]))
    let current = byId.get(initialNodeId)
    const seen = new Set<number>()
    while (current?.id != null && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.type === 'volume') return current.id
      current = current.parentId == null ? undefined : byId.get(current.parentId)
    }
    return null
  }, [initialNodeId, normalizedNodes])

  useEffect(() => {
    if (initialTargetVolumeId != null) setSelectedVolId(initialTargetVolumeId)
  }, [initialTargetVolumeId])
  useInitialRecordTarget(
    initialNodeId,
    initialTargetVolumeId != null && selectedVolId === initialTargetVolumeId,
  )

  useOutlineChapterCountEstimate({
    selectedVolumeId: selectedVolId,
    selectedVolumeExists: selectedVol != null,
    targetWordCount: project.targetWordCount,
    volumeCount: volumes.length,
    parameterValues,
    setParameterValues,
  })

  // 自动选中第一个卷
  useEffect(() => {
    if (selectedVolId === null && volumes.length > 0) {
      setSelectedVolId(volumes[0].id!)
    }
  }, [volumes, selectedVolId])

  const handleAddVolume = async () => {
    const id = await addNode({
      projectId: project.id!, parentId: null, type: 'volume',
      title: `第${volumes.length + 1}卷`, summary: '', order: volumes.length,
    })
    setSelectedVolId(id)
  }

  const handleAddChapter = async (parentId?: number) => {
    const pid = parentId ?? selectedVol?.id
    if (!pid) return
    const siblings = nodes.filter(n => n.parentId === pid && n.type === 'chapter')
    await addNode({
      projectId: project.id!, parentId: pid, type: 'chapter',
      title: `第${siblings.length + 1}章`, summary: '', order: siblings.length,
    })
  }

  // FB-2 任意位置插入：在某章之后插入一章（同 parentId 内重排 order）
  const handleInsertChapterAfter = async (afterChapterId: number, parentId: number) => {
    const siblingIds = nodes
      .filter(n => n.parentId === parentId && n.type === 'chapter')
      .sort((a, b) => a.order - b.order)
      .map(n => n.id!)
    const index = siblingIds.indexOf(afterChapterId) + 1
    await insertNodeAt(
      { projectId: project.id!, parentId, type: 'chapter', title: '新章节', summary: '', order: 0 },
      siblingIds,
      index,
    )
  }

  const findWorldGroupForParent = (parentId: number | null): number | null => {
    if (parentId == null) return null
    const parent = normalizedNodes.find(node => node.id === parentId)
    if (!parent) return null
    if (parent.type === 'volume') return parent.worldGroupId ?? null
    if (parent.type === 'storyBlock') {
      const volume = normalizedNodes.find(node => node.id === parent.parentId && node.type === 'volume')
      return volume?.worldGroupId ?? null
    }
    return null
  }

  const canMoveChapterToParent = (chapterId: number, targetParentId: number | null): boolean => {
    if (!project.enableMultiWorld) return true
    const chapter = normalizedNodes.find(node => node.id === chapterId && node.type === 'chapter')
    if (!chapter) return false
    return findWorldGroupForParent(chapter.parentId) === findWorldGroupForParent(targetParentId)
  }

  const handleMoveChapter = async (chapterId: number, targetParentId: number, index: number) => {
    if (!canMoveChapterToParent(chapterId, targetParentId)) {
      toast.error('不能把章节拖到其它世界组的卷下。')
      return
    }
    try {
      await moveNodeToParent(chapterId, targetParentId, index)
    } catch (error) {
      console.error('[OutlinePanel] Failed to move chapter', error)
      toast.error('章节移动失败，请重试。')
    }
  }

  const handleAddStructure = async (structure: StoryStructure) => {
    if (!selectedVol) return
    const def = STORY_STRUCTURES[structure]
    const currentBlocks = normalizedNodes
      .filter(node => node.parentId === selectedVol.id && node.type === 'storyBlock')
      .sort((a, b) => a.order - b.order)
    if (structure === 'custom') {
      await addNode({
        projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
        title: '自定义故事块', summary: '', order: currentBlocks.length,
      })
    } else {
      for (let i = 0; i < def.blocks.length; i++) {
        await addNode({
          projectId: project.id!, parentId: selectedVol.id!, type: 'storyBlock',
          title: def.blocks[i], summary: '', order: currentBlocks.length + i,
        })
      }
    }
  }

  const generationRunOptions = useMemo(() => ({
    parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
    overrides: (systemOverride != null || userOverride != null) ? {
      systemPrompt: systemOverride ?? undefined,
      userPromptTemplate: userOverride ?? undefined,
    } : undefined,
  }), [parameterValues, systemOverride, userOverride])

  const buildOutlineAssembledContext = useCallback(async (
    request: Parameters<typeof resolveOutlineGenerationSourceKeysV2>[0]['request'],
    worldGroupId: number | null,
    outlineNodeId?: number | null,
    priorOutlineCandidateText?: string,
  ) => {
    return await assembleContext({
      projectId: project.id!,
      worldGroupId,
      outlineNodeId: outlineNodeId ?? null,
      priorOutlineCandidateText,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: resolveOutlineGenerationSourceKeysV2({
        request,
        hasPriorOutlineCandidate: Boolean(priorOutlineCandidateText?.trim()),
      }),
    })
  }, [project.id, aiConfig.provider, aiConfig.model])

  const generation = useOutlineGenerationController({
    project,
    nodes,
    volumes,
    hint,
    runOptions: generationRunOptions,
    ai,
    assembleContext: buildOutlineAssembledContext,
    openPromptPanel: () => setPromptPanelOpen(true),
    clearPreview: clearGenerationPreview,
    onInfo: toast.info,
    onError: toast.error,
    onOutlineRecovered: () => loadAll(project.id!),
  })

  const handleAIVolumes = () => { void generation.prepare({ kind: 'volumes' }) }
  const handleAIChapters = () => {
    if (selectedVol?.id) void generation.prepare({ kind: 'chapters', volumeId: selectedVol.id })
  }

  // ── 采纳预览 + 确认 ──

  const [restructuring, setRestructuring] = useState(false)
  const handlePreviewAccept = async (text: string) => {
    setRestructuring(true)
    try {
      if (generation.moduleKey === 'outline.volume') {
        const parsed = parseVolumeOutlineOutput(text)
        if (parsed.length === 0) {
          toast.error('未能从 AI 输出中解析出卷级大纲，请检查输出内容或重试。')
          return
        }
        const operation = decodeGenerationOperation(ai.operation)
        if (operation?.kind === 'single-volume') {
          setPreviewTargetId(operation.volumeId)
          setPreviewVolumes(parsed.slice(0, 1))
        } else {
          setPreviewTargetId(null)
          setPreviewVolumes(parsed)
        }
      } else {
        const parsed = parseChapterOutlineOutput(text)
        if (parsed.length === 0) {
          toast.error('未能从 AI 输出中解析出章节大纲，请检查输出内容或重试。')
          return
        }
        const operation = decodeGenerationOperation(ai.operation)
        if (operation?.kind === 'single-chapter') {
          setPreviewTargetId(operation.chapterId)
          setPreviewChapters(parsed.slice(0, 1))
        } else {
          setPreviewTargetId(null)
          setPreviewChapters(parsed)
        }
      }
    } finally {
      setRestructuring(false)
    }
  }

  const handleConfirmVolumes = async () => {
    if (!previewVolumes) return
    if (!generation.canAdopt) {
      toast.error('当前结果缺少可验证的 durable 候选，不能写入正式大纲。')
      return
    }
    const targetId = previewTargetId
    const existingCount = volumes.length
    const intent = targetId != null ? {
      version: 1 as const,
      kind: 'single-volume' as const,
      targetId,
      summary: previewVolumes[0]?.summary ?? '',
      baseSummary: volumes.find(volume => volume.id === targetId)?.summary ?? '',
    } : {
      version: 1 as const,
      kind: 'volumes' as const,
      items: previewVolumes,
      startingOrder: existingCount,
      baseExistingTitles: volumes.map(volume => volume.title),
    }
    let completion: Awaited<ReturnType<typeof generation.adoptCandidate>>
    try {
      completion = await generation.adoptCandidate(intent)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error(`卷纲采纳未完成：${message}。系统会保留 durable 运行以供刷新恢复。`)
      return
    }
    ai.reset()
    await loadAll(project.id!)
    setPreviewVolumes(null)
    setPreviewTargetId(null)
    if (targetId != null) {
      toast.success('本卷卷纲已写入并完成终态验证。')
      return
    }
    const evidence = completion.evidence as {
      result?: { writtenCount?: number; firstId?: number | null; skippedReasons?: string[] }
    }
    const result = evidence.result ?? {}
    if (result.firstId) setSelectedVolId(result.firstId)
    // FB-10:不再静默——全跳过/部分跳过都明确告知用户原因
    if ((result.writtenCount ?? 0) < previewVolumes.length) {
      toast.info(`已写入 ${result.writtenCount ?? 0} 个卷，另有 ${previewVolumes.length - (result.writtenCount ?? 0)} 个被跳过（${result.skippedReasons?.join('；') || '标题重复'}）。`)
    } else {
      toast.success(`已写入 ${result.writtenCount ?? previewVolumes.length} 个卷并完成终态验证。`)
    }
  }

  const handleConfirmChapters = async () => {
    if (!previewChapters) return
    if (!generation.canAdopt) {
      toast.error('当前结果缺少可验证的 durable 候选，不能写入正式大纲。')
      return
    }
    const targetId = previewTargetId
    const operation = decodeGenerationOperation(ai.operation)
    const destinationVolume = targetId == null
      ? operation?.kind === 'chapters'
        ? volumes.find(volume => volume.id === operation.volumeId) ?? null
        : selectedVol
      : null
    if (targetId == null && !destinationVolume) {
      await generation.failAdoption('目标卷不存在，未写入章节大纲')
      return
    }
    const existingChapters = destinationVolume
      ? nodes.filter(node => node.parentId === destinationVolume.id && node.type === 'chapter')
      : []
    const intent = targetId != null ? {
      version: 1 as const,
      kind: 'single-chapter' as const,
      targetId,
      summary: previewChapters[0]?.summary ?? '',
      baseSummary: nodes.find(node => node.id === targetId)?.summary ?? '',
    } : {
      version: 1 as const,
      kind: 'chapters' as const,
      destinationVolumeId: destinationVolume!.id!,
      items: previewChapters,
      startingOrder: existingChapters.length,
      baseExistingTitles: existingChapters.map(chapter => chapter.title),
    }
    let completion: Awaited<ReturnType<typeof generation.adoptCandidate>>
    try {
      completion = await generation.adoptCandidate(intent)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error(`章纲采纳未完成：${message}。系统会保留 durable 运行以供刷新恢复。`)
      return
    }
    ai.reset()
    await loadAll(project.id!)
    setPreviewChapters(null)
    setPreviewTargetId(null)
    if (targetId != null) {
      toast.success('本章章纲已写入并完成终态验证。')
      return
    }
    const evidence = completion.evidence as {
      result?: { writtenCount?: number; skippedReasons?: string[] }
    }
    const result = evidence.result ?? {}
    if ((result.writtenCount ?? 0) < previewChapters.length) {
      toast.info(`已写入 ${result.writtenCount ?? 0} 章，另有 ${previewChapters.length - (result.writtenCount ?? 0)} 章被跳过（${result.skippedReasons?.join('；') || '标题重复'}）。`)
    } else {
      toast.success(`已写入 ${result.writtenCount ?? previewChapters.length} 章并完成终态验证。`)
    }
  }

  const handleDeleteSelectedVolume = async () => {
    if (!selectedVol?.id) return
    const ok = await dialog.confirm({
      title: `删除「${selectedVol.title}」及其所有章节？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    deleteNode(selectedVol.id)
    setSelectedVolId(null)
  }

  const batch = useOutlineBatchGeneration({
    project,
    multiWorldEnabled: Boolean(project.enableMultiWorld),
    volumes,
    nodes,
    hint,
    runOptions: generationRunOptions,
    assembleContext: buildOutlineAssembledContext,
    reloadOutline: () => loadAll(project.id!),
    onInfo: toast.info,
    onError: toast.error,
  })

  // ── 侧栏：卷列表 ──

  const sidebarContent = (
    <OutlineVolumeSidebar
      volumes={volumes}
      nodes={normalizedNodes}
      selectedVolumeId={selectedVolId}
      initialTargetNodeId={initialNodeId}
      multiWorldEnabled={Boolean(project.enableMultiWorld)}
      worldGroups={worldGroups}
      aiStreaming={ai.isStreaming}
      batchRunning={batch.running}
      batchProgress={batch.progress}
      batchResult={batch.result}
      activeChapterDrag={activeChapterDrag}
      getActiveChapterDrag={getActiveChapterDrag}
      onClearActiveChapterDrag={clearActiveChapterDrag}
      onSelectVolume={setSelectedVolId}
      onAddVolume={() => { void handleAddVolume() }}
      onGenerateVolumes={handleAIVolumes}
      onGenerateAllChapters={() => { void batch.generate() }}
      onCancelBatch={batch.cancel}
      onConfirmBatch={() => { void batch.confirm() }}
      onDismissBatch={batch.dismiss}
      onReorderVolumes={reorderNodes}
      onMoveChapter={handleMoveChapter}
    />
  )

  // ── 右侧编辑区 ──

  return (
    <PanelLayout
      sidebar={sidebarContent}
      sidebarTitle="📖 大纲"
      defaultWidth={220}
      minWidth={160}
      maxWidth={360}
      className="h-[calc(100vh-8rem)]"
    >
      <div className="p-4 space-y-4">
        {/* 调参 + 提示 */}
        <CInput value={hint} onChange={e => setHint(e.target.value)} placeholder="给 AI 的补充说明（可选）"
          className="w-full px-3 py-2 bg-bg-surface border border-border rounded-md text-text-primary text-sm focus:outline-none focus:border-accent" />

        <PromptRunPanel
          moduleKey={generation.moduleKey}
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
          open={promptPanelOpen}
          onOpenChange={setPromptPanelOpen}
        />

        {generation.pendingRequest && (
          <OutlineGenerationRequestPanel
            request={generation.pendingRequest}
            preparedContext={generation.preparedContext}
            loading={generation.contextLoading}
            error={generation.contextError}
            messages={generation.preparedNode?.messages}
            transparentMode={generation.transparentMode}
            promptReviewOpen={generation.promptReviewOpen}
            onTransparentModeChange={generation.setTransparentMode}
            onClosePromptReview={generation.closePromptReview}
            onConfirmMessages={messages => { void generation.confirmMessages(messages) }}
            onRetry={() => { void generation.prepare(generation.pendingRequest!) }}
            onCancel={generation.cancel}
            onConfirm={() => { void generation.confirm() }}
          />
        )}

        <OutlineGenerationResultPanel
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error}
          tokenUsage={ai.tokenUsage}
          moduleKey={generation.moduleKey}
          restructuring={restructuring}
          previewVolumes={previewVolumes}
          previewChapters={previewChapters}
          previewTargetId={previewTargetId}
          selectedVolumeTitle={selectedVol?.title}
          onStop={ai.stop}
          onAccept={handlePreviewAccept}
          onRetry={() => { void generation.retry() }}
          onDismiss={() => { void generation.dismissCandidate() }}
          onConfirmVolumes={() => { void handleConfirmVolumes() }}
          onConfirmChapters={() => { void handleConfirmChapters() }}
          onCancelPreview={clearGenerationPreview}
          canAdopt={generation.canAdopt}
          adoptionRecoveryRequired={generation.adoptionRecoveryRequired}
        />

        <OutlineVolumeDetail
          volume={selectedVol}
          nodes={normalizedNodes}
          initialTargetNodeId={initialNodeId}
          multiWorldEnabled={Boolean(project.enableMultiWorld)}
          worldGroups={worldGroups}
          aiStreaming={ai.isStreaming}
          activeChapterDrag={activeChapterDrag}
          getActiveChapterDrag={getActiveChapterDrag}
          onChapterDragStart={beginChapterDrag}
          onChapterDragEnd={clearActiveChapterDrag}
          onUpdateNode={updateNode}
          onDeleteNode={deleteNode}
          onGenerateVolume={volumeId => { void generation.prepare({ kind: 'single-volume', volumeId }) }}
          onGenerateAllChapters={handleAIChapters}
          onAddChapter={parentId => { void handleAddChapter(parentId) }}
          onDeleteVolume={() => { void handleDeleteSelectedVolume() }}
          onAddStructure={structure => { void handleAddStructure(structure) }}
          onInsertChapterAfter={(chapterId, parentId) => { void handleInsertChapterAfter(chapterId, parentId) }}
          onGenerateChapter={chapterId => { void generation.prepare({ kind: 'single-chapter', chapterId }) }}
          onOpenChapter={onOpenChapter}
          onReorderNodes={orderedIds => { void reorderNodes(orderedIds) }}
          onMoveChapter={handleMoveChapter}
        />
      </div>
    </PanelLayout>
  )
}
