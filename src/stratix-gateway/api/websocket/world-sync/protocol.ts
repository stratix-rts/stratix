/**
 * 文件职责：world-sync WebSocket 协议契约层（前后端分离 B1 / task_081）—— 消息型的类型、
 *   类型守卫（isXxx）、协议常量与 encode/decode 纯函数。
 *   @since v3.3（task_156）：新增 `event.forward`（客户端 → service 的世界事件转发通道）。
 *   @since v3.3（task_216 / IX-02）：新增 `event.push`（service → 客户端的**下行**事件通道）。
 * 输入：src/core/types.ts 的总线契约（WorldState / HudCommand / WorldEvent，仅 type-only 导入 → 零运行时依赖）。
 * 输出：WorldSyncMessage 联合 + 守卫 + 纯函数（encodeMessage / decodeMessage / toWireState 等）。
 * 禁止事项：
 *   1. 引入任何运行时依赖 —— 尤其禁止依赖 ws（WebSocket 传输库）：本层是纯契约，传输层归 task_082；
 *   2. 在协议层裁决命令载荷的合法性 —— 载荷合法性由 core 状态机裁决（铁律 2「裁决在 core」）；
 *   3. 做增量合并 —— 重连 = 全量 snapshot 覆盖本地（铁律 1「真相唯一」）；
 *   4. 抛异常 —— 序列化/解析失败一律以返回值判别（null / ok=false），不抛不炸传输层。
 *
 * 方向语义（写死，见 docs/WORLD-SYNC.md）：
 *   客户端 → service：hello（注册）、command.forward（命令写入口）、event.forward（世界事件写入口）
 *   service → 客户端：snapshot（唯一的状态面）、command.ack（落点回执）、event.push（**下行事件流**）、
 *                    error（协议错误）
 *
 * 重连语义（写死）：
 *   客户端重连 = hello → service 立即回一份**全量** snapshot → 客户端整体覆盖本地视图。
 *   **不做增量合并**；snapshot.delta 是本期恒为 null 的预留字段位（防将来加字段变成破坏性变更）。
 *
 * 配套文档：docs/WORLD-SYNC.md（消息表 + 五场景时序图 + seq 规则 + 未附着语义）
 */

import type { HudCommand, WorldEvent, WorldState } from '@/core/types';

// ============================================================================
// 协议常量
// ============================================================================

/**
 * 当前协议版本（service 与客户端协商用）。
 * 不兼容 → service 回 `error{code:'unsupported_version'}` 并断开该连接（不降级、不假装能通）。
 *
 * @since v3.3（task_156）升到 2：新增消息型 `event.forward`（客户端 → service 的世界事件转发）。
 *   why 升版本（docs/WORLD-SYNC.md §7.4「新增消息型 = 破坏性变更」）：老 service 收到 event.forward
 *   只会判 unknown_message_type —— 那正是「画布交互全哑」的静默失败面。升版本后老 service 直接回
 *   unsupported_version 并断开：**响亮地失败**好过悄悄不生效。
 *   MIN 仍是 1：v1 客户端只用到 hello / snapshot / command.forward / command.ack —— 那套语义一字未改，
 *   仍可连上（它只是用不上 event.forward 这条新能力）。
 *
 * @since v3.3（task_216 / IX-02）升到 3：新增消息型 `event.push`（service → 客户端的**下行**事件通道）。
 *   why 升版本：同 §7.4「新增消息型 = 破坏性变更」。老客户端收到 event.push 只会判
 *   unknown_message_type ⇒ 客户端那侧要把新消息型显式入册（decode 失败 = 响亮地失败）。
 *   MIN 仍是 1：v1 / v2 客户端用的那套语义一字未改，仍可连上（它们只是用不上 event.push）。
 */
export const WORLD_SYNC_PROTOCOL_VERSION = 3;

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

/** 消息类型词表（封闭）。 */
export type WorldSyncMessageType =
  | 'hello'
  | 'snapshot'
  | 'command.forward'
  | 'command.ack'
  | 'event.forward'
  | 'event.push'
  | 'error';

/** 消息的类型名清单（常量，供服务端分派与文档对齐）。 */
export const WORLD_SYNC_MESSAGE_TYPES: readonly WorldSyncMessageType[] = [
  'hello',
  'snapshot',
  'command.forward',
  'command.ack',
  'event.forward',
  'event.push',
  'error',
] as const;

