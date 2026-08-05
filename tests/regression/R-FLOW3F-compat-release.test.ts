import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { migrateFlow2Graph, parseAuthoringGraph } from '../../src/lib/node-authoring/migration'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import type { NodeFlowGraph, Project } from '../../src/lib/types'

const project: Project = {
  id: 73101,
  name: 'FLOW-3F 兼容发布测试',
  genre: 'fantasy',
  genres: ['fantasy'],
  status: 'drafting',
  description: '',
  targetWordCount: 100_000,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
}

const legacyGraph: NodeFlowGraph = {
  version: 1,
  viewport: { x: 10, y: 20, zoom: 0.8 },
  nodes: [
    { id: 'source', kind: 'input.text', title: '作者输入', x: 0, y: 0, config: { text: '旧图内容仍然可读。' }, inputSlots: [] },
    {
      id: 'compose', kind: 'transform.compose', title: '整理', x: 300, y: 0,
      config: { template: '【整理】\n{{context}}' },
      inputSlots: [{ id: 'material', label: '设定', type: 'text', required: true, priority: 80, maxTokens: 2000 }],
    },
  ],
  edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'compose', targetSlotId: 'material' }],
}

describe('FLOW-3F · FLOW-2 兼容收口与正式发布', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.put(project)
    useNodeFlowStore.setState({ projectId: null, flows: [], runs: [], loading: false })
  })

  afterEach(() => db.close())

  it('旧图可读、显式转换保存为 v2，失败时原始图保持不变', async () => {
    const now = Date.now()
    const flowId = await db.nodeFlows.add({
      projectId: project.id!, worldGroupId: null, name: '旧 FLOW-2 图', description: '',
      graphJson: JSON.stringify(legacyGraph), createdAt: now, updatedAt: now,
    }) as number
    const stored = (await db.nodeFlows.get(flowId))!
    const parsed = parseAuthoringGraph(stored.graphJson)
    expect(parsed.migrated).toBe(true)
    expect(parsed.graph.nodes[0].config).toMatchObject({ text: '旧图内容仍然可读。', legacyKind: 'input.text' })
    await useNodeFlowStore.getState().saveFlow({ ...stored, graphJson: JSON.stringify(parsed.graph) })
    expect(JSON.parse((await db.nodeFlows.get(flowId))!.graphJson).version).toBe(2)

    const invalidLegacy = { ...legacyGraph, nodes: [{ ...legacyGraph.nodes[0], kind: 'unknown.kind' }] } as unknown as NodeFlowGraph
    const invalid = { ...stored, graphJson: JSON.stringify(invalidLegacy) }
    await expect(useNodeFlowStore.getState().saveFlow(invalid)).rejects.toThrow('没有兼容模板')
    expect(JSON.parse((await db.nodeFlows.get(flowId))!.graphJson).version).toBe(2)
  })

  it('旧图随项目备份往返，导入后仍可由兼容解析器读取', async () => {
    const now = Date.now()
    await db.nodeFlows.add({
      projectId: project.id!, worldGroupId: null, name: '便携旧图', description: '',
      graphJson: JSON.stringify(legacyGraph), createdAt: now, updatedAt: now,
    })
    const exported = await exportProjectJSON(project.id!)
    const importedId = await importProjectJSON(exported)
    const imported = await db.nodeFlows.where('projectId').equals(importedId).first()
    expect(imported).toBeDefined()
    expect(parseAuthoringGraph(imported!.graphJson).graph.nodes[0].config).toMatchObject({ text: '旧图内容仍然可读。' })
  })

  it('FLOW-2 迁移对未知节点 fail-closed，不猜测领域语义', () => {
    const invalid = { ...legacyGraph, nodes: [{ ...legacyGraph.nodes[0], kind: 'unknown.kind' }] } as unknown as NodeFlowGraph
    expect(() => migrateFlow2Graph(invalid)).toThrow('没有兼容模板')
  })
})
