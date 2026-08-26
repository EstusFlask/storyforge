# StoryForge 跑团完整功能开发看板

> 状态：`UPPER-LAYER INTEGRATED · WORLDRELEASE ADAPTER DEFERRED`
>
> 建立日期：2026-08-22
>
> 产品规格：[`TTRPG-COMPLETE-PRODUCT-CONSTRUCTION-PLAN-V2.md`](./TTRPG-COMPLETE-PRODUCT-CONSTRUCTION-PLAN-V2.md)
>
> 当前分支：`feat/ttrpg-game-platform`
>
> 当前总裁决：规则、车卡、逐行动反馈、奖惩/物品/次数、AI KP/玩家、产品专属媒资、在线权威和长战役保留为
> `integrated` 证据。TTRPG 已建立自己的 frozen SourceSelection、Brief、Build、步骤账本、Product Release 与运行来源绑定；
> 当前正式 UI 只允许明确标记的冻结开发来源完成上层验收，开发来源不能发布正式 Product Release。
> `WorldRelease → TTRPG SourceCatalog` 的唯一适配器按项目决策后置，因此“世界到跑团正式生产已贯通”的旧裁决仍撤回；
> 严格商业证明仍为 `0/3 Golden`。
> 权威审计见 [`TTRPG-WORLD-DATA-ALIGNMENT-AUDIT-20260822.md`](./TTRPG-WORLD-DATA-ALIGNMENT-AUDIT-20260822.md)。

## 1. 如何阅读这份看板

### 1.1 状态定义

| 标记 | 状态 | 含义 |
|---|---|---|
| ⬜ | `not-started` | 尚未进入施工，或现有内容与目标合同无关 |
| 🧱 | `kernel-only` | 已有类型、服务、页面或测试内核，但没有走通本工单验收 |
| 🟡 | `in-progress` | 正在修改，尚未通过全部定向门 |
| 🟢 | `integrated` | 代码、注册表、生命周期和定向测试已接通，但未通过对应 Golden 场景 |
| ✅ | `golden-passed` | 使用正式页面、非 fixture 数据和隔离身份通过本阶段 Golden 门 |
| ⛔ | `blocked` | 出现数据安全、许可、外部服务或不可裁决的硬阻塞 |

只有 `✅ golden-passed` 才计入用户可用完成度。`🧱 kernel-only` 不能用于宣传“功能已经可用”。

### 1.2 每张工单的完成证据

每张票关闭前必须同时登记：

1. 正式用户入口；
2. AI 读取的 `CONTEXT_SOURCES`；
3. AI 可写字段的 `FIELD_REGISTRY / AdoptionSchema`；
4. 数据表的 `PROJECT_TABLES` 生命周期；
5. 领域命令、事件和 reducer；
6. UI 调用方；
7. 正向、反向、恢复、越权测试；
8. 定向测试命令与结果；
9. 真实浏览器截图/录像或 E2E 证据；
10. 仍未完成的边界。

缺少其中任何适用项，状态最多为 `🟡 in-progress`。

## 2. 开发过程

```mermaid
flowchart LR
  A["选择一张无阻塞工单"] --> B["建立入口→读写→生命周期→调用方→测试闭包"]
  B --> C["先写失败验收与反例"]
  C --> D["注册表/Schema/迁移"]
  D --> E["领域合同、命令、事件、Reducer"]
  E --> F["Service / Agent Harness"]
  F --> G["正式 UI 与错误恢复"]
  G --> H["定向测试与架构门"]
  H --> I["隔离浏览器 Golden Slice"]
  I --> J["更新看板、证据和未完成边界"]
  J --> A
```

每个施工批次遵循以下顺序：

1. **基线保护**：记录 `git status`、相关提交和已有改动；不覆盖当前工作树中其它施工内容。
2. **失败测试先行**：先证明旧实现为什么不满足本票，例如 d101 被错误接受、同一物品可重复领取、玩家行动没有 Receipt。
3. **三注册表先行**：新增上下文、字段或表时先登记并补生命周期测试。
4. **领域内核**：先实现不依赖 React 和模型的确定性合同、命令、事件与 reducer。
5. **Agent 接入**：AI 只能读取登记投影、产出候选或调用工具，不能成为规则和数据真相。
6. **UI 接入**：页面只提交命令并显示投影、Receipt 和恢复状态，不在组件中另存规则状态。
7. **风险递增验证**：定向测试 → 架构检查 → TypeScript → build → 相关 E2E → 完整 CI。
8. **证据更新**：记录测试、截图、fixture/真实数据边界和下一票；未通过 Golden 不上调完成状态。

## 3. 里程碑与交付顺序

| 里程碑 | 包含阶段 | 用户第一次得到什么 | 当前 |
|---|---|---|---|
| M0 真实性重置 | R0 | 固定模板退出生产路径，状态不再虚报 | 🟢 |
| M1 规则底座 | R1 | d2～d100、公平骰子、真实奖惩/物品/次数、Rank Lite | 🟢 |
| M2 从世界生产跑团 | R2～R4 | 上层可从冻结跑团来源完成指令、席位/车卡、Build 与试玩；最终 WorldRelease 适配和正式发布待接 | 🟡 |
| M3 真人 KP 完整团 | R5 | 真人 KP 和真人玩家可完整跑完、保存、反馈、回放一场团 | 🟢 |
| M4 AI 跑团 | R6～R8 | AI KP、AI 玩家、混合组队和动态媒资 | 🟢 |
| M5 联机商业候选 | R9～R10 | 多设备权威房间、深规则、长战役和发行运营 | 🟡 |

依赖主链：

```text
R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R9 → R10
                    └────────→ R8 ────────┘
```

R5 是第一个“真正完整可跑的产品门”，但只覆盖真人 KP 的 Rank Lite 短团。用户要求的 AI KP、AI 玩家、动态美术和多人联机必须继续完成 R6～R10。

## 4. 当前开发总表

### R0 · 状态纠偏与旧入口收口

