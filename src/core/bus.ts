/**
 * 文件职责：总线封装 —— 在项目已有的 mitt 之上，把三条通信方向收敛成带类型的 API。
 * 输入：HudCommand（hud → core）、WorldEvent（world → core）、WorldState（core → 两侧）。
 * 输出：emit* 发送、on* 订阅（返回退订函数）。
 * 禁止事项：
 *   1. 增加第 4 条通道或"万能" payload —— 通道即铁律，新增通道必须先改 docs/REFACTOR_PLAN_V3.md §5；
 *   2. 在 bus 里做业务判断 —— 它只负责转发，判断属于 core/unit、core/mission；
 *   3. 导入 world/ 或 hud/ —— core 是依赖图的底层，不知道上层是谁在订阅；
 *   4. 泄漏监听器 —— 订阅一律返回退订函数，桥接层卸载时调用。
 *
 * 通道方向：
 *   command : hud   → core
 *   world   : world → core
 *   state   : core  → world | hud
 */

import mitt from 'mitt';

import type { HudCommand, WorldEvent, WorldState } from './types';

// 用 type 而非 interface：mitt 泛型约束要求 Record<EventType, unknown>，
// interface 缺隐式索引签名会被 tsc 拒绝（TS2344）。
export type CoreEventMap = {
  command: HudCommand;
  world: WorldEvent;
  state: WorldState;
};

export type Unsubscribe = () => void;

/** 进程内单例总线。mitt 本身无状态，此处仅持有一个 emitter。 */
const emitter = mitt<CoreEventMap>();

const subscribe = <K extends keyof CoreEventMap>(
  channel: K,
  handler: (payload: CoreEventMap[K]) => void
): Unsubscribe => {
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
};

export const emitCommand = (command: HudCommand): void => emitter.emit('command', command);
export const emitWorldEvent = (event: WorldEvent): void => emitter.emit('world', event);
export const emitState = (state: WorldState): void => emitter.emit('state', state);

export const onCommand = (handler: (command: HudCommand) => void): Unsubscribe =>
  subscribe('command', handler);
export const onWorldEvent = (handler: (event: WorldEvent) => void): Unsubscribe =>
  subscribe('world', handler);
export const onState = (handler: (state: WorldState) => void): Unsubscribe =>
  subscribe('state', handler);

/** 清空全部监听。单测隔离用；生产代码只在应用重启时天然重置，不应调用。 */
export function resetBus(): void {
  emitter.all.clear();
}