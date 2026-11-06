/**
 * 文件职责：**气泡话术的唯一事实源**（@since v3.3，task_219 / IX-06）——
 *   战场单位头顶气泡说的每一句话都从这里抽，三族文案：
 *     ① 事件池（用户动作直接引发：下达移动指令 / 选中 / 集火支援 / 任务完成 / 任务报错）；
 *     ② 状态池（agent 自身状态的持续提示：思考中 / 工作中 / LLM 吞吐中）；
 *     ③ 闲置池（全场静默时的彩蛋：Stratix 命令技巧 + 世界观小知识）。
 *   外加「性格彩蛋池」（agent 自述时 20% 概率的一句闲话）。
 *   「离线」= 不联网、不调 LLM、零 token —— 用户已拍板（task_219 requirement 5）。
 * 输入：话语键（事件键 / 状态键）+ 可注入的随机源。
 * 输出：SPEECH_EVENT_POOLS / SPEECH_STATE_POOLS / SPEECH_IDLE_POOL / SPEECH_PERSONALITY_POOL /
 *      SPEECH_COPY_METRICS（节奏数字）/ bubblePool（取池）/ createSpeechCopyPicker（不重复抽取器）。
 * 禁止事项：
 *   1. import world / hud / phaser / 任何 DOM —— 本模块是叶子常量 + 纯函数（node 单测直接引）；
 *   2. 联网 / 调 LLM / 读时钟 —— 话术层是纯本地的，零外部依赖；
 *   3. 在这里做频率控制（同屏上限 / 单位冷却）—— 那是 world/objects/speech-bubble.ts 的职责：
 *      本模块只管「说什么」，不管「什么时候说、能不能说」；
 *   4. 掺入业务真相（谁在什么相位说话）—— 说话时机由 world 层的事件与状态裁决，本模块不认业务；
 *   5. 复制第二份文案池 —— 文案只有这一份，谁要改只改这里。
 *
 * ★ 为什么落在 core/theme/（与 visual-spec / motion-spec / skin-registry 同一模式）：
 *   话术池的消费者**不止战场**：战场侧（world，气泡渲染）与未来的 HUD 侧（复盘 / 日志回看）
 *   都要读同一份文案。按 §1 通信铁律「hud ↔ world 直接调用 = 架构违规」，两侧不能互相 import；
 *   而 world 只允许认识 core。故「唯一事实源」必须落在两侧共用的 core/theme ——
 *   与调色板（core/theme/visual-spec.ts）同一处境、同一解法。
 *   world 侧的取用入口：objects/speech-bubble.ts（气泡板抽句）与 objects/speech-trigger.ts（触发链）。
 *
 * ★ 为什么「同屏 ≤3 / 同单位 5s 冷却」不在这份文件里：
 *   那是**频率规则**（world/objects/speech-bubble.ts 的板子裁决），本文件是**文案事实**。
 *   两件事分开：文案改版不动规则，规则调整不碰文案。
 */

/**
 * 事件键（一条交互事件 → 一池文案）。
 *
 * ★ 两条口径分得清楚（别混）：
 *   - **事件键**：某个**瞬时事件**引发的话 —— 移动指令 / 选中 / 支援 / 完成 / 报错。
 *     口吻是**指挥台播报**（「移动指令已下达」）：这些时刻多半没有 agent 真的在回话，
 *     写成 agent 口吻就是「假回执」（见 docs/DESIGN-canvas-interactions.md §4 IX-06 的病灶 D2）。
 *   - **状态键**：agent **自身状态**的持续提示 —— 口吻是**agent 自述**（「这个我来！」）。
 *     此刻确实有 agent 在干活 / 在说话，所以说「我」不假。
 */
export type SpeechEventKey = 'move' | 'select' | 'support' | 'complete' | 'error';

/**
 * 状态键（agent 会话 / 任务状态驱动的一句话）。
 *
 * - thinking：接了活还没开工 —— 在拆解、在盘算。
 * - working：任务在跑 —— 正在干活。
 * - streaming：agent 正在流式输出（LLM 吞吐中）—— 正在吐字。
 */
export type SpeechStateKey = 'thinking' | 'working' | 'streaming';

/** 话语键全集（事件键 ∪ 状态键）—— 气泡板按它取池。 */
export type SpeechKey = SpeechEventKey | SpeechStateKey;

/**
 * 事件池（指挥台播报口吻）。
 *
 * why 每个池子都是**多条**：同一句话反复出现会像卡带（task_076 的同一纪律）；
 *   每池 ≥4 条起步（task_219 requirement 6）。
 * why 句长都 ≤ 12 字：气泡最大宽 160px、字号 13px（world/speech-spec.ts）⇒ 一行约 11 个汉字，
 *   超长会折成两行、读起来变长条。**世界观的闲话在闲置池里**，那里允许长句。
 */