| 工单 | 状态 | 开发内容 | 代码/文档落点 | 验收 |
|---|---|---|---|---|
| R0-01 | 🟢 | 权威规格、能力状态和旧完成声明统一 | `docs/ttrpg/*`、`docs/roadmap/CAPABILITY-BASELINE.md`、Master plan | 所有状态能区分 kernel/integrated/golden/commercial |
| R0-02 | 🟢 | 固定四场景编译器标记 fixture-only 并断开生产 fallback | `src/lib/ttrpg/campaign.ts`、`authoring.ts`、生产 adapters | 正式构建绝不生成固定四场景；模型失败明确暂停 |
| R0-03 | 🟢 | Golden evidence schema 与禁止假完成检查器 | `scripts/`、`docs/completion/`、`R-MASTER0` | 没有真实入口/E2E 的能力无法标记完成 |
| R0-04 | 🟢 | 收口 ProductHub/页面中的“单机已可用”等错误提示 | `src/pages/ProductHubPage.tsx`、TTRPG UI | UI 状态与看板一致，实验能力默认标识 |

### R1 · RulePack V2、公平骰子与运行账本

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R1-01 | 🟢 | Dice AST/parser/schema；骰面硬限制 d2～d100 | `types/ttrpg-product.ts`、`ttrpg/rule-pack.ts` | d100 通过；d101 在 parser/import/AI/runtime/UI 全拒绝 |
| R1-02 | 🟢 | 拒绝采样 RNG、roll trace、commit-reveal proof | `ttrpg/rule-pack.ts`、`online/*` | 无单字节模偏差；同 seed 可重放；proof 可复算 |
| R1-03 | 🟢 | total-vs-target、roll-under、success-pool、opposed、no-roll | `ttrpg/rule-pack.ts`、新 resolver/effect 模块 | 五类裁决与成功等级均有金标向量 |
| R1-04 | 🟢 | initiative、行动经济、reaction、资源、条件和持续时间 | `ttrpg/runtime.ts`、simulation reducer | 规则声明在事件、UI、回放中真实执行 |
| R1-05 | 🟢 | HouseRule Overlay、diff、冲突、概率预览 | `ttrpg/house-rule.ts`、九步向导 | 村规可追踪；非法/超过 d100 的 patch 被拒绝 |
| R1-06 | 🟢 | Rank Lite 完整规则包 | `ttrpg/rank-lite-rule-pack.ts`、制作选择器 | A/B/C/D 快速车卡并完成规则垂直切片 |
| R1-07 | 🟢 | AbilityDefinition、UsagePool、冷却和 reset triggers | types/rules/runtime/projection | 次数耗尽、共享池、资源、场景/休息重置可回放 |
| R1-08 | 🟢 | ItemDefinition/ItemInstance、背包、装备、充能、耐久和转移 | types/campaign/runtime/events | 并发转移不复制；使用/损坏/丢弃/恢复正确 |
| R1-09 | 🟢 | 奖惩、成长、关系/声望 EffectPlan 与事实对账 | rules/runtime/receipt | 即时与玩家确认型后果均只提交一次 |

### R2 · WorldRelease 精确承接与生产 Brief

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R2-01 | 🟡 | WorldRelease 到跑团来源的唯一适配器 | `ttrpg/production-source.ts`、未来 world adapter | 跑团侧冻结/校验合同已完成；正式 Release 读取与显式升级待出口稳定后接入 |
| R2-02 | 🟢 | 跑团专属 Brief revision 与 Run Contract | `types/ttrpg-production.ts`、`ttrpg/production-service.ts` | 自然语言、规则、席位、角色、媒资和质量目标可恢复 |
| R2-03 | 🟢 | 跑团专属 9 步向导 | `TtrpgProductionWizard.tsx`、`TtrpgProductionWorkspace.tsx` | 从冻结跑团来源完成 Brief；刷新不丢 |
| R2-04 | 🟡 | 来源失效、删除、hash 变化、跨 Work 与显式升级 | `ttrpg/production-source.ts`、产品来源测试 | hash/作用域/篡改已 fail-closed；WorldRelease 新版本 diff 与升级待最终适配器 |

### R3 · 席位、完整车卡与 Session Zero

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R3-01 | 🟢 | Seat/controller/assignment/consent | TTRPG types、DB、online contracts | 真人+AI、真人+真人、真人+真人+AI 均可配置 |
| R3-02 | 🟢 | CharacterSchema renderer 与手工车卡 | `TtrpgProductStudio.tsx`、authoring/types | 身份、技能、能力、等级/Rank、装备、秘密完整 |
| R3-03 | 🟢 | 引导式车卡和世界角色规则映射 | authoring/validators/UI | 数值来源可解释；非法预算阻止发布 |
| R3-04 | 🟢 | AI 车卡候选、逐字段锁定/重生成/采用 | Agent skill/context/registry/UI | AI 不直写；锁定字段不会被覆盖 |
| R3-05 | 🟢 | Session Zero、安全工具、邀请认领和代打同意 | runtime/UI/online/projection | 角色归属、边界、掉线与代打策略全部冻结 |

### R4 · AI 战役生成、验证与正式发布

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R4-01 | 🟢 | 冻结世界分析、2～3 个提案和逐项锁定 DAG | game-production scheduler/Agent runs | 不再一次性黑箱生成 |
| R4-02 | 🟢 | CampaignPack V2：真相、Front/Clock、场景、遭遇、线索、秘密 | `ttrpg/campaign.ts`、types | CampaignPack 不依赖固定四场景 |
| R4-03 | 🟢 | 世界、规则、线索可达、秘密和角色钩子验证器 | ttrpg validators/quality receipts | 直达、失败、绕路、NPC 死亡、队伍分裂反例可判定 |
| R4-04 | 🟢 | 多角色模拟试玩和质量收据 | GM eval/harness/game production | 评测读取实际 CampaignPack 和 RulePack |
| R4-05 | 🟡 | TTRPG Product Build/Release、预览和迁移 | `ttrpg/production-service.ts`、产品表生命周期 | Build 可真实试玩；正式 Release 会拒绝开发来源或缺失生产媒资，等待 WorldRelease 适配后密封 |
| R4-06 | 🟢 | 同世界三指令差异性门 | production E2E/eval | 受控正式页面演练证明三套战役不是换皮骨架；真实供应商 Golden 仍独立关闭 |

