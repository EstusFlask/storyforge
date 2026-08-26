# Phase 5 最终验收报告：分步骤世界引擎 Harness

日期：2026-08-25

状态：PRE-0～Phase 5 施工完成；分支可提交作者审查，尚未合并或部署

## 一、最终结论

本轮不是再造一套 Harness，而是把分步骤世界引擎原有功能收口到统一治理闭环。当前世界观、故事核心、
角色、多世界、Codex、主/支线、卷纲、章纲、细纲、正文、章后演化和只向未来的持续规划，已经具备以下
共同性质：

1. AI 读取由 `CONTEXT_SOURCES + Context Gateway + Agent Skill binding` 决定；组件不再拥有正式来源真相。
2. AI 输出先成为 durable CreativeArtifact/候选；刷新可恢复，作者确认前 Canon 零写入。
3. 采纳只经 `FIELD_REGISTRY + AdoptionSchema + adopt()`；基线变化以 CAS / ContextManifest freshness
   fail-closed。
4. 表的导出、导入、删除、迁移、World/Work/WorldGroup 作用域和引用重映射继续由 `PROJECT_TABLES` 派生。
5. 正文采纳后的演化先失效可重建派生数据，再按作者策略建议或执行；不会隐藏调用或自动重写历史。
6. 长篇上下文不是固定取前 N 条，而是先展示有界资源目录，再按任务读取精确原文、层级摘要、检索块与
   一致性档案；原始 Canon 仍是最终核查依据。

因此，项目已经具备“在理论工程上按章持续推进到百万字符规模”的基础。这里的“具备基础”指有界上下文、
远中近证据召回、作用域隔离、候选 freshness、恢复和写后演化链成立；不表示任意模型都能自动写出百万字
高质量作品，也不表示系统已经没有 Bug。

## 二、最终架构

```text
作者目标 / 当前编辑
        │
        ▼
Agent Skill
  - 任务、操作、读权限、写目标、预算、输出协议
        │
        ▼
Context Gateway
  - CONTEXT_SOURCES 目录
  - metadata 搜索 / original 按需读取
  - World / Work / WorldGroup / Chapter / Character scope
  - Context Packet + Manifest V3 + exact artifacts
        │
        ▼
Formal AI Entry + durable Run
  - 模型前 preflight
  - 调用、用量、错误和恢复证据
  - 无隐藏重试、无静默切换 provider
        │
        ▼
可编辑候选
  - 刷新恢复
  - 前后版本（扩写/润色）
  - stale / scope / protocol / hash 门
        │ 作者确认
        ▼
adopt() + 终态 verifier
        │
        ├── Canon 写入
        ├── 可重建派生数据失效
        └── 受控章后/未来演化
```

“用户输入作为 Skill 内容”不是把每个世界观字段复制成一份文本 `SKILL.md`。Skill 保存任务合同和允许访问
的资源类别，Context Gateway 把用户已经填写或采纳的 Canon 暴露为可寻址目录；Agent 先看目录，再按需读取
原文。这实现了类似 Skill 渐进披露的效果，同时避免把用户事实复制成第四个权威数据源。

## 三、施工进程与签收状态

| 阶段 | 主要工作 | 状态 | 核心证据 |
|---|---|---:|---|
| PRE-0 | 冻结范围、失败语义、基线与回滚边界 | 完成 | 开工卡、独立分支、三注册表检查 |
| Phase 0 / WEH-0A～0H | durable Run、候选草稿、恢复、结构化输出、Prompt、可观测性、正式 AI 入口 | 完成 | 各单元完成卡与架构门 |
| MEMINT-0 | Harness exact evidence 接入既有 Memory Settlement / Artifact Index / compaction replay | 完成 | `MEMINT-0-COMPLETION-CARD` |
| Phase 1A / CTXG-1～8 | 资源身份、Provider、只读工具、selector、Manifest V3、缓存与长文检索 | 完成 | `GATE-P1A`；shadow read 零副作用 |
| Phase 1B / RACE-1～6 | “种族与民族”真实金切片 | 完成 | V21 100/100；跨 provider 独立盲评；`GATE-P1B` |
| Phase 2 | 世界观、故事、角色、多世界、Codex 统一治理 | 完成 | `GATE-P2`；16 files / 112 tests 阶段证据 |
| Phase 3 / ARC-1 | 主线/支线创建、扩写、重写、润色、重规划 | 完成 | 稳定 stageId、progress/crossing freshness |
| Phase 3 / OUTLINE-1 | 卷纲/章纲统一 Gateway 与 durable adoption | 完成 | 单章/批量正式入口与 exact evidence |
| Phase 3 / DETAIL-1 | 单章/批量细纲、稳定 sceneId merge、已写正文保护 | 完成 | 蓝图真实注入、无手写来源清单 |
| Phase 3 / PROSE-1 | 正文唯一 Gateway、POV 知识边界、长尾回查、exact adoption | 完成 | 章纲/细纲/进度/蓝图/事实/档案必读闭包 |
| Phase 3 / PROGRESS-1 | 七域章后候选、预算授权、派生数据失效 | 完成 | 默认 suggest、无隐藏调用、Run lineage |
| Phase 3 / FUTURE-1 | 只向未来的故事线/角色/章纲/细纲/正文循环 | 完成 | 已写历史不可被普通演化改写 |
| GATE-P3 | 隔离作品真实 API 从 StoryCore 到章后对账 | 完成 | 真实 DeepSeek 整链、刷新/stale/采纳证据 |
| Phase 4 | 10 万、30 万、100 万字符工程规模门 | 完成 | 三档有界检索、远距事实/伏笔、错世界/未来隔离 |
| Phase 5 | 全量 CI、全量 Chromium E2E、真实配置恢复、报告与回滚说明 | 完成 | CI 479/2310；E2E 53/53 |

