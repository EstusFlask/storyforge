# WEH-0A 开工卡：Agent Skill 唯一运行契约

> 日期：2026-08-21
> 分支：`refactor/world-engine-harness`
> 基线：`2c9ad713cb5e5201a191a3c8fcbfc641a592af1e`

## 用户故事与目标

正式分步骤生成不能由 Skill、durable adapter、UI 和 Manifest 分别维护可漂移的来源/写目标清单。Skill 是唯一可编辑定义；每次 Run 保存从该定义与显式运行边界派生的不可变快照，实际 assemble、Manifest 和写权限必须与快照集合相等。

## 基线证据

- 隔离工作区：`/Users/qinyingying/Desktop/project/storyforge-world-engine-harness`。
- 原 `feat/ttrpg-game-platform` 工作区存在大量未提交并行改动，本分支没有复制或覆盖这些改动。
- 八项基线检查通过：architecture、required-tables、AI Manual、agent-context、agent-freshness、source-reachability、canon-coverage、AI entry registry。
- 相关 Harness 定向测试：7 files / 61 tests 全通过。
- `npx tsc --noEmit` 与 `npm run build` 通过。
- `npm ci` 报告 16 项既有依赖公告；不在 WEH-0A 范围内，不执行 `npm audit fix --force`。

## 当前关联闭包

| 环节 | 正文生成 | 大纲生成 | 裁决 |
|---|---|---|---|
| UI 入口 | `ChapterEditor.tsx` | `OutlinePanel.tsx` | 两者都直接消费 adapter 导出的来源数组 |
| 上下文装配 | `assembleContext(...PROSE_GENERATION_SOURCE_KEYS_V1)` | `assembleContext(...OUTLINE_GENERATION_SOURCE_KEYS)` | 实际读取未从 Skill resolver 取得 |
| Skill | `prose.generate` / `prose.continue` | `outline.compose` / `outline.volumes` / `outline.chapters` | Skill 已存在，但没有成为实际合同所有者 |
| Run builder | `buildProseGenerationRunContractV1()` | `outlineRunContract()` | permissions 再次复制来源与写目标 |
| Manifest | `ChapterEditor.tsx` 直接传 declared keys | `outlineManifest()` 再传同一手写数组 | 只能证明 UI 与 adapter 自洽，不能证明与 Skill 相等 |
| candidate | `ProseGenerationCandidateV1` | `OutlineGenerationCandidateV1` | 已有 durable 身份/hash，可保留 |
| adopt | `prose-generation-durable.ts → adopt()` | `OutlinePanel/useOutlineGenerationController` | WEH-0A 只冻结权限；大纲 fail-open 在 WEH-0B 修复 |
| 主要守卫 | `R-HARNESS7`、`R-HARNESS13` | `R-HARNESS1`、`R-AGENT1-chat-copilot-outline` | 目前没有正式入口“Skill 解析集合 = Run = assemble = Manifest”相等守卫 |

## 已确认的集合漂移

### 正文

`PROSE_CONTEXT_SOURCE_KEYS`（Skill）包含 `activeNarrativeBlueprint`，实际 `PROSE_GENERATION_SOURCE_KEYS_V1` 缺少它；因此 Blueprint 虽在 Skill 声明，却不会进入正文真实 Prompt/Manifest。

`characterKnowledge` 是 Skill optional source，只应在显式 POV 边界启用；当前正文手写数组却始终声明它。Run permission 因而比默认 Skill 权限更宽。

Skill 的正文写目标只有 `chapters.content`，正式采纳实际同时写 `content + wordCount`。`wordCount` 已在 FIELD_REGISTRY 登记，但权限来源不是同一 Skill 定义。

### 大纲

Skill 的 `OUTLINE_CONTEXT_SOURCE_KEYS` 不含 `priorOutlineCandidate`，实际 UI/Run/Manifest 手写数组始终包含它。该来源只应在批量续接或明确携带前一候选的运行边界启用。

