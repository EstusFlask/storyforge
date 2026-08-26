# StoryForge 已完成能力索引

> 版本：1.0.0 · 更新：2026-08-26
> 只登记可长期成立且有当前代码/检查器证据的基础能力。产品“partial”不会因旧完成卡标题而变成已完成。

## 已完成基础能力

| ID | 能力 | 当前证据 |
|---|---|---|
| BASE-DATA-01 | schema required tables 与 `PROJECT_TABLES` 同源治理 | `check:required-tables`，当前 115 张表；迁移/导入导出/删除测试 |
| BASE-REG-01 | 三注册表成为 AI 读、AI 写和表生命周期单一入口 | `src/lib/registry`、`check:architecture` |
| BASE-AI-01 | 生产模型调用机器登记与分类 | `ai-entry-registry.json`、`check:ai-entry-registry` |
| BASE-HARNESS-01 | durable run、事件、checkpoint、stale、采纳与 receipt 基础 | `src/lib/agent/run` 与对应回归套件 |
| BASE-CTX-01 | Context Gateway 渐进式目录、预选、详情/原文与检索证据 | `src/lib/context-gateway` 与 CTXG/长程规模测试 |
| B-LF-05 | 长篇原文/事实/摘要/索引和按需检索基础 | memory/retrieval/context gateway 代码与测试；不等于产品长篇已完成 |

## 本次权威重建里程碑

- `345aebe8`：建立项目总纲。
- `e2abc188`：建立分支整合证据台账。
- 所有已发现本地/远程分支及开放 PR 的独有 head 已进入整合树；最终 main 同步与分支清场以 A-GOV-01 完成状态为准。
- 清理前文档完整快照已进入 WPS 已过时版本化归档并通过哈希校验。

历史阶段、旧完成卡和评测流水可从 Git 或 WPS 归档追溯，不在本索引复制。
