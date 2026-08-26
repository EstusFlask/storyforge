import { expect, test, type Locator, type Page } from "@playwright/test";

function ttrpgProductionOutput(system: string) {
  const worldHash =
    system.match(/world:[a-f0-9]{64}/)?.[0] ?? `world:${"a".repeat(64)}`;
  if (system.includes("任务=content.design。"))
    return {
      schema: "storyforge.game-design-artifact",
      version: 1,
      title: "潮门档案室",
      logline: "调查者必须在封港前查明被替换的潮门印章。",
      playerGoal: "调查档案、处理守潮人的阻挠并决定如何公开证据。",
      coreLoop: ["观察现场", "声明行动", "按规则结算", "承受后果"],
      sourceAnchors: [worldHash],
      invariants: ["冻结世界事实保持一致", "运行状态不得反写世界 Canon"],
      tone: ["悬疑", "克制"],
      targetPlayMinutes: 90,
      targetEndingCount: 2,
    };
  if (system.includes("任务=content.narrative。")) {
    const d100 = system.includes("storyforge.d100-investigation");
    const d20 = system.includes("storyforge.d20-fantasy-srd-5.2.1");
    const chain = d100
      ? [
          {
            key: "archive-entry",
            title: "封锁的档案室",
            summary: "玩家抵达潮门档案室并发现封条异常。",
          },
          {
            key: "index-room",
            title: "索引间",
            summary: "潮湿索引卡指出一批被重新编号的卷宗。",
          },
          {
            key: "whisper-corridor",
            title: "低语外廊",
            summary: "不同证词在外廊留下互相冲突的时间线。",
          },
          {
            key: "seal-ledger",
            title: "封印账册",
            summary: "账册记录了替换印章的物料与两名经手人。",
          },
          {
            key: "tide-vault",
            title: "潮痕密库",
            summary: "退潮水痕暴露了密库最近开启过的事实。",
          },
          {
            key: "clerk-confrontation",
            title: "书记员的阻拦",
            summary: "书记员试图隐藏被替换的印章。",
          },
        ]
      : d20
        ? [
            {
              key: "floodgate-ambush",
              title: "潮门伏击",
              summary: "守潮傀儡截断退路，队伍必须先处理战斗威胁。",
            },
            {
              key: "archive-approach",
              title: "断桥探索",
              summary: "队伍越过断桥与潮汐机关寻找进入档案室的安全路线。",
            },
            {
              key: "clerk-parley",
              title: "书记员谈判",
              summary: "书记员握有钥匙，立场可通过交涉而改变。",
            },
            {
              key: "vault-clash",
              title: "密库决战",
              summary: "替换印章的执行者在密库发动最后阻拦。",
            },
          ]
        : [
            {
              key: "archive-entry",
              title: "封锁的档案室",
              summary: "玩家抵达潮门档案室并发现封条异常。",
            },
            {
              key: "index-room",
              title: "索引间",
              summary: "潮湿索引卡指出一批被重新编号的卷宗。",
            },
            {
              key: "tide-vault",
              title: "潮痕密库",
              summary: "退潮水痕暴露了密库最近开启过的事实。",
            },
            {
              key: "clerk-confrontation",
              title: "书记员的阻拦",
              summary: "书记员试图隐藏被替换的印章。",
            },
          ];
    const entryNodeKey = chain[0].key;
    const finalSceneKey = chain.at(-1)!.key;
    return {
      schema: "storyforge.game-narrative-artifact",
      version: 1,
      moduleKind: "main",
      moduleTitle: d100 ? "潮门六证词" : d20 ? "潮门英雄骰" : "潮门档案室",
      entryNodeKey,
      nodes: [
        ...chain.map((node, index) => ({
          ...node,
          kind: index === 0 ? "entry" : "scene",
          condition: {},
          effects: [],
        })),
        {
          key: "truth-ending",
          kind: "ending",
          title: "公开证据",
          summary: "证据在封港前被公开。",
          condition: {},
          effects: [],
        },
        {
          key: "shelter-ending",
          kind: "ending",
          title: "封存证据",
          summary: "队伍选择暂时封存真相。",
          condition: {},
          effects: [],
        },
      ],
      beats: [
        ...chain.map((node, index) => ({
          beatKey: `beat.${node.key}`,
          nodeKey: node.key,
          kind: "narration",
          speakerKey: null,
          text:
            index === 0
              ? "潮声穿过封死的窗，蜡封上留着一道新鲜刮痕。"
              : node.summary,
          order: 0,
        })),
        {
          beatKey: "beat.truth",
          nodeKey: "truth-ending",
          kind: "narration",
          speakerKey: null,
          text: "替换蜡屑与原始记录一同进入公开档案。",
          order: 0,
        },
        {
          beatKey: "beat.shelter",
          nodeKey: "shelter-ending",
          kind: "narration",
          speakerKey: null,
          text: "证据被封入新的匣子，等待更安全的时机。",
          order: 0,
        },
      ],
      choices: [
        ...chain.slice(0, -1).map((node, index) => ({
          choiceKey: `choice.${node.key}`,
          sourceNodeKey: node.key,
          text: `继续调查：${chain[index + 1].title}`,
          description: "沿当前证据链推进并承受新的代价",
          unavailableReason: "",
          targetNodeKey: chain[index + 1].key,
          displayCondition: {},
          availableCondition: {},
          effects: [],
          tags: ["investigation"],
          order: 0,
        })),
        {
          choiceKey: "choice.publish",
          sourceNodeKey: finalSceneKey,
          text: "公开全部证据",
          description: "承担公开真相的后果",
          unavailableReason: "",
          targetNodeKey: "truth-ending",
          displayCondition: {},
          availableCondition: {},
          effects: [],
          tags: ["ending"],
          order: 0,
        },
        {
          choiceKey: "choice.seal",
          sourceNodeKey: finalSceneKey,
          text: "封存证据保护证人",
          description: "暂时保留秘密",
          unavailableReason: "",
          targetNodeKey: "shelter-ending",
          displayCondition: {},
          availableCondition: {},
          effects: [],
          tags: ["ending"],
          order: 1,
        },
      ],
    };
  }
  if (system.includes("任务=content.product-module。"))
    return {
      schema: "storyforge.game-product-module-artifact",
      version: 1,
      productType: "ttrpg",
      interfaceStyle: "桌面规则区与剧场叙事并列，行动回执始终可见。",
      interactionNotes: [
        "自然语言意图必须进入规则行动闭环。",
        "秘密按 viewer 投影。",
      ],
      presentationPolicy: {
        pacing: "balanced",
        transitionMs: 250,
        backgroundStrategy: "key-scenes",
      },
    };
  if (system.includes("任务=media.requirements。"))
    return {
      schema: "storyforge.game-media-requirements-artifact",
      version: 2,
      visual: [...new Set(system.match(/media\.visual\.\d{3}/g) ?? [])].map(
        (artifactKey, index) => ({
          artifactKey,
          mediaKind: index === 0 ? "background" : "character-pose",
          sceneTag: index === 0 ? "archive-opening" : `investigator-${index}`,
          beatKey: index === 0 ? "beat.archive" : "beat.clerk",
          prompt:
            index === 0
              ? "无人物的潮门档案室空景，旧木柜、蜡封和潮湿石墙。"
              : "单人全身调查者立绘，旅行披风、档案工具包、警觉姿态。",
          altText:
            index === 0 ? "潮湿昏暗的潮门档案室。" : "携带档案工具包的调查者。",
          width: index === 0 ? 1280 : 720,
          height: index === 0 ? 720 : 1080,
          palette: ["#112233", "#445566", "#ddeeff"],
          characterAnchorRefs:
            index === 0
              ? []
              : [system.match(/character:\d+/)?.[0] ?? "intent:protagonist"],
          hardConstraints: [],
        }),
      ),
      audio: [],
    };
  throw new Error(`未识别的 TTRPG 生产任务:${system.slice(0, 160)}`);
}

