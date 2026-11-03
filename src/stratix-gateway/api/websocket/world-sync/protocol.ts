/**
 * 文件职责：world-sync WebSocket 协议契约层（前后端分离 B1 / task_081）—— 五种消息的类型、
 *   类型守卫（isXxx）、协议常量与 encode/decode 纯函数。
 * 输入：src/core/types.ts 的总线契约（WorldState / HudCommand，仅 type-only 导入 → 零运行时依赖）。
 * 输出：WorldSyncMessage 五型联合 + 守卫 + 纯函数（encodeMessage / decodeMessage / toWireState 等）。
 * 禁止事项：
 *   1. 引入任何运行时依赖 —— 尤其禁止依赖 ws（WebSocket 传输库）：本层是纯契约，传输层归 task_082；
 *   2. 在协议层裁决命令载荷的合法性 —— 载荷合法性由 core 状态机裁决（铁律 2「裁决在 core」）；
 *   3. 做增量合并 —— 重连 = 全量 snapshot 覆盖本地（铁律 1「真相唯一」）；
 *   4. 抛异常 —— 序列化/解析失败一律以返回值判别（null / ok=false），不抛不炸传输层。
 *
 * 方向语义（写死，见 docs/WORLD-SYNC.md）：
 *   客户端 → service：hello（注册）、command.forward（唯一的写入口）
 *   service → 客户端：snapshot（唯一的状态面）、command.ack（落点回执）、error（协议错误）
 *
 * 重连语义（写死）：
 *   客户端重连 = hello → service 立即回一份**全量** snapshot → 客户端整体覆盖本地视图。
 *   **不做增量合并**；snapshot.delta 是本期恒为 null 的预留字段位（防将来加字段变成破坏性变更）。
 *
 * 配套文档：docs/WORLD-SYNC.md（消息表 + 五场景时序图 + seq 规则 + 未附着语义）
 */

import type { HudCommand, WorldState } from '@/core/types';

// ============================================================================
// 协议常量
// ============================================================================

/**
 * 当前协议版本（service 与客户端协商用）。
 * 不兼容 → service 回 `error{code:'unsupported_version'}` 并断开该连接（不降级、不假装能通）。
 */
export const WORLD_SYNC_PROTOCOL_VERSION = 1;

/** 可接受的最低协议版本（含）。低于此值同样按 unsupported_version 拒绝。 */
export const WORLD_SYNC_MIN_PROTOCOL_VERSION = 1;

/** WS 端点路径（task_082 落地时挂载）。协议层只声明路径，不负责监听。 */
export const WORLD_SYNC_PATH = '/ws/world-sync';

/**
 * 首个 snapshot 的 seq（状态版本号起点）。
 * seq 由 service 侧**统一发号**：全 service 单调递增，不按连接分别计数。
 */
export const WORLD_SYNC_SEQ_START = 1;

/**
 * 命令回执超时（ms）—— service 等待 core 裁决落点的上限。
 * 超时不是成功：service 回 `command.ack{ok:false, error.code:'internal_error'}`（绝不假装成功，铁律 4）。
 */
export const WORLD_SYNC_ACK_TIMEOUT_MS = 5_000;

/** 消息类型词表（五型，封闭）。 */
export type WorldSyncMessageType =
  | 'hello'
  | 'snapshot'
  | 'command.forward'
  | 'command.ack'
  | 'error';

/** 五型消息的类型名清单（常量，供服务端分派与文档对齐）。 */
export const WORLD_SYNC_MESSAGE_TYPES: readonly WorldSyncMessageType[] = [
  'hello',
  'snapshot',
  'command.forward',
  'command.ack',
  'error',
] as const;

/**
 * 协议错误码词表。
 * - malformed_message：JSON 解析失败，或信封字段缺失/类型不对。
 * - unknown_message_type：type 不在五型之内。
 * - unsupported_version：hello 自报的协议版本不受支持。
 * - not_attached：状态面未附着（service 未启动 / 未接上 core store）—— 如实报不可用，不返回空态。
 * - rejected：core 状态机裁决拒绝该命令（业务拒绝，非协议错误）。
 * - internal_error：其它内部失败（含命令裁决超时）。
 */
export type WorldSyncErrorCode =
  | 'malformed_message'
  | 'unknown_message_type'
  | 'unsupported_version'
  | 'not_attached'
  | 'rejected'
  | 'internal_error';

/** 错误码白名单（运行时判定用）。 */
export const WORLD_SYNC_ERROR_CODES: readonly WorldSyncErrorCode[] = [
  'malformed_message',
  'unknown_message_type',
  'unsupported_version',
  'not_attached',
  'rejected',
  'internal_error',
] as const;

