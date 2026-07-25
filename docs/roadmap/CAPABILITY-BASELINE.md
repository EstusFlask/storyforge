# StoryForge 当前能力基线

> 本文件回答“项目现在已经有什么”。新体系或完整功能开工前读取对应体系的事实层，不是未来计划，也不是历史流水账。
>
> 事实来源优先级：当前代码与测试 > `MASTER-BLUEPRINT.md` > `docs/ROADMAP-LEGACY.md` 中的完成记录。文档声称完成但缺少代码/测试证据时，按“部分完成”处理，不得据此重新开发或宣称已交付。

## 如何使用

开始新体系或完整功能前，必须先找到对应体系并读取本节相关内容，完成以下核对：

1. 现有能力是否已经覆盖用户故事的一部分。
2. 哪些代码、注册表、表和测试应直接复用。
3. 本次只增加什么，不增加什么。
4. 哪些历史入口必须下线，哪些兼容字段必须保留。

如果本文件与代码不一致，应先开治理任务更新基线；不得直接以新代码“顺便修正文档”。

## GOV-1 架构、质量与发布治理

### 已有能力

- `CONTEXT_SOURCES` + `assembleContext()` 统一 AI 读取；当前上下文注册表已有多种 scope、预算和优先级。
- `FIELD_REGISTRY` + `ADOPTION_SCHEMA` + `adopt()` 统一 AI 结构化写回。
- `PROJECT_TABLES` 驱动表生命周期、导出/导入、级联删除、世界作用域和引用重映射。
- `check:architecture` 覆盖 UI 与 `src/lib/**` 的受治理写回、旧 context builder 和领域扩展复审；检查器带 AST 自测，避免自身假绿。
- AI Manual 用 TypeScript AST 扫描真实 Prompt 源文件，并由运行时测试独立核对 key 唯一性、模板元数据和数字预算。
- 参考分析写回已进入 `FIELD_REGISTRY`、`ADOPTION_SCHEMAS`、`adopt()`；事实账本和角色合并是显式、有复审日期的领域扩展。
- 生产依赖审计、真实运行时代码覆盖率、源码可达性、Blueprint 实时规模和 bundle budget 已进入 CI。
- UI 用 package 语义版本 + commit build SHA 标识每次生产构建；Release tag / changelog 仍由发布闸门三方校验。
- 数据迁移、导入导出、备份、删除和关键 UI 流程已有大量回归测试。
- `AGENTS.md` 是自包含短入口，`docs/CONTEXT-ROUTING.md` 按任务类型定位关联文档、源码与测试；`check:agent-context` 防止恢复长文档固定预载，并量化固定项目输入。

### 持续治理边界

- `ChapterEditor` 仍是复杂度热点；后续按保存、上下文、AI 和连续性 controller 的稳定边界继续拆，不能为降行数搬运复杂度。
- AI runner / parser / import 的覆盖已设分层防退化门槛，但低覆盖文件仍应随相关功能开发补关键路径测试。
- Playwright 商业 smoke、升级前自动快照和第三方匿名错误上报仍分别归 `AUDIT-7` / PRODUCT-1；涉及隐私或产品决策的内容不能擅自启用。
- 依赖、例外复审日期和 Blueprint 指标是持续门槛，P1 完成不代表以后可以停止维护。
- 上下文治理只减少重复和无关输入，不能用作跳过三注册表、数据生命周期、调用方扫描、专项测试或真实项目验证的理由。

### 新功能必须复用

- 新 AI 读：`src/lib/registry/context-sources.ts`、`assemble-context.ts`。
- 新 AI 写：`src/lib/registry/field-registry.ts`、`adoption-schema.ts`、`adopt.ts`。
- 新表/字段生命周期：`src/lib/registry/project-tables.ts`、`src/lib/db/schema.ts`。

## INV-1 角色物品与状态账本

### 已有能力

