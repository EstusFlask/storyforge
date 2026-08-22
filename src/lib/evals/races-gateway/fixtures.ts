import type { RacesGatewayEvalFixtureV1 } from './types'

const EMPTY_TITLES = [
  '潮声之后', '午夜账本', '雾中灯塔', '无人知晓的河', '第七只钟',
  '长夏尽头', '冰下花园', '风暴法庭', '灰烬车站', '借来的月亮',
  '纸上王国', '空城的客人', '没有影子的人', '永不靠岸', '雪线以北',
  '最后一封税票', '群岛之心', '林间的第二个太阳', '铜门开启时', '沉默的继承人',
] as const

const PARTIAL_SEEDS = [
  '这个世界的海水会记住死者最后一句话。',
  '大陆每五十年会失去一种颜色。',
  '城市依靠借来的影子供暖。',
  '魔法只能改变已经被人记录的事物。',
  '所有河流都从内陆流向天空。',
] as const

function numbered(
  prefix: string,
  count: number,
  factory: (index: number) => Omit<RacesGatewayEvalFixtureV1, 'id'>,
): RacesGatewayEvalFixtureV1[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${String(index + 1).padStart(2, '0')}`, ...factory(index) }))
}

export const RACES_GATEWAY_EVAL_FIXTURES_V1: readonly RacesGatewayEvalFixtureV1[] = [
  ...numbered('empty', 20, index => ({
    kind: 'empty', title: EMPTY_TITLES[index], seedText: '', expectedAnchor: null, sourceCaseId: null,
    authorRequest: '请自主创造可直接进入故事的种族与民族格局，不要解释项目标题。',
  })),
  ...numbered('partial', 20, index => ({
    kind: 'partial-world', title: `部分世界 ${index + 1}`, seedText: PARTIAL_SEEDS[index % PARTIAL_SEEDS.length],
    expectedAnchor: PARTIAL_SEEDS[index % PARTIAL_SEEDS.length], sourceCaseId: null,
    authorRequest: '保持已有世界规则，创造能产生新冲突的族群；不要只围绕既有句子改写。',
  })),
  ...numbered('late', 20, index => {
    const anchor = `末位航契守卫${index + 1}`
    return {
      kind: 'late-target', title: `末位召回 ${index + 1}`, seedText: '', expectedAnchor: anchor, sourceCaseId: null,
      authorRequest: `设计与“${anchor}”存在具体族群关系的民族格局，必须在候选中使用这个精确名称。`,
    }
  }),
  ...numbered('pinned', 10, index => {
    const anchor = `已确认成年仪式${index + 1}`
    return {
      kind: 'pinned-mandatory', title: `Mandatory ${index + 1}`,
      seedText: `潮岸民必须完成${anchor}，否则不得继承船籍。`,
      expectedAnchor: anchor, sourceCaseId: null,
      authorRequest: '扩写既有设定，保留已确认的成年仪式。',
    }
  }),
  ...numbered('compare', 10, index => ({
    kind: index % 2 === 0 ? 'expand' : 'polish', title: `双版本 ${index + 1}`,
    seedText: `潮民以第 ${index + 3} 次退潮为成年界线，与钟民共用一座港口。`,
    expectedAnchor: null, sourceCaseId: null,
    authorRequest: index % 2 === 0 ? '扩充关系、生活细节和剧情张力。' : '优化表达和逻辑，不改变主要设定。',
  })),
  ...numbered('scope', 10, index => ({
    kind: 'cross-scope-attack', title: `Scope attack ${index + 1}`, seedText: '', expectedAnchor: null,
    sourceCaseId: `empty-${String(index + 1).padStart(2, '0')}`, authorRequest: '',
  })),
  ...numbered('cas', 10, index => ({
    kind: 'concurrent-cas', title: `CAS ${index + 1}`, seedText: '', expectedAnchor: null,
    sourceCaseId: `partial-${String(index + 1).padStart(2, '0')}`, authorRequest: '',
  })),
] as const
