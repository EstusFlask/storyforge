# GATE-P2 完成卡：分步骤世界引擎现有领域统一 Harness 总验收

日期：2026-08-24

任务：`GATE-P2`

状态：通过；允许进入 Phase 3 `ARC-1`

## 门禁结论

`WE-1`、`STORY-1`、`CHAR-1`、`MW-1`、`CODEX-1` 已把现有世界观可生成字段、七个故事意图字段、
角色创建/补全/演化、多世界通道和 Codex 抽取/补全收口到同一套 Skill、Context Gateway、durable
候选、作者确认、CAS freshness 与 provenance 合同。组件内手写来源清单不再是这些正式入口的上下文权威；
Context Gateway 的真实 Manifest、读取证据和冻结运行记录才是权威。

本门证明的是“现有世界引擎领域统一治理主路径可用”，不提前宣称 Phase 3 的大纲到正文持续演化或
Phase 4 的百万字质量门已经通过。

## 领域签收

1. 世界观：所有 `FIELD_REGISTRY` 中声明可生成的世界观字段由注册表派生同一 controller/Gateway 合同；
   目标字段编辑会使旧候选 stale，World/Work/WorldGroup 越界 fail-closed。
2. 故事：`storyCore` 保持作者意图层，`storyArcs` 保持 1:N 可执行投影层；二者具有独立权威、revision/hash
   与 producer provenance，不会相互覆盖。
3. 角色：创建、补全和状态演化均先生成候选；刷新不重复调用模型，作者确认后才写正式角色数据。
4. 多世界：世界关系/通道使用稳定 scope 和登记生命周期；跨世界、跨作品或伪造引用不能进入候选/采纳。
5. Codex：逐字抽取与 AI 补全分属不同 Skill 和确认动作；词条保留原始来源、Run 与候选哈希。
6. 故事线空项目路径：作品名以明确标注的“低权重灵感”进入 Prompt，不被当作 Canon、主题命令或概念
   释义题；该约束由单元测试和真实浏览器 E2E 同时锁定。

## 验证证据

- Phase 2 定向合同：16 个测试文件、112 个测试通过。
- 完整 CI：473 个测试文件、2277 个测试通过；架构守卫、三注册表、AI 入口、AI 手册、TypeScript、
  coverage、生产构建与 bundle-size 全部通过；生产依赖漏洞为 0。
- 隔离 Chromium：53/53 通过，覆盖空项目、候选生成/编辑/拒绝/采纳、刷新恢复、stale、跨 scope、
  导入导出、故事线、角色、Codex 和影响修复主路径。
- 故事线 E2E 首轮 52/53，暴露 Gateway 迁移后空项目 Prompt 丢失作品名；没有降低断言，修复为低权重
  任务元数据，定向复验 1/1 后全套 53/53。
- 为避免完整 coverage 在高并发下造成事件循环饥饿，Vitest worker 上限固定为 4；没有跳过测试、增加
  timeout 或关闭任何质量检查。

## Phase 3 开工约束

Phase 3 必须按 `ARC-1 → OUTLINE-1 → DETAIL-1 → PROSE-1 → PROGRESS-1 → FUTURE-1 → GATE-P3`
推进。下游候选只能在其作者确认的上游 Canon 版本上生成；上游采纳后，旧下游候选必须 stale 或重新规划，
不能把“预期上游即将变化”当作 freshness 豁免。已写正文是不可越过的保护边界，未来演化只能提出候选，
不得反写已完成历史。