- `itemLedger` 以 `heldByName` + `characterId` 同时保存原文持有人与角色软引用；`adopt()` 会在名称唯一匹配时解析角色 ID，未匹配仍保留原名。
- 物品栏按 `roleWeight` 分组切换主要/次要/NPC/路人背包；全部角色视图不会合并不同角色的同名物品，状态卡逐角色投影同一账本。
- 抽取 Prompt 明确排除目标、提及、传闻、假设和无主物品，并把角色间转移拆成原持有人消耗 + 新持有人获得。
- `CONTEXT_SOURCES`、持有投影和确定性重复获得检查均支持角色归属；审校会用角色名单避免把 A 的物品误报给 B。
- v38 将 owner-less 历史流水迁到唯一 `roleWeight=main` 角色，旧库才回退 `role=protagonist`；多 main/无主角进入可认领的历史未归属区，迁移异常会整体回滚。
- 角色删除在同一事务中 NULL 化 `characterId` 并保留 `heldByName`；角色合并同时重映射 ID 与 canonical 名称；导出/导入会重映射角色 ID。
- `QUICKWIN-3` 已并入：可选全部已写章节或按规范章序选择起止章；反向/空范围在 API 调用前拦截，范围外流水不受影响。

### 禁止重复建设

- 不新建第二套物品表或第二套持有投影。
- 不在 `InventoryPanel` 内手写 AI 提取器、去重或上下文拼接。
- 不删除角色对应的物品流水；删除角色只解除硬引用并保留持有人原文。

### 代码与测试入口

- `src/lib/consistency/held-items.ts`
- `src/lib/registry/context-sources.ts`
- `src/lib/registry/adoption-schema.ts`
- `src/lib/registry/project-tables.ts`
- `src/lib/inventory/extraction-range.ts`
- `src/components/items/InventoryPanel.tsx`
- `tests/regression/R-CONSISTENCY1-held-items.test.ts`
- `tests/regression/R-QUICKWIN2-inventory-edit.test.ts`
- `tests/regression/R-QUICKWIN3-inventory-extraction-range.test.ts`
- `tests/regression/R-INV1-*.test.ts`

## CANON-1 长期一致性与 Canon

### 已有能力

- 章节规范顺序、连续性交接、章节记忆、计划对账和未来章节过滤已有实现。
- `temporalFacts`、受控谓词、当前有效事实、事实候选确认、异常状态和 human-readable IO 已有代码基础。
- `retrievalChunks`、层级叙事摘要和影响分析已有可重建路径。
- `NS-3` 一致性审查已有 Fast Guard / Deep Audit 和逐字引文回查。
- 物品重复获得与角色认知边界闭集比对是当前两类确定性判决样板。
- `knowledgeLedger` 分离世界真相与角色认知，支持获知、误认、遗忘、纠正事件；v39 迁移、三注册表、角色/章节生命周期和导出导入 FK 重映射已覆盖。
- `characterKnowledge` 按规范章序、世界与角色投影目标章开始前的 confirmed 事件，并进入正文生成上下文；事实库提供角色认知候选、确认/否决和异常复核入口。
- 一致性审校让 LLM 只从已确认 `characterId + knowledgeKey` 闭集提取正文逐字引用，再由代码比较 unknown/mistaken；确定性比对不等于抽取不会漏。
- `CONSISTENCY-3` 复用 `temporalFacts` 而不另造 Canon 表；8 个单值宪法主题和 4 类设定来源受闭集注册表约束，来源 FK 可导出导入、来源字段修改自动 stale。
- 设定抽取只接受登记 sourceKey / predicate / subject 和原文逐字 quote，永远写 candidate；普通确认对同项目、同世界、同分类型主体和同主题异值做确定性阻断，明确取代是独立作者操作且不能覆盖 locked Canon。
- `canonAssertions` 只回注 confirmed 且来源仍有效的宪法，正文、设定、大纲和一致性审校共用；事实库“世界宪法”视图提供扫描、确认、否决、冲突与来源异常出口。
- `CONSISTENCY-0` 已把 6 个 `R-CANON-*` 反例落入 `tests/canon/`；6 个活动测试由 `check:canon-coverage` 与覆盖地图双向对齐，当前无显式 todo。
- 角色存亡以 `temporalFacts.aliveStatus` 为唯一硬事实源：枚举写前归一，confirmed 与时点仍有效的 superseded 历史 Canon 按规范章序投影；审校只接受已死亡角色闭集中的正常活动逐字引用，再由代码硬比对。
- Phase 39 复用 `StoryArc/StoryStage` 静态注册表，v40 动态层保存每线最新作者确认进度和跨线交汇；模型只能对 arc/stage/status 闭集与正文逐字证据提出候选，新线必须由作者明确创建。
- 故事线仪表盘支持选择已写章节映射、逐条采纳、当前阶段/状态与交汇节点展示；确认结果按规范章序进入正文、大纲和一致性审校，未来进度不会泄漏给前章。
- 项目/章节/阶段/故事线删除及 JSON 往返均有明确生命周期：删章保留说明和冗余章名、断 FK；删阶段清悬空指针；删线事务级联动态行；Arc/Chapter 外键导入重映射。

