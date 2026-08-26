import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db/schema";
import { hashGameProductionValueV2 } from "../../src/lib/game-production/hash";
import {
  openAIGptImage2AdapterV1,
  type MediaProviderTransportV1,
} from "../../src/lib/game-production/media-adapters";
import {
  branchSimulationSession,
  completeTtrpgSessionZero,
  deleteSimulationSession,
  openTtrpgCampaignScene,
  readSimulationState,
  readSimulationStateVersion,
} from "../../src/lib/simulation/runtime";
import {
  compileWorldReleaseToTtrpgCampaignDraftV1,
  installStoryForgeRulePackV1,
  saveTtrpgCampaignModuleV1,
} from "../../src/lib/ttrpg/authoring";
import { parseTtrpgCampaignContentV1 } from "../../src/lib/ttrpg/campaign";
import { publishTtrpgCampaignReleaseV1 } from "../../src/lib/ttrpg/release";
import {
  enqueueTtrpgRuntimeAssetRequestV1,
  processTtrpgRuntimeAssetRequestV1,
  readTtrpgRuntimeMediaBlobV1,
  readVisibleTtrpgRuntimeMediaRequestsV1,
  recoverTtrpgRuntimeMediaQueueV1,
  retryTtrpgRuntimeAssetRequestV1,
} from "../../src/lib/ttrpg/runtime-media";
import { parseRulePackV1 } from "../../src/lib/ttrpg/rule-pack";
import { createWorldInstance } from "../../src/lib/world-engine/instances";
import { ensureWorkspaceOwnership } from "../../src/lib/world-engine/ownership";
import type {
  SimulationSession,
  WorkspaceScope,
  WorldReleaseManifestV2,
} from "../../src/lib/types";

const now = 1_792_000_000_000;
const png = (() => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x04, 0x00], 16);
  bytes.set([0x00, 0x00, 0x02, 0x40], 20);
  return bytes.buffer;
})();

function manifest(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    characters: [
      {
        _exportId: 0,
        name: "林舟",
        identity: "调查者",
        location: "雾港",
        roleWeight: "main",
      },
    ],
    characterRelations: [],
    importantLocations: [
      { _exportId: 0, name: "雾港", description: "退潮时显露的旧港。" },
    ],
    storyArcs: [],
    itemLedger: [],
    codexEntries: [],
    avgMediaAssets: [],
    narrativeModules: [],
    narrativeNodes: [],
  };
  return {
    schema: "storyforge.world-package",
    version: 2,
    worldCode: "runtime-media",
    worldName: "潮汐界",
    workTitle: "运行时媒资验收",
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: [],
    records,
    portableProject: {},
  };
}

function transport(status = 200): MediaProviderTransportV1 {
  return {
    executionLocation: "trusted-relay",
    request: vi.fn(async () =>
      status === 200
        ? {
            status: 200,
            contentType: "application/json",
            body: null,
            json: {
              created: 1,
              data: [
                {
                  b64_json: btoa(String.fromCharCode(...new Uint8Array(png))),
                  revised_prompt: null,
                },
              ],
            },
            providerRequestId: "runtime-media-provider-1",
            usage: { images: 1 },
            costUsd: 0.08,
          }
        : {
            status,
            contentType: "application/json",
            body: null,
            json: { error: "provider unavailable" },
            providerRequestId: null,
            usage: null,
            costUsd: null,
          },
    ),
  };
}