function ttrpgCampaignProposalOutput(system: string) {
  const worldRef =
    system.match(/world:[a-f0-9]{64}/)?.[0] ?? `world:${"a".repeat(64)}`;
  const proposal = (
    proposalKey: string,
    title: string,
    structure: "linear" | "branching" | "node-based" | "sandbox",
    focus: string,
  ) => ({
    proposalKey,
    title,
    structure,
    pitch: `${focus}形成独立的玩法压力与结局代价。`,
    background: `潮门封锁之际，${focus}开始影响各方行动。`,
    coreConflict: `玩家必须处理${focus}并决定由谁承担代价。`,
    opening: `第一幕从${focus}留下的异常迹象开始。`,
    frontConcepts: [
      `${focus}沿六格 Clock 升级`,
      `${focus}的受益者试图改变证词`,
    ],
    secretConcepts: [`${focus}背后存在可以交叉验证的隐藏动机`],
    endingConcepts: [`公开${focus}的完整真相`, `以部分真相换取眼前安全`],
    sourceRefs: [worldRef],
  });
  return {
    proposals: [
      proposal("proposal.ai-evidence", "AI 证据网络", "node-based", "多路证据"),
      proposal("proposal.ai-factions", "AI 阵营压力", "branching", "阵营承诺"),
      proposal("proposal.ai-crisis", "AI 危机升级", "sandbox", "暴潮危机"),
    ],
  };
}