## 四、现有功能的真实可用状态

| 领域 | 当前能力 | 仍需诚实保留的边界 |
|---|---|---|
| 世界观 | `FIELD_REGISTRY` 中现有可生成字段统一支持创建/扩写/重写/润色、补充说明、候选恢复、采纳与 stale | 只有 `races` 做过 sealed 真实质量矩阵；其它字段已过合同/E2E，不等于逐字段大样本文学评测 |
| 故事核心 | 七字段作者意图层，作品名只作低权重灵感，空项目可自由创作 | 标题低权重是 Prompt/评测约束，不是数学上固定百分比权重 |
| 角色 | 创建、补全、状态演化、关系与知识边界受治理 | 自动持续加入新角色仍必须在未来循环中成为候选并由作者确认 |
| 多世界 | World/Work/WorldGroup 隔离，世界关系/通道有稳定生命周期 | 更复杂的跨世界叙事规则与体验设计仍可在现有通道模型上增量发展 |
| Codex | 逐字抽取与 AI 补全分离，保留来源与 Run provenance | 短正文无法抽取足够词条时只生成候选，不应自动编造为 Canon |
| 主线/支线 | 已有正式 `StoryArc.type = main | sub` 功能；支持阶段、事件、交汇、进度和持续变换 | 一次生成数量有界；后续新线随故事推进增量产生，不追求一次规划完全部长篇 |
| 卷纲/章纲 | 单章、整卷与批量生成受统一 Gateway/Run/采纳治理 | 生成质量仍受模型、作者意图清晰度与现有 Canon 质量影响 |
| 细纲 | 单章/批量场景拆分，稳定 sceneId retain/modify/delete/add，已有正文保护 | 已写正文后的结构性改稿应走独立影响分析/改稿流程，不借普通细纲覆盖历史 |
| 正文 | 生成/续写必读当前章纲、细纲、进度、连续性、POV 知识、事实、蓝图和一致性档案 | 扩写/润色提供前后版本，不替作者做事实级文学裁决；重写直接给新版 |
| 章后演化 | 状态、事实、物品、年表、关系、伏笔、故事线七域候选；摘要与计划对账 | 零证据域允许输出 0 条；Canon 仍需作者确认，不能为了“完整”自动补齐 |
| 持续演化 | 故事线/角色 → 未来章纲 → 细纲 → 正文 → 章后结算循环 | 世界引擎上层产品只消费冻结 release；试玩反馈要重新进入作者目标循环 |
| 长篇记忆 | Canon 原文、目录、层级摘要、检索块、角色知识、事实与 dossier 渐进披露 | 隐含意象、双关或作者未结构化伏笔不能保证自动识别，必要时仍需作者明确登记或核查原文 |

## 五、百万字符能力的判定

Phase 4 在隔离夹具中分别建立约 10 万、30 万和 100 万字符作品，对下一章正文装配要求同时召回：

- 第一章的远距硬事实；
- 全书中段伏笔；
- 最近一章正文尾部；
- 当前视角角色知识；
- 激活叙事蓝图；
- 目标章细纲；
- 零未来泄漏与零其它世界泄漏；
- Context Packet 不超过 64K 检索 tokens；
- 目录检索零模型调用、零额外工具轮次。

三档全部通过。本机定向基线最初约为 0.71s / 1.30s / 5.23s；最终 coverage 环境受插桩影响，百万档
约 10s，仍通过冻结门。由此可以说“架构在理论工程上能够支撑百万字符长篇按章创作”，不能说“已经证明
百万字文学一致性或商业成书质量”。