### R5 · 真人 KP 完整可玩产品

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R5-01 | 🟢 | 玩家桌面、场景、角色卡、行动、骰点、背包和线索 | `TtrpgTabletopSurface.tsx`、CampaignGuide | 玩家无需开发面板提交全部行动 |
| R5-02 | 🟢 | 真人 KP 控制台、NPC、秘密、Clock、场景和 Handout | TTRPG GM UI | KP 可准备、发放、裁决和恢复 |
| R5-03 | 🟢 | 自由/遭遇模式、保存、检查点、回放、分支和会后回顾 | runtime/simulation/UI | 长会话、刷新、恢复与分支状态可复算 |
| R5-04 | 🟢 | ActionContext、关键性判断、ActionExecutionCandidate | runtime/context/rules | 场景、剧情、角色、次数、物品参与判定 |
| R5-05 | 🟢 | ActionReceipt 全状态与 viewer 投影 | runtime/events/projection/UI | 每个真人/AI/NPC 行动恰好一个终态反馈 |
| R5-06 | 🟢 | Observer/Relevance 和四层反应窗口 | runtime/GM UI/online contracts | 不在场角色不反应；真人 PC 不被代演 |
| R5-07 | 🟢 | GmSynthesisFrame 和叙述一致性验证 | GM context/harness/runtime | 反馈不违背骰子、物品、次数、场景和角色反应 |
| R5-08 | 🟡 | 黄金回合 E2E 和真人 KP Golden | E2E/isolated browser | 受控浏览器已演练；非 fixture、真人主持完整场次证据尚未密封 |

### R6 · 可信 AI KP

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R6-01 | 🟢 | AI KP Run Contract、工具权限和完整 trace | `gm-harness.ts`、Agent contracts、hosted AI service | AI 不能指定骰点或直接改状态 |
| R6-02 | 🟢 | KP 场景/会话/战役分层记忆 | `gm-context.ts`、context manifest、自动事实回顾 | 长局记忆有来源、预算和 viewer 边界 |
| R6-03 | 🟢 | AI KP 主动代理 NPC 行动并使用 GmSynthesisFrame 主持完整回合 | `gm-actor-harness.ts`、runtime、`ai.gm.act` online service | NPC 行动只提候选并由 RulePack 结算；每行动都有正确反馈和角色反应 |
| R6-04 | 🟢 | 规则、秘密、世界一致、自由度评测 | `gm-eval.ts`、eval fixtures | 泄漏/改结果/强行回轨达到拒绝阈值 |
| R6-05 | 🟢 | 模型超时、拒绝、截断和真人无损接管 | runtime/UI/E2E | 模型失败仍显示机械 Receipt |

### R7 · AI 玩家与混合队伍

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R7-01 | 🟢 | 独立 AI Player Agent 和私有 viewer context | AI player Harness、hosted service、Agent registry | 每个 AI 只读自己知道的内容 |
| R7-02 | 🟢 | manual/initiative/natural/pooled 激活协调 | orchestration/runtime | 不重复行动、不垄断发言 |
| R7-03 | 🟢 | hybrid 建议、真人确认和缺席代打 | UI/session consent | AI 未获授权不能接管真人角色 |
| R7-04 | 🟢 | 多 AI 关系、目标、长期记忆和成本控制 | Agent memory/eval/continuity | 1真人+2AI、2真人+1AI 受控短团闭环 |

### R8 · 美术与运行时素材

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R8-01 | 🟢 | Visual/Character/Location Bible 和来源许可 | `ttrpg/media-contract.ts`、production compiler | 视觉身份、表情基线、地点锚点和来源策略已冻结并严格解析 |
| R8-02 | 🟢 | 场景、地图、立绘、表情、Token、物品、Handout adapters | `ttrpg/production-media.ts`、`ttrpgProductionMediaAssets` | 七类稳定槽位使用跑团专属版本账本并复用底层 Blob/Provider；候选经作者确认后回绑 CampaignPack |
| R8-03 | 🟢 | Runtime asset request queue、去重和预算 | `ttrpg/runtime-media.ts`、DB v67、UI | 先持久化再后台生成；有去重、租约恢复、并发/数量/成本上限和 viewer 授权 |
| R8-04 | 🟢 | media.available/failed 投影与占位替换 | simulation events / viewer projection / runtime media panel | 成功绑定统一媒资；失败、离线、超时、取消继续显示文字 fallback，分支/删除生命周期闭合 |
| R8-05 | 🟡 | TTRPG 媒资 Golden 门 | E2E/quality receipts | 运行时生成、失败降级和恢复已演练；真实商业供应商完整素材集未密封 |

### R9 · 多人在线与权威权限

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R9-01 | 🟢 | 房间身份、邀请、席位、角色认领和权威命令 | `src/lib/online/*`、room UI | 客户端改状态无效 |
| R9-02 | 🟢 | 事件持久化、幂等、乱序、重连和房主迁移 | online durable/realtime | 重复/过期命令不产生双写 |
| R9-03 | 🟢 | commit-reveal d2～d100 骰子 | online authority/rules | 所有参与者可复算 proof |
| R9-04 | 🟢 | 服务器端 projection 和秘密网络攻击测试 | online adapter/security tests | 玩家响应体不含 GM/private 数据；恶意投影 fail-closed |
| R9-05 | 🟡 | 三身份跨设备 Golden 和灾难恢复 | E2E/hosted service | 持久检查点、重连、重启恢复已受控验证；真实外部身份跨设备演练未完成 |

### R10 · 深规则、长战役与商业候选

