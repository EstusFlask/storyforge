import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Database,
  GripVertical,
  History,
  Loader2,
  Play,
  Plus,
  Save,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import type { Project, NodeFlow, NodeRunRecord } from '../../lib/types'
import {
  AUTHORING_NODE_CATALOG,
  AUTHORING_NODE_BY_ID,
  authoringTemplatesForCategory,
  defaultConfigForTemplate,
} from '../../lib/node-authoring/catalog'
import {
  emptyAuthoringGraph,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
  type AuthoringNodeTemplate,
} from '../../lib/node-authoring/contracts'
import { parseAuthoringGraph } from '../../lib/node-authoring/migration'
import { suggestAuthoringConnections, authoringPortsCompatible } from '../../lib/node-authoring/compatibility'
import { validateAuthoringGraph } from '../../lib/node-authoring/graph'
import {
  adoptAuthoringCandidate,
  runAuthoringGraph,
  type AuthoringCandidateMap,
  type AuthoringRunSnapshotMap,
} from '../../lib/node-authoring/executor'
import { useNodeFlowStore } from '../../stores/node-flow'
import { useAIConfigStore } from '../../stores/ai-config'
import { CONTEXT_SOURCES } from '../../lib/registry/context-sources'
import { useToast } from '../shared/Toast'

const NODE_WIDTH = 238
const HEADER_HEIGHT = 38
const PORT_HEIGHT = 24

function templateColor(template: AuthoringNodeTemplate): string {
  if (template.class === 'control') return 'border-amber-400/60 bg-amber-50/80'
  if (template.class === 'processor') return 'border-sky-400/60 bg-sky-50/80'
  if (template.class === 'output') return 'border-emerald-400/60 bg-emerald-50/80'
  return 'border-violet-400/60 bg-violet-50/80'
}

function addEdge(graph: AuthoringNodeGraph, sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): AuthoringNodeGraph {
  return {
    ...graph,
    edges: [...graph.edges, {
      id: nanoid(), sourceNodeId, sourcePortId, targetNodeId, targetPortId,
      mapping: { mode: 'full', missingPolicy: 'block', refreshPolicy: 'live' },
    }],
  }
}

function portPosition(node: AuthoringNodeInstance, direction: 'input' | 'output', index: number, zoom: number) {
  return {
    x: node.x + (direction === 'output' ? NODE_WIDTH : 0),
    y: node.y + HEADER_HEIGHT + index * PORT_HEIGHT + PORT_HEIGHT / 2,
    screenX: (node.x + (direction === 'output' ? NODE_WIDTH : 0)) * zoom,
    screenY: (node.y + HEADER_HEIGHT + index * PORT_HEIGHT + PORT_HEIGHT / 2) * zoom,
  }
}

function nodeFromTemplate(template: AuthoringNodeTemplate, index: number): AuthoringNodeInstance {
  const config = defaultConfigForTemplate(template)
  if (template.id === 'source.project-context') {
    config.sourceKeys = ['worldview', 'storyCore']
    config.ragEntryKeys = []
    config.contextBudget = 12_000
  }
  if (template.id === 'input.manual-text') config.text = ''
  return {
    id: nanoid(), templateId: template.id, templateVersion: template.version,
    title: template.label, x: 80 + (index % 3) * 330, y: 80 + Math.floor(index / 3) * 240,
    config, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs),
  }
}

function runData(run: NodeRunRecord | null) {
  if (!run) return { snapshots: {} as AuthoringRunSnapshotMap, candidates: {} as AuthoringCandidateMap }
  try {
    return {
      snapshots: JSON.parse(run.inputSnapshotsJson || '{}') as AuthoringRunSnapshotMap,
      candidates: JSON.parse(run.nodeResultsJson || '{}') as AuthoringCandidateMap,
    }
  } catch {
    return { snapshots: {}, candidates: {} }
  }
}

