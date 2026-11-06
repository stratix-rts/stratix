/**
 * 单测：**气泡话术的唯一事实源**（core/theme/bubble-copy.ts，task_219 / IX-06）。
 * 覆盖：
 *   - 每个池子 ≥4 条（requirement 6）+ 池内无重复 + 句长不顶破气泡宽度；
 *   - 池子被冻结（外部改不动 —— 文案只有这一份）；
 *   - 抽取器：同一池**连续两次必不同**（acceptance ①）+ 一轮之内不重样；
 *   - 状态键 vs 事件键的口吻分离（状态池自称「我」，事件池是指挥台播报）；
 *   - 性格彩蛋只替换状态池、且按概率生效；
 *   - 闲置池：技巧 + 世界观两类都在，且不与其它池撞句。
 *
 * 边界说明：本模块是叶子常量 + 纯函数（零 IO / 零 Phaser / 零 LLM）——
 *   node 单测直接引，不起渲染引擎。
 */

import {
  SPEECH_COPY_METRICS,
  SPEECH_EVENT_POOLS,
  SPEECH_IDLE_POOL,
  SPEECH_PERSONALITY_POOL,
  SPEECH_STATE_POOLS,
  bubblePool,
  createSpeechCopyPicker,
  isSpeechStateKey,
  type SpeechEventKey,
  type SpeechKey,
  type SpeechStateKey,
} from '../bubble-copy';

const EVENT_KEYS = Object.keys(SPEECH_EVENT_POOLS) as SpeechEventKey[];
const STATE_KEYS = Object.keys(SPEECH_STATE_POOLS) as SpeechStateKey[];

/** 确定性随机源：返回一个循环序列（0.0, 0.5, 0.25, 0.75 …）。 */
function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return (): number => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