大纲各类请求的真实写字段不同：单卷/单章只写 `summary`，批量卷章还写 `parentId/type/title/order`。需要由 Skill 写目标上限加目标/请求规则派生，不能由 UI 自由传入。

## 唯一归属与明确非范围

### 本单元负责

1. 版本化 Skill definition snapshot 与 resolved run binding。
2. 从 Skill + 显式 runtime activation 派生实际来源集合。
3. 从 Skill + 目标规则派生实际写权限。
4. prose/outline 的 Run、assemble 和 Manifest 消费同一 resolved binding。
5. 保留历史 V1 contract、pending candidate、portable import/rebind 的只读兼容。
6. 架构守卫拒绝正式 UI/adapter 新增手写来源所有权。

### 本单元不负责

- 不修复大纲 trace/candidate/adoption 的 fail-open；归 WEH-0B。
- 不建设保存屏障、候选编辑队列、structured-output pipeline、Prompt override 或 Context Gateway。
- 不改变世界观、故事、角色、大纲、正文的产品字段与创作逻辑。
- 不新增业务表，不执行真实模型调用。

## 读、写与表

- 读：只允许 `CONTEXT_SOURCES` 已登记来源；resolved source set = mandatory direct/tool sources + 本轮规则激活的 optional sources。
- 写：只允许 Skill 的 `writeTargets` 上限内、再由请求目标收窄；仍经 `FIELD_REGISTRY + AdoptionSchema + adopt()`。
- 表：WEH-0A 不新增表；旧 `agentRuns/events/checkpoints` 生命周期继续由 `PROJECT_TABLES` 管理。

## 计划合同

1. `AgentSkillDefinitionV2`：保持 V1 业务字段，新增可规范化/hash 的定义版本；optional source 仍必须显式登记。
2. `ResolvedAgentSkillRunBindingV2`（或同责命名）：冻结 skill ID/version/hash、prompt version、tool schema/hash、实际 source keys、write targets、runtime activation reasons 和 policy hash。
3. Run Contract 只保存解析快照；builder 不得自行扩大 source/write 集合。
4. Manifest 的 `declaredSourceKeys` 取自同一 binding；assembly 也使用同一集合。
5. `priorOutlineCandidate` 成为 outline skills 的 optional source，仅在存在明确 prior candidate 文本的续接/批量步骤激活。
6. `characterKnowledge` 仅在有有效 POV character boundary 时激活。
7. 旧 V1 execution binding 继续可解析/恢复；新 formal run 使用 V2 binding。

## 先写的失败反例

1. Skill 删除 `activeNarrativeBlueprint` 或 adapter 漏传时，正文集合相等测试失败。
2. 无 POV 的正文出现 `characterKnowledge` 时失败；有 POV 时必须出现。
3. 普通大纲出现 `priorOutlineCandidate` 时失败；明确续接时必须出现。
4. UI/Run 额外加入已登记但未经 Skill 授权的来源仍失败，不能因为来源在 `CONTEXT_SOURCES` 就放行。
5. Run 写目标超过 Skill 上限时失败。
6. Skill definition/policy hash 与 Run snapshot 不一致时失败。
7. V1 contract、旧 candidate 和 portable rebind 继续可读。

## 验证与退出门

- 新增 `R-WEH0-skill-runtime-contract.test.ts`。
- 扩展 `R-HARNESS7`、`R-HARNESS1`、`R-HARNESS13` 和 architecture checker。
- 仓库正式 prose/outline UI 不再导入手写来源数组。
- prose/outline 的实际 assemble、contract permissions 和 Manifest declared set 等于同一 resolved binding。
- 三注册表检查、AI Manual、TypeScript、build 和相关测试通过。

## 回滚

若 V2 新运行绑定需回滚，只允许切回“由同一 Skill resolver 派生的 V1 adapter”；不得恢复 UI 自有来源数组。已经保存的 V2 Run 必须保持只读可恢复或明确显示版本不受当前执行器支持。
