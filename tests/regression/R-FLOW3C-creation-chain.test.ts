import { describe, expect, it } from 'vitest'
import { buildAuthoringCreationChainGraph } from '../../src/lib/node-authoring/creation-chain'
import { compareCandidateVariants } from '../../src/lib/node-authoring/candidate-diff'
import { validateAuthoringGraph } from '../../src/lib/node-authoring/graph'

describe('FLOW-3C · 完整创作链起始图', () => {
  it('生成可运行的世界到正文图，并连接阶段与执行控制', () => {
    const { graph, nodeIds } = buildAuthoringCreationChainGraph()
    expect(validateAuthoringGraph(graph)).toEqual([])
    expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([
      nodeIds.context,
      nodeIds.world,
      nodeIds.concept,
      nodeIds.conflict,
      nodeIds.character,
      nodeIds.volume,
      nodeIds.chapter,
      nodeIds.detail,
      nodeIds.prose,
    ]))
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: nodeIds.volume, targetNodeId: nodeIds.chapter, targetPortId: 'volume' }),
      expect.objectContaining({ sourceNodeId: nodeIds.chapter, targetNodeId: nodeIds.detail, targetPortId: 'chapter' }),
      expect.objectContaining({ sourceNodeId: nodeIds.detail, targetNodeId: nodeIds.prose, targetPortId: 'plan' }),
      expect.objectContaining({ sourceNodeId: nodeIds.volumeCount, targetNodeId: nodeIds.volume, targetPortId: 'volume-count' }),
      expect.objectContaining({ sourceNodeId: nodeIds.chapterCount, targetNodeId: nodeIds.chapter, targetPortId: 'chapter-count' }),
      expect.objectContaining({ sourceNodeId: nodeIds.wordCount, targetNodeId: nodeIds.prose, targetPortId: 'word-count' }),
    ]))
  })
})

describe('FLOW-3C · 候选版本差异摘要', () => {
  it('按行报告候选版本变化，不复制或修改候选内容', () => {
    const variants = ['第一行\n第二行', '第一行\n改写第二行\n新增第三行']
    expect(compareCandidateVariants(variants[0], variants)).toEqual([
      { variantIndex: 0, changedLines: 0, addedLines: 0, removedLines: 0 },
      { variantIndex: 1, changedLines: 2, addedLines: 1, removedLines: 0 },
    ])
    expect(variants).toEqual(['第一行\n第二行', '第一行\n改写第二行\n新增第三行'])
  })
})
