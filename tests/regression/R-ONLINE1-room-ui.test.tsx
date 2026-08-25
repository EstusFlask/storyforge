import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TtrpgOnlineRoomPanel from "../../src/components/ttrpg/TtrpgOnlineRoomPanel";
import type { HostedOnlineRoomTransportV1 } from "../../src/lib/online/http-transport";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextarea(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(input: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  );
  if (!found) throw new Error(`找不到按钮：${label}`);
  return found;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PLATFORM-1B · online room product UI", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("建房响应丢失后使用同一 requestId 重试，并只按权威重连投影进入 GM 房间", async () => {
    const releaseHash = "a".repeat(64);
    let attempts = 0;
    const createRoom = vi.fn<HostedOnlineRoomTransportV1["createRoom"]>(
      async (input) => {
        attempts += 1;
        if (attempts === 1)
          throw new Error("[online-room-transport:timeout] 在线房间请求超时");
        return {
          roomId: input.roomId,
          releaseHash,
          member: {
            memberId: "member.gm",
            displayName: input.gmDisplayName,
            role: "gm",
            actorKey: null,
            connected: true,
            joinedAt: 1,
            lastSeenAt: 1,
          },
          authToken: "gm.recovered.credential",
          cursor: 0,
        };
      },
    );
    const transport: HostedOnlineRoomTransportV1 = {
      createRoom,
      issueInvite: vi.fn(async () => ({
        inviteId: "invite.1",
        inviteToken: "invite.token",
      })),
      joinRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      joinAuthenticatedRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      resumeAuthenticatedRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      waitForAdvance: vi.fn(
        (input) =>
          new Promise<{ cursor: number; timedOut: boolean }>((_, reject) => {
            input.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      ),
      listMembers: vi.fn(async () => []),
      proposeGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      acceptGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      cancelGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      submit: vi.fn(async () => {
        throw new Error("not used");
      }),
      reconnect: vi.fn(async () => ({
        cursor: 0,
        member: {
          memberId: "member.gm",
          displayName: "主持人",
          role: "gm",
          actorKey: null,
          connected: true,
          joinedAt: 1,
          lastSeenAt: 1,
        },
        events: [],
        projection: null,
      })),
      disconnect: vi.fn(async () => undefined),
    };
    await act(async () => {
      root.render(
        createElement(TtrpgOnlineRoomPanel, {
          releaseHash,
          selectedCharacterKeys: ["player.1"],
          characterNames: { "player.1": "调查者" },
          transport,
        }),
      );
    });
    await act(async () => {
      setInput(
        host.querySelector<HTMLInputElement>(
          '[aria-label="托管服务访问凭据"]',
        )!,
        "identity.access.token",
      );
    });
    await act(async () => {
      button(host, "创建并连接").click();
      await settle();
    });
    expect(host.textContent).toContain("在线房间请求超时");
    await act(async () => {
      button(host, "创建并连接").click();
      await settle();
    });
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[0][0].requestId).toBe(
      createRoom.mock.calls[1][0].requestId,
    );
    expect(host.textContent).toContain("主持人");
    expect(host.textContent).toContain("online · #0");
    expect(transport.reconnect).toHaveBeenCalledWith({
      roomId: expect.stringMatching(/^room\./),
      memberId: "member.gm",
      authToken: "gm.recovered.credential",
      afterSequence: 0,
    });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[aria-label="离开在线房间"]')!
        .click();
      await settle();
    });
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("创建房间");
  });

  it("未配置托管服务时明确降级，本地战役入口不被伪装成在线能力", async () => {
    await act(async () => {
      root.render(
        createElement(TtrpgOnlineRoomPanel, {
          releaseHash: "b".repeat(64),
          selectedCharacterKeys: ["player.1"],
          characterNames: { "player.1": "调查者" },
          transport: null,
        }),
      );
    });
    expect(
      host.querySelector('[data-testid="ttrpg-online-room-unconfigured"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("当前构建未配置托管房间服务");
    expect(host.textContent).toContain("本地战役仍可完整游玩");
  });

  it("被接受的招募只预填内存凭据，玩家明确确认后才消耗邀请并清空上层交接", async () => {
    const releaseHash = "c".repeat(64);
    const joinAuthenticatedRoom = vi.fn<
      HostedOnlineRoomTransportV1["joinAuthenticatedRoom"]
    >(async (input) => ({
      roomId: input.roomId,
      releaseHash,
      member: {
        memberId: "member.player",
        displayName: input.displayName,
        role: "player",
        actorKey: "investigator.chen",
        connected: true,
        joinedAt: 1,
        lastSeenAt: 1,
      },
      authToken: "member.session.secret",
      cursor: 0,
    }));
    const transport: HostedOnlineRoomTransportV1 = {
      createRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      issueInvite: vi.fn(async () => {
        throw new Error("not used");
      }),
      joinRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      joinAuthenticatedRoom,
      resumeAuthenticatedRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      waitForAdvance: vi.fn(
        (input) =>
          new Promise<{ cursor: number; timedOut: boolean }>((_, reject) => {
            input.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      ),
      listMembers: vi.fn(async () => []),
      proposeGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      acceptGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      cancelGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      submit: vi.fn(async () => {
        throw new Error("not used");
      }),
      reconnect: vi.fn(async () => ({
        cursor: 0,
        member: {
          memberId: "member.player",
          displayName: "陈调查员",
          role: "player",
          actorKey: "investigator.chen",
          connected: true,
          joinedAt: 1,
          lastSeenAt: 1,
        },
        events: [],
        projection: null,
      })),
      disconnect: vi.fn(async () => undefined),
    };
    const consumed = vi.fn();
    await act(async () => {
      root.render(
        createElement(TtrpgOnlineRoomPanel, {
          releaseHash,
          selectedCharacterKeys: ["investigator.chen"],
          characterNames: { "investigator.chen": "陈调查员" },
          transport,
          initialHandoff: {
            roomId: "room.lfg",
            releaseHash,
            actorKey: "investigator.chen",
            inviteId: "invite.lfg",
            inviteToken: "invite.secret.only-memory",
            displayName: "陈调查员",
            memberAccessToken: "account.secret.only-memory",
            expiresAt: Date.now() + 60_000,
          },
          onInitialHandoffConsumed: consumed,
        }),
      );
      await settle();
    });
    expect(
      host.querySelector('[data-testid="online-room-lfg-handoff"]'),
    ).not.toBeNull();
    expect(joinAuthenticatedRoom).not.toHaveBeenCalled();
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="加入的房间 ID"]')
        ?.value,
    ).toBe("room.lfg");
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="邀请 ID"]')?.value,
    ).toBe("invite.lfg");
    await act(async () => {
      button(host, "加入并连接").click();
      await settle();
    });
    expect(joinAuthenticatedRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "room.lfg",
        inviteId: "invite.lfg",
        inviteToken: "invite.secret.only-memory",
        memberAccessToken: "account.secret.only-memory",
        displayName: "陈调查员",
      }),
    );
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("陈调查员");
    expect(JSON.stringify(localStorage)).not.toContain("invite.secret");
  });

  it("目标玩家从权威事件自动看到主持移交，明确确认后界面切换为唯一 GM", async () => {
    const releaseHash = "d".repeat(64);
    const expiresAt = Date.now() + 60_000;
    let accepted = false;
    const player = {
      memberId: "member.player",
      displayName: "候选主持",
      role: "player" as const,
      actorKey: "player.1",
      connected: true,
      joinedAt: 1,
      lastSeenAt: 1,
    };
    const newGm = { ...player, role: "gm" as const, actorKey: null };
    const joinAuthenticatedRoom = vi.fn<
      HostedOnlineRoomTransportV1["joinAuthenticatedRoom"]
    >(async (input) => ({
      roomId: input.roomId,
      releaseHash,
      member: player,
      authToken: "player.room.secret",
      cursor: 0,
    }));
    const acceptGmTransfer = vi.fn<
      HostedOnlineRoomTransportV1["acceptGmTransfer"]
    >(async (input) => {
      expect(input.transferId).toBe("transfer.from-event");
      accepted = true;
      return {
        formerGm: {
          memberId: "member.old-gm",
          displayName: "原主持",
          role: "player",
          actorKey: "player.1",
          connected: true,
          joinedAt: 1,
          lastSeenAt: 2,
        },
        gm: newGm,
        acceptedSequence: 2,
      };
    });
    const transport: HostedOnlineRoomTransportV1 = {
      createRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      issueInvite: vi.fn(async () => ({
        inviteId: "unused",
        inviteToken: "unused",
      })),
      joinRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      joinAuthenticatedRoom,
      resumeAuthenticatedRoom: vi.fn(async () => {
        throw new Error("not used");
      }),
      waitForAdvance: vi.fn(
        (input) =>
          new Promise<{ cursor: number; timedOut: boolean }>((_, reject) => {
            input.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      ),
      listMembers: vi.fn(async () => [newGm]),
      proposeGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      acceptGmTransfer,
      cancelGmTransfer: vi.fn(async () => {
        throw new Error("not used");
      }),
      submit: vi.fn(async () => {
        throw new Error("not used");
      }),
      reconnect: vi.fn(async (input) =>
        accepted
          ? {
              cursor: 2,
              member: newGm,
              events:
                input.afterSequence < 2
                  ? [
                      {
                        sequence: 2,
                        eventType: "room.gm-transferred",
                        publicPayload: { transferId: "transfer.from-event" },
                        privatePayload: null,
                        resultingStateHash: "f".repeat(64),
                        createdAt: Date.now(),
                      },
                    ]
                  : [],
              projection: null,
            }
          : {
              cursor: 1,
              member: player,
              events:
                input.afterSequence < 1
                  ? [
                      {
                        sequence: 1,
                        eventType: "room.gm-transfer.proposed",
                        publicPayload: {
                          transferId: "transfer.from-event",
                          targetMemberId: player.memberId,
                          targetDisplayName: player.displayName,
                          expiresAt,
                        },
                        privatePayload: null,
                        resultingStateHash: "e".repeat(64),
                        createdAt: Date.now(),
                      },
                    ]
                  : [],
              projection: null,
            },
      ),
      disconnect: vi.fn(async () => undefined),
    };
    await act(async () => {
      root.render(
        createElement(TtrpgOnlineRoomPanel, {
          releaseHash,
          selectedCharacterKeys: ["player.1"],
          characterNames: { "player.1": "调查者" },
          transport,
          initialHandoff: {
            roomId: "room.transfer-ui",
            releaseHash,
            actorKey: "player.1",
            inviteId: "invite.transfer-ui",
            inviteToken: "invite.transfer-ui.secret",
            displayName: "候选主持",
            memberAccessToken: "identity.player.secret",
            expiresAt,
          },
        }),
      );
      await settle();
    });
    await act(async () => {
      button(host, "加入并连接").click();
      await settle();
    });
    expect(
      host.querySelector('[data-testid="incoming-gm-transfer"]'),
    ).not.toBeNull();
    const confirmation = button(host, "确认接任主持");
    expect(confirmation.disabled).toBe(false);
    await act(async () => {
      confirmation.click();
      await settle();
    });
    expect(acceptGmTransfer).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("刷新可移交成员");
    expect(
      host.querySelector('[data-testid="incoming-gm-transfer"]'),
    ).toBeNull();
  });

  it("玩家只从本人权威投影看到回应窗口，并以绑定 ActionReceipt 的命令提交私密回应", async () => {
    const releaseHash = "e".repeat(64);
    const member = {
      memberId: "member.response-owner",
      displayName: "岑遥",
      role: "player" as const,
      actorKey: "player.cen-yao",
      connected: true,
      joinedAt: 1,
      lastSeenAt: 1,
    };
    let responded = false;
    let itemUsed = false;
    const projection = () => ({
      schema: "storyforge.online-ttrpg-projection",
      version: 1,
      roomSequence: (responded ? 1 : 0) + (itemUsed ? 1 : 0),
      campaign: {
        schema: "storyforge.ttrpg-viewer-projection",
        version: 1,
        role: "player",
        actorKey: member.actorKey,
        eventSequence: itemUsed ? 9 : responded ? 8 : 7,
        safety: { status: "active", reason: null },
        turn: {
          round: 1,
          activeActorKey: "player.lin-zhou",
          actorKeys: ["player.lin-zhou", member.actorKey],
          budget: null,
          initiative: [],
        },
        actors: [{
          actorKey: member.actorKey,
          name: "岑遥",
          role: "player",
          controller: "human",
          controlledByViewer: true,
          characterSheet: {},
          privateProfile: null,
          attributes: [],
          resources: [],
          conditions: [],
        }],
        inventory: [{
          itemInstanceId: "item.player.cen-yao.focus",
          definitionRef: "focus-token",
          title: "洞察徽记",
          ownerRef: member.actorKey,
          quantity: 1,
          charges: itemUsed ? 0 : 1,
          durability: null,
          equippedSlots: [],
          attunedToActorRef: null,
          allowedEquipSlots: [],
          requiresAttunement: false,
          maximumDurability: null,
          canUse: !itemUsed,
          identification: "identified",
          stateTags: [],
        }],
        scenes: [{
          sceneKey: "scene.archive",
          status: "current",
          title: "旧档案室",
          description: "封蜡记录散落在桌面。",
          locationKey: "location.archive",
          failureForward: null,
          gmSecret: null,
        }],
        visibleClues: [],
        visibleHandoutKeys: [],
        visibleHandouts: [],
        visibleConclusionKeys: [],
        availableActions: [],
        recentActions: [],
        recentIntentReceipts: [],
        humanResponses: responded ? [{
          responseKey: "human-response.7.player.cen-yao",
          eventSequence: 8,
          actionSequence: 7,
          actorKey: member.actorKey,
          kind: "speak",
          text: "我只向主持人说明纸张批次。",
          audience: "gm-only",
        }] : [],
        pendingHumanResponses: responded ? [] : [{
          actionSequence: 7,
          actionReceiptKey: "action-receipt.7",
          sourceActorKey: "player.lin-zhou",
          actorKey: member.actorKey,
        }],
        recentRests: [],
        recentNarrations: [],
        effectReceipts: [],
        quests: [],
        clocks: [],
        ruleReference: [],
        gmControls: null,
        tabletop: null,
        media: null,
        continuity: {
          activeSessionKey: null,
          playSessions: [],
          roster: [],
          memories: [],
          supplements: [],
          worldEvolution: [],
          versionTransitions: [],
        },
        recap: {},
      },
      recentChat: [],
      diceCommitments: {
        schema: "storyforge.online-dice-commitments",
        version: 1,
        algorithm: "sha256-sequential-seed-v1",
        roomId: "room.human-response-ui",
        releaseHash,
        commitments: [],
        rootHash: "f".repeat(64),
      },
    });
    const submit = vi.fn<HostedOnlineRoomTransportV1["submit"]>(async command => {
      if (command.kind === "human.response") {
        expect(command).toMatchObject({
          actorKey: member.actorKey,
          payload: {
            actionSequence: 7,
            actionReceiptKey: "action-receipt.7",
            responseKind: "speak",
            text: "我只向主持人说明纸张批次。",
            audience: "gm-only",
          },
        });
        responded = true;
      } else {
        expect(command).toMatchObject({
          kind: "item.command",
          actorKey: member.actorKey,
          payload: { operation: {
            kind: "use",
            instanceId: "item.player.cen-yao.focus",
            expectedOwnerRef: member.actorKey,
            amount: 1,
          } },
        });
        itemUsed = true;
      }
      const sequence = (responded ? 1 : 0) + (itemUsed ? 1 : 0);
      return {
        requestId: command.requestId,
        acceptedSequence: sequence,
        duplicate: false,
        event: {
          sequence,
          eventType: `ttrpg.${command.kind}`,
          publicPayload: command.kind === "human.response"
            ? { actionSequence: 7, actorKey: member.actorKey, audience: "gm-only", recorded: true }
            : { operation: "use", itemInstanceId: "item.player.cen-yao.focus", changed: true },
          privatePayload: command.kind === "human.response"
            ? { actorKey: member.actorKey, text: "我只向主持人说明纸张批次。" }
            : { operation: "use", itemInstanceId: "item.player.cen-yao.focus" },
          resultingStateHash: "a".repeat(64),
          createdAt: Date.now(),
        },
      };
    });
    const transport: HostedOnlineRoomTransportV1 = {
      createRoom: vi.fn(async () => { throw new Error("not used"); }),
      issueInvite: vi.fn(async () => { throw new Error("not used"); }),
      joinRoom: vi.fn(async () => { throw new Error("not used"); }),
      joinAuthenticatedRoom: vi.fn(async input => ({
        roomId: input.roomId,
        releaseHash,
        member,
        authToken: "response-owner.room.secret",
        cursor: 0,
      })),
      resumeAuthenticatedRoom: vi.fn(async () => { throw new Error("not used"); }),
      waitForAdvance: vi.fn(input => new Promise((_, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
      listMembers: vi.fn(async () => [member]),
      proposeGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      acceptGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      cancelGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      submit,
      reconnect: vi.fn(async () => ({
        cursor: (responded ? 1 : 0) + (itemUsed ? 1 : 0),
        member,
        events: [],
        projection: projection(),
      })),
      disconnect: vi.fn(async () => undefined),
    };
    await act(async () => {
      root.render(createElement(TtrpgOnlineRoomPanel, {
        releaseHash,
        selectedCharacterKeys: [member.actorKey],
        characterNames: { [member.actorKey]: "岑遥" },
        transport,
        initialHandoff: {
          roomId: "room.human-response-ui",
          releaseHash,
          actorKey: member.actorKey,
          inviteId: "invite.response-owner",
          inviteToken: "invite.response-owner.secret",
          displayName: "岑遥",
          memberAccessToken: "identity.response-owner.secret",
          expiresAt: Date.now() + 60_000,
        },
      }));
      await settle();
    });
    await act(async () => {
      button(host, "加入并连接").click();
      await settle();
    });
    expect(host.querySelector('[data-testid="online-ttrpg-human-response"]')).not.toBeNull();
    await act(async () => {
      setTextarea(
        host.querySelector<HTMLTextAreaElement>('[aria-label="在线真人角色回应"]')!,
        "我只向主持人说明纸张批次。",
      );
      setSelect(
        host.querySelector<HTMLSelectElement>('[aria-label="在线真人回应受众"]')!,
        "gm-only",
      );
    });
    await act(async () => {
      button(host, "提交本人回应").click();
      await settle();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="online-ttrpg-human-response"]')).toBeNull();
    expect(host.textContent).toContain("我只向主持人说明纸张批次。");
    expect(host.textContent).toContain("仅本人和 GM");
    expect(host.textContent).toContain("充能 1");
    await act(async () => {
      button(host, "使用 1 次").click();
      await settle();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("充能 0");
    expect([...host.querySelectorAll("button")].some(item => item.textContent?.includes("使用 1 次"))).toBe(false);
  });

  it("GM 页面可实际提交自然语言意图、权威后果、AI 席位反馈和长期分场命令", async () => {
    const releaseHash = "9".repeat(64);
    const gm = {
      memberId: "member.gm-controls",
      displayName: "联机主持",
      role: "gm" as const,
      actorKey: null,
      connected: true,
      joinedAt: 1,
      lastSeenAt: 1,
    };
    let cursor = 0;
    let effectApplied = false;
    let narrationCommitted = false;
    let activeSession = false;
    let completedSession = false;
    let activeActorKey = "player.ai";
    const projection = () => ({
      schema: "storyforge.online-ttrpg-projection",
      version: 1,
      roomSequence: cursor,
      campaign: {
        schema: "storyforge.ttrpg-viewer-projection",
        version: 1,
        role: "gm",
        actorKey: null,
        gmController: "ai",
        eventSequence: 7 + cursor,
        safety: { status: "active", reason: null },
        turn: {
          round: 1,
          activeActorKey,
          actorKeys: ["player.ai", "npc.guide"],
          budget: { actionsRemaining: 1, reactionsRemaining: 1, freeActionsRemaining: 1 },
          initiative: [],
        },
        actors: [
          {
            actorKey: "player.ai", name: "AI 调查者", role: "player", controller: "ai",
            controlledByViewer: true, characterSheet: {}, privateProfile: null,
            attributes: [], resources: [{ key: "vigor", name: "体力", current: 5, maximum: 6 }], conditions: [],
          },
          {
            actorKey: "npc.guide", name: "守潮向导", role: "npc", controller: "gm",
            controlledByViewer: true, characterSheet: {}, privateProfile: null,
            attributes: [], resources: [], conditions: [],
          },
        ],
        inventory: [],
        scenes: [{
          sceneKey: "scene.archive", status: "current", title: "旧档案室",
          description: "潮湿封蜡散落桌面。", locationKey: "location.archive",
          failureForward: "失败仍留下纸张批次。", gmSecret: "记录由向导改写。",
        }],
        visibleClues: [], visibleHandoutKeys: [], visibleHandouts: [], visibleConclusionKeys: [],
        availableActions: [{
          actionKey: "investigate", name: "调查", description: "核对现场记录", phase: "action",
          target: "scene", costResourceKey: null, costResourceName: null, costAmount: 0, defaultDifficulty: 8,
        }],
        recentActions: [{
          eventSequence: 7, actionKey: "investigate", actionName: "调查", actorKey: "player.ai",
          targetKey: null, outcome: "success", dice: [15], modifier: 2, total: 17, difficulty: 8,
          resourceChanges: [], conditionChanges: [], receipt: null,
        }],
        recentIntentReceipts: [], humanResponses: [], pendingHumanResponses: [], recentRests: [],
        recentNarrations: narrationCommitted ? [{
          eventSequence: 9, actionSequence: 7, text: "潮痕记录显出新的时间差。",
          source: "ai-confirmed", audit: null, synthesisFrame: null,
        }] : [],
        effectReceipts: effectApplied ? [{
          eventSequence: 8, planKey: "online.effect.7", degree: "success",
          sourceEventId: "event.7", ruleRef: "investigate",
          reason: "KP 根据本次判定与当前场景结算后果。", audience: "party",
          transitions: [{ effectKey: "effect.clock", family: "story", operation: "clock.advance", targetRef: "player.ai" }],
        }] : [],
        quests: [],
        clocks: [{ clockKey: "clock.tide", title: "潮水回涨", current: effectApplied ? 2 : 1, maximum: 6, visibility: "party", completed: false, onComplete: null }],
        ruleReference: [],
        gmControls: { openableScenes: [], currentClues: [], endings: [], itemDefinitions: [] },
        tabletop: null, media: null,
        continuity: {
          activeSessionKey: activeSession ? "session.1" : null,
          playSessions: completedSession || activeSession ? [{
            sessionKey: "session.1", ordinal: 1, title: "雾港第一夜",
            status: activeSession ? "active" : "completed",
            participantKeys: ["player.ai"], summary: completedSession ? "自动事实回顾" : "",
          }] : [],
          roster: [], memories: [], supplements: [], worldEvolution: [], versionTransitions: [],
        },
        recap: {},
      },
      recentChat: [],
      diceCommitments: {
        schema: "storyforge.online-dice-commitments", version: 1,
        algorithm: "sha256-sequential-seed-v1", roomId: "room.gm-controls",
        releaseHash, commitments: [], rootHash: "8".repeat(64),
      },
    });
    const submit = vi.fn<HostedOnlineRoomTransportV1["submit"]>(async command => {
      cursor += 1;
      if (command.kind === "effects.apply") {
        expect(command.actorKey).toBeNull();
        expect(command.payload).toMatchObject({
          actionSequence: 7,
          plan: { sourceEventId: "event.7", ruleRef: "investigate", effects: [{ operation: "clock.advance" }] },
        });
        effectApplied = true;
      } else if (command.kind === "campaign.session.start") {
        expect(command.payload).toEqual({ title: "雾港第一夜" });
        activeSession = true;
      } else if (command.kind === "campaign.session.complete") {
        expect(command.payload).toMatchObject({ memoryAudience: "party" });
        activeSession = false;
        completedSession = true;
      } else if (command.kind === "ai.gm.narrate") {
        narrationCommitted = true;
      } else if (command.kind === "ai.gm.act") {
        expect(command.payload).toMatchObject({ objective: expect.stringContaining("当前 NPC") });
        activeActorKey = "player.ai";
      } else if (command.kind === "ai.player.run") {
        expect(command.payload).toMatchObject({ objective: expect.stringContaining("合法行动") });
        activeActorKey = "npc.guide";
      } else if (command.kind === "intent.submit") {
        expect(command.payload).toMatchObject({
          rawInput: "我核对封蜡上的潮痕时间。", actionKey: "investigate", targetKey: null,
        });
      } else {
        throw new Error(`unexpected command:${command.kind}`);
      }
      return {
        requestId: command.requestId,
        acceptedSequence: cursor,
        duplicate: false,
        event: {
          sequence: cursor, eventType: `ttrpg.${command.kind}`,
          publicPayload: { accepted: true }, privatePayload: null,
          resultingStateHash: "7".repeat(64), createdAt: Date.now(),
        },
      };
    });
    const transport: HostedOnlineRoomTransportV1 = {
      createRoom: vi.fn(async input => ({
        roomId: input.roomId, releaseHash, member: gm, authToken: "gm.controls.secret", cursor: 0,
      })),
      issueInvite: vi.fn(async () => ({ inviteId: "unused", inviteToken: "unused" })),
      joinRoom: vi.fn(async () => { throw new Error("not used"); }),
      joinAuthenticatedRoom: vi.fn(async () => { throw new Error("not used"); }),
      resumeAuthenticatedRoom: vi.fn(async () => { throw new Error("not used"); }),
      waitForAdvance: vi.fn(input => new Promise((_, reject) => {
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
      listMembers: vi.fn(async () => [gm]),
      proposeGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      acceptGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      cancelGmTransfer: vi.fn(async () => { throw new Error("not used"); }),
      submit,
      reconnect: vi.fn(async () => ({ cursor, member: gm, events: [], projection: projection() })),
      disconnect: vi.fn(async () => undefined),
    };
    await act(async () => {
      root.render(createElement(TtrpgOnlineRoomPanel, {
        releaseHash,
        selectedCharacterKeys: ["player.ai"],
        characterNames: { "player.ai": "AI 调查者" },
        transport,
      }));
    });
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="托管服务访问凭据"]')!, "identity.gm.secret");
      button(host, "创建并连接").click();
      await settle();
    });
    expect(host.querySelector('[data-testid="online-ttrpg-ai-player"]')).not.toBeNull();
    await act(async () => {
      setTextarea(host.querySelector<HTMLTextAreaElement>('[aria-label="在线自然语言行动"]')!, "我核对封蜡上的潮痕时间。");
      setSelect(host.querySelector<HTMLSelectElement>('[aria-label="在线意图规则行动"]')!, "investigate");
      button(host, "提交行动声明").click();
      await settle();
    });
    await act(async () => {
      button(host, "推进 AI 玩家回合").click();
      await settle();
    });
    expect(host.querySelector('[data-testid="online-ttrpg-ai-gm-actor"]')).not.toBeNull();
    await act(async () => {
      button(host, "推进在线 AI KP 的 NPC 回合").click();
      await settle();
    });
    await act(async () => {
      button(host, "提交权威后果").click();
      await settle();
    });
    expect(host.textContent).toContain("本次判定已有后果或待选项");
    await act(async () => {
      button(host, "由 AI KP 反馈最近判定").click();
      await settle();
    });
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="在线分场标题"]')!, "雾港第一夜");
      button(host, "宣布本场开始").click();
      await settle();
    });
    expect(host.textContent).toContain("正在进行：雾港第一夜");
    await act(async () => {
      button(host, "自动对账并结束本场").click();
      await settle();
    });
    expect(host.textContent).toContain("雾港第一夜 · 已结束");
    expect(submit.mock.calls.map(call => call[0].kind)).toEqual([
      "intent.submit", "ai.player.run", "ai.gm.act", "effects.apply", "ai.gm.narrate",
      "campaign.session.start", "campaign.session.complete",
    ]);
  });
});