| 工单 | 状态 | 开发内容 | 代码落点 | 验收 |
|---|---|---|---|---|
| R10-01 | 🟢 | SRD 5.2.1 兼容 d20 Fantasy 和许可清单 | rule packs/attribution/tests | 规则、许可、3级起始强度与濒死恢复村规进入正式生产；Golden A 尚未密封 |
| R10-02 | 🟢 | 原创 d100 Investigation | rule packs/tests | 普通/困难/极难、成功等级、压力、blind roll 与线索闭合；Golden B 尚未密封 |
| R10-03 | 🟢 | Narrative 2d6 V2 | StoryForge pack/rules | 部分成功、后果、资源和成长闭合 |
| R10-04 | 🟢 | 长战役升级、补员、退场、世界演化和版本迁移 | campaign/runtime/release | 连续 10 次会话、自动回顾与版本计划一致 |
| R10-05 | 🟢 | Creator SDK、战役/规则包发行和市场兼容 | creator-sdk/distribution/community | 包校验、许可、版本和删除完整 |
| R10-06 | 🟢 | 成本、审核、可观测性、恢复和支持工具 | commercial/operations | 可部署领域与 readiness 已闭合；真实服务与账号门仍 fail-closed |
| R10-07 | 🟡 | Golden A/B/C 与真实新用户验收 | E2E/evidence/user test | 受控提供方三场景已演练；非 fixture、真实供应商、真实新用户 0/3 |

## 5. 第一施工队列

当前只激活依赖最前的工单。后续票保留在 Backlog，不跨过未通过的阶段门提前宣布完成。

| 顺序 | 工单 | 当前动作 | 开工前失败证据 | 完成后直接解锁 |
|---:|---|---|---|---|
| 1 | R0-01 | 搜索并统一所有 TTRPG 完成状态 | 文档/UI 仍存在“单机已可用/已闭合” | R0-03 状态守卫 |
| 2 | R0-02 | 隔离固定 Campaign 编译器 | 正式 `authoring.ts` 仍调用固定编译器 | R4 真正 CampaignPack 生产 |
| 3 | R0-03 | 建立 Golden evidence 检查 | 当前测试数量可被误当产品完成 | 所有阶段真实状态门 |
| 4 | R0-04 | 收口 UI 错误宣传与实验入口 | ProductHub 显示“单机战役已可用” | 用户看到真实进度 |
| 5 | R1-01 | 重写骰式边界 | V1 接受到 d10000 | R1-02/R1-03 |
| 6 | R1-02 | 修复随机与 proof | V1 `% sides` 有模偏差 | 可信掷骰 |
| 7 | R1-03 | 通用 resolver 与成功等级 | V1 只有 meet-or-beat | R1-04/R1-05/R1-07～09 |
| 8 | R1-04 | 行动经济与状态 | 声明字段未形成完整执行闭环 | 正式遭遇 |
| 9 | R1-07 | 次数/冷却/reset | 当前没有使用次数账本 | R1-06/R5 |
| 10 | R1-08 | ItemInstance 与库存 | 当前只有 itemKeys | R1-06/R5 |
| 11 | R1-09 | 奖惩与对账 | 当前只有里程碑货币 | R1-06/R5 |
| 12 | R1-05 | 村规 Overlay | 当前没有安全 patch 合同 | 用户自定义规则 |
| 13 | R1-06 | Rank Lite 完整规则包 | 当前只有 2d6 演示包 | M1 Golden slice |

## 6. 阶段验证命令

每张票先运行自己的定向测试。每个可提交开发批次至少执行：

```bash
npm run check:architecture
npm run check:required-tables
npm run check:ai-manual
npx tsc --noEmit
npm run build
git diff --check
```

阶段交付执行 `npm run ci`；涉及正式页面、多人身份、恢复或媒资时执行对应 `npm run ci:e2e`/定向 Playwright。外部服务门失败要单独报告，不能把本地合同测试通过写成线上能力已完成。

## 7. 进度更新模板

每次完成一个工单，在本文件追加以下记录：

```md
### YYYY-MM-DD · R?-?? · 工单标题

- 状态变化：🧱 → 🟡 → 🟢 / ✅
- 用户入口：
- 三注册表：
- 领域合同与事件：
- 数据迁移/生命周期：
- UI：
- 定向测试：
- 架构/构建/CI：
- 浏览器/Golden 证据：
- 失败与恢复反例：
- 尚未完成：
- 下一票：
```

## 8. 当前快照

### 2026-08-22 · 看板建立

- 当前阶段：M0 / R0。
- 激活工单：R0-01。
- 完成度：Golden `0/3`；黄金回合未通过。

### 2026-08-22 · R1-04（部分）与 R2-01 · 行动经济及世界到跑团交接

- 状态变化：R1-04 进入 `🟡 in-progress`；R2-01 进入 `🟢 integrated`。
- 世界承接：世界引擎按钮改为“用此世界制作跑团”，交接合同冻结 `productType=ttrpg`、`worldReleaseId`、`worldContentHash`，目标改为跑团制作页。
- 来源防漂移：制作台只选中 ID 与 hash 同时匹配且属于当前 workspace 的 WorldRelease；失效、hash 变化或产品类型冲突时置空来源并明确报错，不回退到另一个世界版本。
- 行动经济：正式本地运行时和 durable 在线适配器共用 V2 账本；action/free/reaction 独立扣减，反应允许在他人回合执行，耗尽拒绝，新轮重置，条件持续时间只在完整回合结束时递减。
- 回放兼容：新会话持久化 action economy；旧事件缺少 phase/ledger 时继续走 V1 兼容分支，不破坏既有存档。
- 定向测试：`R-TTRPG3A`、`R-TTRPG3B`、`R-TTRPG2A/B/C`、`R-ONLINE1-browser/durable`、`R-GAMEPROD1B-source-selector-ui` 等相关 50 余条通过。
- 类型与代码质量：`tsc --noEmit`、`git diff --check` 通过。
- 尚未完成：R1-04 还缺规则化先攻、完整 reaction trigger/window 和 UI 预算显示；R2-02～R2-04 还需 Brief V2、九步向导和全部失效恢复流程。
- 下一票：R1-07 能力次数/冷却/reset 账本与 R1-08 ItemInstance 原子库存。

