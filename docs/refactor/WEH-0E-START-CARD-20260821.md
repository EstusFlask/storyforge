# WEH-0E 开工卡：统一结构化输出与一次 repair

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 基线：WEH-0D `4d9807f`

## 1. 当前真实链路与缺口

仓库已有 `CreativeArtifactV1`、`runCreativeExecutionV1()` 和故事线/大纲/正文的有限 repair，证明不需要新建第二套可靠性体系；但当前覆盖和语义仍分裂：

- 故事线、大纲和正文拥有 raw evidence、状态、issues 与最多一次 repair；故事线还复制了一份专用执行器。
- 世界观字段、故事核心、角色、创作规则、角色驱动、角色补全、故事线进度和细纲各自手写围栏/截取/`JSON.parse`；错误码、路径、超长语义和容错范围不同。
- 角色 parser 额外允许 JSON5，而其它领域拒绝，导致相同模型错误得到不同结果。
- `runBudgetedGenerationNode()` 只对 gate 问题做一次“带原上下文”的重试；结构解析异常直接失败，且没有统一 raw/normalization evidence。
- 现有 JSON normalizer 只接受完整对象和完整围栏，尚未覆盖 BOM、前后说明中的首个平衡 JSON、数组根和登记 alias。

## 2. 本单元裁决

1. 复用 `CreativeArtifactV1`，不建立竞争的候选可靠性模型。
2. 新增唯一 `StructuredOutputPipelineV1`，负责 raw evidence、确定性 normalize/salvage、schema 问题、target/permission/scope 分类和 repair fingerprint。
3. 免费 salvage 仅允许：BOM、外层空白、单一 JSON 围栏、首个语法平衡且可独立解析的 JSON 根、显式登记的顶层字段 alias；禁止 JSON5、截断补全、字段脑补和创作内容猜测。
4. `runBudgetedGenerationNode()` 对结构化错误与可修 target/gate 错误合并为同一个、最多一次的 repair 额度；repair 消息只携带 schema/target、问题和原始输出，不重新附带完整 Canon 上下文。
5. 网络、取消、预算、余额、scope、permission、stale、超长和相同失败指纹不自动重发。
6. 第二次仍失败时产生统一 `manual-repair/blocked` 证据；不得把未通过 schema/gate 的值交给采纳。

## 3. 三注册表与生命周期

- 解析管线不改变 `CONTEXT_SOURCES`；repair 不重新装配上下文，也不能借机读取新来源。
- schema/target gate 只校验候选；真正写入仍由 `FIELD_REGISTRY / AdoptionSchema / adopt()` 或登记扩展完成。
- 不新增表。结构化证据进入现有 candidate payload / CreativeArtifact，并沿 Agent Event/Run 的 `PROJECT_TABLES` 生命周期保存。
- Skill 继续定义输出目标和权限；parser 不能通过 alias 或 salvage 扩大 Skill 写权限。

## 4. 必须先失败的反例

1. BOM、完整围栏、前后说明 + 首个平衡 JSON 可以无模型调用修复，并记录步骤。
2. 截断 JSON、多个无法明确选择的根、JSON5、未知字段、缺字段、错误 enum 都不能伪装 ready。
3. 登记 alias 可重命名；alias 与正式字段并存发生冲突时 fail-closed。
4. 同一种非法 JSON 在世界观、故事、角色、细纲得到同一 parse 分类。
5. 可修错误只额外调用一次；第二次相同 fingerprint 后停止。
6. provider/取消/scope/permission/stale/超长错误额外调用为 0。
7. repair Prompt 不含原始完整项目上下文，只含目标、错误和上次 raw。
8. repair 失败保留首次 raw evidence，但采纳为 0。

## 5. 非范围与回滚

- 本单元不改变业务字段、生成模式和 Prompt 内容所有权；Prompt Engine 真接入属于 WEH-0F。
- 上下文资源渐进披露属于 Phase 1A，不在 repair 时重新查询 Canon。
- 旧 candidate/CreativeArtifact 保持可读；新 evidence 字段必须可选。
- 回滚不得恢复各领域独立决定重试次数或 JSON5/截断猜测；允许暂时停用自动 repair，但 strict schema/gate 必须继续 fail-closed。