export const SPEECH_EVENT_POOLS: Readonly<Record<SpeechEventKey, readonly string[]>> = Object.freeze({
  /** 下达移动指令（右击地面 / 集火）。 */
  move: Object.freeze(['移动指令已下达', '路线已标定', '编队转向', '目标点已锁定']),
  /** 选中单位（左键点选）。 */
  select: Object.freeze(['目标已标记', '该单位已就位', '选中完成', '坐标已同步']),
  /** 集火支援（右击命中卡住的单位）。 */
  support: Object.freeze(['支援已就位', '火力转向该单位', '协防编队出动', '支援指令已下达']),
  /** 任务完成。 */
  complete: Object.freeze(['任务完成', '该单已结', '交付完成', '任务已归档']),
  /** 任务报错 / 卡住。 */
  error: Object.freeze(['任务卡住了', '执行受阻', '需要人工介入', '这一步走不通']),
});

/**
 * 状态池（agent 自述口吻）。
 *
 * why 这里可以自称「我」：这三个时刻确实有 agent 在干活 / 在说话 ——
 *   思考中 = 接了活还没开工；工作中 = 任务在跑；吞吐中 = 正在流式输出。
 *   与事件池分池而不同池：口吻不同（自述 vs 播报），混在一池里会读成半句话。
 */
export const SPEECH_STATE_POOLS: Readonly<Record<SpeechStateKey, readonly string[]>> = Object.freeze({
  /** 思考中：任务已派下，agent 还没开工。 */
  thinking: Object.freeze(['收到新任务，正在拆解', '让我想想怎么干', '先理个思路', '稍等，正在盘算']),
  /** 工作中：任务在跑。 */
  working: Object.freeze(['这个我来！', '开工了', '看我的', '收到，开挖']),
  /** LLM 吞吐中：agent 正在流式吐字。 */
  streaming: Object.freeze(['正在吐字…', '接收中', '数据流已接通', '一个字一个字往外蹦']),
});

/**
 * 闲置池（全场静默时的彩蛋）—— 讲 **Stratix 命令技巧** 与 **世界观小知识**。
 *
 * why 闲置才说话：战场忙的时候没人读气泡；静下来时冒一条技巧，恰好是「这时候才想得起来看」的时机。
 * why 允许长句：闲置时没有别的气泡争版面，长句可以铺开讲（最多两行，气泡会自动折行）。
 * why 混技巧与世界观：两者都是「没人问、但知道会更好」的知识，混在一池里轮换，
 *   连续两条不重样（抽取器保证同池内不重复），观感上像随机翻到一页手册。
 */
export const SPEECH_IDLE_POOL: readonly string[] = Object.freeze([
  // —— 命令技巧 ——
  '小技巧：⌘K 打开命令面板',
  '右键地面 = 给选中编队下达移动指令',
  'Space 键把镜头拉回选中单位',
  'Ctrl/⌘ + A 一次选中全场',
  '1…9 召回编组，Ctrl/⌘ + 1…9 存编组',
  '双击单位 = 打开它的单独聊天框',
  '? 键随时翻出快捷键手册',
  'Shift + 点击 = 加选或减选',
  // —— 世界观小知识 ——
  'Stratix 的战场没有地形阻挡，单位只听指挥。',
  '每个单位背后都站着一个 agent，活是它在干。',
  '这里的命令不走网络，全在本机跑。',
  '指挥官，今天的活还剩不少。',
]);

/**
 * 性格彩蛋池（agent 自述时 **20% 概率替换**当次台词 —— 是替换，不是追加：同屏只冒一句）。
 *
 * why 单独一池：彩蛋是「性格」而不是「事件 / 状态」，混进业务池会让「这句话对应哪件事」说不清。
 * why 只作用于**状态池**：状态池是 agent 自述（「这个我来！」），闲话插在这里才不突兀；
 *   事件池是指挥台播报，插一句「咖啡呢？」会把播报变成噪音。
 */
export const SPEECH_PERSONALITY_POOL: readonly string[] = Object.freeze([
  '咖啡呢？',
  '996 也是要充电的',
  '又是元气满满的一天',
  '先让我伸个懒腰',
]);

/**
 * 话术层的节奏度量（一处改，全场跟着改）。
 *
 * ★ OPEN（task_219 requirement 3）：交互矩阵（docs/DESIGN-canvas-interactions.md §2）
 *   **未定义气泡的触发节奏** —— 本表先给默认值（克制优先：不刷屏），等矩阵补齐后再对齐。
 *   写明 OPEN 是为了不让人以为这几个数字有规格背书。
 */
