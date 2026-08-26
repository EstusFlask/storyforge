# StoryForge 分支整合证据台账

> 建立日期：2026-08-25<br>
> 基准：`origin/main@b9b9c62b`<br>
> 状态：执行中；删除分支前必须更新为最终覆盖证据

## 1. 目的与原则

本台账证明本次主干统一不是“保留看起来最新的分支”，而是逐项检查本地分支、远程分支、工作树、未提交改动和开放 PR 的独有内容，再通过普通提交与合并整合。

执行约束：

- 不使用强制推送、硬重置、clean 或先删除后补救。
- 未提交工作先扫描敏感信息、异常体积和生成物，再形成可恢复提交。
- 分支存在不等于有独有内容；已经成为 `origin/main` 祖先的分支只需记录覆盖证据。
- PR 冲突或 CI 失败不等于内容无效；先查明原因，再合并或把功能按现行契约移植。
- 只有当最终主干能证明覆盖独有提交或等价内容并通过验证后，才删除源分支和工作树。

## 2. 仓库现场保护

本次审计开始时共有六个工作树。除 `feat/ttrpg-game-platform` 外均为干净状态。

`feat/ttrpg-game-platform` 最初包含：

- 84 个已修改文件；
- 323 个未跟踪文件；
- 已跟踪差异约 28,199 行新增、6,922 行删除；
- 连同未跟踪文件固化后，共 407 个文件、145,931 行新增、6,922 行删除。

敏感值扫描只命中普通 URL 和 `task-cancelled` 状态字符串的模式误报，没有发现真实 API Key、私钥或 GitHub Token。未跟踪文件最大约 460 KiB，没有发现异常大文件、嵌套仓库或子模块。

全部现场内容已经以提交 `54621c2c` 固化在 `feat/ttrpg-game-platform`。提交说明明确表示这是整合前的完整保护点，并不宣告全部商业、社区或在线能力已经达到产品完成标准。该保护点通过：

- `check:architecture`；
- `check:required-tables`，107 张表；
- `check:ai-manual`；
- `tsc --noEmit`；
- `git diff --check`。

## 3. 本地分支与工作树

“主干独有 / 分支独有”使用 `git rev-list --left-right --count origin/main...<ref>` 计算。

| 分支 | 审计时 HEAD | 主干独有 | 分支独有 | 现场结论 | 处理要求 |
|---|---:|---:|---:|---|---|
| `main` | `2c9ad713` | 6 | 0 | 本地引用落后，内容已被远程主干覆盖 | 最终快进到统一主干 |
| `feat/game-production-pipeline-design` | `2c9ad713` | 6 | 0 | 无独有提交 | 记录祖先覆盖后删除 |
| `refactor/product-flow-governance` | `8dc6fa7b` | 3 | 0 | 已是 `origin/main` 祖先 | 记录祖先覆盖后删除 |
| `fix/dexie-premature-commit` | `42e97f9c` | 1 | 2 | 有独立数据库事务修复和反例测试 | 合并并修复已知文档指标门 |
| `feat/short-screenplay-comic` | `a3ded2ae` | 6 | 8 | 有短篇、剧本、漫画、媒资治理和对齐审计 | 合并，按新总纲解决产品边界冲突 |
| `refactor/world-engine-harness` | `60acab18` | 6 | 61 | 有 Phase 0A 至 Phase 5 的长篇/Harness 主体成果 | 作为核心底座优先合并，纠正世界引擎命名与回写规则偏差 |
| `feat/ttrpg-game-platform` | `54621c2c` | 6 | 1 | 一个巨大保护提交，包含上层产品、媒资、在线、社区和商业化成果 | 完整保留并合并；生产可用性与发展顺序另行审计，不虚报完成 |
| `refactor/project-document-authority` | `345aebe8` | 0 | 1 | 新项目总纲 | 当前整合分支，作为全部裁决依据 |

干净分支的基础门禁复核：

