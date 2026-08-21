# RACE-2 完成卡：四模式与有限长度合同

日期：2026-08-22  
施工单元：RACE-2  
状态：完成

## 已实现

- 目标字段为空时自动冻结为 `create`；有原文时分别冻结作者选择的 `expand`、`rewrite`、`polish`。
- 四种模式进入候选 payload，刷新恢复后仍可识别本轮真实操作，不依赖按钮当前状态猜测。
- 默认输出兼容值统一为 `6,000` tokens；不再在领域调用点散落多个默认值。
- 每次运行生成 `WorldviewFieldOutputBudgetV1`：区分默认/作者自定义，并冻结模型 cap、作者配置 cap、字段 schema cap、Skill cap、effective cap 和实际请求值。
- 全局配置中的“不限”只解析为当前模型的有限输出上限；Run 中不保存 Infinity、0 或“不限”字符串。
- 作者自定义长度超过 effective cap 时，在模型调用前明确拒绝，并说明普通链路尚未开放 LONGOUT；不截断、不自动降长、不暗中追加调用。
- provider 返回 `finish_reason=length` 时，即使返回文本碰巧可解析，也会按“不完整候选”失败，不进入待采纳状态。
- UI 明确区分“默认”和“作者自定义”，显示当前单次上限、LONGOUT 未启用及不会静默截断/多调用的说明。
- 作者补充说明、Prompt 参数/覆盖和自定义 maxTokens 仍经既有 Prompt Run 冻结链进入 durable Run。

## 当前产品边界

本阶段没有启用 LONGOUT-1 父子 Run。超过单次 effective cap 的请求只能明确拒绝。该选择满足“不伪装成功”的门槛，也避免把未经恢复/幂等设计的分段生成藏进普通字段 runner。

## 验证

- `R-RACE2-races-mode-length-contract`：5 项
  - 四模式边界；
  - default/custom 与四类 cap 派生；
  - prepare 冻结模式、补充说明和输出值；
  - UI 合同；
  - `finish_reason=length` 失败关闭。
- `R-RACE1-races-gateway-canary`
- `R-HARNESS32-worldview-field-agent`
- TypeScript `--noEmit`