export const SPEECH_COPY_METRICS = Object.freeze({
  /** 性格彩蛋命中概率（0.2 = 20%）；只作用于状态池。 */
  personalityChance: 0.2,
  /**
   * 同一单位两次**状态**气泡的最小间隔（ms）—— 状态是持续的，不该一直刷。
   * why 需要：agent 连续说三句「正在吐字…」没人受得了 —— 状态气泡按间隔节流。
   */
  stateMinIntervalMs: 15_000,
  /**
   * 状态气泡的**沉降期**（ms）：状态要稳住这么久才说话。
   * why 需要：「接了活」（thinking）常常在几百毫秒后就变成「开工了」（working）——
   *   立刻说一句「收到新任务，正在拆解」，下一秒又说「这个我来！」，两句话互相打脸。
   *   沉降期内状态变了 ⇒ 前一句作废（只说后一句）。
   */
  stateSettleMs: 1_200,
  /**
   * 闲置彩蛋的**静默门槛**（ms）：距离上一次任何气泡至少这么久，才允许冒彩蛋。
   * why 需要：刚派完活就冒「小技巧」，像是在说「你刚才那单不算数」。
   */
  idleGraceMs: 15_000,
  /** 闲置彩蛋的最小间隔（ms）—— 两条彩蛋之间至少隔这么久。 */
  idleMinIntervalMs: 30_000,
  /** 闲置彩蛋的最大间隔（ms）—— 抽到的间隔落在这个区间内（随机，避免固定节奏）。 */
  idleMaxIntervalMs: 60_000,
});

/** 话术节奏度量的类型别名（便于调用方按类型标注）。 */
export type SpeechCopyMetrics = typeof SPEECH_COPY_METRICS;

/**
 * 取某个话语键对应的文案池。
 *
 * @param key 事件键或状态键
 * @returns 该键的文案池（冻结数组）；键不在词表内返回空数组（接线错误的兜底，不抛错 ——
 *   抛错会让一条坏事件炸掉整条气泡链，静默空池则只是「这句话没说出来」）
 */
export function bubblePool(key: SpeechKey): readonly string[] {
  const eventPool = SPEECH_EVENT_POOLS[key as SpeechEventKey];
  if (eventPool) return eventPool;
  return SPEECH_STATE_POOLS[key as SpeechStateKey] ?? [];
}

/** 该键是不是状态键（状态池走 agent 自述口径 + 性格彩蛋；事件池走播报口径）。 */
export function isSpeechStateKey(key: SpeechKey): key is SpeechStateKey {
  return Object.prototype.hasOwnProperty.call(SPEECH_STATE_POOLS, key);
}

/**
 * 抽取器（不重复抽取）。
 *
 * why 不直接 `Math.random()` 抽：那样**连续两次可能抽到同一句**（task_219 acceptance ① 明令不许）。
 *   本抽取器按「洗牌牌堆」抽：抽过的句子本轮不再出现，牌堆抽空才重新洗 ——
 *   于是同一池内**连续两次必不同**，且一轮之内不重样（与 core/theme/skin-registry.ts 的
 *   `createSkinRandomizer()` 同一套路：洗牌 → 抽走 → 抽空重洗）。
 */
export interface SpeechCopyPicker {
  /**
   * 抽一句话。
   * @param key 事件键或状态键
   */
  pick(key: SpeechKey): string;
  /** 抽一句闲置彩蛋。 */
  pickIdle(): string;
}

/**
 * 创建一个抽取器（每个气泡系统一份；同一份抽取器 ⇒ 跨池也不重样）。
 *
 * @param options.random 随机源（默认 Math.random；单测注入确定性序列）
 *
 * why 随机源必须可注入：抽取器带状态（牌堆剩多少），用真随机就没法断言「连续两次不同」。
 */
export function createSpeechCopyPicker(options: { readonly random?: () => number } = {}): SpeechCopyPicker {
  const random = options.random ?? Math.random;
  const decks = new Map<string, () => string>();
  const deckFor = (key: string, pool: readonly string[]): (() => string) => {
    let cached = decks.get(key);
    if (!cached) {
      cached = createDeck(pool, random);
      decks.set(key, cached);
    }
    return cached;
  };

  return {
    pick(key: SpeechKey): string {
      const pool = bubblePool(key);
      if (pool.length === 0) return '';
      const base = deckFor(`key:${key}`, pool)();
      if (!isSpeechStateKey(key)) return base;
      // 状态池 = agent 自述 —— 20% 概率被一句闲话替换。
      if (random() >= SPEECH_COPY_METRICS.personalityChance) return base;
      const quip = deckFor('personality', SPEECH_PERSONALITY_POOL)();
      return quip || base;
    },
    pickIdle(): string {
      const pool = SPEECH_IDLE_POOL;
      if (pool.length === 0) return '';
      return deckFor('idle', pool)();
    },
  };
}

/**
 * 一个池子的抽取器：洗牌 → 抽走 → 抽空重洗。
 * why 抽走而不是「记住上次那句再重抽」：牌堆法天然保证**一轮之内不重样**，
 *   顺带保证「连续两次不同」（池 ≥2 条时）。
 */
function createDeck(pool: readonly string[], random: () => number): () => string {
  let remaining: string[] = [];
  const refill = (): void => {
    remaining = shuffle(pool, random);
  };
  refill();
  return (): string => {
    if (remaining.length === 0) refill();
    const index = Math.min(remaining.length - 1, Math.max(0, Math.floor(random() * remaining.length)));
    const picked = remaining.splice(index, 1)[0] ?? '';
    return picked;
  };
}

/** Fisher-Yates 洗牌（就地打乱副本，不改原池）。 */
function shuffle(pool: readonly string[], random: () => number): string[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    const a = copy[i] ?? '';
    const b = copy[j] ?? '';
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
