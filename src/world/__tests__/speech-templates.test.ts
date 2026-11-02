/**
 * 测试职责：**离线模板句库**（task_076 / DEMO-PLAN.md §3）——
 *   四类事件（开工 / 完成 / 报错 / 被派活）各自的候选句、支援响应池、
 *   以及性格彩蛋的 20% 概率分支。
 * 输入：被测模块 src/world/speech-templates.ts。
 * 输出：断言（无返回值）。
 * 禁止事项：
 *   1. import phaser —— 句库是纯离线数据，node 单测直接跑；
 *   2. 用 Math.random 造成不稳定断言 —— 随机源一律注入确定性函数；
 *   3. 断言「恰好抽到某一句」而不注入随机 —— 抽句是随机的，测的是**集合约束**与**分支**。
 */

import {
  PERSONALITY_SPEECH_CHANCE,
  PERSONALITY_SPEECH_POOL,
  SPEECH_POOLS,
  pickSpeechText,
  type SpeechKind,
} from '../speech-templates';

describe('speech-templates 离线句库', () => {
  it('四类事件各有自己的候选句（规格逐字对齐）', () => {
    expect(SPEECH_POOLS.start).toEqual(['这个我来！', '收到，开挖', '看我的']);
    expect(SPEECH_POOLS.complete).toEqual(['搞定！', '下一个', '完工收工']);
    expect(SPEECH_POOLS.error).toEqual(['这有点不对…', '卡住了，求助', '这块有坑']);
    expect(SPEECH_POOLS.assigned).toEqual(['收到新任务']);
    // 支援响应池（被派活的回应）。
    expect(SPEECH_POOLS.support).toEqual(['来了来了', '这就去']);
  });

  it('句库是不可变的（防止运行期被改写）', () => {
    expect(Object.isFrozen(SPEECH_POOLS)).toBe(true);
    expect(Object.isFrozen(SPEECH_POOLS.start)).toBe(true);
    expect(Object.isFrozen(PERSONALITY_SPEECH_POOL)).toBe(true);
  });

  it('性格彩蛋池是规格里的三句，概率是 20%', () => {
    expect(PERSONALITY_SPEECH_POOL).toEqual(['咖啡呢？', '996 也是要充电的', '又是元气满满的一天']);
    expect(PERSONALITY_SPEECH_CHANCE).toBe(0.2);
  });

  it('抽出来的句子一定来自对应池（注入确定性随机）', () => {
    const kinds: SpeechKind[] = ['start', 'complete', 'error', 'assigned', 'support'];
    for (const kind of kinds) {
      for (let i = 0; i < 20; i += 1) {
        const text = pickSpeechText(kind, () => 0.9); // 0.9 > 0.2 → 走本类池
        expect(SPEECH_POOLS[kind]).toContain(text);
        expect(PERSONALITY_SPEECH_POOL).not.toContain(text);
      }
    }
  });

  it('随机小于 20% 时走性格彩蛋池', () => {
    for (let i = 0; i < 20; i += 1) {
      const text = pickSpeechText('start', () => 0.1); // 0.1 < 0.2 → 彩蛋
      expect(PERSONALITY_SPEECH_POOL).toContain(text);
    }
  });

  it('概率边界：恰好等于 0.2 时不进彩蛋（< 才是彩蛋）', () => {
    const text = pickSpeechText('start', () => PERSONALITY_SPEECH_CHANCE);
    expect(SPEECH_POOLS.start).toContain(text);
  });

  it('彩蛋分支与本类分支互斥（随机源决定走哪条）', () => {
    // 第一次调用消耗随机判定（0.05 < 0.2 → 彩蛋），第二次调用抽本类句（0.5 → 池内首句）。
    const sequence = [0.05, 0.5];
    let index = 0;
    const random = (): number => sequence[index++] ?? 0.5;
    expect(PERSONALITY_SPEECH_POOL).toContain(pickSpeechText('complete', random));
    expect(SPEECH_POOLS.complete).toContain(pickSpeechText('complete', random));
  });

  it('默认随机源可用（不注入也能抽出一句合法的话）', () => {
    const text = pickSpeechText('error');
    const known = [...SPEECH_POOLS.error, ...PERSONALITY_SPEECH_POOL];
    expect(known).toContain(text);
  });
});