/**
 * 错误详情（挂在 command.ack.error 上）。
 * stale 标记：true = 状态面不可用，客户端必须把本地视图标记为不可信。
 */
export interface WorldSyncErrorDetail {
  readonly code: WorldSyncErrorCode;
  readonly message: string;
  /** true = 状态面未附着/已失效（客户端不得把本地旧态当真相）。 */
  readonly stale?: boolean;
  /** 下一步建议（一句话，人类可读）。 */
  readonly hint?: string;
}

// ============================================================================
// 消息类型（五型）
// ============================================================================

/**
 * hello —— 客户端 → service：连接注册。
 * 收到后 service 立即回一份全量 snapshot（重连亦然）。
 */
export interface HelloMessage {
  readonly type: 'hello';
  /** 客户端自报的协议版本，必须落在 [WORLD_SYNC_MIN_PROTOCOL_VERSION, WORLD_SYNC_PROTOCOL_VERSION]。 */
  readonly protocolVersion: number;
  /** 客户端实例 id（Electron 壳重启会换新 id）。service 侧用作连接日志与广播归属。 */
  readonly clientId: string;
}

/**
 * snapshot —— service → 客户端：全量世界状态。
 * seq 是状态版本号（service 统一发号，单调递增）。
 */
export interface SnapshotMessage {
  readonly type: 'snapshot';
  /** 状态版本号（service 侧统一发号，单调递增；首个 = WORLD_SYNC_SEQ_START）。 */
  readonly seq: number;
  /** 全量世界状态（wire 形态：selectionGroups 已从 Map 摊平成数组，见 WorldStateWire）。 */
  readonly state: WorldStateWire;
  /**
   * 预留字段位：本期恒为 null（不实现增量）。
   * why 预留：将来若引入增量 patch，字段已在契约里 → 「加字段」不是破坏性变更。
   */
  readonly delta?: null;
}

/**
 * command.forward —— 客户端 → service：HudCommand 信封。
 * 客户端**只能**经这一条写；命令载荷的合法性由 core 裁决（铁律 2）。
 */
export interface CommandForwardMessage {
  readonly type: 'command.forward';
  /** 命令 id（客户端生成、连接内唯一）。service 回 ack 用它关联。 */
  readonly commandId: string;
  /** 待裁决的 HUD 命令（与 src/core/types.ts 同源）。 */
  readonly command: HudCommand;
}

/**
 * command.ack —— service → 客户端：命令落点回执。
 * ok=true 表示 core 已裁决并落点；ok=false 必须带 error（失败必带原因，不假装成功）。
 */
export interface CommandAckMessage {
  readonly type: 'command.ack';
  /** 回执对应的命令 id（与 command.forward.commandId 一致）。 */
  readonly commandId: string;
  /** true = core 已裁决落点；false = 被拒 / 未附着 / 超时。 */
  readonly ok: boolean;
  /** 核对后的状态版本。状态面未附着时为 null（没有真相就没有版本号）。 */
  readonly seq: number | null;
  /** ok=false 时必填；ok=true 时不得出现。 */
  readonly error?: WorldSyncErrorDetail;
}

/**
 * error —— service → 客户端：协议错误信封（信封级问题：解不开、类型不认识、版本不兼容）。
 * 命令层面的失败不走这里，走 command.ack{ok:false}。
 */
export interface ErrorMessage {
  readonly type: 'error';
  readonly code: WorldSyncErrorCode;
  readonly message: string;
  /** 若该错误由某条命令引发，附带命令 id。 */
  readonly commandId?: string;
}

/** 五型消息联合。 */
export type WorldSyncMessage =
  | HelloMessage
  | SnapshotMessage
  | CommandForwardMessage
  | CommandAckMessage
  | ErrorMessage;

// ============================================================================
// WorldState 的 wire 形态
// ============================================================================

/** 编组槽位（wire 形态）：Map 摊平成数组项。 */
export interface ControlGroupWire {
  /** 槽位号（1..9，见 MAX_CONTROL_GROUP_SLOT）。 */
  readonly slot: number;
  /** 槽位内的单位 id 数组副本。 */
  readonly unitIds: readonly string[];
}

/**
 * WorldState 的 wire 形态：与 core 的 WorldState 同构，**只多一处差异** ——
 * selectionGroups 由 `ReadonlyMap<number, readonly string[]>` 摊平成 `ControlGroupWire[]`。
 * why：JSON 没有 Map（JSON.stringify(Map) 得 "{}"，编组会静默蒸发 —— 违反「全量覆盖即真相」），
 *   故协议层显式定义摊平形态，并在 toWireState / fromWireState 里做**无损**互转。
 */
