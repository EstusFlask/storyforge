# WEH-0H 开工卡：正式 AI 入口机器绑定

## 任务 ID / 用户故事

- 任务：`WEH-0H`
- 用户故事：任何正式或辅助模型调用都必须能由稳定 `entryId` 追溯到 Agent Skill、执行边界、候选种类、允许调用方与采纳权限；未知入口、别名、成员调用或本地 wrapper 不能绕过 CI。

## 当前证据

- `src/lib/agent/ai-entry-registry.json` 只登记文件、调用次数和文字理由。
- `scripts/check-ai-entry-registry.mjs` 只识别裸 `useAIStream()` / `chat()`；不识别 `ai.start()`、导入别名、namespace member 或 wrapper。
- 同一个 `useAIStream()` 实例可执行润色、扩写、去 AI 味和审校改写，文件级登记无法证明实际 Skill 和写边界。
- 旧登记中的 `governed` / `auxiliary` 是人工声明，不是运行时授权。

## 唯一归属与非范围

- 唯一事实源：升级现有 `ai-entry-registry.json`，不新建第二份入口清单。
- 集中执行边界：新增正式入口解析/执行模块；底层 provider client 仍是唯一网络适配器。
- 本单元不重写各领域 Prompt、数据库 schema 或领域候选语义；只把实际模型调用绑定到可机验入口。

## 入口、读、写与表

- 入口：`src/components`、`src/hooks`、`src/pages` 及它们调用的 GenerationNode/service。
- 读：由 `skillId` 指向 `AGENT_SKILLS`，上下文权限继续由 Skill / `CONTEXT_SOURCES` 派生。
- 写：`adoptAllowed=true` 时，目标必须与 Skill `writeTargets` 一致；辅助/评测/草稿入口必须 `adoptAllowed=false`。
- 表：本单元不新增表；实际采纳仍必须走现有 `FIELD_REGISTRY` / AdoptionSchema / `adopt()`。

## 要下线的旧入口

- 下线“文件 + calls 数量即治理完成”的 v1 注册表语义。
- UI 不再直接导入/调用底层 `chat` / `streamChat`。
- `useAIStream.start()` 不再允许缺省入口身份。

## 验证

- 注册表严格解析：重复 ID、未知 Skill、category 冲突、非法采纳边界全部失败。
- AST 守卫：覆盖 bare、member、alias、namespace member 和 local wrapper 反例。
- 调用点必须使用字面量 `entryId` 且位于 `allowedCallers`。
- 删除入口/Skill、改错 category、给辅助入口开放采纳、增加未登记直连均由测试或架构检查阻断。
- 定向测试后运行架构检查、TypeScript、完整测试与构建。