### 2026-08-22 · 当前快照（世界交接后）

- 当前阶段：M1 / R1，R2-01 前置已提前闭合。
- 激活工单：R1-07。
- 工单分布：`🟢 7`、`🟡 2`、`🧱 23`、`⬜ 30`、`✅ 0`。
- 完成度：Golden `0/3`；黄金回合未通过。
- 现有可复用内核：WorldRelease、统一生产骨架、事件账本、检查点/分支、RulePack V1、CampaignPack V1、viewer projection、GM Harness、媒资 Blob、在线房间合同。
- 现有关键失败证据：固定编译器仍在正式 authoring 路径；骰面允许到 10,000；随机存在 `% sides` 模偏差；世界引擎入口跳转 storygame 且未携带具体 release；没有 ActionReceipt、完整反应、ItemInstance、能力次数和通用奖惩账本。
- 工作树状态：当前分支包含大量未提交的既有游戏平台施工改动；后续必须逐文件保护，不能用破坏性 Git 命令回退或覆盖。
- 下一动作：完成 R0-01 全仓状态扫描和状态枚举，然后执行 R0-02 固定模板隔离。

### 2026-08-22 · R0-01～R0-04 · 真实性重置与固定模板隔离

- 状态变化：R0 四票均进入 `🟢 integrated`；M0 进入 `🟢`，但不计 Golden 完成。
- 用户入口：ProductHub 不再展示“单机战役已可用”；TTRPG 工作台明确标记为内核施工台，固定战役生成入口已禁用。
- 三注册表：本批次没有新增上下文源、AI 可写字段或数据表；沿用既有注册表并通过架构/必需表检查。
- 领域合同与事件：首次新增 `ttrpg-completion-gate-v1` 证据校验；该 hash-only 合同随后已被 V2 取代，不能再用于正式晋级。
- 数据迁移/生命周期：通过内容指纹识别并拦截历史固定四场景 Campaign，无需破坏性迁移或删除用户数据。
- UI：固定编译按钮退出正式制作页；现有 fixture 即使从旧 IndexedDB 读取也不能正式发布。
- 定向测试：`R-MASTER0`、`R-TTRPG2A/B/C`、`R-GAMEPROD1F/G`、`R-ONLINE1-browser/durable`、`R-CREATORSDK1`、`R-PLATFORM1H` 共 67 条通过。
- 架构/构建：`check:architecture`、`check:required-tables`（91 表）、`check:ai-manual`、`check:roadmap`、`tsc --noEmit`、`npm run build`、`git diff --check` 通过。
- 浏览器/Golden 证据：尚未执行 R5 黄金回合或 Golden A/B/C，因此完成证明仍为空，商业状态仍关闭。
- 失败与恢复反例：正式 authoring 未显式 fixture 标志会拒绝；正式 release 未显式测试豁免会拒绝；生产执行器不再回退到固定四场景。
- 尚未完成：真正的 CampaignPack V2 生产将于 R4 恢复 TTRPG 发布路径。
- 下一票：R1-01，统一所有骰式入口为 d2～d100，并建立解析/导入/AI/runtime/UI 反例。

### 2026-08-22 · 当前快照（R0 后）

- 当前阶段：M1 / R1。
- 激活工单：R1-01。
- 工单分布：`🟢 4`、`🧱 27`、`⬜ 31`、`🟡 0`、`✅ 0`。
- 完成度：Golden `0/3`；黄金回合未通过。
- 下一动作：先建立共享骰子策略和 d101 失败测试，再修正随机算法与可验证 proof。

### 2026-08-22 · R1-01～R1-02 · d100 统一合同、公平随机与证明

- 状态变化：R1-01、R1-02 从 `🧱` 进入 `🟢 integrated`；R1-03 进入 `🟡 in-progress`。
- 用户入口：在线房间骰式输入明确显示 d2～d100，非法骰式在按钮提交前即显示错误并禁用。
- 三注册表：本批次不新增 AI 上下文、可采用字段或数据表；RulePack import/AI candidate 统一通过闭集 parser。
- 领域合同：新增 Dice Expression V2、共享 d2～d100 常量、uint32 拒绝采样、SHA-256 样本流、roll trace、seed commitment 和独立复算函数。
- 运行路径：旧模拟骰式、正式 RulePack、在线 commit-reveal 骰子、UI 全部引用同一 parser；RulePack V1 检定已改走 V2 total-vs-target resolver。
- 反例：d1、d101、101 颗骰、过大修正、伪造骰点/合计/trace/seed/proof 均拒绝；`0xffffffff` 对 d100 必须拒绝重采样而不是取模。
- 定向测试：`R-TTRPG2A`、`R-TTRPG2B`、`R-TTRPG3A`、`R-ONLINE1-verifiable-dice`、`R-ONLINE1-durable-ttrpg-adapter`、`R-SIM1-runtime-core` 相关 39 条通过。
- 类型与代码质量：`tsc --noEmit`、`git diff --check` 通过。
- 尚未完成：联机多人共同 nonce 与跨设备 proof 留在 R9；五类 resolver 已有纯领域金标和 total-vs-target 生产接入，其余四类还需进入 RulePack V2 schema/runtime/UI。
- 下一票：完成 R1-03 EffectPlan 与四类剩余 resolver 的正式规则包接入，然后施工 R1-04 行动经济。

### 2026-08-22 · 当前快照（R1 骰子底座后）

- 当前阶段：M1 / R1。
- 激活工单：R1-03。
- 工单分布：`🟢 6`、`🟡 1`、`🧱 24`、`⬜ 31`、`✅ 0`。
- 完成度：Golden `0/3`；黄金回合未通过。

### 2026-08-22 · R1-04～R1-09（规则运行账本施工）