/**
 * 协议错误码词表。
 * - malformed_message：JSON 解析失败，或信封字段缺失/类型不对。
 * - unknown_message_type：type 不在消息型词表之内。
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
// 消息类型（七型 —— @since v3.3 task_156 加了 event.forward；task_216 / IX-02 加了 event.push）
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
 * 可上行的世界事件（@since v3.3，task_156）—— **状态语义**事件白名单。
 *
 * why 只有这四条：它们改变世界真相（选择集 / 单位落位 / 导演开关），远程模式下必须由
 *   **service 侧的 core** 裁决（铁律 2「裁决在 core」—— 本地没有真相，本地裁决就是第二份真相）。
 *   纯视图事件（camera.moved / replay.beat / fx.sound / unit.bubble …）是本机表现，
 *   service 不需要 —— 上行只会拿视图态污染真相（且 camera.moved 每 120ms 一条，纯烧带宽）。
 *
 * @since v3.3（task_214 / IX-03）追加 `unit.chat.open`：双击 agent → 打开该 agent 的单独聊天框。
 *   它同样必须**上行** —— 远程模式下渲染进程**不起本地 core runtime**（真相在 service），
 *   本地裁决就等于第二份真相（铁律 2）。裁决结果写进 WorldState.chatTarget ⇒ 随 snapshot
 *   全量回推客户端 ⇒ HUD 聊天抽屉订阅后开框（路径见 design §5.2 扩展点 E-1）。
 *   ⚠️ 多客户端口径：chatTarget 随 snapshot 广播给**全体**客户端 ⇒ 别人的双击也会让本端开框。
 *   本期接受该口径（单客户端本地工作台是主场景），不为此改快照语义（那要动协议契约）。
 */
export type ForwardableWorldEvent = Extract<
  WorldEvent,
  { type: 'unit.click' | 'selection.box' | 'unit.move' | 'camera.director' | 'unit.chat.open' }
>;

/**
 * 世界事件的**上行白名单**（类型名 → 在册）。
 *
 * why 不是 `Record<WorldEvent['type'], true>`（那等于放行 core 的**全部**事件，含纯视图事件）：
 *   白名单必须显式列出「状态语义」那几条。键的类型由上面的 `Extract` 从 core 的 WorldEvent
 *   推导 —— core 改名或改形状会**编译报错**（同 HUD_COMMAND_TYPE_FLAGS 的纪律：契约不静默漂移）。
 */
const FORWARDABLE_WORLD_EVENT_FLAGS: Readonly<Record<ForwardableWorldEvent['type'], true>> = {
  'unit.click': true,
  'selection.box': true,
  'unit.move': true,
  'camera.director': true,
  'unit.chat.open': true,
};

/** 上行白名单的类型名清单（常量，供客户端 / 文档 / 单测对齐）。 */
export const FORWARDABLE_WORLD_EVENT_TYPES: readonly ForwardableWorldEvent['type'][] = [
  'unit.click',
  'selection.box',
  'unit.move',
  'camera.director',
  'unit.chat.open',
] as const;

/**
 * event.forward —— 客户端 → service：世界事件的转发信封（@since v3.3，task_156）。
 *
 * why 存在这条通道：远程模式下渲染进程**不起本地 core runtime**（真相在 service），
 *   画布交互（点选 / 框选 / 右键移动）走的是 world → core 的 WorldEvent 通道 ——
 *   少了这条通道，那些事件进了本地总线却零消费者 → **静默丢弃**（画布全哑）。
 *
 * 语义：service 侧把事件发到**它自己的 core 总线**，由 service 侧的 runtime 裁决
 *   （落 store → snapshot 全量回推全体客户端）。service **不改 store**（铁律 2）。
 *
 * 回执：fire-and-forget（无 ack）—— 快照是最终一致口径，事件本身没有「落点 id」可回读；
 *   客户端要看结果就读下一份 snapshot（选中环 / 面板据此更新）。
 */
export interface EventForwardMessage {
  readonly type: 'event.forward';
  /** 待裁决的世界事件（白名单内的那几条状态语义事件）。 */
  readonly event: ForwardableWorldEvent;
}

/**
 * 可**下行**的世界事件（@since v3.3，task_216 / IX-02）—— **视图事实**事件白名单。
 *
 * why 首批只有 `unit.position`：位置是**共享真相**（所有客户端看到同一份站位），
 *   但它**不进 WorldState 快照**（core 契约里 UnitView 无坐标字段 —— 位置真相在世界层）⇒
 *   它只能经**事件流**下发。快照通道不动（WorldState 不加坐标字段 —— 那是契约层的破坏性变更）。
 *
 * why 与上行白名单**互斥**（硬要求，防回环）：同一事件类型若同时在两个白名单里 ⇒
 *   service 推给客户端 → 客户端喂回本地总线 → 本地转发器又上行 → service 再推…… **无限回环**。
 *   编译期断言见 `UpstreamDownstreamEventOverlap`。
 */
