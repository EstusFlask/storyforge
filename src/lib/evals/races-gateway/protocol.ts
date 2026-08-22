import type { ChatMessage } from '../../types'
import type { RacesGatewayBlindGradeFailureEvidenceV1 } from './types'

export const RACES_GATEWAY_BLIND_GRADER_PROMPT_VERSION_V21 =
  'races-gateway-blind-grader-v21' as const

export const RACES_GATEWAY_GRADER_TIMEOUT_MS_V21 = 60_000 as const

export const RACES_GATEWAY_BLIND_GRADE_JSON_SCHEMA_V21 = {
  type: 'object',
  properties: {
    placeholder: { type: 'boolean' },
    titleOveranchored: { type: 'boolean' },
    concrete: { type: 'boolean' },
    constraintsRespected: { type: 'boolean' },
    addsUsefulInformation: { type: 'boolean' },
    irrelevantMaterial: { type: 'boolean' },
    reason: { type: 'string', maxLength: 500 },
  },
  required: [
    'placeholder', 'titleOveranchored', 'concrete', 'constraintsRespected',
    'addsUsefulInformation', 'irrelevantMaterial', 'reason',
  ],
  additionalProperties: false,
} as const

export class RacesGatewayBlindGraderFailureV1 extends Error {
  constructor(readonly failureEvidence: RacesGatewayBlindGradeFailureEvidenceV1) {
    super(failureEvidence.parseError)
    this.name = 'RacesGatewayBlindGraderFailureV1'
  }
}

export const RACES_GATEWAY_GRADER_PREFLIGHT_INPUT_V3 = {
  title: '盲评协议预检',
  seedText: '港民以潮汐纪年，不得在灯塔内点燃明火。',
  candidateText: '港民按潮季组成互助船团，以贝契登记亲属；守塔人与船团共享航标，却因夜航裁决权长期冲突。',
} as const

export function buildRacesGatewayBlindGraderMessagesV1(input: {
  title: string
  seedText: string
  candidateText: string
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `你是小说世界观候选的盲评员。协议版本：${RACES_GATEWAY_BLIND_GRADER_PROMPT_VERSION_V21}。`,
        '你不知道候选来自哪种实现，也不得推测实现。只根据输入判断。',
        'placeholder：候选主要是占位、说明任务、复述要求或解释“种族与民族”概念。',
        'titleOveranchored：候选把作品名当成必须解释的概念，或大部分设定只是标题的同义扩写；仅把标题作为轻微意象不算。',
        'concrete：至少给出可进入故事的族群身份/来源、差异或生活组织、以及群体关系/张力中的具体内容。',
        'constraintsRespected：若已有设定非空，候选在语义上保留其中全部约束和因果事实；允许调整语序、拆句、换用同义表达或把“已确认”改成标题标注，不要求逐字包含原句。若为空则应为 true。',
        'addsUsefulInformation：候选不是围绕已有设定转述，而是增加可推动人物、冲突或情节的新信息。',
        'irrelevantMaterial：存在大量与种族民族格局无关的解释、元话语或跑题内容。',
        '直接返回一个紧凑 JSON 对象，不要思考过程、解释前缀或 Markdown。字段必须且只能是 placeholder、titleOveranchored、concrete、constraintsRespected、addsUsefulInformation、irrelevantMaterial、reason。前六项是 boolean，reason 是不超过 200 字的中文理由。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `作品名：${input.title}`,
        `已有确定设定：${input.seedText.trim() || '（无）'}`,
        '待评候选：',
        input.candidateText,
      ].join('\n'),
    },
  ]
}
