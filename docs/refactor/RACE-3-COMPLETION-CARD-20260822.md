# RACE-3 完成卡：世界观候选双版本审阅

日期：2026-08-22  
施工单元：RACE-3  
状态：完成

## 已实现

- 世界观候选编辑器只显示/编辑 artifact 的 `value`，不再把 `field/value` JSON 外壳暴露给普通作者。
- 编辑时由组件重建严格候选 artifact，并保留 `temporaryAssumptions`；结构治理仍由 Harness 持有。
- `expand`、`polish` 默认显示原文（只读）与新版（可编辑）双栏；窄屏自动上下堆叠。
- 双栏支持比例同步滚动；可切换“只看变化”或完整块列表。
- `rewrite` 以新版编辑器为主，原文保留在折叠区，不运行没有产品价值的强制差异对照。
- `create` 只展示新候选，不伪造不存在的原文。
- 刷新后从 durable candidate 的 `baseSnapshot.values[field]` 和候选正文重建两版；对照结果不落库、不影响候选 hash。
- 临时假设单独显示，并明确说明不会随正文自动进入 Canon。
- 神明对象字段同样只编辑 `value` 对象；旧的无法解析候选保留带错误说明的兼容修复入口。

## 对照算法边界

`worldview-text-block-compare-v1` 先按段落/标题和规范化文本做稳定顺序匹配，再用保守的中英文 token shingle 相似度标记：

- `unchanged`：规范化文本块一致；
- `possibly-rewritten`：同标题或相似度达到保守门槛；
- `removed`：原块未在候选中对齐；
- `added`：候选新增块。

界面明确声明这只是结构/相似度提示，不是事实验证器，也不会把“相似”宣传成“事实已保留”。

## 验证

- `R-RACE3-worldview-candidate-review`：3 项
  - 四种块状态与确定性重放；
  - value-only 编辑、原文、临时假设和非事实声明；
  - rewrite/create 模式边界。
- `R-HARNESS32-worldview-panels-ui`：现有世界观三面板刷新恢复与手工编辑回归。
- TypeScript `--noEmit`。
