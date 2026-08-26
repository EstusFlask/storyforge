import {
  AuthoritativeOnlineRoomV1,
  OnlineRoomAuthorityError,
  type OnlineRoomCommandV1,
} from "./room-authority";
import type { OnlineRoomRealtimeCoordinatorV1 } from "./realtime-hub";

export interface OnlineRoomGatewayRequestV1 {
  method: string;
  path: string;
  contentType: string;
  body: unknown;
  signal?: AbortSignal;
}

export interface OnlineRoomGatewayResponseV1 {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface OnlineRoomGatewayAuditV1 {
  path: string;
  roomId: string | null;
  memberId: string | null;
  requestId: string | null;
  outcome: "accepted" | "rejected";
  code: string;
  status: number;
  latencyMs: number;
}

export interface OnlineRoomAuthorityRegistryV1 {
  load(roomId: string): Promise<AuthoritativeOnlineRoomV1 | null>;
  /** Deployment boundary: validates identity/entitlement before provisioning. */
  create?(input: {
    requestId: string;
    roomId: string;
    releaseHash: string;
    selectedCharacterKeys: string[];
    creatorAccessToken: string;
    gmDisplayName: string;
  }): Promise<{
    room: AuthoritativeOnlineRoomV1;
    gm: Awaited<ReturnType<typeof AuthoritativeOnlineRoomV1.create>>["gm"];
  }>;
  joinAuthenticated?(input: {
    requestId: string;
    roomId: string;
    inviteId: string;
    inviteToken: string;
    memberAccessToken: string;
    displayName: string;
  }): Promise<{
    room: AuthoritativeOnlineRoomV1;
    member: Awaited<ReturnType<AuthoritativeOnlineRoomV1["join"]>>;
  }>;
  resumeAuthenticated?(input: {
    roomId: string;
    memberAccessToken: string;
  }): Promise<{
    room: AuthoritativeOnlineRoomV1;
    member: Awaited<
      ReturnType<AuthoritativeOnlineRoomV1["resumeMemberByPrincipal"]>
    >;
  }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

function protocolError(message: string) {
  return new OnlineRoomAuthorityError("protocol", message);
}

function roomIdFrom(value: Record<string, unknown>): string {
  if (
    typeof value.roomId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.roomId)
  ) {
    throw protocolError("roomId 无效");
  }
  return value.roomId;
}

function memberCredentials(value: Record<string, unknown>): {
  roomId: string;
  memberId: string;
  authToken: string;
} {
  const roomId = roomIdFrom(value);
  if (
    typeof value.memberId !== "string" ||
    !value.memberId.trim() ||
    value.memberId.length > 200
  ) {
    throw protocolError("memberId 无效");
  }
  if (
    typeof value.authToken !== "string" ||
    !value.authToken.trim() ||
    value.authToken.length > 500
  ) {
    throw protocolError("authToken 无效");
  }
  return { roomId, memberId: value.memberId, authToken: value.authToken };
}

function statusFor(code: string): number {
  if (code === "unauthorized") return 401;
  if (["forbidden", "actor_spoof"].includes(code)) return 403;
  if (code === "room_not_found") return 404;
  if (
    [
      "stale_cursor",
      "request_conflict",
      "seat_taken",
      "release_spoof",
      "release_mismatch",
      "room_mismatch",
      "persistence_conflict",
      "domain_rejected",
      "transfer_invalid",
      "transfer_conflict",
    ].includes(code)
  )
    return 409;
  if (code === "rate_limited") return 429;
  if (code === "request_aborted") return 408;
  if (["service_unavailable", "domain_configuration"].includes(code))
    return 503;
  if (
    [
      "protocol",
      "protocol_version",
      "domain_protocol",
      "payload_too_large",
      "cursor_invalid",
    ].includes(code)
  )
    return 422;
  return 400;
}

function response(status: number, body: unknown): OnlineRoomGatewayResponseV1 {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body,
  };
}

/**
 * Framework-neutral server gateway. A deployment adapter may translate an
 * HTTP request to this contract, but authentication tokens and command
 * payloads never enter the audit record produced here.
 */
