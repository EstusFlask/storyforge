# StoryForge TTRPG Creator SDK v1

> 状态：已实现的 headless 数据包边界。入口：`src/lib/ttrpg/creator-sdk.ts`，公开聚合入口：
> `src/lib/game-platform/headless-platform.ts#ttrpgCreatorSdk`。

## 1. 安全模型

v1 只接受 `RulePack` 或同时包含 `RulePack + CampaignPack` 的纯数据包。`permissions` 必须严格为空；JavaScript、
网络、模型、主机文件、浏览器存储和动态 UI 扩展均不属于合同。运行时只解释封闭枚举和规则表达式，因此 v1 的“隔离”
不是在页面里执行不可信脚本，而是从合同上禁止任何可执行内容进入安装包。

每个包都必须：

1. 通过 RulePack strict parser、fixture runner 和 CampaignPack strict parser；
2. 声明唯一包 ID、SemVer、运行协议 1、发布者公钥和规则许可；
3. 计算 payload SHA-256，并由发布者 ECDSA P-256 私钥签名；
4. 不携带私钥材料；单包规范化数据不得超过 16 MiB；
5. 在安装前通过 StoryForge 固定可信根签发的有效 trust manifest。

## 2. 密钥、可信清单与撤销

发布者私钥只存在于发布者自己的签名工具或受控密钥服务中。发布包只携带公钥。StoryForge 信任根签发
`storyforge.creator-trust-manifest@1`，其中冻结：

- 单调递增 `sequence`、`issuedAt`、短期 `expiresAt`；
- 当前允许的发布者 key ID；
- 按生效时间撤销的发布者 key；
- 可精确到 package ID、SemVer 和 payload hash 的包级撤销；
- 清单 hash、信任根公钥和清单签名。

部署必须固定信任根 key ID，并把上一次成功接纳的 sequence 持久化为下一次的 `minimumSequence`。过期、未来生效、
签名/hash 篡改、非固定可信根或 sequence 回滚均 fail-closed。撤销不会删除用户已经合法导出的本地文件；它只阻止新的
安装和加载授权。

## 3. 打包与安装流程

```text
规则/战役数据
  → createSignedTtrpgCreatorPackageV1()
  → 发布者签名包
  → verifyTtrpgCreatorPackageAgainstTrustManifestV1()
  → createTtrpgCreatorDependencyLockV1()
  → prepareTtrpgCreatorPackageInstallV1()
  → data-only package + install receipt
```

`dependency lock` 冻结本次安装的完整包集合；每个 package ID 只能有一个版本，并绑定版本、payload hash 和发布者 key。
安装时提供的包少一个、多一个、换版本、换内容或换签名者都会失败。安装收据继续绑定 trust manifest hash/sequence、
dependency lock hash 和验证时间，供部署审计及崩溃恢复使用。

v1 的 CampaignPack 内嵌对应 RulePack，因此没有动态下载依赖。多个独立内容包共同部署时，仍必须作为一个完整安装集合
生成 lock，禁止运行时临时解析未锁定依赖。

## 4. 加载熔断

数据包没有可执行脚本，但错误的主机集成仍可能重复触发解析或装配故障。主机应持久化
`TtrpgCreatorLoadCircuitBreakerStateV1`：同一安装收据连续失败三次后停止自动加载，等待运营修复、重新签发或显式清零；
不同 payload/lock 不能复用旧状态绕过熔断。一次真实成功加载可清零连续失败计数。

## 5. 发布者最小示例

```ts
const packageV1 = await createSignedTtrpgCreatorPackageV1({
  packageId: 'studio.example.harbor-rules',
  packageVersion: '1.0.0',
  publisherId: 'studio.example',
  publisherDisplayName: 'Example Studio',
  publicKey,
  privateKey,
  rulePack,
  campaign,
})
```

在分发前还必须人工确认 RulePack `license`、Campaign/世界来源、署名、商用与二创权利。密码学签名只证明“谁发布了
哪些 bytes”，不替代版权、商标、隐私或内容审核结论。第三方图片、音频和语音不属于 Creator SDK v1，应继续通过
GAME-PROD 媒资 byte verifier、权利元数据和商业发布策略，不得塞进 data-only TTRPG 包规避媒资治理。

## 6. 验收证据

`tests/regression/R-CREATORSDK1-ttrpg-package.test.ts` 覆盖：签名/验签、可信与非可信发布者、payload/签名/权限篡改、
fixture 失败、私钥泄漏拒绝、短期 trust manifest、过期、防回滚、包撤销、完整依赖锁、安装收据和加载熔断。
