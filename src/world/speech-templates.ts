/**
 * 文件职责：**离线模板句库**（task_076 / DEMO-PLAN.md §3「内容源」）——
 *   战场气泡说的话全部来自这里的静态句库：开工 / 完成 / 报错 / 被派活 / 支援响应 / 性格彩蛋。
 *   「离线」= 不依赖网络、不依赖 LLM、不依赖任何外部服务 —— 句库随包发布，永远有话说。
 * 输入：SpeechKind（话语类别）+ 可注入的随机源（单测可确定性驱动）。
 * 输出：SPEECH_POOLS（各类别句库）/ PERSONALITY_SPEECH_POOL（性格彩蛋池）/
 *      PERSONALITY_SPEECH_CHANCE（彩蛋概率）/ pickSpeechText（取一句话）。
 * 禁止事项：
 *   1. import phaser / hud / app / vue —— 纯数据 + 纯函数（node 单测直接引本文件）；
 *   2. 联网 / 调 LLM / 读时钟 —— 「离线模板」的含义就是没有外部依赖；
 *   3. 在这里做频率控制（同屏上限 / 单位冷却）—— 那是 objects/speech-bubble.ts 的职责：
 *      句库只管「说什么」，不管「什么时候说、能不能说」；
 *   4. 掺入业务真相（谁在什么相位说话）—— 说话时机由 core 事件决定，句库不认业务；
 *   5. import core/types 以外的模块 —— 句库与总线契约无关（谁来触发由上层接线）。
 *
 * ★ 为什么是「模板」而不是生成式台词：
 *   直播演示要的是**可预期**的台词 —— 每次开工都是「这个我来！」，观众看得懂、评审好验收；
 *   生成式台词每次都不一样，既不可测也不可控（还把「无网络依赖」这条验收直接顶穿）。
 *
 * @since v3.3（task_076）。
 */

/**
 * 话语类别（= 一条事件 → 一池台词）。
 * 词表与 DEMO-PLAN §3 的五个池子一一对应：开工 / 完成 / 报错 / 被派活 / 支援响应。
 */
export type SpeechKind = 'start' | 'complete' | 'error' | 'assigned' | 'support';

/**
 * 各类别的句库（规格原文照抄，不自行扩写 —— 扩写会稀释「可预期」这条纪律）。
 *
 * why 每个池子都是**多条**：同一句话反复出现会像卡带；轮换几条就自然。
 * why 被派活只有一条：「收到新任务」是**事实陈述**（任务确实派到手上了），
 *   换句话说就变成了废话（「好嘞」并不描述发生了什么）—— 这一池不参与轮换是刻意的。
 */
export const SPEECH_POOLS: Readonly<Record<SpeechKind, readonly string[]>> = Object.freeze({
  /** 开工池。 */
  start: Object.freeze(['这个我来！', '收到，开挖', '看我的']),
  /** 完成池。 */
  complete: Object.freeze(['搞定！', '下一个', '完工收工']),
  /** 报错池。 */
  error: Object.freeze(['这有点不对…', '卡住了，求助', '这块有坑']),
  /** 被派活池。 */
  assigned: Object.freeze(['收到新任务']),
  /** 支援响应池（集火支援时的应答；§4「集火卡住单位」触发）。 */
  support: Object.freeze(['来了来了', '这就去']),
});

/**
 * 性格彩蛋池（20% 概率**替换**当次台词 —— 不是追加，是替换：同屏只冒一句，追加会变成两条）。
 * why 单独一池：彩蛋是「性格」而不是「事件状态」，混进业务池会让「这句话对应哪件事」说不清。
 */
export const PERSONALITY_SPEECH_POOL: readonly string[] = Object.freeze([
  '咖啡呢？',
  '996 也是要充电的',
  '又是元气满满的一天',
]);

/** 性格彩蛋的命中概率（0.2 = 20%）。 */
export const PERSONALITY_SPEECH_CHANCE = 0.2;

/**
 * 取一句话：先按类别抽一条，20% 概率被性格彩蛋替换。
 *
 * @param kind 话语类别
 * @param random 随机源（默认 Math.random；单测注入确定性序列）
 *
 * why 彩蛋判定放在**最前**（一次随机就够）：概率口径只有一条路径，
 *   不会出现「先抽池子再判彩蛋」那种两次随机的组合口径（组合起来概率会漂）。
 */
export function pickSpeechText(kind: SpeechKind, random: () => number = Math.random): string {
  if (random() < PERSONALITY_SPEECH_CHANCE) {
    return pickFrom(PERSONALITY_SPEECH_POOL, random);
  }
  return pickFrom(SPEECH_POOLS[kind], random);
}

/** 从一个句池里抽一句（池空时返回空串 —— 句池是编译期常量，空池只会是接线错误）。 */
function pickFrom(pool: readonly string[], random: () => number): string {
  if (pool.length === 0) return '';
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index] ?? '';
}
