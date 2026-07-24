import type { ChatMessage } from '../types'

export type GenerationGateStatus = 'pass' | 'blocked'

export interface GenerationGateIssue {
  code: string
  message: string
}

export interface GenerationGateResult {
  status: GenerationGateStatus
  issues: GenerationGateIssue[]
}

/**
 * 透明生成管线的最小运行时单元。
 *
 * 节点不拥有数据读取策略：assembleInput 的 input 必须来自既有
 * assembleContext / 已确认的前序节点产物。adopt 默认不会执行，必须由前台
 * 在作者确认后显式传入 adopt=true。
 */
export interface GenerationNode<TInput, TOutput, TAdoption = never> {
  id: string
  kind: string
  editableInput: boolean
  assembleInput: (input: TInput) => ChatMessage[]
  run: (messages: ChatMessage[]) => Promise<TOutput>
  gate?: (output: TOutput) => Promise<GenerationGateResult> | GenerationGateResult
  adopt?: (output: TOutput) => Promise<TAdoption>
}

export interface PreparedGenerationNode {
  nodeId: string
  kind: string
  editableInput: boolean
  messages: ChatMessage[]
}

export interface GenerationNodeRunResult<TOutput, TAdoption> {
  output: TOutput
  gate: GenerationGateResult | null
  adopted: boolean
  adoption: TAdoption | null
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => ({ ...message }))
}

function assertMessages(messages: ChatMessage[]): void {
  if (messages.length === 0) throw new Error('生成节点没有可发送的消息。')
  if (messages.some(message => !message.content.trim())) {
    throw new Error('生成节点包含空消息，已阻止调用模型。')
  }
}

/** 装配并冻结一次会话级输入快照；不会写库。 */
export function prepareGenerationNode<TInput, TOutput, TAdoption>(
  node: GenerationNode<TInput, TOutput, TAdoption>,
  input: TInput,
): PreparedGenerationNode {
  const messages = cloneMessages(node.assembleInput(input))
  assertMessages(messages)
  return {
    nodeId: node.id,
    kind: node.kind,
    editableInput: node.editableInput,
    messages,
  }
}

/**
 * 执行已准备节点。消息覆盖仅作用于本次调用；默认停在 output/gate，
 * 不自动采纳，确保前台作者确认线不被运行器绕过。
 */
export async function runGenerationNode<TInput, TOutput, TAdoption>(
  node: GenerationNode<TInput, TOutput, TAdoption>,
  prepared: PreparedGenerationNode,
  options: {
    messages?: ChatMessage[]
    adopt?: boolean
  } = {},
): Promise<GenerationNodeRunResult<TOutput, TAdoption>> {
  if (prepared.nodeId !== node.id || prepared.kind !== node.kind) {
    throw new Error('生成节点输入快照与当前节点不匹配。')
  }
  const messages = cloneMessages(options.messages ?? prepared.messages)
  assertMessages(messages)
  const output = await node.run(messages)
  const gate = node.gate ? await node.gate(output) : null
  if (gate?.status === 'blocked') {
    return { output, gate, adopted: false, adoption: null }
  }
  if (options.adopt === true && node.adopt) {
    const adoption = await node.adopt(output)
    return { output, gate, adopted: true, adoption }
  }
  return { output, gate, adopted: false, adoption: null }
}
