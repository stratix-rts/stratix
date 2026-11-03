/**
 * ⚠️⚠️⚠️ DEMO-ONLY（演示 / 单测路径）⚠️⚠️⚠️
 *
 * 文件职责：角色聊天抽屉的**定时器假流** —— 演示"发送 → 流式增量 → 收束"的视觉动线。
 *   仅用于 hud-dev 演示页与 task_034 单测；**正式数据流由 task_035 的 chat-service 桥接
 *   （抽屉 onSend → CliTransport → appendStream/finalizeStream 喂回），本文件不进生产链路**
 *   （main-entry / main-screen 一律不得 import 本文件）。
 * 输入：抽屉元素引用（getter，避开挂载前的空引用）。
 * 输出：onSend 回调（形状与 CharacterChatDrawerDeps.onSend 一致，直接注入即可）。
 * 禁止事项：
 *   1. 伪装成真 transport —— 假流内容全部带 DEMO 前缀，肉眼 / 断言都能认出这是演示数据；
 *   2. import world/、core/bus —— 铁律同 hud 全层；
 *   3. 被 components/chat-drawer/chat-drawer.ts 反向 import —— 组件保持零定时器，
 *      演示装配（谁接谁）只能由挂载方决定。
 *
 * @since v3.13（task_034 演示路径）
 */

import type { StratCharacterChatDrawerElement } from './chat-drawer';

/** 假流节奏（毫秒）：首发延迟 + 逐 chunk 间隔。测试用 jest fake timers 精确推进。 */
export interface DemoStreamTiming {
  readonly startDelayMs: number;
  readonly chunkIntervalMs: number;
}

export const DEMO_FAKE_STREAM_TIMING: DemoStreamTiming = {
  startDelayMs: 120,
  chunkIntervalMs: 40,
};

/** 假流正文前缀：肉眼与断言共用的 DEMO 标记。 */
export const DEMO_REPLY_PREFIX = '(DEMO 假流) ';

/** 把整段回复切成定长 chunk，模拟 transport 的流式分片（按 Unicode 码点切，不切半个汉字）。 */
export function splitDemoReply(text: string, chunkSize = 3): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += chunkSize) {
    chunks.push(chars.slice(i, i + chunkSize).join(''));
  }
  return chunks;
}

/**
 * 造一个 demo 版 onSend：发送后锁输入（setSending）→ 定时器逐 chunk appendStream → 收束解锁。
 * 正式桥接（035）与此处同构：chat-service 拿到 (characterId, text) 后驱动真 transport，
 * 用同一组公开方法把流喂回抽屉 —— 演示路径的存在正是为了让这条调用面先被验证。
 */
export function createDemoOnSend(
  getDrawer: () => StratCharacterChatDrawerElement,
  timing: DemoStreamTiming = DEMO_FAKE_STREAM_TIMING
): (characterId: string, text: string) => void {
  return (_characterId: string, text: string): void => {
    const drawer = getDrawer();
    drawer.setSending(true);
    const reply = `${DEMO_REPLY_PREFIX}收到「${text}」。这是定时器假流的演示回显，正式回复由后端服务产出。`;
    const chunks = splitDemoReply(reply);
    let at = timing.startDelayMs;
    for (const chunk of chunks) {
      setTimeout((): void => { drawer.appendStream(chunk); }, at);
      at += timing.chunkIntervalMs;
    }
    setTimeout((): void => {
      drawer.finalizeStream();
      drawer.setSending(false);
    }, at);
  };
}