export type WorldStateWire = Omit<WorldState, 'selectionGroups'> & {
  readonly selectionGroups?: readonly ControlGroupWire[];
};

/**
 * WorldState → wire 形态（摊平编组槽位）。
 * 纯函数、不改原对象；槽位按 slot 升序输出（保证同一状态多次序列化字节稳定）。
 */
export function toWireState(state: WorldState): WorldStateWire {
  const groups = state.selectionGroups;
  const wire: WorldStateWire = {
    ...state,
    selectionGroups: groups
      ? [...groups.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([slot, unitIds]) => ({ slot, unitIds: [...unitIds] }))
      : undefined,
  };
  return wire;
}

/**
 * wire 形态 → WorldState（把摊平的编组槽位还原成 Map）。
 * 纯函数；缺省 = 空 Map（与 core/store.ts 的初始态一致：空 Map 即「无编组」）。
 */
export function fromWireState(wire: WorldStateWire): WorldState {
  const groups = wire.selectionGroups ?? [];
  const map = new Map<number, readonly string[]>(
    groups.map((group) => [group.slot, [...group.unitIds]] as [number, readonly string[]]),
  );
  return { ...wire, selectionGroups: map };
}

// ============================================================================
// 类型守卫
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * HUD 命令类型名白名单。
 * why 用 `Record<HudCommand['type'], true>` 而不是 `string[]`：类型由 core/types.ts 推导，
 *   core 新增命令类型时本对象会**编译报错**（缺键）→ 协议与总线契约不会静默漂移；
 *   写错键名同样编译报错（多余属性）→ 不会放行一个 core 不认识的命令。
 */
const HUD_COMMAND_TYPE_FLAGS: Readonly<Record<HudCommand['type'], true>> = {
  'unit.select': true,
  'unit.focus': true,
  // @since v3.4（task_091）事件轨点选单位（HUD Z2 事件轨条目点击 → core → world 通道）。
  'focus.unit': true,
  'camera.center': true,
  'camera.shake': true,
  'camera.director': true,
  'unit.move': true,
  'unit.group.assign': true,
  'unit.group.recall': true,
  'mission.assign': true,
  'mission.confirm': true,
  'mission.create': true,
  'mission.cancel': true,
  'mission.checkpoint': true,
  'character.persona.update': true,
  'character.appearance.update': true,
  'character.contextEnabled.update': true,
  'character.name.update': true,
  'character.create': true,
  'chat.send': true,
  'ui.navigate': true,
  'theme.set': true,
  'link.open': true,
  'link.resume': true,
  'link.reconnect': true,
  'link.close': true,
  'settings.set': true,
  'selection.reset': true,
  'cache.clear': true,
  'task.assign': true,
  'task.cancel': true,
  'task.approve': true,
  'task.reject': true,
  'pipeline.start': true,
  // @since v3.40（task_091）会话中断（core/types.ts 新增）。本表由类型驱动，
  // core 加命令类型时必须在此补键 —— 缺键即编译报错（见上方注释「不会静默漂移」）。
  'session.interrupt': true,
  // @since v3.47（task_101 / v3.2b-B2）会话恢复（续聊）：与 session.interrupt 同一模式入册。
  'session.resume': true,
  // @since v3.48（task_102 / v3.2b-B3）会话分叉（从某条事件另起一条会话）：同一模式入册。
  'session.fork': true,
  // @since v3.4（task_096）HUD 信息层级三档：远程模式下渲染进程不起 core runtime，
  //   真相在 service 侧的 core —— 故这条命令必须入册（否则远程切档发不出去）。
  'hud.layer.set': true,
  // @since v3.4（task_094）Z6 沉浸层的演出占用（里程碑大字 / ▶60 秒重演 / 导演取景框）：
  //   远程模式下渲染进程不起 core runtime，占用与释放都得经 service 侧的 core 落账 ——
  //   故这条命令同样必须入册（否则远程端的演出不会让 L1 让位）。
  'hud.layer.hold': true,
};

/**
 * 命令载荷的**信封级**判定：只认「类型名在册」，不校验各字段的业务合法性。
 * why：业务合法性归 core 裁决（铁律 2）—— 协议层再抄一份校验规则 = 第二份真相，
 *   且 core 新增字段时会立刻漂移。载荷非法 → core 拒绝 → service 回 ack{ok:false, code:'rejected'}。
 */