async function configureMockedTextProvider(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "storyforge_guide_completed",
      "ttrpg-production-browser-rehearsal",
    );
    localStorage.setItem("storyforge-ai-api-key-remember", "true");
    localStorage.setItem(
      "storyforge-ai-config",
      JSON.stringify({
        provider: "agnes",
        apiKey: "browser-rehearsal-key",
        model: "agnes-2.0-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        temperature: 0,
        maxTokens: 0,
      }),
    );
  });
  await page.route("**/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const system =
      body.messages?.find((message) => message.role === "system")?.content ??
      "";
    const requestText =
      body.messages?.map((message) => message.content ?? "").join("\n") ??
      system;
    const output = system.includes("StoryForge 的 TTRPG 战役提案设计器")
      ? ttrpgCampaignProposalOutput(requestText)
      : system.includes("StoryForge 可信 AI KP 的 NPC 行动提议器")
        ? {
            actionKey: "investigate",
            targetKey: null,
            approach:
              "依据当前角色掌握的现场事实谨慎核对痕迹，并对玩家的调查形成合理回应。",
            spokenIntent: "先让我确认这里发生了什么。",
          }
        : system.includes("StoryForge 可信 AI GM 的候选叙事生成器")
          ? {
              narration:
                "规则结果已经呈现；现场人物依据各自所知作出反应，后续选择仍交给玩家决定。",
              offeredClueKeys: [],
              recommendedNextSceneKeys: [],
            }
          : system.includes("StoryForge 的隔离 AI 玩家行动提议器")
            ? {
                actionKey: "investigate",
                targetKey: null,
                approach:
                  "依据眼前可见的痕迹逐项检查，并把可公开的观察告诉同伴。",
                spokenIntent: "我先核对这些痕迹。",
              }
            : ttrpgProductionOutput(requestText);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `ttrpg-browser-rehearsal-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "agnes-2.0-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output) },
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 200,
          total_tokens: 400,
        },
      }),
    });
  });
  await page.route("**/images/generations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-request-id": `ttrpg-image-${Date.now()}` },
      body: JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [
          {
            b64_json:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2vAAAAABJRU5ErkJggg==",
            revised_prompt: "受控浏览器排练生成的透明占位图。",
          },
        ],
        usage: { total_tokens: 1 },
      }),
    });
  });
}

async function createUpperLayerTtrpgWorkspace(page: Page) {
  await page.goto("./");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "新建", exact: true })
    .click();
  await page.getByRole("button", { name: /世界引擎.*从零创建/ }).click();
  await page.getByPlaceholder("例如：潮汐之后").fill("跑团上层验收工作区");
  await page
    .getByPlaceholder("一句话描述这个世界或作品")
    .fill("世界正式出口待接期间，用跑团专属冻结开发来源验收生产与运行。 ");
  await page.getByRole("button", { name: "创建世界引擎", exact: true }).click();
  await page.getByRole("button", { name: "跑团", exact: true }).click();
  await page.getByRole("button", { name: "跑团制作", exact: true }).click();
  await expect(page.getByTestId("ttrpg-production-workspace")).toBeVisible({ timeout: 15_000 });
}

async function buildProductOwnedTtrpgFixture(
  page: Page,
  fixtureKey: "rank-lite-mist-harbor" | "d20-fantasy-floodgate" | "d100-investigation-archive",
  configure: (page: Page) => Promise<void>,
) {
  await createUpperLayerTtrpgWorkspace(page);
  const workspace = page.getByTestId("ttrpg-production-workspace");
  await workspace.getByTestId("ttrpg-development-fixture").selectOption(fixtureKey);
  await workspace.getByTestId("ttrpg-freeze-source").click();
  await configure(page);
  await workspace.getByTestId("ttrpg-confirm-brief").click();
  await expect(workspace).toContainText("Brief 已作为新 revision 冻结");
  await workspace.getByTestId("ttrpg-build-preview").click();
  await expect(workspace).toContainText("可以开桌试玩", { timeout: 15_000 });
  await workspace.getByTestId("ttrpg-start-preview").click();
  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(guide).toBeVisible({ timeout: 20_000 });
  return guide;
}

test("跑团专属受控 Golden C slice：生产、三真人开桌、规则回执、动态媒资、存档与刷新恢复", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  await createUpperLayerTtrpgWorkspace(page);
  const workspace = page.getByTestId("ttrpg-production-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  await workspace.getByTestId("ttrpg-development-fixture").selectOption(
    "rank-lite-mist-harbor",
  );
  await workspace.getByTestId("ttrpg-freeze-source").click();
  await expect(workspace.getByTestId("ttrpg-source-summary")).toContainText(
    "rank-lite",
  );
  await configureRankLiteTable(page);
  await workspace.getByTestId("ttrpg-confirm-brief").click();
  await expect(workspace).toContainText("Brief 已作为新 revision 冻结");
  await workspace.getByTestId("ttrpg-build-preview").click();
  await expect(workspace).toContainText("可以开桌试玩", { timeout: 15_000 });
  await expect(workspace.getByTestId("ttrpg-start-preview")).toBeEnabled();
  await workspace.getByTestId("ttrpg-start-preview").click();
  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(guide).toBeVisible({
    timeout: 20_000,
  });
  await completeSessionZero(page, false);
  await guide.getByRole("button", { name: "宣布本场开始", exact: true }).click();
  await expect(guide).toContainText("正在进行：第 1 场");
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  const activeActor = guide.getByTestId("ttrpg-active-actor");
  for (let guard = 0; guard < 8; guard += 1) {
    const previousActor = (await activeActor.textContent()) ?? "";
    if (previousActor.includes("真人")) break;
    await expect(activeActor).toContainText("KP 控制");
    await guide
      .getByLabel("角色行动声明")
      .fill(`我以当前 NPC 的立场追问来意，并观察三名调查者是否隐瞒证据（KP 回合 ${guard + 1}）。`);
    await guide
      .locator("button:enabled")
      .filter({ hasText: /提交意图.*结算|检定并结算/ })
      .first()
      .click();
    await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
      "行动终态回执",
    );
    await expect.poll(() => activeActor.textContent()).not.toBe(previousActor);
  }
  await expect(activeActor).toContainText("真人");
  await guide.getByLabel("角色行动声明").fill("我检查潮痕与封条的差异，并把观察结果告诉同伴。");
  await guide.locator("button:enabled").filter({ hasText: /提交意图.*结算|检定并结算/ }).first().click();
  const receipt = guide.getByTestId("ttrpg-action-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("行动终态回执");
  await expect(receipt).toContainText("行动者后果");
  await expect(receipt).toContainText("场景反馈");
  await expect(receipt).toContainText(/d20|D20/);

  const media = guide.getByTestId("ttrpg-runtime-media-panel");
  await expect(media).toContainText("文字 fallback");
  const generatedSlot = media.locator("article").filter({ hasText: "后台生成" }).first();
  await generatedSlot.getByRole("button", { name: "后台生成", exact: true }).click();
  await expect(media.locator("img").first()).toBeVisible({ timeout: 20_000 });
  await expect(media).toContainText("运行时可用");

  const save = guide.getByTestId("ttrpg-save-and-branch");
  await save.getByLabel("正式战役检查点名称").fill("首次规则行动后");
  await save.getByRole("button", { name: "保存", exact: true }).click();
  await expect(save).toContainText("首次规则行动后");

  await page.reload();
  await page.getByRole("button", { name: "跑团", exact: true }).click();
  const restored = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(restored.getByTestId("ttrpg-action-receipt")).toBeVisible({ timeout: 20_000 });
  await expect(restored).toContainText("Session Zero 已完成");
  await expect(restored.getByTestId("ttrpg-save-and-branch")).toContainText("首次规则行动后");
});

test("跑团专属受控 Golden A slice：d20 混合席位、AI 回合、规则回执与 AI KP 叙事采用", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  const guide = await buildProductOwnedTtrpgFixture(
    page,
    "d20-fantasy-floodgate",
    configureGoldenD20Table,
  );
  await expect(guide).toContainText("StoryForge 5E 兼容奇幻核心");
  await expect(guide).toContainText("等级 3");
  await completeSessionZero(page, true);
  await guide.getByRole("button", { name: "宣布本场开始", exact: true }).click();
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await guide
    .getByLabel("角色行动声明")
    .fill("我借助训练检查封条，并准备在书记员阻拦时保护同伴。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  const receipt = guide.getByTestId("ttrpg-action-receipt");
  await expect(receipt).toContainText("行动终态回执");
  await expect(receipt).toContainText(/d20|D20/);

  await ensureAiGmExperimentEnabled(guide);
  await guide.getByRole("button", { name: "生成受治理候选", exact: true }).click();
  await expect(
    guide.getByRole("button", { name: "确认并写入叙事", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await guide.getByRole("button", { name: "确认并写入叙事", exact: true }).click();
  await expect(guide.getByTestId("formal-ttrpg-gm-narration")).toContainText("AI GM");
});

test("跑团专属受控 Golden B slice：d100 暗骰、AI 玩家推进与角色私密信息隔离", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  const guide = await buildProductOwnedTtrpgFixture(
    page,
    "d100-investigation-archive",
    configureGoldenD100Table,
  );
  await expect(guide).toContainText("StoryForge d100 调查规则");
  await completeSessionZero(page, true);
  await guide.getByRole("button", { name: "宣布本场开始", exact: true }).click();
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await guide.getByLabel("检定可见性").first().selectOption("gm-only");
  await guide
    .getByLabel("角色行动声明")
    .fill("我逐项比对账册时间与封条纤维，并把可公开的部分告诉队伍。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
    "行动终态回执",
  );
  await expect(guide.getByTestId("ttrpg-dice-proof-summary")).toContainText(/d100|D100/);

  await guide.getByRole("button", { name: "玩家视图", exact: true }).click();
  await guide.getByRole("button", { name: /查看角色：/ }).first().click();
  await expect(guide).toContainText("暗骰已提交");
  await expect(guide.getByTestId("ttrpg-dice-proof-summary")).toHaveCount(0);
  await expect(guide).not.toContainText("隐瞒账册经手人的身份，只向本角色与 KP 公开。");
  await expect(guide).not.toContainText("保护低语外廊的证人，只向本角色与 KP 公开。");
});

// These scenarios are retained as migration evidence for the superseded unified
// TTRPG production path. They must not run as current acceptance tests until the
// product-owned SourceSelection and production contracts replace that path.
test.skip("战役提案页面主路径：比较、混合、锁定、定向 AI 重生成并重新确认", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  await createWorldThroughProductUi(page);
  await configureProductionHeader(
    page,
    "潮门提案审查团",
    "保留阵营压力，但只重新设计隐藏秘密，并冻结作者确认后的组合。",
  );
  await configureRankLiteTable(page);
  await page
    .getByRole("button", { name: "生成严格 Brief", exact: true })
    .click();
  const selector = page.getByTestId("ttrpg-campaign-proposal-selector");
  await expect(selector).toBeVisible();
  await expect(selector).toContainText("证据网");
  await expect(selector).toContainText("阵营压力");
  await expect(selector).toContainText("升级危机");
  await expect(selector).toContainText(/world:[a-f0-9]{64}/);

  const fronts = selector.getByLabel("Front / 压力来源提案");
  await fronts.selectOption("proposal.faction-pressure");
  const frontSection = selector.locator('[data-proposal-section="fronts"]');
  await frontSection.getByLabel("锁定", { exact: true }).check();
  await expect(fronts).toBeDisabled();
  await selector
    .getByLabel("混合说明（会进入冻结 Brief）")
    .fill("阵营 Front 已审定，只重新设计秘密。");
  await selector
    .getByRole("button", { name: "只重生成秘密", exact: true })
    .click();
  await expect(selector).toContainText(/AI candidate · Run #\d+/, {
    timeout: 30_000,
  });
  await expect(selector.getByLabel("Front / 压力来源提案")).toBeDisabled();
  await expect(selector.getByLabel("混合说明（会进入冻结 Brief）")).toHaveValue(
    "阵营 Front 已审定，只重新设计秘密。",
  );
  await expect(selector.getByLabel(/确认采用当前提案混合/)).not.toBeChecked();
  await selector.getByLabel(/确认采用当前提案混合/).check();
  await page
    .getByRole("button", { name: "保存 Brief revision", exact: true })
    .click();
  await expect(page.getByText(/Production 待授权/)).toBeVisible();
});

async function createWorldThroughProductUi(page: Page) {
  await page.goto("./");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "新建", exact: true })
    .click();
  await page.getByRole("button", { name: /世界引擎.*从零创建/ }).click();
  await page.getByPlaceholder("例如：潮汐之后").fill("潮门黄金回合世界");
  await page
    .getByPlaceholder("一句话描述这个世界或作品")
    .fill("退潮后显露旧港档案室，守潮人试图隐藏被替换的印章。");
  await page.getByRole("button", { name: "创建世界引擎", exact: true }).click();

  await page.getByRole("button", { name: "角色档案", exact: true }).click();
  await page.getByRole("button", { name: "新建角色", exact: true }).click();
  await page.getByRole("button", { name: "主要", exact: true }).click();
  await page.getByRole("button", { name: "绝对中立", exact: true }).click();
  await page.getByRole("button", { name: "创建并分流", exact: true }).click();
  await page.locator("div.cursor-text.text-2xl").click();
  await page.locator("input.text-2xl").fill("林舟");
  await page.locator("input.text-2xl").press("Enter");
  await expect(page.locator("div.cursor-text.text-2xl")).toHaveText("林舟");

  await page.goto("./");
  await page.getByRole("button", { name: "世界引擎", exact: true }).click();
  await page.getByRole("button", { name: "重要地点", exact: true }).click();
  await page.getByRole("button", { name: "添加地点", exact: true }).click();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await page.locator('input[value="新地点"]').fill("潮门档案室");
  await page.getByRole("heading", { name: "📍 重要地点" }).click();
  await expect(page.getByText("潮门档案室", { exact: true })).toBeVisible();

  await page.goto("./");
  await page.getByRole("button", { name: "世界引擎", exact: true }).click();
  await page.getByRole("button", { name: "主线与支线", exact: true }).click();
  await page.getByTitle("新增主线").click();
  await page.getByRole("button", { name: "添加阶段", exact: true }).click();
  await page.getByRole("button", { name: "添加阶段", exact: true }).click();

  await page.goto("./");
  await page.getByRole("button", { name: "世界引擎", exact: true }).click();
  const pipeline = page.getByRole("region", { name: "叙事蓝图与世界发布" });
  await pipeline
    .getByRole("button", { name: "同步主线与支线", exact: true })
    .click();
  await expect(pipeline.getByRole("status")).toContainText(
    "已同步 1 条主线/支线。",
  );
  await pipeline.locator(".sf-world-module-list button").click();
  await pipeline.getByPlaceholder("例如：世界修订 1").fill("潮门跑团冻结来源");
  await pipeline.getByRole("button", { name: "冻结修订", exact: true }).click();
  await expect(pipeline.getByRole("status")).toContainText(
    "已冻结新的世界草稿修订。",
  );
  await pipeline.getByRole("button", { name: "发布版本", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "发布版本", exact: true })
    .click();
  await expect(pipeline.getByRole("status")).toContainText(
    "不可变世界版本已发布。",
  );
  await page
    .getByRole("region", { name: "世界到文字游戏" })
    .getByRole("button", { name: "用此世界制作跑团", exact: true })
    .click();
}

async function configureRankLiteTable(page: Page) {
  const wizard = page.getByTestId("ttrpg-production-wizard");
  await wizard
    .getByRole("button", { name: "步骤 3 规则与村规", exact: true })
    .click();
  await wizard.getByLabel("基础规则").selectOption("builtin-rank-lite");
  await wizard
    .getByRole("button", { name: "步骤 4 主持与席位", exact: true })
    .click();
  await wizard.getByLabel("KP / GM 模式").selectOption("human");
  await wizard.getByLabel("席位 1 车卡方式").selectOption("quick-card");
  await wizard.getByLabel("席位 2 控制者").selectOption("human");
  await wizard.getByLabel("席位 2 车卡方式").selectOption("quick-card");
  await wizard
    .getByRole("button", { name: "添加席位（最多 12）", exact: true })
    .click();
  await wizard.getByLabel("席位 3 控制者").selectOption("human");
  await wizard.getByLabel("席位 3 车卡方式").selectOption("quick-card");
  await wizard
    .getByRole("button", { name: "步骤 9 审查确认", exact: true })
    .click();
  await wizard
    .getByLabel(/确认世界边界、数值映射、规则授权、AI 参与和媒资权利/)
    .check();
}

async function configureProductionHeader(
  page: Page,
  title: string,
  opening: string,
) {
  const enableProduction = page.getByRole("button", {
    name: "为当前项目显式启用",
    exact: true,
  });
  if (await enableProduction.isVisible().catch(() => false))
    await enableProduction.click();
  await expect(page.getByTestId("game-production-studio")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("combobox", { name: /产品形态/ })).toHaveValue(
    "ttrpg",
  );
  await page
    .getByRole("combobox", { name: /制作质量/ })
    .selectOption("prototype");
  await page.getByRole("combobox", { name: /视觉目标/ }).selectOption("none");
  await page
    .getByRole("textbox", { name: "游戏标题", exact: true })
    .fill(title);
  await page
    .getByRole("textbox", { name: "玩家身份 / 主角", exact: true })
    .fill("冻结世界中的三人调查小队");
  await page
    .getByRole("combobox", { name: "游戏规模", exact: true })
    .selectOption("short-arc");
  await page
    .getByRole("textbox", { name: /你想玩的第一幕与核心目标/ })
    .fill(opening);
  await page.getByRole("button", { name: "分析可玩起点", exact: true }).click();
  await expect(page.getByText("可追溯起点", { exact: true })).toBeVisible();
}

async function configureGoldenD20Table(page: Page) {
  const wizard = page.getByTestId("ttrpg-production-wizard");
  await wizard
    .getByRole("button", { name: "步骤 3 规则与村规", exact: true })
    .click();
  await wizard.getByLabel("基础规则").selectOption("builtin-d20-fantasy");
  await wizard.getByLabel("濒死恢复英雄骰消耗").fill("1");
  await wizard
    .getByRole("button", { name: "步骤 4 主持与席位", exact: true })
    .click();
  await wizard.getByLabel("KP / GM 模式").selectOption("ai");
  await wizard.getByLabel("席位 1 车卡方式").selectOption("ai-generated");
  await wizard.getByLabel("席位 2 控制者").selectOption("human");
  await wizard.getByLabel("席位 2 车卡方式").selectOption("ai-generated");
  await wizard
    .getByRole("button", { name: "添加席位（最多 12）", exact: true })
    .click();
  await wizard.getByLabel("席位 3 控制者").selectOption("ai");
  await wizard.getByLabel("席位 3 车卡方式").selectOption("ai-generated");
  await wizard
    .getByRole("button", { name: "步骤 5 车卡策略", exact: true })
    .click();
  await wizard.getByLabel("初始等级 / 阶位").fill("3");
  await wizard
    .getByRole("button", { name: "步骤 9 审查确认", exact: true })
    .click();
  await wizard
    .getByLabel(/确认世界边界、数值映射、规则授权、AI 参与和媒资权利/)
    .check();
}

async function configureGoldenD100Table(page: Page) {
  const wizard = page.getByTestId("ttrpg-production-wizard");
  await wizard
    .getByRole("button", { name: "步骤 3 规则与村规", exact: true })
    .click();
  await wizard
    .getByLabel("基础规则")
    .selectOption("builtin-d100-investigation");
  await wizard
    .getByRole("button", { name: "步骤 4 主持与席位", exact: true })
    .click();
  await wizard.getByLabel("KP / GM 模式").selectOption("ai");
  await wizard.getByLabel("席位 1 车卡方式").selectOption("ai-generated");
  await wizard
    .getByLabel("席位 1 私人目标")
    .fill("查明导师失踪真相，只向 KP 说明。");
  await wizard.getByLabel("席位 2 控制者").selectOption("ai");
  await wizard.getByLabel("席位 2 车卡方式").selectOption("ai-generated");
  await wizard
    .getByLabel("席位 2 私人目标")
    .fill("隐瞒账册经手人的身份，只向本角色与 KP 公开。");
  await wizard
    .getByRole("button", { name: "添加席位（最多 12）", exact: true })
    .click();
  await wizard.getByLabel("席位 3 控制者").selectOption("ai");
  await wizard.getByLabel("席位 3 车卡方式").selectOption("ai-generated");
  await wizard
    .getByLabel("席位 3 私人目标")
    .fill("保护低语外廊的证人，只向本角色与 KP 公开。");
  await wizard
    .getByRole("button", { name: "步骤 6 剧情结构", exact: true })
    .click();
  await wizard.getByLabel("目标场景数").fill("8");
  await wizard
    .getByRole("button", { name: "步骤 9 审查确认", exact: true })
    .click();
  await wizard
    .getByLabel(/确认世界边界、数值映射、规则授权、AI 参与和媒资权利/)
    .check();
}

async function buildAndPreview(page: Page) {
  await page
    .getByRole("button", { name: "生成严格 Brief", exact: true })
    .click();
  await expect(
    page.getByText("Brief v3 审查摘要", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "保存 Brief revision", exact: true })
    .click();
  await expect(page.getByText(/Production 待授权/)).toBeVisible();
  await page
    .getByRole("button", { name: "作者授权并开始自动制作", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "试玩未发布 Build", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: "试玩未发布 Build", exact: true })
    .click();
  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(guide).toBeVisible({ timeout: 45_000 });
  return guide;
}

async function advanceAutomatedTtrpgTurnsUntilHuman(guide: Locator) {
  const activeActor = guide.getByTestId("ttrpg-active-actor");
  const determineControl = async () => {
    const label = (await activeActor.textContent()) ?? "";
    if (label.includes("真人")) return "human" as const;
    if (
      await guide
        .getByRole("button", {
          name: "将当前项目加入 AI GM 实验",
          exact: true,
        })
        .first()
        .isVisible()
        .catch(() => false)
    )
      return "enroll-ai-gm" as const;
    if (
      await guide
        .getByRole("button", {
          name: "推进 AI KP 的 NPC 回合",
          exact: true,
        })
        .isVisible()
        .catch(() => false)
    )
      return "ai-gm" as const;
    if (
      await guide
        .getByRole("button", {
          name: "推进 AI 玩家回合",
          exact: true,
        })
        .isVisible()
        .catch(() => false)
    )
      return "ai-player" as const;
    return "waiting" as const;
  };

  for (let guard = 0; guard < 12; guard += 1) {
    await expect
      .poll(determineControl, {
        message: "当前行动者必须由真人、AI 玩家或已授权的 AI KP 接管",
        timeout: 15_000,
      })
      .not.toBe("waiting");
    const control = await determineControl();
    if (control === "human") return;
    if (control === "enroll-ai-gm") {
      await guide
        .getByRole("button", {
          name: "将当前项目加入 AI GM 实验",
          exact: true,
        })
        .first()
        .click();
      await expect.poll(determineControl).not.toBe("enroll-ai-gm");
      continue;
    }

    const previousActor = await activeActor.textContent();
    if (control === "ai-gm") {
      await guide
        .getByRole("button", {
          name: "推进 AI KP 的 NPC 回合",
          exact: true,
        })
        .click();
      await expect(guide.getByTestId("ttrpg-ai-gm-actor-summary")).toContainText(
        "RulePack 结算",
        { timeout: 30_000 },
      );
    } else {
      await guide
        .getByRole("button", { name: "推进 AI 玩家回合", exact: true })
        .click();
      await expect(
        guide.getByTestId("ttrpg-ai-player-cycle-summary"),
      ).toContainText(/已停在真人回合|已停在 KP \/ NPC 回合/, {
        timeout: 30_000,
      });
    }
    await expect
      .poll(() => activeActor.textContent(), {
        message: "自动行动结算后必须推进到下一行动者",
        timeout: 15_000,
      })
      .not.toBe(previousActor);
  }
  throw new Error("自动行动推进超过 12 个边界，未抵达真人回合");
}

async function ensureAiGmExperimentEnabled(guide: Locator) {
  const generate = guide.getByRole("button", {
    name: "生成受治理候选",
    exact: true,
  });
  const enrollment = guide
    .getByRole("button", {
      name: "将当前项目加入 AI GM 实验",
      exact: true,
    })
    .first();
  const state = async () =>
    (await generate.isEnabled().catch(() => false))
      ? "ready"
      : (await enrollment.isVisible().catch(() => false))
        ? "needs-enrollment"
        : "waiting";
  await expect
    .poll(state, {
      message: "AI GM 应完成刷新或给出显式实验授权入口",
      timeout: 15_000,
    })
    .not.toBe("waiting");
  if ((await state()) === "needs-enrollment") await enrollment.click();
  await expect(generate).toBeEnabled({ timeout: 15_000 });
}

async function completeSessionZero(page: Page, aiDisclosure: boolean) {
  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  const sessionZero = guide.getByTestId("ttrpg-session-zero");
  if (aiDisclosure) {
    const disclosures = sessionZero.getByLabel("已知晓本团 AI 身份");
    for (let index = 0; index < (await disclosures.count()); index += 1) {
      if (!(await disclosures.nth(index).isChecked())) {
        await disclosures.nth(index).click();
        await expect(disclosures.nth(index)).toBeChecked();
      }
    }
  }
  await sessionZero.getByLabel("主题与强度").check();
  await sessionZero.getByLabel("角色间冲突").check();
  await sessionZero.getByLabel("录制与回放").check();
  await sessionZero.getByLabel("AI 参与").check();
  await sessionZero
    .getByRole("button", { name: "确认共识并开始战役", exact: true })
    .click();
  await expect(guide).toContainText("Session Zero 已完成");
  return guide;
}

async function returnToFreshProduction(page: Page) {
  await page.getByRole("button", { name: "自动制作", exact: true }).click();
  const studio = page.getByTestId("game-production-studio");
  await expect(studio).toBeVisible({ timeout: 15_000 });
  await studio
    .getByRole("button", { name: "新建 Production", exact: true })
    .click();
  await expect(
    studio.getByRole("textbox", { name: "游戏标题", exact: true }),
  ).toBeVisible();
  const releaseId = await studio.getByLabel("冻结 WorldRelease").inputValue();
  return releaseId;
}

test.skip("Golden C 页面排练：Rank Lite 三真人、动态场景/物品图、行动回执与刷新恢复", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  await createWorldThroughProductUi(page);

  const enableProduction = page.getByRole("button", {
    name: "为当前项目显式启用",
    exact: true,
  });
  if (await enableProduction.isVisible().catch(() => false))
    await enableProduction.click();
  await expect(page.getByTestId("game-production-studio")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("combobox", { name: /产品形态/ })).toHaveValue(
    "ttrpg",
  );
  await page
    .getByRole("combobox", { name: /制作质量/ })
    .selectOption("prototype");
  await page.getByRole("combobox", { name: /视觉目标/ }).selectOption("none");
  await page
    .getByRole("textbox", { name: "游戏标题", exact: true })
    .fill("潮门档案室即时团");
  await page
    .getByRole("textbox", { name: "玩家身份 / 主角", exact: true })
    .fill("三名调查者组成的临时小队");
  await page
    .getByRole("combobox", { name: "游戏规模", exact: true })
    .selectOption("short-arc");
  await page
    .getByRole("textbox", { name: /你想玩的第一幕与核心目标/ })
    .fill("在封港前进入潮门档案室，查明印章被替换的原因，并决定如何处理证据。");
  await page.getByRole("button", { name: "分析可玩起点", exact: true }).click();
  await expect(page.getByText("可追溯起点", { exact: true })).toBeVisible();
  await configureRankLiteTable(page);
  await page
    .getByRole("button", { name: "生成严格 Brief", exact: true })
    .click();
  await expect(
    page.getByText("Brief v3 审查摘要", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "保存 Brief revision", exact: true })
    .click();
  await expect(page.getByText(/Production 待授权/)).toBeVisible();
  await page
    .getByRole("button", { name: "作者授权并开始自动制作", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "试玩未发布 Build", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: "试玩未发布 Build", exact: true })
    .click();

  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(guide).toBeVisible({ timeout: 45_000 });
  const sessionZero = guide.getByTestId("ttrpg-session-zero");
  await sessionZero.getByLabel("主题与强度").check();
  await sessionZero.getByLabel("角色间冲突").check();
  await sessionZero.getByLabel("录制与回放").check();
  await sessionZero.getByLabel("AI 参与").check();
  await sessionZero
    .getByRole("button", { name: "确认共识并开始战役", exact: true })
    .click();
  await expect(guide).toContainText("Session Zero 已完成");
  await guide
    .getByRole("button", { name: "宣布本场开始", exact: true })
    .click();
  await expect(guide).toContainText("正在进行：第 1 场");
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await guide
    .getByLabel("角色行动声明")
    .fill("我仔细检查蜡封的刮痕，并把发现告诉同伴。");
  await guide
    .getByRole("button", { name: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  const actionReceipt = guide.getByTestId("ttrpg-action-receipt");
  await expect(actionReceipt).toBeVisible();
  await expect(actionReceipt).toContainText("行动终态回执");
  await expect(actionReceipt).toContainText(
    "我仔细检查蜡封的刮痕，并把发现告诉同伴。",
  );
  await expect(actionReceipt).toContainText("行动者后果");
  await expect(actionReceipt).toContainText("场景反馈");

  await guide.getByRole("button", { name: "玩家视图", exact: true }).click();
  const characterButtons = guide.getByRole("button", { name: /查看角色：/ });
  let humanResponseFound = false;
  for (let index = 0; index < (await characterButtons.count()); index += 1) {
    await characterButtons.nth(index).click();
    if (
      await guide
        .getByTestId("ttrpg-human-response-window")
        .isVisible()
        .catch(() => false)
    ) {
      humanResponseFound = true;
      break;
    }
  }
  expect(humanResponseFound).toBe(true);
  const humanResponse = guide.getByTestId("ttrpg-human-response-window");
  await humanResponse
    .getByLabel("真人角色回应")
    .fill("我接过记录，先核对纸张批次，再决定是否公开。");
  await humanResponse.getByLabel("真人回应可见范围").selectOption("gm-only");
  await humanResponse
    .getByRole("button", { name: "提交本角色回应", exact: true })
    .click();
  await expect(humanResponse).toBeHidden();
  await expect(guide).toContainText(
    "我接过记录，先核对纸张批次，再决定是否公开。",
  );
  await guide.getByRole("button", { name: "主持人视图", exact: true }).click();

  const media = guide.getByTestId("ttrpg-runtime-media-panel");
  const sceneJob = media
    .locator("article")
    .filter({ hasText: "scene.index-room" });
  await sceneJob.getByRole("button", { name: "后台生成", exact: true }).click();
  await expect(sceneJob).toContainText("可用", { timeout: 15_000 });
  await expect(sceneJob.locator("img")).toBeVisible();
  const itemJob = media
    .locator("article")
    .filter({ hasText: "item.field-kit" });
  await itemJob.getByRole("button", { name: "后台生成", exact: true }).click();
  await expect(itemJob).toContainText("可用", { timeout: 15_000 });
  await expect(itemJob.locator("img")).toBeVisible();
  await expect(media).toContainText("文字 fallback");
  const recap = guide.getByTestId("ttrpg-session-recap");
  await expect(recap).toContainText("本场事实对账");
  await expect(recap).toContainText("资源、状态与能力次数");
  await expect(recap).toContainText("物品取得、使用与转移");
  await guide
    .getByRole("button", { name: "自动对账并结束本场", exact: true })
    .click();
  await expect(guide.getByTestId("ttrpg-long-campaign")).toContainText(
    "已完成 1 场",
  );
  await expect(guide.getByTestId("ttrpg-long-campaign")).toContainText(
    "本场行动",
  );

  await page.reload();
  await page.getByRole("button", { name: "跑团", exact: true }).click();
  const restored = page.getByTestId("formal-ttrpg-campaign-guide");
  await expect(restored.getByTestId("ttrpg-action-receipt")).toBeVisible({
    timeout: 15_000,
  });
  await expect(restored).toContainText("Session Zero 已完成");
  await expect(restored.getByTestId("ttrpg-long-campaign")).toContainText(
    "已完成 1 场",
  );
});

test.skip("Golden A 页面排练：d20 三级混合队伍、濒死资源村规、AI KP 候选与接管边界", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  await createWorldThroughProductUi(page);
  await configureProductionHeader(
    page,
    "潮门英雄骰短战役",
    "两名真人与一名 AI 调查者进入潮门档案室，在探索、交涉与冲突中查明印章真相。",
  );
  await configureGoldenD20Table(page);
  const guide = await buildAndPreview(page);
  await completeSessionZero(page, true);
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await expect(guide).toContainText("等级 3");
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await guide
    .getByLabel("角色行动声明")
    .fill("我借助训练检查封条，并准备在书记员阻拦时保护同伴。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算/ })
    .first()
    .click();
  await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
    "行动终态回执",
  );
  await ensureAiGmExperimentEnabled(guide);
  await guide
    .getByRole("button", { name: "生成受治理候选", exact: true })
    .click();
  await expect(
    guide.getByRole("button", { name: "确认并写入叙事", exact: true }),
  ).toBeVisible();
  await guide
    .getByRole("button", { name: "确认并写入叙事", exact: true })
    .click();
  await expect(guide.getByTestId("formal-ttrpg-gm-narration")).toContainText(
    "AI GM",
  );
});

test.skip("Golden B 页面排练：d100 六线索、双 AI 玩家、暗骰投影与 AI KP", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  await createWorldThroughProductUi(page);
  await configureProductionHeader(
    page,
    "潮门六证词调查团",
    "一名真人与两名 AI 调查者追索六条相互独立的证据；失败必须带来代价但不能封死真相。",
  );
  await configureGoldenD100Table(page);
  const guide = await buildAndPreview(page);
  await expect(guide.getByLabel("玩家 1角色 控制方式")).toHaveValue("human");
  await completeSessionZero(page, true);
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await expect(guide).toContainText("场景路径8 个场景");

  const activeActor = guide.getByTestId("ttrpg-active-actor");
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await expect(activeActor).toContainText("真人");
  await guide.getByLabel("检定可见性").first().selectOption("gm-only");
  await guide
    .getByLabel("角色行动声明")
    .fill("我逐项比对账册时间与封条纤维，并把可公开的部分告诉队伍。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算/ })
    .first()
    .click();
  await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
    "行动终态回执",
  );

  await ensureAiGmExperimentEnabled(guide);
  await guide
    .getByRole("button", { name: "生成受治理候选", exact: true })
    .click();
  await expect(
    guide.getByRole("button", { name: "确认并写入叙事", exact: true }),
  ).toBeVisible();
  await guide
    .getByRole("button", { name: "确认并写入叙事", exact: true })
    .click();

  await guide.getByRole("button", { name: "玩家视图", exact: true }).click();
  await guide.getByRole("button", { name: /查看角色：玩家 1角色/ }).click();
  await expect(guide).toContainText("暗骰已提交");
  await expect(guide).not.toContainText(
    "隐瞒账册经手人的身份，只向本角色与 KP 公开。",
  );
  await expect(guide).not.toContainText(
    "保护低语外廊的证人，只向本角色与 KP 公开。",
  );
});

test.skip("同一冻结 WorldRelease 的三条指令生成三种可区分 TTRPG 产品，而非换名模板", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await configureMockedTextProvider(page);
  await createWorldThroughProductUi(page);

  await configureProductionHeader(
    page,
    "同源 d20 英雄团",
    "守潮傀儡伏击后，队伍必须经历探索、交涉与密库战斗。",
  );
  await configureGoldenD20Table(page);
  const d20Guide = await buildAndPreview(page);
  await expect(d20Guide).toContainText("StoryForge 5E 兼容奇幻核心");
  await expect(d20Guide).toContainText("潮门伏击");
  const releaseA = await returnToFreshProduction(page);

  await configureProductionHeader(
    page,
    "同源 d100 六证词团",
    "围绕互相冲突的六条证词调查印章替换案，失败也必须继续。",
  );
  await configureGoldenD100Table(page);
  const d100Guide = await buildAndPreview(page);
  await expect(d100Guide).toContainText("StoryForge d100 调查规则");
  await expect(d100Guide).toContainText("低语外廊");
  await expect(d100Guide).toContainText("封印账册");
  const releaseB = await returnToFreshProduction(page);

  await configureProductionHeader(
    page,
    "同源 Rank Lite 即时团",
    "三名真人在九十分钟内查明档案室封条异常并选择公开或封存证据。",
  );
  await configureRankLiteTable(page);
  const rankGuide = await buildAndPreview(page);
  await expect(rankGuide).toContainText("Rank Lite");
  await expect(rankGuide).toContainText("封锁的档案室");
  await expect(rankGuide).not.toContainText("潮门伏击");
  await expect(rankGuide).not.toContainText("低语外廊");

  const releaseC = await returnToFreshProduction(page);
  expect(new Set([releaseA, releaseB, releaseC])).toEqual(new Set([releaseA]));
});