- 状态变化：R1-04 进入 `🟢 integrated`；R1-05～R1-09 进入 `🟡 in-progress`，未因只有内核而虚报完成。
- 先攻与行动：场景开启按冻结 RulePack 的先攻骰型和属性生成逐角色 proof，稳定排序后写入事件；本地/联机投影显示先攻、主要行动、反应和自由行动预算。非当前角色可消耗 reaction，不能抢走当前回合。
- 能力账本：每个角色/行动有独立次数、资源、共享池、冷却和禁用状态；正式行动原子写入 before/after，场景 reset 进入场景事件，回放不靠描述推断。
- 物品账本：角色模板物品转成 ItemInstance；grant/remove/transfer/use/equip/attune/damage/repair 为闭集命令，正式事件复用 commandId 防重复，expectedOwnerRef 拒绝陈旧并发转移；本地与联机玩家投影按所有权隔离。
- 奖惩与事实：EffectPlan 可将资源、伤势/状态、物品、能力、成长、关系/声望、剧情 Clock 和事实作为一笔事务提交；任一效果非法则整笔不写，收据按 audience 投影。
- 村规：新增绑定 RulePack hash 的 HouseRule Overlay、可修改路径白名单、同路径冲突检测、应用后 parser/fixture/d100 复验与成功率预览；规则编辑 UI 尚未接入，因此保持黄色。
- Rank Lite：新增第一方可商业使用的 d20 规则包、D/C/B/A 快速卡、行动/反应、招牌技次数、冷却、资源、状态、物品、成长和 compendium；制作向导选择与完整发布垂直切片尚未接入，因此保持黄色。
- 定向反例：d101 村规、过期 base hash、重复 EffectPlan、EffectPlan 中途失败、反应耗尽、能力耗尽、冷却未到、物品重复 grant、陈旧 owner 转移均被拒绝。
- 定向测试：`R-TTRPG2B` 13 条、`R-TTRPG3A` 10 条、`R-TTRPG3C` 3 条、`R-TTRPG3D` 2 条及 online durable/browser/UI 回归通过；`tsc --noEmit`、`git diff --check` 通过。
- 尚未完成：五类 resolver 仍有四类未进入正式 RulePack schema/runtime；共享池、充能/耐久需进入真实发布规则；HouseRule 与 Rank Lite 需接制作向导。
- 下一票：R2-02 TtrpgProductionBrief V2，随后把规则选择、村规、席位、角色和媒资目标接入九步制作向导。

### 2026-08-22 · 当前快照（运行账本后）

- 当前阶段：M1 / R1 与 M2 前置。
- 激活工单：R2-02。
- 完成度：Golden `0/3`；尚未达到可对外宣称完成的状态。

### 2026-08-22 · R5-04～R5-07 / R6-03、R6-05 · 逐行动终态反馈与角色反应权限

- 状态变化：R5-04～R5-07、R6-03、R6-05 进入 `🟡 in-progress`。内核、正式事件、投影和 UI 已接通，但黄金回合浏览器门尚未通过，所以不标绿、不计 Golden。
- ActionContext：每个正式规则行动在提交前冻结当前场景、回合、行动者/目标、席位控制权、关键性理由、状态、ItemInstance、授予行动的物品、能力次数/冷却、任务/已知结论和在场观察者。
- ActionReceipt：与骰点/资源/状态/能力/行动经济同一事件提交唯一终态回执；模型失败、禁用或超时时仍立即显示机械结果、行动者后果、场景后果、世界 Canon 边界、失败前进和下一行动建议。
- 观察者与反应：只从当前冻结场景的 `turnOrder` 计算观察者；四层窗口覆盖机械 reaction、即时角色反应、场景后果和战役后果。不在场角色不会进入回执；真人/开放席位只能 `prompt-human`，AI 不得代演。
- 席位权威：新 CampaignPack 在角色模板冻结 `human / ai / open / gm` controller；旧发布按“玩家=真人、NPC=GM”兼容。正式生产测试证明真人+AI 玩家席位和 GM NPC 不靠描述猜测。
- GmSynthesisFrame：可信 AI KP 候选升级为机械结果、行动者反馈、逐角色反应、场景/世界更新和下一提示的闭集结构；机械摘要与世界写入边界必须原样绑定 Receipt，相关在场角色必须恰好覆盖，`prompt-human.text` 非空直接拒绝。
- 真人 KP：正式页面新增真人 KP 反馈提交；显式颠倒成功/失败的旁白在事件写入前被拒绝。确定性 fallback 同样附带结构化综合帧且零模型调用。
- Viewer/UI：玩家、KP 和安全投屏从同一 viewer projection 读取回执；页面明确显示终态、失败前进、在场相关角色、响应权限和开放反应窗口，不再等待 AI 文案才知道行动结果。
- 三注册表与生命周期：本批次没有新增表或 AI 可采用字段；AI 继续只读已登记 `ttrpgRuntime`，结构化候选仍经 durable Run/Checkpoint/作者确认，事件随现有 simulation 生命周期导出、分支和回放。
- 定向测试：`R-TTRPG2B` 13、`R-TTRPG2C` 8、`R-TTRPG2D` 4、`R-TTRPG2E` 2、`R-TTRPG3E` 4，共 31 条通过；`tsc --noEmit` 通过。反例覆盖篡改上下文、越权代演真人、AI/真人颠倒成功等级、候选陈旧、秘密泄漏和无模型 fallback。
- 尚未完成：真人回应本身还需独立命令与在线席位签名；场景/战役后果的建议到 EffectPlan 审批桥、黄金回合 E2E 仍未完成。
- 下一票：补 R7 长局记忆/成本与真实浏览器短团，再把角色回应作为独立可审计行动接入在线权威层。

### 2026-08-22 · R3-01、R3-05 / R7-01～R7-04 · 显式席位权威与隔离 AI 玩家

