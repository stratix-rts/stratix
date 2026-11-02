/**
 * world-sync 线格式（自包含的最小切片）。
 *
 * why 自带一份而不引用主仓 `src/stratix-gateway/api/websocket/world-sync/protocol.ts`：
 * 本目录是一个**独立插件包**（可脱离 Stratix 主仓分发），不依赖主仓构建产物，
 * 也不把主仓的依赖树拖进 dsh 宿主进程。契约照 docs/WORLD-SYNC.md v1 抄最小必要面，
 * 字段只增不删的规则由主仓协议文档背书。
 */

/** 端点路径（docs/WORLD-SYNC.md §2.1）。 */
export const WORLD_SYNC_PATH = '/ws/world-sync';

/** 本客户端自报的协议版本（docs/WORLD-SYNC.md §2.2）。 */
export const WORLD_SYNC_PROTOCOL_VERSION = 1;

/** 客户端注册帧。 */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly clientId: string;
}

/** 单位投影（WorldState.units 的 wire 形态，核心 UnitView）。 */
export interface WireUnit {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly missionId: string | null;
  readonly power: number;
  readonly characterId?: string | null;
  readonly level?: number | null;
}

/** 任务投影（WorldState.missions 的 wire 形态，核心 MissionView）。 */
export interface WireMission {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly unitIds: readonly string[];
}

/** 角色投影（WorldState.characters 的 wire 形态，核心 CharacterView）。 */
export interface WireCharacter {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly agentKind?: string | null;
}

/** 全量世界状态投影。 */
export interface WireWorldState {
  readonly units: readonly WireUnit[];
  readonly missions: readonly WireMission[];
  readonly characters: readonly WireCharacter[];
}

/** service → 客户端的全量快照帧。 */
export interface SnapshotMessage {
  readonly type: 'snapshot';
  readonly seq: number;
  readonly state: WireWorldState;
  readonly delta: null;
}

/** service → 客户端的协议错误帧。 */
export interface ProtocolErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type WorldSyncServerMessage = SnapshotMessage | ProtocolErrorMessage;

/** 构造 hello 帧（协议只认这五个字段，多余字段一律不发）。 */
export function createHello(clientId: string, protocolVersion: number = WORLD_SYNC_PROTOCOL_VERSION): HelloMessage {
  return { type: 'hello', protocolVersion, clientId };
}

/** 窄化一条服务端帧；认不出的形状一律当作「不是快照」处理，不猜。 */
export function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<SnapshotMessage>;
  return message.type === 'snapshot' && typeof message.seq === 'number' && typeof message.state === 'object';
}

/** 窄化一条协议错误帧。 */
export function isProtocolErrorMessage(value: unknown): value is ProtocolErrorMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ProtocolErrorMessage>;
  return message.type === 'error' && typeof message.code === 'string';
}