function NodeLibrary({ onAdd }: { onAdd: (template: AuthoringNodeTemplate) => void }) {
  const categories = useMemo(() => Array.from(new Set(AUTHORING_NODE_CATALOG.map(template => template.category))), [])
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-surface p-3">
      <div className="mb-3 flex items-center gap-2">
        <Workflow className="h-4 w-4 text-accent" />
        <div><p className="text-xs font-semibold text-text-primary">领域节点库</p><p className="text-[10px] text-text-muted">拖入或点击添加</p></div>
      </div>
      <div className="space-y-3">
        {categories.map(category => (
          <section key={category}>
            <h3 className="mb-1 px-1 text-[10px] font-semibold tracking-wide text-text-muted">{category}</h3>
            <div className="space-y-1">
              {authoringTemplatesForCategory(category).map(template => (
                <button key={template.id} type="button" onClick={() => onAdd(template)} className="group flex w-full items-start gap-2 rounded border border-transparent px-2 py-1.5 text-left hover:border-accent/40 hover:bg-bg-hover">
                  <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-text-muted group-hover:text-accent" />
                  <span className="min-w-0"><span className="block truncate text-[11px] font-medium text-text-primary">{template.label}</span><span className="mt-0.5 block text-[9px] leading-3 text-text-muted">{template.description}</span></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

function AuthoringCanvas(props: {
  graph: AuthoringNodeGraph
  selectedNodeId: string | null
  candidates: AuthoringCandidateMap
  onSelectNode: (id: string) => void
  onChange: (graph: AuthoringNodeGraph) => void
  onBeginConnection: (nodeId: string, portId: string, direction: 'input' | 'output') => void
  onCanvasConnection: (x: number, y: number) => void
  onRemoveNode: (id: string) => void
}) {
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const zoom = props.graph.viewport.zoom
  const height = 120 + Math.max(0, ...props.graph.nodes.map(node => node.y + HEADER_HEIGHT + Math.max(node.inputs.length, node.outputs.length) * PORT_HEIGHT))

  const moveNode = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    props.onChange({ ...props.graph, nodes: props.graph.nodes.map(node => node.id === drag.nodeId ? {
      ...node,
      x: Math.max(20, drag.nodeX + (event.clientX - drag.startX) / zoom),
      y: Math.max(20, drag.nodeY + (event.clientY - drag.startY) / zoom),
    } : node) })
  }

  return (
    <div
      ref={canvasRef}
      className="relative min-w-0 flex-1 overflow-auto bg-[#f7f7f5]"
      onPointerMove={moveNode}
      onPointerUp={() => { dragRef.current = null }}
      onPointerLeave={() => { dragRef.current = null }}
      onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        props.onCanvasConnection((event.clientX - rect.left - props.graph.viewport.x) / zoom, (event.clientY - rect.top - props.graph.viewport.y) / zoom)
      }}
    >
      <div className="relative" style={{ width: 1900, height, transform: `translate(${props.graph.viewport.x}px, ${props.graph.viewport.y}px) scale(${zoom})`, transformOrigin: 'top left' }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {props.graph.edges.map(edge => {
            const source = props.graph.nodes.find(node => node.id === edge.sourceNodeId)
            const target = props.graph.nodes.find(node => node.id === edge.targetNodeId)
            if (!source || !target) return null
            const sourceIndex = source.outputs.findIndex(port => port.id === edge.sourcePortId)
            const targetIndex = target.inputs.findIndex(port => port.id === edge.targetPortId)
            if (sourceIndex < 0 || targetIndex < 0) return null
            const from = portPosition(source, 'output', sourceIndex, 1)
            const to = portPosition(target, 'input', targetIndex, 1)
            const bend = Math.max(60, Math.abs(to.x - from.x) * 0.45)
            return <path key={edge.id} d={`M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeOpacity=".7" />
          })}
        </svg>
        {props.graph.nodes.map(node => {
          const template = AUTHORING_NODE_BY_ID.get(node.templateId)
          if (!template) return null
          const result = props.candidates[node.id]
          return (
            <div key={node.id} className={`absolute rounded-md border shadow-sm ${templateColor(template)} ${props.selectedNodeId === node.id ? 'ring-2 ring-accent ring-offset-1' : ''}`} style={{ left: node.x, top: node.y, width: NODE_WIDTH }} onClick={event => { event.stopPropagation(); props.onSelectNode(node.id) }}>
              <div
                className="flex h-[38px] cursor-grab items-center gap-2 rounded-t-md border-b border-black/10 px-2 active:cursor-grabbing"
                onPointerDown={event => { event.stopPropagation(); dragRef.current = { nodeId: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y }; event.currentTarget.setPointerCapture(event.pointerId) }}
              >
                <GripVertical className="h-3.5 w-3.5 text-text-muted" /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-primary">{node.title}</span><button type="button" title="删除节点" onClick={event => { event.stopPropagation(); props.onRemoveNode(node.id) }} className="rounded p-0.5 text-text-muted hover:bg-error/10 hover:text-error"><X className="h-3 w-3" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2 px-1 py-1.5">
                <div className="space-y-1">{node.inputs.map(port => <button key={port.id} type="button" onClick={event => { event.stopPropagation(); props.onBeginConnection(node.id, port.id, 'input') }} className="flex w-full items-center gap-1 text-left text-[9px] text-text-secondary hover:text-accent"><span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent bg-white" /><span className="truncate">{port.label}{port.required ? ' *' : ''}</span></button>)}</div>
                <div className="space-y-1">{node.outputs.map(port => <button key={port.id} type="button" onClick={event => { event.stopPropagation(); props.onBeginConnection(node.id, port.id, 'output') }} className="flex w-full items-center justify-end gap-1 text-right text-[9px] text-text-secondary hover:text-accent"><span className="truncate">{port.label}</span><span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent bg-white" /></button>)}</div>
              </div>
              <div className="border-t border-black/10 px-2 py-1 text-[9px] text-text-muted">{result ? (result.status === 'blocked' ? '运行阻塞' : `${result.output.length.toLocaleString()} 字候选`) : `${template.category} · ${template.capability}`}</div>
            </div>
          )
        })}
      </div>
      {!props.graph.nodes.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center"><div><Workflow className="mx-auto h-9 w-9 text-accent/50" /><p className="mt-2 text-sm font-medium text-text-secondary">从左侧添加第一个领域节点</p><p className="mt-1 text-xs text-text-muted">从世界观、故事、角色或控制节点开始编排。</p></div></div>}
    </div>
  )
}

function NodeInspector(props: { node: AuthoringNodeInstance | null; graph: AuthoringNodeGraph; onChange: (graph: AuthoringNodeGraph) => void; onRemove: () => void }) {
  const presets = useAIConfigStore(state => state.presets)
  if (!props.node) return <aside className="flex w-80 shrink-0 items-center justify-center border-l border-border bg-bg-surface p-6 text-center text-xs text-text-muted">选择节点后编辑参数、上下文来源和端口。</aside>
  const node = props.node
  const template = AUTHORING_NODE_BY_ID.get(node.templateId)!
  const updateNode = (patch: Partial<AuthoringNodeInstance>) => props.onChange({ ...props.graph, nodes: props.graph.nodes.map(item => item.id === node.id ? { ...item, ...patch } : item) })
  const updateConfig = (key: string, value: unknown) => updateNode({ config: { ...node.config, [key]: value } })
  const sourceKeys = Array.isArray(node.config.sourceKeys) ? node.config.sourceKeys.filter((item): item is string => typeof item === 'string') : []
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-bg-surface p-4">
      <div className="mb-4 flex items-start justify-between gap-2"><div><p className="text-[10px] font-semibold tracking-wide text-accent">{template.category}</p><h3 className="mt-1 text-sm font-semibold text-text-primary">{template.label}</h3></div><button type="button" title="删除节点" onClick={props.onRemove} className="rounded p-1 text-text-muted hover:bg-error/10 hover:text-error"><Trash2 className="h-3.5 w-3.5" /></button></div>
      <label className="mb-4 block"><span className="mb-1 block text-[10px] text-text-secondary">节点名称</span><input value={node.title} onChange={event => updateNode({ title: event.target.value })} className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent" /></label>
      <p className="mb-3 text-[10px] leading-4 text-text-muted">{template.description}</p>
      {template.id === 'source.project-context' && <section className="mb-4 rounded border border-border bg-bg-base p-2"><p className="mb-2 text-[10px] font-medium text-text-secondary">读取哪些登记来源</p><div className="max-h-48 space-y-1 overflow-y-auto">{CONTEXT_SOURCES.filter(source => source.key !== 'ragSelection').map(source => <label key={source.key} className="flex items-start gap-2 text-[10px] text-text-secondary"><input type="checkbox" checked={sourceKeys.includes(source.key)} onChange={() => updateConfig('sourceKeys', sourceKeys.includes(source.key) ? sourceKeys.filter(item => item !== source.key) : [...sourceKeys, source.key])} className="mt-0.5 accent-[var(--color-accent)]" /><span><span className="block">{source.label}</span><span className="block text-[9px] text-text-muted">{source.key}</span></span></label>)}</div><p className="mt-2 text-[9px] leading-3 text-text-muted">需要精确资料时，请在来源节点配置稳定字段键；不会把 API Key 保存进图。</p></section>}
      <div className="space-y-3">{(template.parameters ?? []).map(parameter => {
        const value = node.config[parameter.key] ?? parameter.defaultValue ?? ''
        if (parameter.key === 'presetId') return <label key={parameter.key} className="block"><span className="mb-1 block text-[10px] text-text-secondary">{parameter.label}</span><select value={String(value)} onChange={event => updateConfig(parameter.key, event.target.value)} className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-[11px] text-text-primary"><option value="">使用全局配置</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        if (parameter.type === 'text') return <label key={parameter.key} className="block"><span className="mb-1 block text-[10px] text-text-secondary">{parameter.label}</span><textarea rows={parameter.key === 'text' || parameter.key === 'instruction' || parameter.key === 'template' ? 6 : 3} value={String(value)} onChange={event => updateConfig(parameter.key, event.target.value)} className="w-full resize-y rounded border border-border bg-bg-base px-2 py-1.5 text-[11px] leading-4 text-text-primary outline-none focus:border-accent" /></label>
        if (parameter.type === 'boolean') return <label key={parameter.key} className="flex items-center gap-2 text-[11px] text-text-secondary"><input type="checkbox" checked={Boolean(value)} onChange={event => updateConfig(parameter.key, event.target.checked)} className="accent-[var(--color-accent)]" />{parameter.label}</label>
        return <label key={parameter.key} className="block"><span className="mb-1 flex justify-between text-[10px] text-text-secondary"><span>{parameter.label}</span><span className="text-text-muted">{String(value)}</span></span><input type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)} onChange={event => updateConfig(parameter.key, Number(event.target.value))} className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent" /></label>
      })}</div>
      <div className="mt-5 border-t border-border pt-3"><p className="mb-2 text-[10px] font-semibold text-text-secondary">输入端口</p>{node.inputs.length ? node.inputs.map(port => <div key={port.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-[10px]"><span className="text-text-secondary">{port.label}{port.required ? ' *' : ''}</span><span className="text-text-muted">{port.semantic}</span></div>) : <p className="text-[10px] text-text-muted">无输入</p>}<p className="mb-2 mt-3 text-[10px] font-semibold text-text-secondary">输出端口</p>{node.outputs.map(port => <div key={port.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-[10px]"><span className="text-text-secondary">{port.label}</span><span className="text-text-muted">{port.semantic}</span></div>)}</div>
    </aside>
  )
}

function SmartConnectionMenu(props: { anchor: { nodeId: string; portId: string; direction: 'input' | 'output'; x: number; y: number }; graph: AuthoringNodeGraph; onPick: (template: AuthoringNodeTemplate) => void; onClose: () => void }) {
  const node = props.graph.nodes.find(item => item.id === props.anchor.nodeId)
  const template = node ? AUTHORING_NODE_BY_ID.get(node.templateId) : undefined
  const port = node ? [...node.inputs, ...node.outputs].find(item => item.id === props.anchor.portId) : undefined
  if (!node || !template || !port) return null
  const suggestions = suggestAuthoringConnections({ catalog: AUTHORING_NODE_CATALOG, anchorTemplate: template, anchorPort: port, direction: props.anchor.direction === 'output' ? 'after' : 'before' }).slice(0, 10)
  return <div className="absolute z-20 w-64 rounded-md border border-border bg-bg-surface p-2 shadow-xl" style={{ left: props.anchor.x, top: props.anchor.y }}><div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-semibold text-text-secondary">{props.anchor.direction === 'output' ? '添加后置节点' : '添加前置节点'}</p><button type="button" onClick={props.onClose} className="text-text-muted hover:text-text-primary"><X className="h-3 w-3" /></button></div>{suggestions.length ? suggestions.map(item => <button key={`${item.template.id}:${item.port.id}`} type="button" onClick={() => props.onPick(item.template)} className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-hover"><ChevronRight className="mt-0.5 h-3 w-3 text-accent" /><span><span className="block text-[10px] text-text-primary">{item.template.label}</span><span className="block text-[9px] text-text-muted">{item.reason === 'recommended' ? '推荐连接' : '语义兼容'} · {item.port.label}</span></span></button>) : <p className="p-2 text-[10px] text-text-muted">没有找到兼容节点</p>}</div>
}

export default function NodeAuthoringWorkspace(props: { project: Project; worldGroupId: number | null }) {
  const projectId = props.project.id!
  const toast = useToast()
  const flows = useNodeFlowStore(state => state.flows)
  const runs = useNodeFlowStore(state => state.runs)
  const loading = useNodeFlowStore(state => state.loading)
  const [selectedFlowId, setSelectedFlowId] = useState<number | null>(null)
  const [draft, setDraft] = useState<NodeFlow | null>(null)
  const [graph, setGraph] = useState<AuthoringNodeGraph>(emptyAuthoringGraph())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<NodeRunRecord | null>(null)
  const [snapshots, setSnapshots] = useState<AuthoringRunSnapshotMap>({})
  const [candidates, setCandidates] = useState<AuthoringCandidateMap>({})
  const [connection, setConnection] = useState<{ nodeId: string; portId: string; direction: 'input' | 'output' } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [showRuns, setShowRuns] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { void useNodeFlowStore.getState().load(projectId) }, [projectId])
  useEffect(() => { if (selectedFlowId == null && flows.length) setSelectedFlowId(flows[0].id!) }, [flows, selectedFlowId])
  useEffect(() => {
    if (selectedFlowId == null) { setDraft(null); setGraph(emptyAuthoringGraph()); return }
    const flow = flows.find(item => item.id === selectedFlowId)
    if (!flow) return
    try { setDraft(flow); setGraph(parseAuthoringGraph(flow.graphJson).graph); setSelectedNodeId(null); setDirty(false); void useNodeFlowStore.getState().loadRuns(projectId, selectedFlowId) } catch (error) { toast.error(`节点图读取失败：${error instanceof Error ? error.message : String(error)}`) }
  // A store refresh must not replace an in-progress local graph edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlowId, projectId])
  useEffect(() => { const latest = runs.find(item => item.flowId === selectedFlowId) ?? null; setRun(latest); const data = runData(latest); setSnapshots(data.snapshots); setCandidates(data.candidates) }, [runs, selectedFlowId])

  const selectedNode = selectedNodeId ? graph.nodes.find(node => node.id === selectedNodeId) ?? null : null
  const save = async (notify = false): Promise<NodeFlow | null> => {
    if (!draft) return null
    setSaving(true)
    try { const next = { ...draft, graphJson: JSON.stringify(graph), updatedAt: Date.now() }; const id = await useNodeFlowStore.getState().saveFlow(next); const saved = { ...next, id }; setDraft(saved); setDirty(false); if (notify) toast.success('节点图已保存。'); return saved } catch (error) { toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`); return null } finally { setSaving(false) }
  }
  // Autosave intentionally captures the current draft and graph snapshot; including the
  // recreated save callback would schedule a second save on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty || !draft) return; const timer = window.setTimeout(() => { void save() }, 700); return () => window.clearTimeout(timer) }, [dirty, graph, draft?.name, draft?.description])
  const changeGraph = (next: AuthoringNodeGraph) => { setGraph(next); setDirty(true) }
  const createFlow = async () => { const id = await useNodeFlowStore.getState().createFlow(projectId, props.worldGroupId); setSelectedFlowId(id) }
  const addTemplate = (template: AuthoringNodeTemplate, position?: { x: number; y: number }) => { const node = nodeFromTemplate(template, graph.nodes.length); if (position) { node.x = position.x; node.y = position.y } changeGraph({ ...graph, nodes: [...graph.nodes, node] }); setSelectedNodeId(node.id); return node }
  const removeNode = (id: string) => { changeGraph({ ...graph, nodes: graph.nodes.filter(node => node.id !== id), edges: graph.edges.filter(edge => edge.sourceNodeId !== id && edge.targetNodeId !== id) }); if (selectedNodeId === id) setSelectedNodeId(null) }
  const beginConnection = (nodeId: string, portId: string, direction: 'input' | 'output') => { if (connection && connection.direction === 'output' && direction === 'input' && connection.nodeId !== nodeId) { const next = addEdge(graph, connection.nodeId, connection.portId, nodeId, portId); const issue = validateAuthoringGraph(next).find(item => item.code === 'cycle' || item.code === 'type-mismatch' || item.code === 'duplicate-edge'); if (issue) toast.error(issue.message); else changeGraph(next); setConnection(null); setMenu(null); return } setConnection({ nodeId, portId, direction }); setMenu(null) }
  const openConnectionMenu = (x: number, y: number) => { if (connection) setMenu({ x, y }) }
  const pickConnectionTemplate = (template: AuthoringNodeTemplate) => {
    if (!connection) return
    const anchorNode = graph.nodes.find(node => node.id === connection.nodeId)
    if (!anchorNode) return
    const node = nodeFromTemplate(template, graph.nodes.length)
    node.x = Math.max(30, anchorNode.x + (connection.direction === 'output' ? 330 : -330))
    node.y = anchorNode.y
    const anchorPort = [...anchorNode.inputs, ...anchorNode.outputs].find(port => port.id === connection.portId)
    const newPort = connection.direction === 'output'
      ? template.inputs.find(port => anchorPort && authoringPortsCompatible(anchorPort, port))
      : template.outputs.find(port => anchorPort && authoringPortsCompatible(port, anchorPort))
    const graphWithNode = { ...graph, nodes: [...graph.nodes, node] }
    changeGraph(anchorPort && newPort
      ? addEdge(
          graphWithNode,
          connection.direction === 'output' ? anchorNode.id : node.id,
          connection.direction === 'output' ? anchorPort.id : newPort.id,
          connection.direction === 'output' ? node.id : anchorNode.id,
          connection.direction === 'output' ? newPort.id : anchorPort.id,
        )
      : graphWithNode)
    setSelectedNodeId(node.id)
    setConnection(null)
    setMenu(null)
  }
  const runGraph = async (targetNodeId?: string) => { if (!draft || abortRef.current) return; const issues = validateAuthoringGraph(graph); if (issues.length) { toast.error(issues[0].message); return } const saved = await save(); if (!saved?.id) return; const controller = new AbortController(); abortRef.current = controller; try { const result = await runAuthoringGraph({ flow: saved, targetNodeId, signal: controller.signal, onUpdate: update => { setRun(update.run); setSnapshots(update.snapshots); setCandidates(update.candidates) } }); setRun(result.run); setSnapshots(result.snapshots); setCandidates(result.candidates); await useNodeFlowStore.getState().loadRuns(projectId, saved.id); if (result.run.status === 'completed') toast.success('节点图运行完成，候选已保存。') } catch (error) { toast.error(`运行失败：${error instanceof Error ? error.message : String(error)}`) } finally { abortRef.current = null } }
  const adoptCandidate = async (nodeId: string) => { if (!draft || !candidates[nodeId]) return; try { const result = await adoptAuthoringCandidate({ flow: draft, nodeId, output: candidates[nodeId].output }); setCandidates(current => ({ ...current, [nodeId]: { ...current[nodeId], status: 'adopted' } })); toast.success(`已采纳：写入 ${result.written.length} 条记录。`) } catch (error) { toast.error(`采纳失败：${error instanceof Error ? error.message : String(error)}`) } }

  if (loading && !flows.length) return <div className="flex min-h-[720px] items-center justify-center text-sm text-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载节点图…</div>
  if (!draft) return <div className="flex min-h-[720px] items-center justify-center bg-[#f7f7f5]"><div className="max-w-lg rounded-lg border border-border bg-bg-surface p-8 text-center shadow-sm"><Workflow className="mx-auto h-10 w-10 text-accent" /><h2 className="mt-3 text-lg font-semibold text-text-primary">领域节点创作</h2><p className="mt-2 text-sm leading-6 text-text-secondary">把世界观、故事、角色和执行参数编排成一张可观察、可回放的创作图。每个结果先作为候选保存，确认后才写入项目。</p><button type="button" onClick={() => void createFlow()} className="mt-5 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"><Plus className="h-4 w-4" />创建第一张节点图</button></div></div>

  const selectedSnapshot = selectedNodeId ? snapshots[selectedNodeId] : undefined
  const selectedCandidate = selectedNodeId ? candidates[selectedNodeId] : undefined
  return <div className="flex h-[760px] min-h-[560px] max-h-[calc(100vh-180px)] flex-col overflow-hidden bg-bg-base">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg-surface px-3"><Workflow className="h-4 w-4 text-accent" /><input aria-label="节点图名称" value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setDirty(true) }} className="w-56 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-text-primary hover:border-border focus:border-accent focus:outline-none" /><span className="text-[10px] text-text-muted">{saving ? '保存中…' : dirty ? '待保存' : '已保存'}</span><div className="ml-auto flex items-center gap-2"><button type="button" onClick={() => void save(true)} className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-hover"><Save className="h-3.5 w-3.5" />保存</button>{abortRef.current ? <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-1 rounded bg-error/10 px-3 py-1.5 text-xs text-error"><CircleStop className="h-3.5 w-3.5" />停止</button> : <button type="button" onClick={() => void runGraph()} className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"><Play className="h-3.5 w-3.5" />运行全部</button>}</div></header>
    <div className="flex min-h-0 flex-1"><div className="flex w-60 shrink-0 flex-col border-r border-border bg-bg-surface"><div className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold tracking-wide text-text-muted">我的节点图</span><button type="button" title="新建节点图" onClick={() => void createFlow()} className="rounded p-1 text-accent hover:bg-accent/10"><Plus className="h-3.5 w-3.5" /></button></div>{flows.map(flow => <button key={flow.id} type="button" onClick={() => setSelectedFlowId(flow.id!)} className={`mb-1 w-full truncate rounded px-2 py-1.5 text-left text-[11px] ${flow.id === selectedFlowId ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover'}`}>{flow.name}</button>)}</div><NodeLibrary onAdd={template => addTemplate(template)} /></div><div className="relative flex min-w-0 flex-1"><AuthoringCanvas graph={graph} selectedNodeId={selectedNodeId} candidates={candidates} onSelectNode={setSelectedNodeId} onChange={changeGraph} onBeginConnection={beginConnection} onCanvasConnection={openConnectionMenu} onRemoveNode={removeNode} />{connection && menu && <SmartConnectionMenu anchor={{ ...connection, x: menu.x, y: menu.y }} graph={graph} onPick={pickConnectionTemplate} onClose={() => { setConnection(null); setMenu(null) }} />}</div><NodeInspector node={selectedNode} graph={graph} onChange={changeGraph} onRemove={() => selectedNode && removeNode(selectedNode.id)} /></div>
    <section className="shrink-0 border-t border-border bg-bg-surface">
      <button type="button" onClick={() => setShowRuns(value => !value)} className="flex h-9 w-full items-center gap-2 px-4 text-left text-[11px] text-text-secondary hover:bg-bg-hover">
        <History className="h-3.5 w-3.5" />
        <span>运行记录</span>
        <span className="text-text-muted">{run ? `${run.status} · ${new Date(run.startedAt).toLocaleString()}` : '尚未运行'}</span>
        <span className="ml-auto">{showRuns ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
      </button>
      {showRuns && (
        <div className="grid max-h-72 grid-cols-2 gap-0 overflow-y-auto border-t border-border">
          <div className="border-r border-border p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold text-text-secondary"><Database className="h-3 w-3" />实际输入快照</div>
            {selectedSnapshot ? <><p className="text-[10px] text-text-muted">估算输入：{selectedSnapshot.totalTokens.toLocaleString()} tokens</p>{selectedSnapshot.inputs.map(input => <details key={`${input.sourceNodeId}:${input.targetPortId}`} className="mt-2 rounded border border-border bg-bg-base p-2"><summary className="cursor-pointer text-[10px]">{input.targetPortId} ← {input.sourceNodeId} · {input.tokens} tokens</summary><pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[9px] text-text-muted">{input.content}</pre></details>)}</> : <p className="text-[10px] text-text-muted">选择已运行节点查看它实际收到的输入。</p>}
          </div>
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-secondary">候选输出</span>
              {selectedCandidate && <button type="button" onClick={() => void adoptCandidate(selectedNodeId!)} className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover"><Check className="h-3 w-3" />{selectedCandidate.status === 'adopted' ? '已采纳' : '确认采纳'}</button>}
            </div>
            {selectedCandidate ? <textarea aria-label="候选输出" value={selectedCandidate.output} onChange={event => setCandidates(current => ({ ...current, [selectedCandidate.nodeId]: { ...selectedCandidate, output: event.target.value, status: 'candidate' } }))} className="h-40 w-full resize-y rounded border border-border bg-bg-base p-2 text-[10px] leading-4 text-text-primary outline-none focus:border-accent" /> : <p className="text-[10px] text-text-muted">选择已运行节点查看候选输出。</p>}
          </div>
        </div>
      )}
    </section>
  </div>
}