async function createMediaSession(): Promise<{
  session: SimulationSession;
  scope: WorkspaceScope;
}> {
  const projectId = (await db.projects.add({
    name: "TTRPG 运行时媒资",
    genre: "fantasy",
    genres: ["fantasy"],
    status: "drafting",
    description: "",
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any)) as number;
  const scope = (await ensureWorkspaceOwnership(projectId)).scope;
  const world = manifest();
  const contentHash = await hashGameProductionValueV2(world);
  const worldReleaseId = (await db.worldReleases.add({
    projectId,
    worldId: scope.worldId,
    revisionId: 1,
    version: 1,
    label: "潮汐界 v1",
    manifestJson: JSON.stringify(world),
    contentHash,
    sourceWorldCode: world.worldCode,
    createdAt: now,
  })) as number;
  const rule = await installStoryForgeRulePackV1(scope);
  const draft = await compileWorldReleaseToTtrpgCampaignDraftV1({
    scope,
    worldReleaseId,
    rulePackId: rule.id,
    fixtureOnly: true,
    confirmDefaultMappings: true,
  });
  const rulePack = parseRulePackV1(rule.rulePackJson);
  const campaign = parseTtrpgCampaignContentV1(draft.contentJson, rulePack);
  const playerKey = campaign.characterTemplates.find(
    (character) => character.role === "player",
  )!.characterKey;
  campaign.visualBible = {
    schema: "storyforge.ttrpg-visual-bible",
    version: 1,
    style: {
      description: "雾港写实奇幻",
      medium: "数字叙事插画",
      composition: "空间关系清晰，人物身份稳定。",
      colorPalette: ["雾蓝", "铜金"],
      era: "潮汐奇幻",
      prohibitedElements: ["水印"],
      referenceLicense: "author-owned",
    },
    characters: [
      {
        characterKey: playerKey,
        identityPrompt: "林舟，深色雨衣的谨慎调查者。",
        silhouette: "长雨衣与录音机",
        attire: "雾港档案员服装",
        markers: ["旧录音机"],
        colorPalette: ["深蓝"],
        expressionBaselines: [
          { expressionKey: "neutral", prompt: "专注中性表情" },
        ],
        referenceAssetKeys: [],
      },
    ],
    locations: [],
    provenancePolicy: {
      rightsPolicyVersion: "storyforge-runtime-media-rights-v1",
      allowedSources: ["provider-generated"],
      requirePromptReceipt: true,
      requireHumanAdoptionForRelease: true,
    },
  };
  campaign.mediaManifest = {
    schema: "storyforge.ttrpg-media-manifest",
    version: 1,
    slots: [
      {
        slotKey: "scene.opening.runtime",
        kind: "scene",
        targetRef: campaign.openingSceneKey,
        audience: "public",
        productionRequired: false,
        assetKey: null,
        fallbackText: "雾港入口仍以文字正常游玩。",
        altText: "雾港开场图",
        promptTemplate: "雾港潮门开场，空间关系清晰。",
        width: 1536,
        height: 1024,
      },
      {
        slotKey: "scene.secret.runtime",
        kind: "scene",
        targetRef: campaign.openingSceneKey,
        audience: "gm-only",
        productionRequired: false,
        assetKey: null,
        fallbackText: "只有 KP 可见的潮门机关。",
        altText: "KP 秘密图",
        promptTemplate: "潮门机关的 KP 秘密视图。",
        width: 1536,
        height: 1024,
      },
      {
        slotKey: "portrait.player.runtime",
        kind: "character-portrait",
        targetRef: playerKey,
        audience: "private",
        productionRequired: false,
        assetKey: null,
        fallbackText: "林舟的文字肖像。",
        altText: "林舟肖像",
        promptTemplate: "林舟角色肖像。",
        width: 1024,
        height: 1536,
      },
    ],
    runtimePolicy: {
      enabled: true,
      networkPolicy: "any",
      maximumSessionCostUsd: 2,
      maximumConcurrentRequests: 1,
      maximumAttempts: 3,
      maximumGeneratedAssets: 3,
      allowProviderFallback: true,
    },
  };
  const saved = await saveTtrpgCampaignModuleV1({
    scope,
    sourceWorldReleaseId: worldReleaseId,
    rulePackId: rule.id!,
    campaign,
    status: "validated",
  });
  const release = await publishTtrpgCampaignReleaseV1({
    scope,
    campaignModuleId: saved.id!,
    testOnlyAllowFixtureCampaign: true,
  });
  const session = await createWorldInstance({
    scope,
    kind: "ttrpg",
    title: "雾港动态媒资团",
    worldGroupId: null,
    gameSource: { kind: "release", gameReleaseId: release.id! },
    seed: "runtime-media",
  });
  const state = await readSimulationState(session.id!);
  const version = await readSimulationStateVersion(session.id!);
  await completeTtrpgSessionZero({
    sessionId: session.id!,
    commandId: "session-zero.media",
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: "gm",
  });
  return { session, scope };
}

describe("R-TTRPG-3G · durable runtime media", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => db.close());

  it("先持久化请求、文字路径不停服，再采用统一媒资并按 viewer 隔离读取", async () => {
    const { session, scope } = await createMediaSession();
    const queued = await enqueueTtrpgRuntimeAssetRequestV1({
      sessionId: session.id!,
      viewerKey: "viewer.gm",
      slotKey: "scene.opening.runtime",
      requestKey: "runtime.scene.opening.1",
      adapterId: openAIGptImage2AdapterV1.capability.adapterId,
      adapter: openAIGptImage2AdapterV1,
      maximumRequestCostUsd: 0.5,
    });
    expect(queued).toMatchObject({
      status: "queued",
      mediaAssetId: null,
      costReservationUsd: 0.5,
    });
    const replayed = await enqueueTtrpgRuntimeAssetRequestV1({
      sessionId: session.id!,
      viewerKey: "viewer.gm",
      slotKey: "scene.opening.runtime",
      requestKey: "runtime.scene.opening.1",
      adapterId: openAIGptImage2AdapterV1.capability.adapterId,
      adapter: openAIGptImage2AdapterV1,
      maximumRequestCostUsd: 0.5,
    });
    expect(replayed.id).toBe(queued.id);
    expect(
      await db.simulationEvents
        .where("sessionId")
        .equals(session.id!)
        .filter((event) => event.type === "ttrpg.media.requested")
        .count(),
    ).toBe(1);

    const beforeScene = await readSimulationStateVersion(session.id!);
    await openTtrpgCampaignScene({
      sessionId: session.id!,
      commandId: "scene.open-while-media-queued",
      baseSequence: beforeScene.sequence,
      baseStateHash: beforeScene.stateHash,
      sceneKey: (await readSimulationState(session.id!)).ttrpg!.product!
        .openingSceneKey,
    });
    expect(
      (await readSimulationState(session.id!)).ttrpg?.product?.media?.slots[0],
    ).toMatchObject({
      status: "queued",
      fallbackText: "雾港入口仍以文字正常游玩。",
    });

    const available = await processTtrpgRuntimeAssetRequestV1({
      requestId: queued.id!,
      adapter: openAIGptImage2AdapterV1,
      transport: transport(),
    });
    expect(available).toMatchObject({
      status: "available",
      actualCostUsd: 0.08,
      mediaAssetId: expect.any(Number),
    });
    expect(await db.avgMediaAssets.get(available.mediaAssetId!)).toMatchObject({
      contentHash: available.mediaContentHash,
      width: 1024,
      height: 576,
    });
    await expect(
      readTtrpgRuntimeMediaBlobV1({
        scope,
        sessionId: session.id!,
        mediaAssetId: available.mediaAssetId!,
        viewerKey: "viewer.gm",
      }),
    ).resolves.toMatchObject({ size: png.byteLength, type: "image/png" });
    const playerViewer = (
      await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(session.id!)
        .toArray()
    ).find((row) => row.role === "player")!.viewerKey;
    const visible = await readVisibleTtrpgRuntimeMediaRequestsV1({
      sessionId: session.id!,
      viewerKey: playerViewer,
    });
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toMatch(
      /prompt|processorLease|lastErrorDetail/i,
    );
  });

  it("失败保留 fallback，可恢复、可重试；离线策略不绕过租约并释放确定未发生的成本", async () => {
    const { session } = await createMediaSession();
    const failed = await enqueueTtrpgRuntimeAssetRequestV1({
      sessionId: session.id!,
      viewerKey: "viewer.gm",
      slotKey: "scene.secret.runtime",
      requestKey: "runtime.scene.secret.1",
      adapterId: openAIGptImage2AdapterV1.capability.adapterId,
      adapter: openAIGptImage2AdapterV1,
      maximumRequestCostUsd: 0.4,
    });
    const providerFailure = await processTtrpgRuntimeAssetRequestV1({
      requestId: failed.id!,
      adapter: openAIGptImage2AdapterV1,
      transport: transport(503),
    });
    expect(providerFailure).toMatchObject({
      status: "failed",
      lastErrorCode: "provider-generation-failed",
    });
    expect(
      (await readSimulationState(session.id!)).ttrpg?.product?.media?.slots[1],
    ).toMatchObject({
      status: "failed",
      fallbackText: "只有 KP 可见的潮门机关。",
    });
    const playerViewer = (
      await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(session.id!)
        .toArray()
    ).find((row) => row.role === "player")!.viewerKey;
    expect(
      await readVisibleTtrpgRuntimeMediaRequestsV1({
        sessionId: session.id!,
        viewerKey: playerViewer,
      }),
    ).toEqual([]);

    const retried = await retryTtrpgRuntimeAssetRequestV1({
      requestId: failed.id!,
      viewerKey: "viewer.gm",
    });
    expect(retried.status).toBe("queued");
    await db.ttrpgRuntimeAssetRequests.update(retried.id!, {
      status: "generating",
      processorLeaseId: "expired-lease",
      processorLeaseExpiresAt: now - 1,
    });
    expect(
      await recoverTtrpgRuntimeMediaQueueV1({ sessionId: session.id!, now }),
    ).toBe(1);
    expect((await db.ttrpgRuntimeAssetRequests.get(retried.id!))?.status).toBe(
      "queued",
    );
    await expect(
      processTtrpgRuntimeAssetRequestV1({
        requestId: retried.id!,
        adapter: openAIGptImage2AdapterV1,
        transport: transport(),
        networkClass: "offline",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      lastErrorCode: "network-policy-blocked",
      actualCostUsd: 0,
    });

    await expect(
      enqueueTtrpgRuntimeAssetRequestV1({
        sessionId: session.id!,
        viewerKey: "viewer.gm",
        slotKey: "portrait.player.runtime",
        requestKey: "runtime.portrait.denied",
        adapterId: openAIGptImage2AdapterV1.capability.adapterId,
        adapter: openAIGptImage2AdapterV1,
        maximumRequestCostUsd: 0.4,
      }),
    ).rejects.toThrow("尚未同意生成肖像");
  });

  it("分支只继承分支点可见的队列/资产证据，删除 Instance 完整级联且不删除 Work 统一资产", async () => {
    const { session } = await createMediaSession();
    const queued = await enqueueTtrpgRuntimeAssetRequestV1({
      sessionId: session.id!,
      viewerKey: "viewer.gm",
      slotKey: "scene.opening.runtime",
      requestKey: "runtime.scene.branch.1",
      adapterId: openAIGptImage2AdapterV1.capability.adapterId,
      adapter: openAIGptImage2AdapterV1,
      maximumRequestCostUsd: 0.5,
    });
    const available = await processTtrpgRuntimeAssetRequestV1({
      requestId: queued.id!,
      adapter: openAIGptImage2AdapterV1,
      transport: transport(),
    });
    const throughSequence = (await readSimulationState(session.id!))
      .lastSequence;
    const child = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence,
      title: "媒资分支",
      seed: "media-branch",
    });
    expect(
      await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(child.id!)
        .first(),
    ).toMatchObject({
      requestKey: queued.requestKey,
      status: "available",
      mediaAssetId: available.mediaAssetId,
      processorLeaseId: null,
    });
    await deleteSimulationSession(session.id!);
    expect(
      await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(session.id!)
        .count(),
    ).toBe(0);
    expect(
      await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(child.id!)
        .count(),
    ).toBe(1);
    expect(await db.avgMediaAssets.get(available.mediaAssetId!)).toBeDefined();
    await deleteSimulationSession(child.id!);
    expect(
      await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(child.id!)
        .count(),
    ).toBe(0);
  });
});