历史 H4 sealed held-out 的 `FAIL` 必须继续保留，不能因为新的工程规模门通过而改写。H4 测的是当时冻结
模型/协议下的生成质量；Phase 4 测的是有界检索、证据可达性、隔离和验签，二者不是同一个结论。

## 六、这次为何不需要再做整体重构

原有三注册表核心架构仍然有效，并且是本轮避免再次分叉的基础。需要修的不是“数据库推倒重来”，而是曾经
在组件、Copilot 或批量 runner 中存在的旁路和不完整迁移：

- Skill 声明 `activeNarrativeBlueprint`，旧细纲编辑器却维护手写来源列表并遗漏它；
- 主 Agent 与页面入口曾各自装配上下文；
- 批量细纲曾保留旧 resolver 和无条件追加语义；
- freshness 重放曾丢失 chapter/character scope 轴；
- 正文 hash 与编辑器规范化曾使用两套规则。

这些都不是“正常 Harness 流程”，而是重构尚未完全收口时留下的双轨。现在 DETAIL/PROSE/OUTLINE 和主
Agent 均由共享 Gateway/Skill binding 派生，架构检查会在 CI 中阻止手写来源清单、页面层装配和第二套正文
规范化重新出现。后续新功能应在现有合同上增量扩展，不需要重新设计第四注册表或另一套记忆中心。

## 七、质量与风险评价

### 已达到的工程质量

- 三注册表和 83 张表生命周期门通过；没有新增旁路表或平行权威源。
- 34 个 AI binding、37 个调用位置受登记检查；正式、辅助、评测和实验边界可区分。
- durable 候选、exact artifacts、Run/step/attempt、hash、terminal receipt 和恢复路径统一。
- 跨 Project/Work/WorldGroup/Chapter/Character 的正反作用域测试齐全。
- 全量 CI 与 Chromium E2E 均在最终代码上通过，生产依赖审计为 0 漏洞。

### 不能承诺的事情

1. 不能承诺“没有 Bug”；本次真实链正是靠运行暴露并修复了测试未先发现的空行 hash 问题。
2. 不能用一章真实正文证明长期文学质量、人物成长自然度或百万字无事实遗失。
3. 不能保证免费 provider 每次都可用；本轮 Agnes 超时、NVIDIA 代理悬挂，说明 provider 健康与代码正确
   必须分开监控。
4. 不能把模型估算费用当作账单；费用显示是授权边界，真实计费以 provider 为准。
5. 不能让上层跑团、聊天或文字游戏直接反写世界 Canon；反馈必须回到作者目标和候选确认循环。

## 八、后续迭代路径

Phase 5 后不再以“大重构”为默认动作。后续优先级建议是：

1. 建立持续真实作者研究：以 10 万、30 万、100 万字符作品记录事实召回、作者修改量、stale 次数、
   每章成本和连续性缺陷，而不是只测单次模型分数。
2. 为世界观其它高频字段建立类似 races 的小规模 sealed 质量门，优先从真实社区反馈最多的字段开始；
   不必机械地为每个字段复制 100 例。
3. 增加 provider 健康与路由可见性：区分连接成功、长输出成功、额度、限流、代理悬挂和模型协议失败；
   仍禁止隐藏切换收费模型。
4. 改进上下文目录的作者可见解释：展示本次为什么读取、为什么省略、何时回查原文，以及哪些伏笔需要作者
   显式固定为强制证据。
5. 在世界引擎上继续做跑团、角色聊天、文字游戏/AVG 的 release 消费与反馈回流；产品演化只新增未来内容，
   不绕过 Canon 和作者确认。
6. 商业化工作继续后置。先积累稳定创作数据、作者留存和长篇完成率，再讨论云同步、协作、付费路由与运营。

## 九、最终验证与交付状态

- 最终 `npm run ci`：479 files / 2,310 tests，退出码 0。
- 覆盖率：83.30% statements/lines、73.97% branches、80.66% functions。
- 最终 `PLAYWRIGHT_PORT=4298 npm run ci:e2e`：53/53，约 5.4 分钟。
- `git diff --check`、架构、必需表、AI 手册、TypeScript、生产构建、bundle gate 全部通过。
- 真实 API 完成卡：`docs/refactor/GATE-P3-COMPLETION-CARD-20260825.md`。
- 百万字符工程门：`docs/refactor/PHASE4-LONG-FORM-SCALE-GATE-COMPLETION-20260824.md`。
- 当前工作分支：`refactor/world-engine-harness`；没有合并、push 或部署 `main`。
- 隔离真实验收项目 ID 363 保留，等待作者明确授权后再删除。
