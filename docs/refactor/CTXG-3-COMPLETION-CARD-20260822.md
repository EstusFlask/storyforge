# CTXG-3 完成卡：Canon resource descriptor 覆盖

## 完成结论

- 任务 ID：`CTXG-3`
- 基线：`93e6dbf6`
- 分支：`refactor/world-engine-harness`
- 状态：完成，允许进入 `CTXG-4`；本卡不宣称 Phase 1A 已过门。

世界、故事、角色、规划、正文与参考六类 Canon 内容已统一接入注册表派生的只读 Provider。目录表集合来自 `PROJECT_TABLES.resourceIdentity`，世界观、故事核心和角色字段来自 `FIELD_REGISTRY`；旧 `rag-library.ts` 的表清单及三组字段数组已删除。

## 实现范围

1. 扩展 `ContextResourceDescriptorV1`，分别冻结内容 revision/hash 与检索策略 revision/hash。
2. 将 descriptor kind、标签和字段投影模式并入 `PROJECT_TABLES.resourceIdentity`；启动校验会拒绝未知 kind、空标签和没有 FIELD_REGISTRY 覆盖的 registered-fields 表。
3. 新增 storage-neutral Canon Provider：
   - metadata-only `list/search` 与绑定 scope/filter/query 的稳定 cursor；
   - `index/summary/focused/full` 分层读取和显式 token 截断标记；
   - 当前 SourceRef、revision、hash、anchor 的 fail-closed 原文回查；
   - 目录、搜索、正文读取均不写数据库。
4. 增加结构化投影：story arc stage、detailed outline scene、章节派生摘要 authority、完整世界通道规则及关系/时间元数据。
5. Provider 挂入 `CONTEXT_SOURCES.ragSelection.resources`；旧资料库 UI 改为分页消费 Provider，并通过 descriptor 定点读取正文。
6. 保留旧 `custom.<field>` 与 `itemLedger::event` 选择键：Codex 自定义字段实时派生自分类 schema，物品事件回指实际源字段，没有恢复平行字段清单。
7. 增加 CTXG-3 架构守卫，阻止 Provider 写库、手写目录/字段列表、未挂载 Provider 或旧 UI 绕过 Provider。

## 关键反例

- limit=1 逐页仍能到达最后创建的角色、story arc 和 chapter；cursor 跨 kind/filter 复用、坏编码与超 limit 均拒绝。
- 空字段不生成正文资源；已验证章节摘要为 `derived-summary`，源正文 hash 不匹配时降为 `candidate`。
- 伪造/过期 SourceRef 或 anchor 无法回读；源字段变化后旧 descriptor 失效，稳定 resource key 不变。
- World、Work、WorldGroup 三层隔离；改名不换 key，删除即消失，导出导入后 key 集合一致且本地 recordId 正确重映射。
- world link 包含方向、双向性、描述、进入/离开条件、力量限制与带出规则。
- 旧 Codex 自定义字段和物品事件选择键可读取，字段级 `must-read` 策略 revision/hash 正确生效。
- 对所有 resourceIdentity 表做读取前后快照，目录、搜索、分层读取与原文回查均为零写。

## 验证记录

- 关联回归：8 files / 60 tests，全绿（CTXG-1/2/3、RAG、PROJECT_TABLES、World/Work scope 与 Flow 创建链）。
- 十项静态闸门：required tables、AI manual、AI entry registry、architecture、source reachability、roadmap、agent context、agent freshness、Canon coverage、project metrics 全绿。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，3963 modules。
- `npm run check:bundle-size`：通过；entry 640.5 KiB / 191.4 KiB gzip，未超过 700 / 230 KiB 预算。
- `git diff --check`：通过。

## 后续边界

- `CTXG-4` 才把 catalog、search、read resource、read original evidence 暴露为受策略约束的 Agent 只读工具。
- `CTXG-5` 才实现 task-kind 预选、Mandatory/Pinned 配额与充分性报告；本单元不替模型决定读取集合。
- `CTXG-6～8` 才闭合 Trace/Packet、快慢路径、缓存和性能；正式生成入口尚未切换。
