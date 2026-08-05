import type { NodeFlowGraph, NodeFlowInputSlot, NodeFlowNode, NodeValueType } from '../types/node-flow'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from './catalog'
import {
  AUTHORING_GRAPH_VERSION,
  emptyAuthoringGraph,
  isAuthoringSemantic,
  type AuthoringGraphParseResult,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
  type AuthoringPortDefinition,
  type AuthoringSemantic,
} from './contracts'

const LEGACY_TEMPLATE_BY_KIND = new Map(
  Array.from(AUTHORING_NODE_BY_ID.values())
    .filter(template => template.legacyKind)
    .map(template => [template.legacyKind!, template] as const),
)

function legacySemantic(type: NodeValueType): AuthoringSemantic {
  if (type === 'text') return 'text'
  if (type === 'candidate' || type === 'json') return 'candidate'
  return 'any'
}

function migrateLegacyInput(slot: NodeFlowInputSlot): AuthoringPortDefinition {
  return {
    id: slot.id,
    label: slot.label,
    semantic: legacySemantic(slot.type),
    cardinality: 'one',
    state: 'any',
    required: slot.required,
    multiple: false,
    priority: slot.priority,
    maxTokens: slot.maxTokens,
  }
}

function migrateLegacyNode(node: NodeFlowNode): AuthoringNodeInstance {
  const template = LEGACY_TEMPLATE_BY_KIND.get(node.kind)
  if (!template) throw new Error(`FLOW-2 节点类型没有兼容模板：${node.kind}`)
  return {
    id: node.id,
    templateId: template.id,
    templateVersion: template.version,
    title: node.title,
    x: node.x,
    y: node.y,
    config: {
      ...defaultConfigForTemplate(template),
      ...structuredClone(node.config),
      legacyKind: node.kind,
    },
    inputs: node.inputSlots.map(migrateLegacyInput),
    outputs: structuredClone(template.outputs),
  }
}

export function migrateFlow2Graph(graph: NodeFlowGraph): AuthoringNodeGraph {
  const nodes = graph.nodes.map(migrateLegacyNode)
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  return {
    version: AUTHORING_GRAPH_VERSION,
    nodes,
    edges: graph.edges.map(edge => {
      const source = nodeById.get(edge.sourceNodeId)
      if (!source?.outputs[0]) throw new Error(`FLOW-2 连线来源缺少输出端口：${edge.sourceNodeId}`)
      return {
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: source.outputs[0].id,
        targetNodeId: edge.targetNodeId,
        targetPortId: edge.targetSlotId,
        mapping: {
          mode: 'full' as const,
          priority: nodeById.get(edge.targetNodeId)?.inputs.find(port => port.id === edge.targetSlotId)?.priority,
          maxTokens: nodeById.get(edge.targetNodeId)?.inputs.find(port => port.id === edge.targetSlotId)?.maxTokens,
          missingPolicy: 'block' as const,
          refreshPolicy: 'frozen' as const,
        },
      }
    }),
    viewport: structuredClone(graph.viewport),
    groups: [],
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`)
  }
}

function parseAuthoringPort(value: unknown, label: string): AuthoringPortDefinition {
  assertObject(value, label)
  if (typeof value.id !== 'string' || typeof value.label !== 'string') throw new Error(`${label} 缺少 ID 或名称。`)
  if (!isAuthoringSemantic(value.semantic)) throw new Error(`${label} 使用未知语义。`)
  if (value.cardinality !== 'one' && value.cardinality !== 'many') throw new Error(`${label} 基数无效。`)
  if (!['canon', 'draft', 'candidate', 'control', 'any'].includes(String(value.state))) throw new Error(`${label} 状态无效。`)
  return value as unknown as AuthoringPortDefinition
}

function parseVersion2(value: Record<string, unknown>): AuthoringNodeGraph {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('FLOW-3 节点图缺少 nodes 或 edges。')
  }
  const viewport = value.viewport && typeof value.viewport === 'object'
    ? value.viewport as Record<string, unknown>
    : { x: 0, y: 0, zoom: 1 }
  const graph: AuthoringNodeGraph = {
    version: AUTHORING_GRAPH_VERSION,
    nodes: value.nodes.map((raw, index) => {
      assertObject(raw, `nodes[${index}]`)
      if (
        typeof raw.id !== 'string'
        || typeof raw.templateId !== 'string'
        || typeof raw.title !== 'string'
        || typeof raw.x !== 'number'
        || typeof raw.y !== 'number'
        || !Array.isArray(raw.inputs)
        || !Array.isArray(raw.outputs)
      ) {
        throw new Error(`nodes[${index}] 结构无效。`)
      }
      return {
        ...raw,
        templateVersion: 1,
        config: raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
          ? raw.config as Record<string, unknown>
          : {},
        inputs: raw.inputs.map((port, portIndex) => parseAuthoringPort(port, `nodes[${index}].inputs[${portIndex}]`)),
        outputs: raw.outputs.map((port, portIndex) => parseAuthoringPort(port, `nodes[${index}].outputs[${portIndex}]`)),
      } as AuthoringNodeInstance
    }),
    edges: value.edges.map((raw, index) => {
      assertObject(raw, `edges[${index}]`)
      if (
        typeof raw.id !== 'string'
        || typeof raw.sourceNodeId !== 'string'
        || typeof raw.sourcePortId !== 'string'
        || typeof raw.targetNodeId !== 'string'
        || typeof raw.targetPortId !== 'string'
      ) {
        throw new Error(`edges[${index}] 结构无效。`)
      }
      return raw as unknown as AuthoringNodeGraph['edges'][number]
    }),
    viewport: {
      x: typeof viewport.x === 'number' ? viewport.x : 0,
      y: typeof viewport.y === 'number' ? viewport.y : 0,
      zoom: typeof viewport.zoom === 'number' ? viewport.zoom : 1,
    },
    groups: Array.isArray(value.groups) ? value.groups as AuthoringNodeGraph['groups'] : [],
  }
  return graph
}

export function parseAuthoringGraph(value: string | null | undefined): AuthoringGraphParseResult {
  if (!value?.trim()) return { graph: emptyAuthoringGraph(), sourceVersion: 2, migrated: false }
  const parsed = JSON.parse(value) as unknown
  assertObject(parsed, '节点图')
  if (parsed.version === 2) {
    return { graph: parseVersion2(parsed), sourceVersion: 2, migrated: false }
  }
  if (parsed.version === 1) {
    const legacy = parsed as unknown as NodeFlowGraph
    if (!Array.isArray(legacy.nodes) || !Array.isArray(legacy.edges)) {
      throw new Error('FLOW-2 节点图结构无效。')
    }
    return { graph: migrateFlow2Graph(legacy), sourceVersion: 1, migrated: true }
  }
  throw new Error(`不支持的节点图版本：${String(parsed.version)}`)
}
