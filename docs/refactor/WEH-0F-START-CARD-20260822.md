# WEH-0F 开工卡：Prompt Engine 真接入

- 单元：WEH-0F
- 日期：2026-08-22
- 分支：`refactor/world-engine-harness`
- 前置提交：`19b6bc9`（WEH-0E）

## 现状证据

1. 世界基座字段与故事核心字段的正式 Harness 节点仍手写 system/user messages，没有执行激活的 PromptTemplate。
2. 角色节点虽然间接调用 `renderPrompt()`，但 UI 的模板参数、system override、user override 被压入任务文本，未进入 Prompt Engine 的对应角色。
3. 三个分步骤入口均存在 160/240/360/640/1000 字符的静默截断。
4. durable 主计划只冻结 Skill 的 `promptVersion`，没有冻结实际模板、运行参数与覆盖项；恢复时可能读取新的激活模板。

## 本单元施工边界

1. 建立 `PromptExecutionRequestV1`、冻结的 `PromptExecutionOptionsV1` 与运行证据契约。
2. 主计划创建时冻结激活模板；durable checkpoint/plan hash 与 Run Contract 绑定模板身份和参数。
3. 世界基座、故事核心、角色创建均从冻结模板调用 `renderPrompt()`；作者补充作为独立 user message，Harness 硬约束作为不可覆盖的 system message。
4. 删除分步骤入口的静默截断，改为明确上限和调用前失败。
5. 候选记录实际渲染消息 hash、模板 hash、参数/覆盖 hash 和生效生成参数。
6. 历史 durable 计划不读取最新模板，继续使用历史手写路径；不得伪造冻结证据。

## 非目标

- 不在本单元重做 Prompt 管理 UI。
- 不改变三个注册表的数据读写范围。
- 不把自由文本/旧 Agent 节点一次性迁移到新契约。

## 验收重点

- 切换激活模板会改变新 Run 的冻结绑定和实际消息。
- system/user override 进入正确 role，且不能移除 Harness 的结构、权限与作用域约束。
- 超过旧 1000 字但处于明确上限内的作者说明完整进入请求；超过上限则模型调用前报错。
- Run 暂停后切换激活模板，恢复仍使用计划中冻结的旧模板。
- durable 解析拒绝篡改或越权的 Prompt 执行数据。