### 当前边界 / 尚未完成

- 世界宪法硬保证只覆盖已登记、已抽取、来源有效且已确认的单值主题；未登记散文、抽取遗漏和复杂条件规则仍属于软审计范围。
- 存亡硬保证只覆盖目标章开始前已确认死亡与正文中的闭集正常活动引用；同章内先死后动、倒叙、附身、借尸和未明确登记的复活仍属于软审计。
- 一致性覆盖地图和 `tests/canon/` 是跨功能的声明基线，`tests/regression/` 继续覆盖具体实现细节；新增 Canon 声明必须先加地图行和可证伪反例，不用删除 `todo` 制造假绿。
- 角色变化影响传播与局部重规划尚未形成统一产品出口；故事线动态进度与交汇已完成。
- 内联编辑器提示尚未把确定性 finding 映射到编辑器装饰层。

### 禁止重复建设

- 不把向量召回或 LLM 软审当作 Canon 判决器。
- 不为 Phase 38、Phase 39、Agent 各建一套事实库。
- 不在生成后自动改正文；所有软结果都要经过作者确认。

### 代码与测试入口

- `src/lib/consistency/`
- `src/lib/fact-ledger/`
- `src/lib/knowledge-ledger/`
- `src/lib/storyline/`
- `src/lib/fact-ledger/setting-assertions.ts`
- `src/lib/registry/canon-assertion-source-registry.ts`
- `src/lib/retrieval/`
- `src/lib/registry/assemble-context.ts`
- `tests/regression/R-NS3-consistency-audit.test.ts`
- `tests/regression/R-NS4-current-facts.test.ts`
- `tests/regression/R-NS5-retrieval.test.ts`
- `tests/regression/R-NS6-impact.test.ts`
- `tests/regression/R-CONSISTENCY3-world-constitution.test.ts`
- `tests/regression/R-CONSISTENCY2-*`
- `tests/canon/R-CANON-*`
- `tests/canon/storyline-progress.test.ts`
- `scripts/check-canon-coverage.mjs`

## PIPE-1 透明生成与质量工作坊

### 已有能力

- `GenerationNode`、输入快照和安全默认不采纳的 `runGenerationNode` 已成为统一运行时薄层。
- 卷纲/章纲四类请求及正文生成/续写支持默认关闭的最终提示词预览与一次性编辑。
- 当前章节页已有五阶段章纲工坊；中间产物瞬态、顺序不可跳、可重做并比较最近版本。
- 工坊质量节点与最终采纳前复用持有物、认知账本和世界宪法闭集 gate；反套路审查保持 advisory。
- 场景卡与不可写清单经 `adopt()` 写入细纲，并由 `detailedOutline` 上下文回注正文。
- 既有 PromptWorkflow step 已适配同一节点接口；模型路由、上下文装配和作者确认写回语义保持不变。

### 当前边界 / 尚未完成

- `AgentRunner` 尚不存在；动态对话/多 Agent 编排归 `AGENT-1`，不得在 PIPE-1 伪造空壳。
- 闭集引用由模型抽取，代码可拒绝伪造 ID/引文和已声明冲突，但不能证明模型没有漏报未声明的语义。
- 工坊历史只保留当前会话最近版本；若未来要求跨会话持久化，必须先登记新表、迁移和导入导出，不得偷写 localStorage。

### 代码与设计入口

- `src/lib/ai/`
- `src/lib/generation/`
- `src/lib/outline/workshop.ts`
- `src/lib/registry/assemble-context.ts`
- `src/components/outline/ChapterOutlineWorkshop.tsx`
- `src/components/settings/prompt/WorkflowRunner.tsx`
- `docs/TRANSPARENT-GENERATION-PIPELINE.md`

## WORLD-1 世界知识、词条、地图与修炼

### 已有能力

- Codex 分类 schema 项目级共享、词条严格按世界隔离；手动新增、AI 拆分、编辑器提示、
  ref 选择和 AI 上下文使用同一作用域判定。删词条/世界会清理 JSON 引用和角色种族 FK。
- 世界规则、多世界、历史年表、重要地点、地图和角色设计已有产品能力。
- Phase 36 已为上游设定、正文、下游产物和系统入口建立内容类型标记。
- Phase 37-a 已交付：DB v41 `cultivationSystems`、多套体系、境界 DAG 分叉/合流编辑、
  角色种族/主修/当前设定境界、异兽体系/境界关联、世界宪法来源、AI 上下文以及
  项目/世界/删除/迁移/导出导入生命周期。