export function createOnlineRoomGatewayV1(input: {
  rooms: OnlineRoomAuthorityRegistryV1;
  realtime?: OnlineRoomRealtimeCoordinatorV1;
  audit?: (entry: OnlineRoomGatewayAuditV1) => void | Promise<void>;
  now?: () => number;
}) {
  const now = input.now ?? (() => Date.now());
  return async (
    request: OnlineRoomGatewayRequestV1,
  ): Promise<OnlineRoomGatewayResponseV1> => {
    const startedAt = now();
    let roomId: string | null = null;
    let memberId: string | null = null;
    let requestId: string | null = null;
    let result: OnlineRoomGatewayResponseV1 = response(500, {
      code: "internal_error",
      message: "在线房间服务未产生响应",
    });
    let code = "ok";
    try {
      if (request.method.toUpperCase() !== "POST") {
        result = response(405, {
          code: "method_not_allowed",
          message: "只支持 POST",
        });
        code = "method_not_allowed";
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        result = response(415, {
          code: "unsupported_media_type",
          message: "请求必须使用 application/json",
        });
        code = "unsupported_media_type";
      } else {
        const encoded = JSON.stringify(request.body);
        if (encoded === undefined || encoded.length > 96_000) {
          throw new OnlineRoomAuthorityError(
            "payload_too_large",
            "请求体超过 96KB",
          );
        }
        const body = record(request.body);
        if (!body) throw protocolError("请求体必须是对象");
        roomId = typeof body.roomId === "string" ? body.roomId : null;
        memberId = typeof body.memberId === "string" ? body.memberId : null;
        requestId = typeof body.requestId === "string" ? body.requestId : null;
        const resolvedRoomId = roomIdFrom(body);
        if (request.path === "/v1/rooms") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "requestId",
              "roomId",
              "releaseHash",
              "selectedCharacterKeys",
              "creatorAccessToken",
              "gmDisplayName",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.requestId !== "string" ||
            typeof body.releaseHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(body.releaseHash) ||
            !Array.isArray(body.selectedCharacterKeys) ||
            body.selectedCharacterKeys.length < 1 ||
            body.selectedCharacterKeys.length > 20 ||
            body.selectedCharacterKeys.some(
              (value) =>
                typeof value !== "string" ||
                !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value),
            ) ||
            new Set(body.selectedCharacterKeys).size !==
              body.selectedCharacterKeys.length ||
            typeof body.creatorAccessToken !== "string" ||
            !body.creatorAccessToken.trim() ||
            body.creatorAccessToken.length > 2_000 ||
            typeof body.gmDisplayName !== "string" ||
            !body.gmDisplayName.trim() ||
            body.gmDisplayName.length > 100
          ) {
            throw protocolError("创建房间请求字段不符合协议");
          }
        } else if (request.path === "/v1/rooms/invites") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "gmMemberId",
              "gmAuthToken",
              "role",
              "actorKey",
              "expiresAt",
              "maximumUses",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.gmMemberId !== "string" ||
            typeof body.gmAuthToken !== "string" ||
            !["player", "spectator"].includes(String(body.role)) ||
            (body.actorKey != null && typeof body.actorKey !== "string") ||
            !Number.isInteger(body.expiresAt) ||
            !Number.isInteger(body.maximumUses)
          ) {
            throw protocolError("房间邀请请求字段不符合协议");
          }
          memberId = body.gmMemberId;
        } else if (request.path === "/v1/rooms/join") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "inviteId",
              "inviteToken",
              "displayName",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.inviteId !== "string" ||
            typeof body.inviteToken !== "string" ||
            typeof body.displayName !== "string" ||
            !body.displayName.trim() ||
            body.displayName.length > 100
          ) {
            throw protocolError("加入房间请求字段不符合协议");
          }
        } else if (request.path === "/v1/rooms/join-account") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "requestId",
              "roomId",
              "inviteId",
              "inviteToken",
              "memberAccessToken",
              "displayName",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.requestId !== "string" ||
            typeof body.inviteId !== "string" ||
            typeof body.inviteToken !== "string" ||
            typeof body.memberAccessToken !== "string" ||
            !body.memberAccessToken.trim() ||
            body.memberAccessToken.length > 2_000 ||
            typeof body.displayName !== "string" ||
            !body.displayName.trim() ||
            body.displayName.length > 100
          ) {
            throw protocolError("账号加入房间请求字段不符合协议");
          }
        } else if (request.path === "/v1/rooms/session") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberAccessToken",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.memberAccessToken !== "string" ||
            !body.memberAccessToken.trim() ||
            body.memberAccessToken.length > 2_000
          ) {
            throw protocolError("账号恢复房间请求字段不符合协议");
          }
        } else if (request.path === "/v1/rooms/commands") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "releaseHash",
              "requestId",
              "memberId",
              "authToken",
              "expectedSequence",
              "kind",
              "actorKey",
              "payload",
            ]) ||
            body.protocolVersion !== 1
          )
            throw protocolError("命令请求字段不符合协议");
        } else if (request.path === "/v1/rooms/reconnect") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberId",
              "authToken",
              "afterSequence",
            ]) ||
            body.protocolVersion !== 1 ||
            !Number.isInteger(body.afterSequence)
          ) {
            throw protocolError("重连请求字段不符合协议");
          }
          memberCredentials(body);
        } else if (request.path === "/v1/rooms/wait") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberId",
              "authToken",
              "afterSequence",
              "timeoutMs",
            ]) ||
            body.protocolVersion !== 1 ||
            !Number.isInteger(body.afterSequence) ||
            Number(body.afterSequence) < 0 ||
            !Number.isInteger(body.timeoutMs)
          ) {
            throw protocolError("实时等待请求字段不符合协议");
          }
          memberCredentials(body);
        } else if (request.path === "/v1/rooms/disconnect") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberId",
              "authToken",
            ]) ||
            body.protocolVersion !== 1
          ) {
            throw protocolError("断线请求字段不符合协议");
          }
          memberCredentials(body);
        } else if (request.path === "/v1/rooms/members") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberId",
              "authToken",
            ]) ||
            body.protocolVersion !== 1
          ) {
            throw protocolError("成员列表请求字段不符合协议");
          }
          memberCredentials(body);
        } else if (request.path === "/v1/rooms/gm-transfer") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "gmMemberId",
              "gmAuthToken",
              "targetMemberId",
              "expiresAt",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.gmMemberId !== "string" ||
            typeof body.gmAuthToken !== "string" ||
            typeof body.targetMemberId !== "string" ||
            !Number.isInteger(body.expiresAt)
          ) {
            throw protocolError("主持移交请求字段不符合协议");
          }
          memberId = body.gmMemberId;
        } else if (request.path === "/v1/rooms/gm-transfer/accept") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "memberId",
              "authToken",
              "transferId",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.transferId !== "string"
          ) {
            throw protocolError("主持移交确认请求字段不符合协议");
          }
          memberCredentials(body);
        } else if (request.path === "/v1/rooms/gm-transfer/cancel") {
          if (
            !exactKeys(body, [
              "protocolVersion",
              "roomId",
              "gmMemberId",
              "gmAuthToken",
              "transferId",
            ]) ||
            body.protocolVersion !== 1 ||
            typeof body.gmMemberId !== "string" ||
            typeof body.gmAuthToken !== "string" ||
            typeof body.transferId !== "string"
          ) {
            throw protocolError("主持移交取消请求字段不符合协议");
          }
          memberId = body.gmMemberId;
        } else {
          result = response(404, {
            code: "endpoint_not_found",
            message: "在线房间端点不存在",
          });
          code = "endpoint_not_found";
        }
        if (code === "endpoint_not_found") {
          // Unknown routes are closed before registry access.
        } else {
          if (request.path === "/v1/rooms") {
            if (!input.rooms.create)
              throw new OnlineRoomAuthorityError(
                "service_unavailable",
                "当前部署未配置房间创建服务",
              );
            const created = await input.rooms.create({
              requestId: String(body.requestId),
              roomId: resolvedRoomId,
              releaseHash: String(body.releaseHash),
              creatorAccessToken: String(body.creatorAccessToken),
              selectedCharacterKeys: structuredClone(
                body.selectedCharacterKeys as string[],
              ),
              gmDisplayName: String(body.gmDisplayName).trim(),
            });
            result = response(201, {
              roomId: created.room.roomId,
              releaseHash: created.room.releaseHash,
              member: created.gm.member,
              authToken: created.gm.authToken,
              cursor: 0,
            });
          } else if (request.path === "/v1/rooms/join-account") {
            if (!input.rooms.joinAuthenticated) {
              throw new OnlineRoomAuthorityError(
                "service_unavailable",
                "当前部署未配置账号席位服务",
              );
            }
            const joined = await input.rooms.joinAuthenticated({
              requestId: String(body.requestId),
              roomId: resolvedRoomId,
              inviteId: String(body.inviteId),
              inviteToken: String(body.inviteToken),
              memberAccessToken: String(body.memberAccessToken),
              displayName: String(body.displayName).trim(),
            });
            result = response(200, {
              roomId: joined.room.roomId,
              releaseHash: joined.room.releaseHash,
              ...joined.member,
            });
          } else if (request.path === "/v1/rooms/session") {
            if (!input.rooms.resumeAuthenticated) {
              throw new OnlineRoomAuthorityError(
                "service_unavailable",
                "当前部署未配置账号席位恢复服务",
              );
            }
            const resumed = await input.rooms.resumeAuthenticated({
              roomId: resolvedRoomId,
              memberAccessToken: String(body.memberAccessToken),
            });
            result = response(200, {
              roomId: resumed.room.roomId,
              releaseHash: resumed.room.releaseHash,
              ...resumed.member,
            });
          } else {
            const room = await input.rooms.load(resolvedRoomId);
            if (!room)
              throw new OnlineRoomAuthorityError(
                "room_not_found",
                "在线房间不存在",
              );
            if (request.path === "/v1/rooms/invites") {
              result = response(
                200,
                await room.issueInvite({
                  gmMemberId: String(body.gmMemberId),
                  gmAuthToken: String(body.gmAuthToken),
                  role: body.role as "player" | "spectator",
                  actorKey:
                    body.actorKey == null ? null : String(body.actorKey),
                  expiresAt: Number(body.expiresAt),
                  maximumUses: Number(body.maximumUses),
                }),
              );
            } else if (request.path === "/v1/rooms/join") {
              const joined = await room.join({
                inviteId: String(body.inviteId),
                inviteToken: String(body.inviteToken),
                displayName: String(body.displayName),
              });
              result = response(200, {
                roomId: room.roomId,
                releaseHash: room.releaseHash,
                ...joined,
              });
            } else if (request.path === "/v1/rooms/commands") {
              const receipt = await room.submit(
                body as unknown as OnlineRoomCommandV1,
              );
              await input.realtime?.notify(
                resolvedRoomId,
                receipt.acceptedSequence,
              );
              result = response(200, receipt);
            } else if (request.path === "/v1/rooms/reconnect") {
              const credentials = memberCredentials(body);
              result = response(
                200,
                await room.reconnect({
                  memberId: credentials.memberId,
                  authToken: credentials.authToken,
                  afterSequence: Number(body.afterSequence),
                }),
              );
            } else if (request.path === "/v1/rooms/wait") {
              if (!input.realtime) {
                throw new OnlineRoomAuthorityError(
                  "service_unavailable",
                  "当前部署未配置实时房间服务",
                );
              }
              const credentials = memberCredentials(body);
              result = response(
                200,
                await input.realtime.waitForAdvance({
                  room,
                  memberId: credentials.memberId,
                  authToken: credentials.authToken,
                  afterSequence: Number(body.afterSequence),
                  timeoutMs: Number(body.timeoutMs),
                  signal: request.signal,
                }),
              );
            } else if (request.path === "/v1/rooms/disconnect") {
              const credentials = memberCredentials(body);
              await room.disconnect(
                credentials.memberId,
                credentials.authToken,
              );
              result = response(200, { disconnected: true });
            } else if (request.path === "/v1/rooms/members") {
              const credentials = memberCredentials(body);
              result = response(200, {
                members: await room.listMembersForGm(
                  credentials.memberId,
                  credentials.authToken,
                ),
              });
            } else if (request.path === "/v1/rooms/gm-transfer") {
              const transfer = await room.proposeGmTransfer({
                gmMemberId: String(body.gmMemberId),
                gmAuthToken: String(body.gmAuthToken),
                targetMemberId: String(body.targetMemberId),
                expiresAt: Number(body.expiresAt),
              });
              await input.realtime?.notify(
                resolvedRoomId,
                transfer.acceptedSequence,
              );
              result = response(200, transfer);
            } else if (request.path === "/v1/rooms/gm-transfer/accept") {
              const credentials = memberCredentials(body);
              const transfer = await room.acceptGmTransfer({
                memberId: credentials.memberId,
                authToken: credentials.authToken,
                transferId: String(body.transferId),
              });
              await input.realtime?.notify(
                resolvedRoomId,
                transfer.acceptedSequence,
              );
              result = response(200, transfer);
            } else if (request.path === "/v1/rooms/gm-transfer/cancel") {
              const transfer = await room.cancelGmTransfer({
                gmMemberId: String(body.gmMemberId),
                gmAuthToken: String(body.gmAuthToken),
                transferId: String(body.transferId),
              });
              await input.realtime?.notify(
                resolvedRoomId,
                transfer.acceptedSequence,
              );
              result = response(200, transfer);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof OnlineRoomAuthorityError) {
        code = error.code;
        result = response(statusFor(error.code), {
          code: error.code,
          message: error.message.replace(/^\[online-room:[^\]]+\]\s*/, ""),
        });
      } else {
        code = "internal_error";
        result = response(500, { code, message: "在线房间服务发生内部错误" });
      }
    }
    await input.audit?.({
      path: request.path,
      roomId,
      memberId,
      requestId,
      outcome: result.status < 400 ? "accepted" : "rejected",
      code,
      status: result.status,
      latencyMs: Math.max(0, now() - startedAt),
    });
    return result;
  };
}