- `fix/dexie-premature-commit`：架构、82 张表、AI 手册、TypeScript 通过。
- `feat/short-screenplay-comic`：架构、90 张表、AI 手册、TypeScript 通过。
- `refactor/world-engine-harness`：架构、83 张表、AI 手册、TypeScript 通过；分支自带 Phase 5 完整验收报告，最终仍以整合后重跑为准。

## 4. 远程分支

`git ls-remote --heads origin` 确认远程只有：

| 远程分支 | HEAD | 状态 |
|---|---:|---|
| `origin/main` | `b9b9c62b` | 整合基准 |
| `origin/fix/dexie-premature-commit` | `42e97f9c` | 与 PR #75 相同，待合并 |
| `origin/readme-assets` | `3ac67dad` | 自动更新历史；相对主干的最终内容差异仅为 `storyforge-star-history.svg` |

`readme-assets` 与主干从较早提交分叉，包含 111 个重复更新同一 SVG 的自动提交；最终必须保留最新 SVG 内容和可追溯整合记录，不把“提交数量”误当成 111 项独立产品功能。

## 5. 开放 PR

### PR #75 · Dexie PrematureCommitError

- URL：<https://github.com/yuanbw2025/storyforge/pull/75>
- HEAD：`42e97f9c`，与本地及远程修复分支相同。
- GitHub 判定可合并，但 CI 为红色。
- 失败原因已经从 Actions 日志确认：`check:project-metrics` 检测到旧 `MASTER-BLUEPRINT` 实时规模数字漂移；不是修复实现或回归测试失败。
- 独有内容：批量作用域查询，避免 Dexie 事务在最终写入前变空闲；包含长对话、复杂世界集合和 167→168 事件账本导入往返反例。

结论：必须整合，并在新文档体系中移除对过时 Blueprint 实时数字的错误发布耦合。

### PR #60 · 长篇编辑与大纲改进

- URL：<https://github.com/yuanbw2025/storyforge/pull/60>
- HEAD：`e1780923`；相对现行主干为主干独有 28、PR 独有 4。
- GitHub 判定存在冲突，PR 未提供当前 CI 绿灯，也未完成三注册表等自检勾选。
- 独有功能包括：全局替换、设定查询、三层协调视图、计划与正文对账、伏笔处理、分块大纲生成、章节审查、首页字数汇总。
- 其中 42 个文件约 7,350 行新增、148 行删除；含一个应归档而非作为产品源码的 `docs/pseudocode.py`。

结论：这些能力与独立长篇产品直接相关，不能因 PR 陈旧或冲突而丢弃。整合时必须保留用户价值，同时把旧直连、旧上下文清单、旧状态写入和重复功能改到当前 Harness 与三注册表契约；无法直接沿用的原始实现进入历史归档并在等价移植清单中逐项勾销。

## 6. 计划整合顺序

1. 新项目总纲（已提交 `345aebe8`）。
2. `refactor/world-engine-harness` 的长篇/Harness 主体。
3. `fix/dexie-premature-commit` / PR #75。
4. `feat/short-screenplay-comic`。
5. PR #60 的长篇独有能力，逐冲突对齐现行契约。
6. `feat/ttrpg-game-platform` 的上层产品完整保护点。
7. `origin/readme-assets` 的最新资产。
8. 统一生成文档与项目指标，运行完整 CI/E2E，形成覆盖矩阵。

该顺序以核心长篇与数据底座优先，再叠加独立创作产品和上层产品，降低旧分支覆盖新 Harness 的风险。

## 7. 删除前的最终检查表

- [ ] 所有独有提交或等价移植内容已能从最终 `main` 追溯。
- [ ] 所有工作树干净，无未跟踪文件。
- [ ] 两个开放 PR 均已合并或以有证据的等价整合方式关闭。
- [ ] 最新星标历史 SVG 已进入主干。
- [ ] 过时文档已上传 WPS 版本化归档并回读校验。
- [ ] 完整 CI、必要 E2E、构建与架构门通过。
- [ ] `origin/main` 与本地 `main` 指向同一提交。
- [ ] 删除所有非 `main` 的本地/远程分支和多余工作树后再次确认引用列表。