- Phase 34 已交付：DB v42 `cultivationProgress`、正文唯一逐字证据与闭集映射、作者
  逐条确认、规范章序/DAG 投影、角色历程视图、默认关闭的后续写作回注，以及章节、
  角色、体系、阶段和导出导入生命周期。角色卡设定境界与正文确认进度严格分层。
- Phase 35-b 已交付：政治/经济/文化三份概述与三类 Codex 独立维护；正式历史成为
  唯一主入口，DB v43 对旧历史做空目标无损桥接；城池词条通过可移植软 FK 关联地点，
  删除地点子树只断引用不删词条。旧历史、`humEra/humEvent`、`humSociety` 和合并字段
  都保留在兼容区，不自动猜测重分类。
- Phase 35-c 已交付：外部文档分块解析会生成带本块逐字证据的 Codex 候选，使用稳定
  分类引用而非数据库 ID；未知分类、非法字段和伪造证据在本地拒绝。候选跨块归并后
  必须由作者逐条选择、改名或改分类，再通过 `adopt()` 写回；同名词条只补空内容，
  多世界严格使用导入目标世界。
- ENH-WORLDMAP-2 已交付：地图 AI 从当前世界观、Codex 和重要地点抽取带证据的命名
  实体、规模、八向方位与距离，本地闭集校验后由确定性求解器计算坐标；命名城市落实
  到适宜陆地，国家规模影响扩张，聚落规模影响人口和渲染，河流只匹配现有物理水道。
- 地图比例尺公开手动、用户疆域、显式距离或估算来源；显式日程/月程明确标为旅行估算，
  矛盾空间关系保留残差提示，手动比例尺按世界持久化。

### 当前边界 / 尚未完成

- 旧自由文本不会后台自动语义拆成实体；作者主动走文档解析并确认后才进入结构化分类。
- 定性约束不承诺重画精确国界或强制河流逐点穿过地名；无明确尺寸/距离时绝对公里数仍
  是系统估算。

### 代码与设计入口

- `src/components/codex/CodexPanel.tsx`
- `src/components/worldview/CultivationSystemsPanel.tsx`
- `src/lib/types/cultivation.ts`
- `src/lib/ai/cultivation-context.ts`
- `src/lib/cultivation/progress.ts`
- `src/components/cultivation/CultivationProgressPanel.tsx`
- `src/lib/registry/project-tables.ts`
- `docs/CULTIVATION-PROGRESS-DESIGN.md`
- `docs/CODEX-IMPORT-CLASSIFICATION-DESIGN.md`
- `docs/CODEX-REDESIGN.md`
- `docs/WORLD-RULES-MULTIWORLD-DESIGN.md`
- `docs/WORLD-MAP-SPATIAL-CONSTRAINTS-DESIGN.md`

## STORY-1 角色驱动与动态故事规划

### 已有能力

- 角色双轴（戏份、道德/秩序）模型、角色关系、StoryArc 和大纲主线约束已有基础。
- CF-9C 已把临时角色驱动面板升级为项目级持久化工作区：方案保存弧光角色快照、作者要求、生成卷章、状态和版本链。
- 工作台支持新建、打开、复制为新版、重命名、删除、生成结果回填和显式“设为当前参考”；刷新不丢输入与结果。
- `characterDrivenPlan` 只读取 `projects.activeCharacterDrivenPlanId` 指向的同项目方案；普通卷纲、章纲、细纲、场景与正文生成均显式接入，没有 active 时不注入。
- 角色改名时使用当前名并提示方案快照名；角色删除时软 ID 置空、文本快照保留，方案不级联删除。
- DB v44、`PROJECT_TABLES`、必需表、项目删除、便携导出导入均已收口；active、父版本和弧光角色引用会在导入后重映射。
- 勾选生成卷后只经统一 `adopt(target=outlineNodes)` 写入卷/章，并保留 `【角色弧光推进】`；重复采纳幂等。
- CF-12 在同一入口提供“开书规划 / 中途重规划”：规范章序和真实正文划分已写保护、近期过渡和未写规划区，保护值不能低于最后已写章。
- 影响分析复用 active 方案、角色、Canon、故事线、现有大纲和章节连续性等登记上下文；章节记忆不足时明确降级为有限证据分析。
- AI 必须给轻量、中度、深度三档方案；本地拒绝未知/重复节点、正文或保护区 patch 和锚点改名，作者可逐项预览后确认。
- 应用前重读项目并拒绝过期预览；合法 patch 只经 `adopt(target=outlineNodes)` 写未来标题/摘要，空 Chapter 仅同步标题，正文和主线不写。