export type PushableWorldEvent = Extract<WorldEvent, { type: 'unit.position' }>;

/**
 * 下行白名单的类型名 → 在册。
 * why 同样是类型驱动的（`Record<PushableWorldEvent['type'], true>`）：
 *   core 改事件名/改形状时本对象**编译报错**（缺键 / 多余键）⇒ 契约不静默漂移。
 */
const PUSHABLE_WORLD_EVENT_FLAGS: Readonly<Record<PushableWorldEvent['type'], true>> = {
  'unit.position': true,
};

/** 下行白名单的类型名清单（常量，供 service 端点 / 客户端 / 文档 / 单测对齐）。 */
export const PUSHABLE_WORLD_EVENT_TYPES: readonly PushableWorldEvent['type'][] = [
  'unit.position',
] as const;

/** 类型层面的 never 断言（T 非 never 时编译报错）。 */
type AssertNever<T extends never> = T;

/**
 * 编译期不变式（@since v3.3，task_216 / IX-02）：上行白名单与下行白名单**互斥**。
 *
 * why 要编译期守：防回环是**协议级**的不变式，靠人记靠不住 —— 一旦有人把 `unit.position`
 *   加进 `FORWARDABLE_WORLD_EVENT_TYPES`（它看起来很"合理"：位置也是状态语义），
 *   线上就是一个无限回环（每条事件都绕一圈回来）。这里把交集压成 never ⇒ **编译期报错**。
 */
export type UpstreamDownstreamEventOverlap = AssertNever<
  Extract<ForwardableWorldEvent['type'], PushableWorldEvent['type']>
>;

/**
 * event.push —— service → 客户端：**下行**事件信封（@since v3.3，task_216 / IX-02）。
 *
 * why 存在这条通道：service 侧的 core 裁决右击移动后，会在**自己的**总线上广播 `unit.position`
 *   （编队终值 —— 见 core/runtime.ts 的 applyUnitMove）。协议原先只有 `event.forward`（上行）⇒
 *   那条广播**无人可收** ⇒ 客户端没有 tween、没有小地图更新、也没有落库（画布"点了没反应"）。
 *
 * 语义：客户端收到后把事件**喂回本地 core 总线**（复用既有 world 通道语义）⇒
 *   world 桥接层照旧驱动 tween（unit-layer 的 applyUnitPosition）、小地图累积表照旧更新、
 *   落库订阅者照旧落 unit_positions —— **三处自动恢复，无需各自新增代码**。
 *
 * 载荷 = 白名单化的视图事件（首批只放 `unit.position`）—— 与 `event.forward` 的上行白名单**互斥**。
 */
export interface EventPushMessage {
  readonly type: 'event.push';
  /** 待下发的世界事件（下行白名单内的那几条）。 */
  readonly event: PushableWorldEvent;
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

/** 消息联合。 */
export type WorldSyncMessage =
  | HelloMessage
  | SnapshotMessage
  | CommandForwardMessage
  | CommandAckMessage
  | EventForwardMessage
  | EventPushMessage
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
  // @since v3.6(task_120):撤掉一条从未开工的编组任务(core/mission/machine.ts 的 canRemoveMission 守门)。
  'mission.remove': true,
  'mission.checkpoint': true,
  'character.persona.update': true,
  'character.appearance.update': true,
  'character.contextEnabled.update': true,
  'character.name.update': true,
  'character.create': true,
  // @since v3.7(task_129):删除角色档案（名册清理 —— core/character/manager.ts 的 deleteCharacter）。
  'character.delete': true,
  'chat.send': true,
  'ui.navigate': true,
  'theme.set': true,
  'link.open': true,
  'link.resume': true,
  'link.reconnect': true,
  'link.close': true,
  // @since v3.7(task_130):'settings.set' 已从契约移除（偏好视图是没人消费的死字段，已删）——
  //   偏好现在由 HUD 直写本机持久层（localStorage），不再有总线命令。
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
  // @since v3.3（task_177 / M1-03）进入副本：远程模式下渲染进程不起 core runtime，
  //   切换裁决在 service 侧的 core ⇒ 这条命令必须入册（否则远程端进不去副本）。
  'project.enter': true,
  // @since v3.3（task_178 / M1-04）退出副本：同 project.enter 的理由 —— 切换裁决在
  //   service 侧的 core ⇒ 远程端要能退出副本，这条命令必须入册。
  'project.exit': true,
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

/**
 * 上行世界事件的**信封级**判定（@since v3.3，task_156）：
 * 类型名在白名单内 + 载荷的**形状**对得上（够 core 裁决用，不至于炸在它手里）。
 *
 * why 在这里挡形状（而不像 HudCommand 那样只认类型名）：事件是要**原样喂进 core 总线**的 ——
 *   `unit.click` 缺 mods 会在 core 的 `mods.shift` 上炸，`unit.move` 缺坐标会让落位成 NaN。
 *   形状不对 → 拒（客户端发的是坏消息，不必连累 service）。
 *   业务合法性（单位是否存在、点的是不是已阵亡的单位）仍归 core 裁决（铁律 2）。
 */
export function isForwardableWorldEvent(value: unknown): value is ForwardableWorldEvent {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;
  if (FORWARDABLE_WORLD_EVENT_FLAGS[type as ForwardableWorldEvent['type']] !== true) return false;
  switch (type) {
    case 'unit.click':
      return (
        isNonEmptyString(value.unitId) &&
        isRecord(value.mods) &&
        typeof value.mods.shift === 'boolean' &&
        typeof value.mods.ctrl === 'boolean' &&
        typeof value.mods.meta === 'boolean' &&
        typeof value.mods.alt === 'boolean'
      );
    case 'selection.box':
      return (
        isRecord(value.bounds) &&
        isFiniteNumber(value.bounds.x) &&
        isFiniteNumber(value.bounds.y) &&
        isFiniteNumber(value.bounds.width) &&
        isFiniteNumber(value.bounds.height) &&
        (value.unitIds === undefined ||
          (Array.isArray(value.unitIds) && value.unitIds.every(isNonEmptyString))) &&
        (value.additive === undefined || typeof value.additive === 'boolean')
      );
    case 'unit.move':
      return (
        Array.isArray(value.unitIds) &&
        value.unitIds.every(isNonEmptyString) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y)
      );
    case 'camera.director':
      return typeof value.enabled === 'boolean';
    // @since v3.3（task_214 / IX-03）双击开聊天框：载荷只带单位 id
    //   （单位 → 角色的映射由 core 裁决 —— 协议层不解释业务）。
    case 'unit.chat.open':
      return isNonEmptyString(value.unitId);
    default:
      return false;
  }
}