- 状态变化：R3-01、R3-05、R7-01～R7-04 进入 `🟡 in-progress`。数据库、运行时、Harness、协调器和本地 UI 已接通；缺席超时、长局记忆/成本、在线身份签名和浏览器短团尚未完成，因此不标绿。
- 席位单一事实源：新增登记表 `ttrpgSessionParticipants`，记录 GM/玩家席位、actor/viewer、真人/AI/hybrid/vacant controller、认领状态、四类激活策略、替补策略、AI 配置、逐项同意、revision 和幂等指纹。Session Zero 与活动席位确认同事务提交；分支复制、删除级联、导入导出和重映射均进入 `PROJECT_TABLES` 生命周期。
- 同意边界：AI/混合席位必须先披露 AI 身份；hybrid 建议必须获 `aiAdviceAllowed`；任何 AI 代打必须获 `aiSubstitutionAllowed`。Session Zero 后普通配置冻结。旧会话只能从原冻结 Release 显式重建席位，所有安全/AI/代打同意保持 false；已开团旧桌必须再次明确确认，不能从历史行为推断授权。
- 独立玩家上下文：登记 `ttrpgPlayerRuntime` 与 `prose.ttrpg-player-intent`。每次模型调用绑定一个 actor/viewer，只使用与 UI 相同的玩家 Projection，并彻底移除 `gmSecret`、`failureForward`、`gmControls` 字段；只保留本人私档、本人私密线索、队伍公开信息、本人库存和当前可用行动。
- 行动候选与结算：模型输出闭集只有 `actionKey / targetKey / approach / spokenIntent`；额外字段、隐藏目标、越界友敌目标、骰点/难度/成败/伤害预写全部拒绝。候选不写 SIM；采用后仍由冻结 RulePack 重算 d2～d100 骰点、能力次数、资源、状态和行动经济。
- 授权证据：正式 ActionResult 保存 AI/hybrid 来源、viewer、Run、candidate/context manifest hash、角色做法和本人台词；提交层回读 Instance-owned durable checkpoint。纯 AI 席位可自动采用，hybrid 必须存在精确候选哈希的真人确认事件。
- 协调器：每个 `session + sequence + actor` 只生成一个候选；崩溃恢复复用同一 checkpoint，不二次调用模型。自动循环有 1～32 硬上限，连续 AI 玩家可推进，遇到真人、hybrid 确认、空缺或 GM/NPC 立即停止；纯 AI 角色的普通手动结算按钮被禁用。
- 可用行动修正：玩家 Projection 现在同时过滤行动经济、次数耗尽、冷却、disabled reason、技能资源费和行动额外成本，AI 与 UI 不再看到实际不能执行的行动。
- 定向证据：`R-TTRPG2F-ai-player` 4 条通过，覆盖 1 真人+2 AI 信息隔离、纯 AI 自动 RulePack 结算、hybrid 真人确认、2 真人+1 AI 单纪元去重与恢复；联合 `R-TTRPG2B/2C/2F` 共 28 条通过。`tsc --noEmit`、`check:architecture`、`check:ai-manual`、`git diff --check` 通过。
- 下一票：补 AI 玩家长期角色记忆与会话成本预算，做混合短团浏览器 E2E；随后继续 R3 完整车卡/AI 车卡与 R8 动态媒资。

### 2026-08-22 · 全链实现审计 · 在线权威、长战役、AI 与玩家选择型后果

- 状态变化：R1～R7、R8-01～04、R9-01～04、R10-01～06 的代码闭包更新为 `🟢 integrated`；R5-08、R8-05、R9-05、R10-07 保持 `🟡`，没有伪造任何 `✅ golden-passed`。
- 世界与生产：正式页面从精确 `WorldRelease id/hash` 进入 TTRPG 九步 Brief；规则、村规、人数、真人/AI 控制、完整车卡、媒资目标、2～3 个战役提案、分区混合/锁定、验证、Build Preview 与原子发布已经贯通。固定四场景只保留显式 fixture。
- 战役设计：Campaign Bible、Front、Clock、秘密、线索结论、任务、失败推进、结局触发、线索可达与反例验证进入冻结 CampaignPack；同世界三创作指令的受控浏览器演练产生不同结构，不把演练写成真实供应商 Golden。
- 规则与行动：d20 SRD 5.2.1、原创 d100、Narrative 2d6、Rank Lite 和 hash 绑定村规均进入制作选择；统一骰式硬上限 d100。自然语言意图先走合法性/澄清，再由 RulePack 结算；ActionContext、ActionReceipt、观察者、真人回应窗口和 GmSynthesisFrame 保证每次关键行动有可复算反馈。
- 物品、次数与奖惩：ItemInstance、能力次数/共享池/冷却/休息重置和 EffectPlan 均进入正式事件。`pending-choice` 已从空格式升级为两阶段权威事务：KP 提议互斥选项不改状态；只有所有者真人可选，KP 只可代纯 AI 席位；确认后原子应用一个选项。待选项与收据按 actor/GM 隔离并随检查点恢复。
- AI 与长战役：本地 durable Harness 和托管房间服务均只向 AI 玩家提供单角色安全投影，只向 AI KP 提供 GM 投影；AI KP 可在当前 NPC 回合提出闭集行动候选，采用后仍由权威 RulePack 掷骰和结算，再基于已提交 ActionReceipt 主持反馈。模型不能指定骰点或机械结果。长期分场开始/结束、自动事实回顾、角色私密记忆、编组、补充包、世界演化和版本计划可恢复，十场连续性回归通过。
- 在线与媒资：权威房间覆盖邀请、身份/角色防伪、幂等/乱序、重连、主持移交、可验证骰子、私密回应、物品、休息、奖惩、AI 玩家/KP 与分场；动态场景/角色/表情/Token/物品/Handout/地图沿统一媒资管线异步生成，失败继续文字路径。
- 本批次定向证据：`R-ONLINE1-*` 14 文件 52 项通过；`R-TTRPG*` 26 文件 110 项通过；`npx tsc --noEmit` 通过。玩家选择型后果覆盖越权、非法选项、KP 代真人、隐私、原子结算和检查点恢复反例；AI KP actor 路径覆盖恶意机械结果、手工绕过、陈旧候选和混合主持确认。
- 当前完成度：严格商业证明仍为 Golden `0/3`。现有 Golden A/B/C 是受控提供方/受控身份演练，不能替代非 fixture 真实供应商、真实外部身份、多设备、商业媒资完整集和无开发者协助的新用户场次。
- 最终工程证据：完成门 V2 落地后再次运行 `npm run ci`，连续通过三注册表、架构、路线图、依赖、lint、类型、522 文件/2390 项覆盖回归、生产构建和 bundle 预算；运行时代码块为 597.6 KiB，低于 600 KiB 预算且未制造 circular chunk。此前 `PLAYWRIGHT_PORT=4187 npm run ci:e2e` 为 63/63 通过；V2 修改后又以 `PLAYWRIGHT_PORT=4189` 定向复跑 TTRPG 生产旅程 5/5，覆盖提案主路径、Golden C/A/B 受控页面演练和同一 WorldRelease 三产品差异性。
- 商业性能证据：最终代码以真实 Chromium 完成 30.3 分钟商业长跑，369 个场景/输入样本，场景 p95 174.2ms、输入 p95 9.8ms、首交互 3,956 bytes、61 个堆样本、峰值 36,663,048 bytes、长期增长 1.92%；receipt `5e02102e…7f042d3` 为 `passed` 且失败列表为空。该证据只关闭本地浏览器性能门，不替代真实供应商或外部玩家 Golden。
- 当前剩余门：只剩需要真实部署资源或真人参与的密封证明——非 fixture 真实模型/图片/音频供应商、真人 KP 完整场、真实外部身份跨设备与灾备、五名无开发者协助新用户场次。
- 完成证明已升级为 `ttrpg-completion-gate-v2`：十一项证据必须分别带原始报告、复核回执、时间、环境和场景专用明细；旧 V1 的六个 hash-only 布尔报告会被拒绝。详细取证合同见 `docs/completion/TTRPG-COMPLETION-EVIDENCE-V2.md`。当前 attestation 仍为空，严格 Golden 仍为 `0/3`。

