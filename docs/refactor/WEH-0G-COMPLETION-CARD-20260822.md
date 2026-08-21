# WEH-0G / GATE-P0 完成卡：Harness 证据可视化与 Phase 0 总门禁

## 完成结论

`WEH-0G` 与 `GATE-P0` 已完成。分步骤模式的正式主 Agent 候选现在把“作者编辑已保存 → 上下文已冻结 → 候选已持久化 → 候选可采纳 → 终态已验证”组织为作者可见的五段证据链；逐来源显示全文、语义压缩、确定性截断或未输入，并给出字符/token 前后数量、来源哈希、内容修订、Context Manifest、Prompt、候选、采纳和终态回执。

正式错误已统一为十二类确定性故障，开发/测试环境具备标准内存故障注入点。故障注入不持久化、不暴露 UI、生产模式不可启用；候选前故障保持业务表零写入，正式写入后的回执中断可沿同一 ledger 恢复或重验。

## 交付

- `src/components/agent/HarnessEvidencePanel.tsx`
  - 世界观、故事、角色、主 Agent、大纲、角色驱动和创作规则共用同一证据面板。
  - 保留“查看本次实际输入证据”可观察契约，同时扩展五阶段生命周期和哈希链。
- `src/lib/agent/harness-evidence.ts`
  - 冻结五段作者可见生命周期及 `passed / pending / blocked / unavailable` 诚实状态。
- `src/lib/agent/run/harness-failure.ts`
  - 统一 `save / scope / context / budget / provider / parse / schema / gate / candidate / stale / adoption / terminal` 十二类故障、稳定代码、重试属性和 fingerprint。
- `src/lib/agent/dev-fault-injection.ts`
  - 覆盖保存、上下文、候选、采纳和终态九个关键前后边界，仅 `DEV / test` 有效。
- Context 与 durable 证据
  - `assembleContext()` 保存逐来源原始/实际字符数、token 数和原始哈希。
  - durable candidate 在 hash/persist 前绑定 Context Manifest hash，恢复时校验。
  - 采纳消息结构化携带 lifecycle、adoption hash 与 terminal receipt；多候选未汇合时明确保持 pending。
- 架构与文档
  - 架构检查锁定十二类故障、五阶段、字符证据、Manifest 链接、故障边界和 UI 不得暴露注入器。
  - AI Manual 与能力基线明确：exact 原文 artifact 持久化属于后续 `MEMINT-0 / Phase 1A`，Phase 0 不伪称可逐字重放。
- Phase 0 构建债务修复
  - 对照 WEH-0H 基线确认入口包超限是既有分包回归，不由 WEH-0G 引入。
  - `vite.config.ts` 改为按真实模块路径归组，`react-dom/client` 及其实现不再回灌主入口，也消除 `vendor-editor ↔ vendor-react` 循环。
  - 入口由 796.1 KiB / 241.1 KiB gzip 降至约 617.8 KiB / 184.2 KiB gzip，未放宽预算。

## 关键反例

- 保存前/后故障：前置故障不开始上下文；后置故障保留已落库作者编辑并阻断模型。
- Context 前/后故障：不产生可采纳候选；故障类别稳定为 `context`。
- candidate persist 前故障：候选和 Canon 均为零；persist 后故障：同一候选可恢复，Canon 仍为零。
- adoption write 前故障：Canon 零写入；write 后故障：只产生一次正式写入，ledger 可恢复补证。
- terminal receipt 后故障：已完成回执可恢复，重复终验幂等。
- 旧候选或旧夹具缺少新证据时显示 `unavailable`，不伪造已通过状态。
- 新证据面板初次 E2E 暴露消息正文与子面板共用容器的精确可观测性回归；修复为独立语义段落后，失败的 8 条路径定向 8/8、完整 E2E 53/53 通过。

## 验证证据

- WEH-0G 定向 UI、上下文、故障、durable/CAS/恢复测试通过。
- 完整 Vitest：447 files / 2116 tests 全部通过；覆盖率 statements/lines 83.18%、branches 73.78%、functions 81.08%。
- 十项架构/注册表/AI/路线图/上下文/Canon/指标检查、依赖审计（0 vulnerabilities）、ESLint、TypeScript、生产构建和 bundle budget 通过。
- 独立端口 4179 的 Chromium E2E：53/53 通过；包含分步骤世界引擎、角色、故事、故事线、大纲、正文、刷新恢复、采纳、多 World/Work、导入导出和真实浏览器文件系统记忆往返。
- `git diff --check` 通过。

## 诚实边界与下一步

- Phase 0 证明的是现有正式主链具备一致的契约、保存/候选屏障、结构化输出、Prompt 冻结、入口绑定、可见证据和故障恢复；不等于已经解决百万字选源。
- 当前逐来源证据有哈希与计数，但 exact Context Packet、去认证 request、raw response、压缩/截断原文 snapshot 尚未进入内容寻址存储，不能宣称历史 Run 可逐字重放。
- 下一工作单元是 `MEMINT-0`：只封住现有 Memory Settlement/Artifact Index 与 exact artifact、retention、`evidence-pruned`、compaction checkpoint + tail replay 的接缝，不重开第二套记忆工程，也不先建设 Gateway UI。