/** event.forward 判定（@since v3.3，task_156）。 */
export function isEventForwardMessage(value: unknown): value is EventForwardMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'event.forward') return false;
  return isForwardableWorldEvent(value.event);
}

/**
 * 下行世界事件的**信封级**判定（@since v3.3，task_216 / IX-02）：
 * 类型名在**下行白名单**内 + 载荷形状对得上（坐标是有限数、单位 id 非空串）。
 *
 * why 在这里挡形状：下行事件是要**原样喂进客户端本地总线**的 —— 坐标是 NaN 会让
 *   tween 的时长算成 NaN（画面直接卡住），坐标缺失会让单位层炸在 undefined 上。
 */
export function isPushableWorldEvent(value: unknown): value is PushableWorldEvent {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;
  if (PUSHABLE_WORLD_EVENT_FLAGS[type as PushableWorldEvent['type']] !== true) return false;
  switch (type) {
    case 'unit.position':
      return (
        isNonEmptyString(value.unitId) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y)
      );
    default:
      return false;
  }
}

/** event.push 判定（@since v3.3，task_216 / IX-02）。 */
export function isEventPushMessage(value: unknown): value is EventPushMessage {
  if (!isRecord(value)) return false;
  if (value.type !== 'event.push') return false;
  return isPushableWorldEvent(value.event);
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

/** 分派守卫：是真消息就返回 true。 */
export function isWorldSyncMessage(value: unknown): value is WorldSyncMessage {
  return (
    isHelloMessage(value) ||
    isSnapshotMessage(value) ||
    isCommandForwardMessage(value) ||
    isCommandAckMessage(value) ||
    isEventForwardMessage(value) ||
    isEventPushMessage(value) ||
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

/**
 * 构造 event.forward 信封（@since v3.3，task_156）。
 * 不在白名单的事件返回 null（客户端侧据此不上行；service 侧据此拒收）。
 */
export function createEventForwardMessage(
  event: WorldEvent,
): EventForwardMessage | null {
  if (!isForwardableWorldEvent(event)) return null;
  return { type: 'event.forward', event };
}

/**
 * 构造 event.push 信封（@since v3.3，task_216 / IX-02）。
 * 不在下行白名单的事件返回 null（service 端点据此**不推** —— 白名单是防回环的第一道闸）。
 */
export function createEventPushMessage(event: WorldEvent): EventPushMessage | null {
  if (!isPushableWorldEvent(event)) return null;
  return { type: 'event.push', event };
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
 * 解析 JSON 文本为消息型之一（七型）。
 * 失败 → 返回 { ok:false, code, message }，**不抛**。
 * 错误码口径：JSON 解析失败 / 字段不合法 → malformed_message；type 不在词表 → unknown_message_type。
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