### 当前边界 / 尚未完成

- 当前方案激活和 CF-12 都不会自动修改 `storyCore.mainPlot` 或既有正文；主线影响只生成只读建议，这是刻意的数据安全边界。
- 第一版不保存独立修订计划历史，也不自动补写受影响正文；需要持久化修订审计或安全批量改稿时统一归 AUTHOR-1。
- 证据质量受章节记忆和已确认 Canon 覆盖影响；缺失时界面会警告，不把大纲推断冒充正文事实。

### 代码与测试入口

- `src/stores/character-driven-plan.ts`
- `src/lib/types/character-driven-plan.ts`
- `src/lib/story-planning/character-driven-adoption.ts`
- `src/components/outline/CharacterDrivenPlotPanel.tsx`
- `src/components/outline/CharacterRevisionPanel.tsx`
- `src/lib/story-planning/character-revision.ts`
- `tests/regression/R-CF9C-*.test.ts`
- `tests/regression/R-CF12-character-revision.test.ts`
- `docs/CHARACTER-DRIVEN-WORKSPACE-DESIGN.md`
- `docs/CHARACTER-REVISION-WORKFLOW-DESIGN.md`

## AUTHOR-1 / IDEA-1 长篇编辑、风格与灵感

### 已有能力

- 富文本编辑、自动保存、对照润色、全文查找替换、实体补全和悬浮档案已存在。
- `EDITOR-5` 已提供角色、重要地点和词条的智能全书改名：名称冲突预检、canonical 富文本正文替换、稳定 FK 冗余名同步、项目快照、单事务提交和会话原子撤销。
- 物品因缺少独立稳定实体 ID 不进入智能改名；自由文本和历史快照只列入人工复核，避免语义误改。
- 文风学习已支持章节画像、有界改前/改后 few-shot、作者样本说明、互动校准反馈和显式样本采纳；下游统一由 `userStyleProfile` 读取画像及最多三组短样本。
- 画像学习最多读取 6 章、每章 2500 字符；样本最多保存 8 组且只截取变化附近，未经作者确认的 AI 校准稿不会自动学习。
- 参考作品导入/分块/分析、灵感反推和草稿持久化已存在。

### 当前边界 / 尚未完成

- 原稿风格续写、个人向量写作知识库和多次灵感融合尚未交付；FB-4 必须另行解决剧情记忆、版权/授权和长文本成本，不得整本回灌。
- 参考分析的写回旁路必须先由 GOV-1 收口，不能直接扩展。

## AGENT-1 / SIM-1 / PRODUCT-1 / PLATFORM-1

### 已有能力

- 当前 AI 主要是用户触发的单轮生成、流式输出、确认和采纳；已有模型路由和部分 Agent/工具基础。
- 应用是纯前端、本地 IndexedDB、可导出/导入和多种备份恢复路径。
- Phase 27.2a 场景考证按钮已存在；多世界、角色、地点、状态和故事线数据可作为未来运行时底座。

### 当前边界 / 尚未完成

- ChatCopilot、多 Agent 团队、后台 Agent 和 NPC 自动演进仍未形成正式产品闭环。
- 协同编辑、账号、云同步、发布发现和社区治理不属于当前纯前端架构的增量功能，必须另立 PLATFORM 架构阶段。
- 新手转化、加密云备份、帮助系统、国际化和开源信任仍需独立治理/产品组合。

## 新开发前的最小核对清单

- [ ] 已读本文件中对应体系的“已有能力 / 当前边界 / 禁止重复建设”。
- [ ] 已在 `docs/roadmap/README.md` 当前入口登记唯一主归属和非范围。
- [ ] 已定位 `CONTEXT_SOURCES`、`FIELD_REGISTRY`、`ADOPTION_SCHEMA`、`PROJECT_TABLES` 影响。
- [ ] 已搜索 `tests/` 中相关回归、迁移、导入导出和浏览器测试。
- [ ] 已确认是否取代旧入口，是否保留兼容字段。
- [ ] 已写清本次增量不会重新实现哪些已有能力。
