import type { TtrpgViewerProjectionV1 } from '../ttrpg/viewer-projection'
import type { OnlineDiceCommitmentSeriesV1 } from './verifiable-dice'

export interface OnlineTtrpgRoomChatEntryV1 {
  sequence: number
  memberId: string
  displayName: string
  role: 'gm' | 'player' | 'spectator'
  actorKey: string | null
  text: string
}

export interface OnlineTtrpgRoomProjectionV1 {
  schema: 'storyforge.online-ttrpg-projection'
  version: 1
  roomSequence: number
  campaign: TtrpgViewerProjectionV1
  recentChat: OnlineTtrpgRoomChatEntryV1[]
  diceCommitments: OnlineDiceCommitmentSeriesV1
}

function fail(message: string): never {
  throw new Error(`[online-ttrpg-projection] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    fail(`${label} 字段不符合闭集协议`)
  }
}

function boundedString(value: unknown, label: string, maximum: number, allowNull = false): string | null {
  if (allowNull && value == null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value
}

/**
 * Browser trust boundary for the domain projection returned by a room server.
 * It validates identity, role/privacy invariants and bounded collection sizes
 * before any service-provided string reaches the React tree.
 */
export function parseOnlineTtrpgRoomProjectionV1(value: unknown): OnlineTtrpgRoomProjectionV1 {
  const encoded = JSON.stringify(value)
  if (encoded === undefined || encoded.length > 2_000_000) fail('投影超过 2MB')
  const row = record(value, '投影')
  exact(row, ['schema', 'version', 'roomSequence', 'campaign', 'recentChat', 'diceCommitments'], '投影')
  if (row.schema !== 'storyforge.online-ttrpg-projection' || row.version !== 1
    || !Number.isInteger(row.roomSequence) || Number(row.roomSequence) < 0) fail('投影 schema/version/sequence 无效')

  const campaign = record(row.campaign, 'campaign')
  if (campaign.schema !== 'storyforge.ttrpg-viewer-projection' || campaign.version !== 1
    || !['gm', 'player', 'spectator'].includes(String(campaign.role))
    || !Array.isArray(campaign.actors) || campaign.actors.length > 100
    || !Array.isArray(campaign.scenes) || campaign.scenes.length > 2_000
    || !Array.isArray(campaign.visibleClues) || campaign.visibleClues.length > 2_000
    || !Array.isArray(campaign.inventory) || campaign.inventory.length > 10_000
    || !Array.isArray(campaign.availableActions) || campaign.availableActions.length > 200
    || !Array.isArray(campaign.recentActions) || campaign.recentActions.length > 50
    || (campaign.recentIntentReceipts != null
      && (!Array.isArray(campaign.recentIntentReceipts)
        || campaign.recentIntentReceipts.length > 50))
    || (campaign.humanResponses != null
      && (!Array.isArray(campaign.humanResponses)
        || campaign.humanResponses.length > 100))
    || (campaign.pendingHumanResponses != null
      && (!Array.isArray(campaign.pendingHumanResponses)
        || campaign.pendingHumanResponses.length > 100))
    || !Array.isArray(campaign.recentRests) || campaign.recentRests.length > 50
    || !Array.isArray(campaign.recentNarrations) || campaign.recentNarrations.length > 50
    || !Array.isArray(campaign.effectReceipts) || campaign.effectReceipts.length > 50
    || (campaign.pendingEffectChoices != null
      && (!Array.isArray(campaign.pendingEffectChoices)
        || campaign.pendingEffectChoices.length > 10_000))
    || !Array.isArray(campaign.visibleHandouts) || campaign.visibleHandouts.length > 500
    || !Array.isArray(campaign.quests) || campaign.quests.length > 500
    || !Array.isArray(campaign.ruleReference) || campaign.ruleReference.length > 1_000) {
    fail('campaign 基础结构无效')
  }
  const actorKey = boundedString(campaign.actorKey, 'campaign.actorKey', 200, true)
  if (campaign.gmController != null && !['human', 'ai', 'hybrid'].includes(String(campaign.gmController))) {
    fail('campaign.gmController 无效')
  }
  if (campaign.role === 'player' && !actorKey) fail('玩家投影缺少角色绑定')
  if (campaign.role !== 'player' && actorKey != null) fail('非玩家投影不得继承角色私密视图')
  if (campaign.role !== 'gm' && campaign.gmControls != null) fail('非 GM 投影包含主持控制')
  const humanResponses = Array.isArray(campaign.humanResponses) ? campaign.humanResponses : []
  for (const responseValue of humanResponses) {
    const response = record(responseValue, 'human response')
    exact(response, [
      'responseKey', 'eventSequence', 'actionSequence', 'actorKey',
      'kind', 'text', 'audience',
    ], 'human response')
    const responseActorKey = boundedString(response.actorKey, 'human response.actorKey', 200)!
    boundedString(response.responseKey, 'human response.responseKey', 200)
    boundedString(response.text, 'human response.text', 10_000)
    if (!Number.isInteger(response.eventSequence) || Number(response.eventSequence) < 1
      || !Number.isInteger(response.actionSequence) || Number(response.actionSequence) < 1
      || !['speak', 'act-narratively', 'decline'].includes(String(response.kind))
      || !['party', 'gm-only'].includes(String(response.audience))) {
      fail('human response 结构无效')
    }
    if (response.audience === 'gm-only' && campaign.role !== 'gm'
      && (campaign.role !== 'player' || actorKey !== responseActorKey)) {
      fail('投影泄露其他角色的 GM 私密回应')
    }
  }
  const pendingHumanResponses = Array.isArray(campaign.pendingHumanResponses)
    ? campaign.pendingHumanResponses
    : []
  if (campaign.role === 'spectator' && pendingHumanResponses.length) {
    fail('观战投影不得包含真人私密回应窗口')
  }
  for (const pendingValue of pendingHumanResponses) {
    const pending = record(pendingValue, 'pending human response')
    exact(pending, [
      'actionSequence', 'actionReceiptKey', 'sourceActorKey', 'actorKey',
    ], 'pending human response')
    const pendingActorKey = boundedString(pending.actorKey, 'pending human response.actorKey', 200)!
    boundedString(pending.actionReceiptKey, 'pending human response.actionReceiptKey', 200)
    boundedString(pending.sourceActorKey, 'pending human response.sourceActorKey', 200)
    if (!Number.isInteger(pending.actionSequence) || Number(pending.actionSequence) < 1) {
      fail('pending human response 结构无效')
    }
    if (campaign.role === 'player' && pendingActorKey !== actorKey) {
      fail('玩家投影包含其他角色的回应窗口')
    }
  }
  for (const actorValue of campaign.actors) {
    const actor = record(actorValue, 'actor')
    const projectedActorKey = boundedString(actor.actorKey, 'actor.actorKey', 200)!
    boundedString(actor.name, 'actor.name', 300)
    if (!['player', 'npc'].includes(String(actor.role)) || typeof actor.controlledByViewer !== 'boolean'
      || !Array.isArray(actor.attributes) || !Array.isArray(actor.resources) || !Array.isArray(actor.conditions)) {
      fail('actor 结构无效')
    }
    if (campaign.role !== 'gm' && actor.privateProfile != null
      && (campaign.role !== 'player' || projectedActorKey !== actorKey)) {
      fail('投影泄露其他角色或 NPC 的私密档案')
    }
  }
  for (const sceneValue of campaign.scenes) {
    const scene = record(sceneValue, 'scene')
    if (campaign.role !== 'gm' && (scene.gmSecret != null || scene.failureForward != null)) {
      fail('非 GM 投影包含场景主持信息')
    }
  }
  for (const clockValue of campaign.clocks as unknown[]) {
    const clock = record(clockValue, 'clock')
    if (!['gm-only', 'party', 'public'].includes(String(clock.visibility))) fail('clock.visibility 无效')
    if (campaign.role !== 'gm' && clock.visibility === 'gm-only') {
      fail('非 GM 投影包含 GM 私密时钟')
    }
  }
  for (const receiptValue of campaign.effectReceipts as unknown[]) {
    const receipt = record(receiptValue, 'effect receipt')
    exact(receipt, [
      'eventSequence', 'planKey', 'degree', 'sourceEventId', 'ruleRef',
      'reason', 'audience', 'transitions',
    ], 'effect receipt')
    if (!Number.isInteger(receipt.eventSequence) || Number(receipt.eventSequence) < 1
      || !Array.isArray(receipt.transitions) || receipt.transitions.length > 100) {
      fail('effect receipt 结构无效')
    }
    boundedString(receipt.planKey, 'effect receipt.planKey', 200)
    boundedString(receipt.sourceEventId, 'effect receipt.sourceEventId', 200)
    boundedString(receipt.ruleRef, 'effect receipt.ruleRef', 200)
    boundedString(receipt.reason, 'effect receipt.reason', 4_000)
    const audience = boundedString(receipt.audience, 'effect receipt.audience', 220)!
    if (!['public', 'party', 'gm'].includes(audience) && !audience.startsWith('actor:')) {
      fail('effect receipt.audience 无效')
    }
    if (campaign.role !== 'gm' && audience === 'gm') {
      fail('非 GM 投影包含 GM 私密效果账本')
    }
    if (campaign.role === 'spectator' && audience.startsWith('actor:')) {
      fail('观战投影包含角色私密效果账本')
    }
    if (campaign.role === 'player' && audience.startsWith('actor:')
      && audience !== `actor:${actorKey}`) {
      fail('玩家投影包含其他角色的私密效果账本')
    }
    for (const transitionValue of receipt.transitions) {
      const transition = record(transitionValue, 'effect transition')
      exact(transition, ['effectKey', 'family', 'operation', 'targetRef'], 'effect transition')
      boundedString(transition.effectKey, 'effect transition.effectKey', 200)
      boundedString(transition.family, 'effect transition.family', 100)
      boundedString(transition.operation, 'effect transition.operation', 100)
      boundedString(transition.targetRef, 'effect transition.targetRef', 200)
    }
  }
  const pendingEffectChoices = Array.isArray(campaign.pendingEffectChoices)
    ? campaign.pendingEffectChoices
    : []
  if (campaign.role === 'spectator' && pendingEffectChoices.length) {
    fail('观战投影不得包含玩家私密后果选择')
  }
  for (const choiceValue of pendingEffectChoices) {
    const choice = record(choiceValue, 'pending effect choice')
    exact(choice, [
      'choiceKey', 'proposedEventSequence', 'actionSequence', 'ownerActorKey',
      'degree', 'reason', 'options',
    ], 'pending effect choice')
    const ownerActorKey = boundedString(choice.ownerActorKey, 'pending effect choice.ownerActorKey', 200)!
    boundedString(choice.choiceKey, 'pending effect choice.choiceKey', 200)
    boundedString(choice.degree, 'pending effect choice.degree', 100)
    boundedString(choice.reason, 'pending effect choice.reason', 4_000)
    if (!Number.isInteger(choice.proposedEventSequence) || Number(choice.proposedEventSequence) < 1
      || !Number.isInteger(choice.actionSequence) || Number(choice.actionSequence) < 1
      || Number(choice.actionSequence) >= Number(choice.proposedEventSequence)
      || !Array.isArray(choice.options) || choice.options.length < 2 || choice.options.length > 100) {
      fail('pending effect choice 结构无效')
    }
    if (campaign.role === 'player' && ownerActorKey !== actorKey) {
      fail('玩家投影包含其他角色的私密后果选择')
    }
    for (const optionValue of choice.options) {
      const option = record(optionValue, 'pending effect option')
      exact(option, ['effectKey', 'family', 'operation', 'targetRef', 'detail'], 'pending effect option')
      boundedString(option.effectKey, 'pending effect option.effectKey', 200)
      boundedString(option.family, 'pending effect option.family', 100)
      boundedString(option.operation, 'pending effect option.operation', 100)
      boundedString(option.detail, 'pending effect option.detail', 1_000)
      const targetRef = boundedString(option.targetRef, 'pending effect option.targetRef', 200)!
      if (targetRef !== ownerActorKey) fail('后果选择选项目标不是所有者')
    }
  }
  const turn = record(campaign.turn, 'campaign.turn')
  if (!Number.isInteger(turn.round) || Number(turn.round) < 0 || !Array.isArray(turn.actorKeys)
    || turn.actorKeys.length > 100 || !Array.isArray(turn.initiative) || turn.initiative.length > 100
    || (turn.budget != null && (!record(turn.budget, 'campaign.turn.budget')
      || !['actionsRemaining', 'reactionsRemaining', 'freeActionsRemaining'].every(key => Number.isInteger((turn.budget as Record<string, unknown>)[key]))))) {
    fail('campaign.turn 无效')
  }
  const normalizedInventory = campaign.inventory.map(itemValue => {
    const item = record(itemValue, 'inventory item')
    boundedString(item.itemInstanceId, 'inventory.itemInstanceId', 200)
    boundedString(item.definitionRef, 'inventory.definitionRef', 200)
    boundedString(item.title, 'inventory.title', 300)
    const allowedEquipSlots = item.allowedEquipSlots == null ? [] : item.allowedEquipSlots
    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1 || !Array.isArray(item.equippedSlots)
      || !Array.isArray(allowedEquipSlots)
      || allowedEquipSlots.some(slot => typeof slot !== 'string' || !slot)
      || !Array.isArray(item.stateTags) || !['unknown', 'partly-known', 'identified'].includes(String(item.identification))) {
      fail('inventory item 结构无效')
    }
    return {
      ...structuredClone(itemValue as Record<string, unknown>),
      attunedToActorRef: boundedString(item.attunedToActorRef, 'inventory.attunedToActorRef', 200, true),
      allowedEquipSlots: structuredClone(allowedEquipSlots) as string[],
      requiresAttunement: item.requiresAttunement === true,
      maximumDurability: item.maximumDurability == null ? null : Number(item.maximumDurability),
      canUse: item.canUse === true,
    }
  })
  const normalizedGmControls = campaign.gmControls == null
    ? null
    : {
        ...(structuredClone(campaign.gmControls) as NonNullable<TtrpgViewerProjectionV1['gmControls']>),
        itemDefinitions: Array.isArray((campaign.gmControls as Record<string, unknown>).itemDefinitions)
          ? structuredClone((campaign.gmControls as Record<string, unknown>).itemDefinitions) as NonNullable<TtrpgViewerProjectionV1['gmControls']>['itemDefinitions']
          : [],
      }
  if (normalizedGmControls && (
    !Array.isArray(normalizedGmControls.openableScenes)
    || !Array.isArray(normalizedGmControls.currentClues)
    || !Array.isArray(normalizedGmControls.endings)
    || normalizedGmControls.itemDefinitions.length > 10_000
    || normalizedGmControls.itemDefinitions.some(item =>
      !item || typeof item.itemKey !== 'string' || !item.itemKey
      || typeof item.title !== 'string' || !item.title
      || !Number.isInteger(item.maximumStack) || item.maximumStack < 1)
  )) fail('campaign.gmControls 无效')

  if (!Array.isArray(row.recentChat) || row.recentChat.length > 100) fail('recentChat 无效')
  const recentChat = row.recentChat.map(value => {
    const chat = record(value, 'chat')
    exact(chat, ['sequence', 'memberId', 'displayName', 'role', 'actorKey', 'text'], 'chat')
    if (!Number.isInteger(chat.sequence) || Number(chat.sequence) < 1
      || !['gm', 'player', 'spectator'].includes(String(chat.role))) fail('chat 字段无效')
    return {
      sequence: Number(chat.sequence),
      memberId: boundedString(chat.memberId, 'chat.memberId', 200)!,
      displayName: boundedString(chat.displayName, 'chat.displayName', 100)!,
      role: chat.role as OnlineTtrpgRoomChatEntryV1['role'],
      actorKey: boundedString(chat.actorKey, 'chat.actorKey', 200, true),
      text: boundedString(chat.text, 'chat.text', 4_000)!,
    }
  })
  const commitments = record(row.diceCommitments, 'diceCommitments')
  exact(commitments, ['schema', 'version', 'algorithm', 'roomId', 'releaseHash', 'commitments', 'rootHash'], 'diceCommitments')
  if (commitments.schema !== 'storyforge.online-dice-commitments' || commitments.version !== 1
    || commitments.algorithm !== 'sha256-sequential-seed-v1'
    || !Array.isArray(commitments.commitments) || commitments.commitments.length > 100_000
    || commitments.commitments.some(item => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item))
    || typeof commitments.releaseHash !== 'string' || !/^[a-f0-9]{64}$/.test(commitments.releaseHash)
    || typeof commitments.rootHash !== 'string' || !/^[a-f0-9]{64}$/.test(commitments.rootHash)) {
    fail('骰子承诺结构无效')
  }
  boundedString(commitments.roomId, 'diceCommitments.roomId', 200)

  return {
    schema: 'storyforge.online-ttrpg-projection', version: 1,
    roomSequence: Number(row.roomSequence),
    campaign: {
      ...(structuredClone(row.campaign) as TtrpgViewerProjectionV1),
      recentIntentReceipts: Array.isArray(campaign.recentIntentReceipts)
        ? structuredClone(campaign.recentIntentReceipts) as TtrpgViewerProjectionV1['recentIntentReceipts']
        : [],
      humanResponses: structuredClone(humanResponses) as TtrpgViewerProjectionV1['humanResponses'],
      pendingHumanResponses: structuredClone(pendingHumanResponses) as TtrpgViewerProjectionV1['pendingHumanResponses'],
      pendingEffectChoices: structuredClone(pendingEffectChoices) as TtrpgViewerProjectionV1['pendingEffectChoices'],
      inventory: normalizedInventory as TtrpgViewerProjectionV1['inventory'],
      gmControls: normalizedGmControls,
    },
    recentChat,
    diceCommitments: structuredClone(row.diceCommitments) as OnlineDiceCommitmentSeriesV1,
  }
}
