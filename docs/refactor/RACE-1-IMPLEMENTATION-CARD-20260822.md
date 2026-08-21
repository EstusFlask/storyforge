# RACE-1 实施卡：空白种族生成与 Gateway canary

日期：2026-08-22  
施工单元：RACE-1  
状态：工程实现完成；真实模型统计随 RACE-6 阶段评测签收

## 完成边界

- `worldviews.races` 成为 `world-origin.worldview-field` 的唯一 required Gateway canary；同一 Skill 的其余世界观字段继续保持 legacy/shadow，未形成双读或全量冒进。
- 空项目生成时，作品名只以“低权重灵感”进入 Prompt，并明确禁止标题释义、标题复述和将标题当作世界事实。
- 空白“种族与民族”候选必须给出身份/来源、群体差异、生活或组织方式、群体关系或张力；禁止占位话术、状态说明和概念解释。
- AI 可返回最多 8 条 `temporaryAssumptions`。它们随候选供作者查看，但采纳只写 `worldviews.races`，不会进入 Canon。
- 已有 `races` 正文成为 mandatory Context Resource；缺失、越界或选择后漂移均在模型或采纳边界 fail closed。
- required canary 在模型调用前持久化 selector、Context Packet、逐资源 source snapshot、工具记录和 rendered request；模型响应后生成 ContextManifestV3，再持久化候选。
- 采纳前重新校验 V3 完整性、当前 Scope、资源内容、检索策略和 SourceRef 新鲜度。
- ContextManifestV3 绑定原始生成候选；作者编辑由 `candidate.revised` 连续事件链绑定，避免“可编辑候选”和“不可篡改生成证据”互相冲突。

## 关键架构决定

1. `requiredWriteTargets` 是 Skill 内的显式 canary 边界，且只能引用该 Skill 已登记的 `table.field` 写目标。
2. Gateway Provider 来源通过统一来源解析器进入 Run Contract；UI、组件和领域 service 没有新增手写来源清单。
3. `contextManifestHash` 不进入 required-Gateway 候选自身哈希，消除 Manifest 绑定 candidateHash 时的循环哈希。
4. canary 暂不与 fan-out 独立语义终验并行；该组合在合同构建时排除，避免用未设计的调用顺序伪造证据。

## 回归证据

- `R-RACE1-races-gateway-canary`
  - 空项目零 Canon 写入后生成候选；V3 exact artifacts 齐全。
  - 作者编辑候选形成连续修订链，随后可采纳且只写目标字段。
  - 已有种族正文进入 mandatory trace；Canon 改动后旧候选被 `candidate-context-stale` 阻止。
- `R-CTXG7-gateway-execution`
- `R-GATE-P1A-shadow-read`
- `R-HARNESS32-worldview-field-agent`

## 延后到 RACE-6 的量化签收

- 20 个空项目、多次真实模型调用的占位率、标题过锚率和具体新设定覆盖率。
- 这些指标必须由保存的 transcript/outcome 评测集计算；本实施卡不以提示词存在代替真实质量结论。