export function isHudCommand(value: unknown): value is HudCommand {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string') return false;
  return HUD_COMMAND_TYPE_FLAGS[value.type as HudCommand['type']] === true;
}

/**
 * WorldState wire 形态的**骨架级**判定：数组/对象在位 + 编组槽位结构正确。
 * why 不做逐字段深度校验：WorldState 是 core 的活契约，字段会演进；
 *   深度校验抄在这里 = 第二份真相且必然漂移。深度语义由 core 保证，协议层只挡「形状不对」。
 */
export function isWorldStateWire(value: unknown): value is WorldStateWire {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.units)) return false;
  if (!Array.isArray(value.missions)) return false;
  if (!Array.isArray(value.characters)) return false;
  if (!Array.isArray(value.notices)) return false;
  if (!Array.isArray(value.links)) return false;
  if (!Array.isArray(value.messages)) return false;
  if (!isRecord(value.selection)) return false;
  if (value.selectionGroups !== undefined) {
    if (!Array.isArray(value.selectionGroups)) return false;
    for (const group of value.selectionGroups) {
      if (!isRecord(group)) return false;
      if (!Number.isInteger(group.slot)) return false;
      if (!Array.isArray(group.unitIds)) return false;
      if (!group.unitIds.every(isNonEmptyString)) return false;
    }
  }
  return true;
}

/** 错误码是否在词表内。 */
export function isWorldSyncErrorCode(value: unknown): value is WorldSyncErrorCode {
  return typeof value === 'string' && (WORLD_SYNC_ERROR_CODES as readonly string[]).includes(value);
}

/** 错误详情判定。 */
export function isWorldSyncErrorDetail(value: unknown): value is WorldSyncErrorDetail {
  if (!isRecord(value)) return false;
  if (!isWorldSyncErrorCode(value.code)) return false;
  if (!isNonEmptyString(value.message)) return false;
  if (value.stale !== undefined && typeof value.stale !== 'boolean') return false;
  if (value.hint !== undefined && typeof value.hint !== 'string') return false;
  return true;
}

/** hello 判定。 */
export function isHelloMessage(value: unknown): value is HelloMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'hello') return false;
  if (!Number.isInteger(value.protocolVersion)) return false;
  if (!isNonEmptyString(value.clientId)) return false;
  return true;
}

/** snapshot 判定。 */
export function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'snapshot') return false;
  if (!isPositiveInt(value.seq)) return false;
  if (!isWorldStateWire(value.state)) return false;
  if (value.delta !== undefined && value.delta !== null) return false;
  return true;
}

/** command.forward 判定。 */
export function isCommandForwardMessage(value: unknown): value is CommandForwardMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'command.forward') return false;
  if (!isNonEmptyString(value.commandId)) return false;
  if (!isHudCommand(value.command)) return false;
  return true;
}

/**
 * command.ack 判定。
 * 不变式：ok=false 必带 error；ok=true 不得带 error；seq 为 null 或正整数。
 */
export function isCommandAckMessage(value: unknown): value is CommandAckMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'command.ack') return false;
  if (!isNonEmptyString(value.commandId)) return false;
  if (typeof value.ok !== 'boolean') return false;
  if (value.seq !== null && !isPositiveInt(value.seq)) return false;
  if (value.error !== undefined && !isWorldSyncErrorDetail(value.error)) return false;
  if (value.ok && value.error !== undefined) return false;
  if (!value.ok && value.error === undefined) return false;
  return true;
}

/** error 判定。 */
export function isErrorMessage(value: unknown): value is ErrorMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'error') return false;
  if (!isWorldSyncErrorCode(value.code)) return false;
  if (!isNonEmptyString(value.message)) return false;
  if (value.commandId !== undefined && !isNonEmptyString(value.commandId)) return false;
  return true;
}

/** 五型分派守卫：是真消息就返回 true。 */
export function isWorldSyncMessage(value: unknown): value is WorldSyncMessage {
  return (
    isHelloMessage(value) ||
    isSnapshotMessage(value) ||
    isCommandForwardMessage(value) ||
    isCommandAckMessage(value) ||
    isErrorMessage(value)
  );
}

/** 协议版本是否受支持（service 侧在收到 hello 时判定）。 */
export function isSupportedProtocolVersion(version: unknown): version is number {
  if (typeof version !== 'number' || !Number.isInteger(version)) return false;
  return (
    version >= WORLD_SYNC_MIN_PROTOCOL_VERSION && version <= WORLD_SYNC_PROTOCOL_VERSION
  );
}