### 2026-08-22 · 跑团专属生产层、生产媒资与 Product Build 真实运行闭环

- 来源与权限：新增跑团专属 `TtrpgProductionSourceCatalogV1 / TtrpgProductionSourceSelectionV1`。当前冻结开发来源带 `developmentOnly`，有严格 schema、hash、portable key、依赖、scope 和跨 Work 校验；未冻结来源不得确认 Brief、生成 Build、写正式媒资或调用正式生产。开发来源不得发布正式 Product Release。
- 产品生产：新增跑团专属 `ttrpgProductions / ttrpgSourceSelections / ttrpgProductionBriefs / ttrpgProductionSteps / ttrpgProductionBuilds / ttrpgProductReleases`。Brief 每次确认形成不可变 revision；Build 绑定来源、Brief、RulePack、CampaignPack 和验证 hash；步骤账本支持失败、重试、恢复和作者 Preview 确认点。
- 运行绑定：`createPlayableGameInstance()` 正式支持 `ttrpg-build` 来源，`simulationSessions.ttrpgBuildId` 与 `runtimeSourceHash` 固定 Build；错误 hash、跨 Work、Build 内容篡改均不能启动，检查点和分支继续绑定同一来源。
- 生产媒资：新增跑团专属 `ttrpgProductionMediaAssets` 版本账本，Build 原子规划场景、地图、角色立绘、表情、Token、物品、Handout 槽位。上传和 Provider 候选校验真实 MIME、精确尺寸、内容 hash、商业权利与回执；AI 只返回内存候选，作者确认后才写正式表。首个试玩实例建立后旧 Build 的生产媒资冻结，换图必须创建新 Build。
- 运行时媒资：Product Build 预制媒资通过共享 Blob 的受控 resolver/lease 进入正式跑团页面；没有预制素材时继续文字 fallback，可按 viewer 权限后台生成 session-local 媒资。生产媒资与运行时动态媒资不混写同一账本。
- 受控浏览器证据：产品自有正式页面通过三个 slice——Golden C（Rank Lite 三真人、随机先攻下 KP/NPC 和真人行动、d20 回执、动态图片、检查点与刷新恢复）、Golden A（d20 三级真人/AI 混合席位、AI 玩家/AI KP 有界推进、RulePack 结算和 AI KP 候选采用）、Golden B（d100、AI 玩家推进、GM-only 暗骰和其他角色私密目标隔离）。最终以 `PLAYWRIGHT_PORT=4265` 定向复跑 3/3 通过。这些使用冻结开发 fixture 与 mocked provider，只是上层集成证据，不升级为真实 Golden。
- 注册表与生命周期：Schema 当前为 103 表；新表进入 `PROJECT_TABLES` 的导出、导入、删除、World/Work scope、引用重映射和 Blob GC。AI 继续通过登记 Context/Harness；生成候选在作者采用前不进入正式媒资。AI 手册已由注册表重新生成并一致。
- 定向结果：全部 `R-TTRPG*` 回归 32 文件 / 130 项通过；产品媒资 5 项含开桌冻结反例；三条受控浏览器 slice 分别通过；`tsc --noEmit`、架构守卫、103 表必需表守卫、AI 手册、旧 v3 导出兼容、严格全表导出/导入/删除/Blob 生命周期通过。
- 最终工程门（2026-08-23）：第二轮 `npm run ci` 完整通过，532 文件 / 2417 项测试全绿，覆盖率 statements/lines `86.61%`、branches `73.68%`、functions `82.04%`；生产构建和 bundle 预算通过。跑团生产层拆为独立 `182.58 kB` 分包，运行核心为 `596.1 KiB raw / 158.0 KiB gzip`，低于 `600 / 180 KiB` 预算且没有 circular chunk。第一次完整复跑仅有一个共享 AVG Blob 生命周期测试因全套资源争用超时；该测试隔离复跑 `302ms` 通过，随后原样第二轮完整 CI 中 `440ms` 通过，未放宽阈值。
- 明确未完成：最终 `WorldReleaseManifestV2 → TTRPG SourceCatalog` 适配器、WorldRelease 显式升级 diff、非 fixture 正式 Product Release、真实供应商完整生产媒资、外部身份多设备和无开发者协助真人 Golden 仍未密封。`CURRENT_TTRPG_COMPLETION_ATTESTATION_V2` 继续为空，严格商业完成度保持 `0/3`。
