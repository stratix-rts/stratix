/**
 * 单测：**气泡话术的触发链**（world/objects/speech-trigger.ts，task_219 / IX-06）。
 * 覆盖：
 *   - 三状态触发链：思考中（thinking）/ 工作中（working）/ 闲置（idle）——
 *     acceptance ②「思考中 / 工作中 / 闲置三状态气泡触发链」；
 *   - 沉降期：「接了活」在沉降期内变成「开工了」⇒ 前一句作废，只说后一句；
 *   - 同状态不重复 + 同状态节流（连续两次相同状态不刷屏）；
 *   - 闲置彩蛋的克制：静默门槛没到不冒、间隔没到不冒、只挂在真闲着的单位上。
 *
 * 边界说明：本模块是纯逻辑（零 Phaser / 零 IO）—— 时钟与随机全部注入，
 *   推进靠显式 tick(now)，不用真实时间。
 */

import {
  SPEECH_IDLE_POOL,
  SPEECH_STATE_POOLS,
  createSpeechCopyPicker,
} from '../../core/theme/bubble-copy';
import { SpeechTrigger } from '../objects/speech-trigger';

/** 固定随机源（0.9 ⇒ 不命中性格彩蛋；抽取结果确定可断言）。 */
const FIXED_RANDOM = (): number => 0.9;

function makeTrigger(clock: { now: number }): SpeechTrigger {
  return new SpeechTrigger({
    now: () => clock.now,
    random: FIXED_RANDOM,
    picker: createSpeechCopyPicker({ random: FIXED_RANDOM }),
  });
}

describe('状态触发链：思考中 / 工作中', () => {
  test('思考中：状态稳住沉降期后冒一句，句子来自思考池', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setThinking('u1', true);

    // 沉降期没到 ⇒ 不说话（不是状态一变就抢着冒）。
    expect(trigger.tick(0)).toHaveLength(0);
    expect(trigger.tick(500)).toHaveLength(0);

    const events = trigger.tick(1200);
    expect(events).toHaveLength(1);
    expect(events[0]?.unitId).toBe('u1');
    expect(events[0]?.source).toBe('state');
    expect(events[0]?.state).toBe('thinking');
    expect(SPEECH_STATE_POOLS.thinking).toContain(events[0]?.text);
  });

  test('工作中：任务开工冒一句，句子来自工作池', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setBusy('u1', true);

    expect(trigger.tick(0)).toHaveLength(0);
    const events = trigger.tick(1200);
    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe('working');
    expect(SPEECH_STATE_POOLS.working).toContain(events[0]?.text);
  });

  test('LLM 吞吐中：正在流式输出冒一句，句子来自吞吐池', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setSpeaking('u1', true);

    expect(trigger.tick(0)).toHaveLength(0);
    const events = trigger.tick(1200);
    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe('streaming');
    expect(SPEECH_STATE_POOLS.streaming).toContain(events[0]?.text);
  });

  test('状态优先级：正在说话 > 在忙 > 在思考（此刻最该说的是正在吐字）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setThinking('u1', true);
    trigger.setBusy('u1', true);
    trigger.setSpeaking('u1', true);

    expect(trigger.tick(0)).toHaveLength(0);
    const events = trigger.tick(1200);
    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe('streaming');
  });
});

describe('触发链的克制：沉降期与节流', () => {
  test('沉降期内状态变了 ⇒ 前一句作废，只说后一句（两句不互相打脸）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setThinking('u1', true);
    expect(trigger.tick(0)).toHaveLength(0); // 「接了活」的沉降期开始

    // 300ms 后就开工了 —— 「收到新任务，正在拆解」这句已经不对了。
    trigger.setThinking('u1', false);
    trigger.setBusy('u1', true);
    expect(trigger.tick(300)).toHaveLength(0);

    const events = trigger.tick(1500);
    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe('working');
    // 全程没有冒过「思考中」那一句。
    expect(SPEECH_STATE_POOLS.working).toContain(events[0]?.text);
  });

  test('状态不变就不重复（同一个状态不刷屏）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setThinking('u1', true);

    // 沉降期从**触发链观察到状态变化**的那一刻起算（生产环境每帧一次 ⇒ 误差 ≤1 帧）。
    expect(trigger.tick(0)).toHaveLength(0);
    expect(trigger.tick(1200)).toHaveLength(1);
    expect(trigger.tick(1300)).toHaveLength(0);
    expect(trigger.tick(5000)).toHaveLength(0);
    expect(trigger.tick(60000)).toHaveLength(0);
  });

  test('同状态节流：思考 → 工作 → 思考（15s 内）不再说第二遍「思考中」', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);

    // 第一轮：思考中 → 工作中。
    trigger.setThinking('u1', true);
    expect(trigger.tick(0)).toHaveLength(0);
    expect(trigger.tick(1200)[0]?.state).toBe('thinking');
    trigger.setThinking('u1', false);
    trigger.setBusy('u1', true);
    expect(trigger.tick(1200)).toHaveLength(0);
    expect(trigger.tick(2400)[0]?.state).toBe('working');

    // 第二轮思考（距上次「思考中」不到 stateMinIntervalMs）⇒ 被节流压掉。
    trigger.setBusy('u1', false);
    trigger.setThinking('u1', true);
    expect(trigger.tick(2400)).toHaveLength(0);
    expect(trigger.tick(3600)).toHaveLength(0);
  });

  test('单位离场：它的状态不再驱动气泡', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setThinking('u1', true);
    trigger.syncUnits([]);
    expect(trigger.tick(1200)).toHaveLength(0);
  });
});

describe('闲置彩蛋：静默门槛 + 随机间隔 + 只挂真闲着的单位', () => {
  test('静默门槛没到 ⇒ 不冒彩蛋', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    expect(trigger.tick(10_000)).toHaveLength(0);
    expect(trigger.tick(14_999)).toHaveLength(0);
  });

  test('静默够久 + 间隔到了 ⇒ 冒一条彩蛋（技巧 / 世界观闲话）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    // 间隔没到（idleMinIntervalMs=30s 起，随机落在 [30s, 60s]）⇒ 静默够久也不冒。
    expect(trigger.tick(20_000)).toHaveLength(0);
    const events = trigger.tick(60_000);
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe('idle');
    expect(events[0]?.state).toBeNull();
    expect(SPEECH_IDLE_POOL).toContain(events[0]?.text);
  });

  test('彩蛋只挂在真闲着的单位上（在忙的单位不算闲置）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.setBusy('u1', true);
    expect(trigger.tick(60_000)).toHaveLength(0);
  });

  test('刚有事件气泡 ⇒ 静默门槛重置（不紧跟着冒技巧）', () => {
    const clock = { now: 0 };
    const trigger = makeTrigger(clock);
    trigger.syncUnits(['u1']);
    trigger.noteActivity(10_000);
    expect(trigger.isQuiet(10_000)).toBe(false);
    expect(trigger.isQuiet(24_999)).toBe(false);
    expect(trigger.isQuiet(25_000)).toBe(true);
  });
});