// ============================================================================
// 构造助手（纯函数）
// ============================================================================

/**
 * 构造 snapshot 消息（自动摊平编组槽位）。
 * seq 由 service 侧发号器提供，本函数不自增 —— 发号是 service 的单一职责。
 */
export function createSnapshotMessage(seq: number, state: WorldState): SnapshotMessage {
  return { type: 'snapshot', seq, state: toWireState(state), delta: null };
}

/**
 * 构造「状态面未附着」的 ack。
 * why 单独一个助手：未附着是最容易被糊弄成成功的场景（铁律 4「绝不假装成功」），
 *   统一在此构造 → seq=null、stale=true、code='not_attached'，杜绝各处手拼出乐观回执。
 */
export function createNotAttachedAck(commandId: string): CommandAckMessage {
  return {
    type: 'command.ack',
    commandId,
    ok: false,
    seq: null,
    error: {
      code: 'not_attached',
      message: '状态面未附着：service 未接上 core store',
      stale: true,
      hint: '确认 service 已启动后重连；在此之前不要把本地视图当作真相',
    },
  };
}

/** 构造失败 ack（core 拒绝 / 超时 / 其它内部失败）。 */
export function createFailedAck(
  commandId: string,
  code: WorldSyncErrorCode,
  message: string,
  seq: number | null = null,
  hint?: string,
): CommandAckMessage {
  return {
    type: 'command.ack',
    commandId,
    ok: false,
    seq,
    error: hint === undefined ? { code, message } : { code, message, hint },
  };
}

/** 构造成功 ack（core 已裁决落点）。 */
export function createOkAck(commandId: string, seq: number): CommandAckMessage {
  return { type: 'command.ack', commandId, ok: true, seq };
}

/** 构造协议错误信封。 */
export function createErrorMessage(
  code: WorldSyncErrorCode,
  message: string,
  commandId?: string,
): ErrorMessage {
  return commandId === undefined
    ? { type: 'error', code, message }
    : { type: 'error', code, message, commandId };
}

// ============================================================================
// 编解码（纯函数，失败不抛）
// ============================================================================

/** decode 的结果（判别式，不用异常表达失败）。 */
export type WorldSyncDecodeResult =
  | { readonly ok: true; readonly message: WorldSyncMessage }
  | {
      readonly ok: false;
      readonly code: WorldSyncErrorCode;
      readonly message: string;
    };

/**
 * 序列化为 JSON 文本。
 * 失败（循环引用 / 不可序列化 / 消息本身不合法）→ 返回 null，**不抛**。
 * 注意：构造 snapshot 前必须先过 toWireState —— 直接把 core 的 WorldState（含 Map）塞进来
 *   会因编组不是 wire 形态而被判为不合法（返回 null），这比静默丢掉编组好。
 */
export function encodeMessage(message: WorldSyncMessage): string | null {
  if (!isWorldSyncMessage(message)) return null;
  try {
    const json = JSON.stringify(message);
    return typeof json === 'string' ? json : null;
  } catch {
    return null;
  }
}

/**
 * 解析 JSON 文本为五型消息之一。
 * 失败 → 返回 { ok:false, code, message }，**不抛**。
 * 错误码口径：JSON 解析失败 / 字段不合法 → malformed_message；type 不在五型 → unknown_message_type。
 */
export function decodeMessage(raw: string): WorldSyncDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'malformed_message', message: 'JSON 解析失败' };
  }
  if (isWorldSyncMessage(parsed)) {
    return { ok: true, message: parsed };
  }
  if (isRecord(parsed) && typeof parsed.type === 'string') {
    if ((WORLD_SYNC_MESSAGE_TYPES as readonly string[]).includes(parsed.type)) {
      return {
        ok: false,
        code: 'malformed_message',
        message: `消息 ${parsed.type} 的字段不合法`,
      };
    }
    return {
      ok: false,
      code: 'unknown_message_type',
      message: `未知消息类型：${parsed.type}`,
    };
  }
  return { ok: false, code: 'malformed_message', message: '不是合法的 world-sync 消息' };
}

/**
 * 解析字节流（Uint8Array / Node Buffer 均可）—— 传输层收包后直接喂进来。
 * 依赖全局 TextDecoder（Node ≥ 11 / 浏览器均有），不引依赖。
 */
export function decodeMessageBytes(bytes: Uint8Array): WorldSyncDecodeResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(bytes);
  } catch {
    return { ok: false, code: 'malformed_message', message: '字节流解码失败' };
  }
  return decodeMessage(text);
}