describe('话术池的规模与形态', () => {
  test('每个事件池 ≥4 条（requirement 6）', () => {
    for (const key of EVENT_KEYS) {
      expect(SPEECH_EVENT_POOLS[key].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('每个状态池 ≥4 条（requirement 6）', () => {
    for (const key of STATE_KEYS) {
      expect(SPEECH_STATE_POOLS[key].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('闲置池 ≥4 条（技巧 + 世界观两类都要有）', () => {
    expect(SPEECH_IDLE_POOL.length).toBeGreaterThanOrEqual(4);
    expect(SPEECH_PERSONALITY_POOL.length).toBeGreaterThanOrEqual(4);
  });

  test('池内没有重复句（同一池里出现两次同样的话 = 卡带）', () => {
    const pools: readonly (readonly string[])[] = [
      ...EVENT_KEYS.map((key) => SPEECH_EVENT_POOLS[key]),
      ...STATE_KEYS.map((key) => SPEECH_STATE_POOLS[key]),
      SPEECH_IDLE_POOL,
      SPEECH_PERSONALITY_POOL,
    ];
    for (const pool of pools) {
      expect(new Set(pool).size).toBe(pool.length);
    }
  });

  test('池子被冻结（外部改不动 —— 文案只有这一份）', () => {
    expect(Object.isFrozen(SPEECH_EVENT_POOLS)).toBe(true);
    expect(Object.isFrozen(SPEECH_STATE_POOLS)).toBe(true);
    expect(Object.isFrozen(SPEECH_IDLE_POOL)).toBe(true);
    expect(Object.isFrozen(SPEECH_PERSONALITY_POOL)).toBe(true);
    for (const key of EVENT_KEYS) expect(Object.isFrozen(SPEECH_EVENT_POOLS[key])).toBe(true);
    for (const key of STATE_KEYS) expect(Object.isFrozen(SPEECH_STATE_POOLS[key])).toBe(true);
  });

  test('事件池与状态池不撞句（口吻分离：播报 vs 自述）', () => {
    const eventTexts = new Set(EVENT_KEYS.flatMap((key) => SPEECH_EVENT_POOLS[key]));
    const stateTexts = new Set(STATE_KEYS.flatMap((key) => SPEECH_STATE_POOLS[key]));
    for (const text of stateTexts) expect(eventTexts.has(text)).toBe(false);
  });

  test('闲置池不与业务池撞句（彩蛋不冒充事件 / 状态）', () => {
    const business = new Set([
      ...EVENT_KEYS.flatMap((key) => SPEECH_EVENT_POOLS[key]),
      ...STATE_KEYS.flatMap((key) => SPEECH_STATE_POOLS[key]),
    ]);
    for (const text of SPEECH_IDLE_POOL) expect(business.has(text)).toBe(false);
  });

  test('事件池句子短（≤12 字）—— 气泡最大宽 160px / 字号 13px，一行约 11 个汉字', () => {
    for (const key of EVENT_KEYS) {
      for (const text of SPEECH_EVENT_POOLS[key]) {
        expect(text.length).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('bubblePool 取池', () => {
  test('事件键取到事件池', () => {
    expect(bubblePool('move')).toBe(SPEECH_EVENT_POOLS.move);
    expect(bubblePool('support')).toBe(SPEECH_EVENT_POOLS.support);
  });

  test('状态键取到状态池', () => {
    expect(bubblePool('thinking')).toBe(SPEECH_STATE_POOLS.thinking);
    expect(bubblePool('working')).toBe(SPEECH_STATE_POOLS.working);
    expect(bubblePool('streaming')).toBe(SPEECH_STATE_POOLS.streaming);
  });

  test('词表外的键返回空数组（静默兜底，不抛错炸掉整条气泡链）', () => {
    expect(bubblePool('nope' as SpeechKey)).toEqual([]);
  });

  test('状态键判定（状态池走 agent 自述 + 性格彩蛋；事件池走播报）', () => {
    expect(isSpeechStateKey('thinking')).toBe(true);
    expect(isSpeechStateKey('working')).toBe(true);
    expect(isSpeechStateKey('streaming')).toBe(true);
    expect(isSpeechStateKey('move')).toBe(false);
    expect(isSpeechStateKey('complete')).toBe(false);
  });
});

describe('抽取器：随机池（acceptance ① 同一事件连续两次文案不同）', () => {
  test('每个事件池连续抽两次都不重样', () => {
    for (const key of EVENT_KEYS) {
      const picker = createSpeechCopyPicker({ random: Math.random });
      const first = picker.pick(key);
      const second = picker.pick(key);
      expect(first).not.toBe(second);
      expect(SPEECH_EVENT_POOLS[key]).toContain(first);
      expect(SPEECH_EVENT_POOLS[key]).toContain(second);
    }
  });

  test('每个状态池连续抽两次都不重样', () => {
    for (const key of STATE_KEYS) {
      const picker = createSpeechCopyPicker({ random: Math.random });
      expect(picker.pick(key)).not.toBe(picker.pick(key));
    }
  });

  test('闲置彩蛋连续抽两次不重样', () => {
    const picker = createSpeechCopyPicker({ random: Math.random });
    expect(picker.pickIdle()).not.toBe(picker.pickIdle());
  });

  test('一轮之内不重样（洗牌牌堆：抽过的本轮不再出现）', () => {
    const picker = createSpeechCopyPicker({ random: Math.random });
    const pool = SPEECH_EVENT_POOLS.move;
    const drawn = new Set<string>();
    for (let i = 0; i < pool.length; i += 1) drawn.add(picker.pick('move'));
    expect(drawn.size).toBe(pool.length);
  });

  test('确定性随机源 ⇒ 可复现（同一序列两次抽取结果相同）', () => {
    const first = createSpeechCopyPicker({ random: sequenceRandom([0.1, 0.9, 0.4, 0.6]) });
    const second = createSpeechCopyPicker({ random: sequenceRandom([0.1, 0.9, 0.4, 0.6]) });
    expect(first.pick('move')).toBe(second.pick('move'));
    expect(first.pick('move')).not.toBe(first.pick('move'));
  });

  test('抽出来的句子一定在池子里（不会凭空造句）', () => {
    // 随机源恒 0.9 ⇒ 恒不命中性格彩蛋 ⇒ 抽出来的必是本池的句子。
    const picker = createSpeechCopyPicker({ random: () => 0.9 });
    for (const key of [...EVENT_KEYS, ...STATE_KEYS]) {
      expect(bubblePool(key)).toContain(picker.pick(key));
    }
    expect(SPEECH_IDLE_POOL).toContain(picker.pickIdle());
  });
});

describe('性格彩蛋：只替换状态池', () => {
  test('概率 0 时永远不替换（状态池原句）', () => {
    // 随机源恒返回 0.9 ⇒ 恒不命中彩蛋（0.9 ≥ 0.2）。
    const picker = createSpeechCopyPicker({ random: () => 0.9 });
    const text = picker.pick('working');
    expect(SPEECH_STATE_POOLS.working).toContain(text);
  });

  test('概率命中时状态池那句被彩蛋替换', () => {
    // 随机源恒返回 0 ⇒ 恒命中彩蛋（0 < 0.2）。
    const picker = createSpeechCopyPicker({ random: () => 0 });
    const text = picker.pick('working');
    expect(SPEECH_PERSONALITY_POOL).toContain(text);
  });

  test('事件池永不被彩蛋替换（播报插一句闲话会变成噪音）', () => {
    const picker = createSpeechCopyPicker({ random: () => 0 });
    const text = picker.pick('move');
    expect(SPEECH_EVENT_POOLS.move).toContain(text);
    expect(SPEECH_PERSONALITY_POOL).not.toContain(text);
  });

  test('彩蛋概率写在度量表里（口径集中可配）', () => {
    expect(SPEECH_COPY_METRICS.personalityChance).toBe(0.2);
  });
});

describe('节奏度量（★ OPEN：交互矩阵未定义气泡节奏，这里给默认值）', () => {
  test('闲置彩蛋的静默门槛与间隔都在度量表里，且间隔不小于门槛', () => {
    expect(SPEECH_COPY_METRICS.idleGraceMs).toBeGreaterThan(0);
    expect(SPEECH_COPY_METRICS.idleMinIntervalMs).toBeGreaterThanOrEqual(SPEECH_COPY_METRICS.idleGraceMs);
    expect(SPEECH_COPY_METRICS.idleMaxIntervalMs).toBeGreaterThanOrEqual(SPEECH_COPY_METRICS.idleMinIntervalMs);
  });

  test('状态气泡有沉降期与同状态节流（克制优先：不刷屏）', () => {
    expect(SPEECH_COPY_METRICS.stateSettleMs).toBeGreaterThan(0);
    expect(SPEECH_COPY_METRICS.stateMinIntervalMs).toBeGreaterThan(0);
  });
});
