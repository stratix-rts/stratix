/**
 * 文件职责：**角色域的写入面** —— 把「给某个角色加经验」翻译成 growth.ts 的纯动作，
 *   并把结果**投影进 store**（WorldState.characters），失败一律转 Notice（用户点了没反应最伤）。
 *   数值裁决全在 growth.ts（纯函数），本文件只做三件事：找角色 → 跑动作 → 写库 + 上报。
 *   来源：docs/REFACTOR_PLAN_V3.md §2「character/ 角色域（D3）」+ D3「数值系统保留」。
 * 输入：core/store 的 CoreStore；characterId 与经验增量（由调用方给出）。
 * 输出：WorldState.characters 的写入；失败 / 升级时的 Notice（source = 'core/character'）。
 * 禁止事项：
 *   1. 自己订阅总线 / 自己 emitState —— 状态广播的唯一出口是 core/runtime.ts 的 store 订阅
 *      （与 mission 同一铁律，否则一次加经验广播两遍，两侧白重渲染一次）；
 *   2. 在这里判定等级 / 经验怎么算 —— 那是 growth.ts 的职责，两处判定必然漂移；
 *   3. 在调用链里抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；一切失败转 Notice；
 *   4. 自己发 HudCommand —— 角色域不主动往 command 通道写任何东西（铁律：只有 hud → core）；
 *   5. import hud / world / 任何渲染依赖 —— core 是依赖图底层。
 *
 * 为什么当前没有 HudCommand 能到达它（与 mission.completeMission 同一处境，故同样留程序化入口）：
 *   契约里的 character 域只有 `character.persona.update`（改提示词），没有"加经验"的命令位；
 *   经验的真实来源应是 world / agent-link 侧的回报（任务完成、agent 学习新技能），
 *   那是 WorldEvent / link 消息的职责，不该让 HUD 手动点一下涨经验（那会变成一个假养成）。
 *   TODO(v3.x): 接回报链路后由 world/agent-link 调本 manager，HUD 侧只读 WorldState.characters 展示。
 */

import { worldStore, type CoreStore } from '../store';
import { NOTICE_TTL_MS, type CharacterView, type NoticeLevel } from '../types';

import { grantExperience as applyExperience, type GrowthErrorCode } from './growth';

/** 写经验被拒的机器可读原因（growth 的错误码 + "角色不在状态里"）。 */
export type CharacterRejectionCode = 'not-found' | GrowthErrorCode;

export type CharacterGrantResult =
  | {
      readonly ok: true;
      readonly character: CharacterView;
      /** 本次跨越的级数；> 0 即升级（降级对账为负数，不发升级提示，见下）。 */
      readonly levelUps: number;
      readonly gained: number;
    }
  | { readonly ok: false; readonly code: CharacterRejectionCode; readonly characterId: string };

export interface CharacterManagerOptions {
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
}

export interface CharacterManager {
  readonly store: CoreStore;
  /**
   * 给角色加经验（成长数值写入面的唯一入口）。
   * 成功即**一次** store 写入 → 广播；角色不存在 / 增量非法返回失败码并推一条 warn 级 Notice。
   * 注意：升级本身不额外广播 —— 状态变更与"升级了"这件事在同一次 setState 里，
   * HUD 靠前后两帧的经验差自己发动画钩子（见 hud/screens/character-screen.ts），
   * core 不为"提示"再广播一次（perf：每次广播都有成本）。
   */
  grantExperience(characterId: string, amount: number): CharacterGrantResult;
}

/**
 * 失败 Notice：统一口径（含 id），让"点了没反应"在日志屏里可追。
 * why 不开时钟注入口：store.pushNotice 内部按**真实** Date.now 剔除过期通知
 * （见 core/store.ts 的 pruneNotices），注一个假时钟进来只会让通知写下即过期、单测假绿。
 */
function reportFailure(
  store: CoreStore,
  id: string,
  text: string,
  level: NoticeLevel = 'warn'
): void {
  const at = Date.now();
  store.pushNotice({
    id,
    level,
    text,
    createdAt: at,
    expiresAt: at + NOTICE_TTL_MS,
    source: 'core/character',
  });
}

export function createCharacterManager(options: CharacterManagerOptions = {}): CharacterManager {
  const store = options.store ?? worldStore;

  /**
   * 查找 → 判定 → 写库全部发生在**同一次 setState 内**（读改写原子化）。
   * why 不先 getState 再 setState：两次读之间若有别的写入（任务域、agent-link 都在写同一个 store），
   * 基于陈旧快照构造的 characters 数组会把那次写入整段覆盖掉。
   * 被拒时 updater 原样返回当前引用 —— store 的"引用未变即不广播"约定因此自动生效（无变化不广播）。
   */
  const grantExperience = (characterId: string, amount: number): CharacterGrantResult => {
    let result: CharacterGrantResult | null = null;

    store.setState((current) => {
      const index = current.characters.findIndex((c) => c.id === characterId);
      if (index < 0) {
        result = { ok: false, code: 'not-found', characterId };
        return current;
      }

      const transition = applyExperience(current.characters[index] as CharacterView, amount);
      if (transition.error) {
        result = { ok: false, code: transition.error, characterId };
        return current;
      }
      result = {
        ok: true,
        character: transition.next,
        levelUps: transition.levelUps,
        gained: transition.gained,
      };
      if (!transition.changed) return current;

      const characters = current.characters.slice();
      characters[index] = transition.next;
      return { ...current, characters };
    });

    // setState 是同步的，返回时 result 必已赋值；保底兜一层（只可能是编程错误，不是用户路径）。
    if (result === null) return { ok: false, code: 'not-found', characterId };
    const settled = result as CharacterGrantResult;
    if (!settled.ok) {
      reportFailure(
        store,
        `character-rejected:${characterId}:${settled.code}`,
        settled.code === 'not-found'
          ? `未找到角色：${characterId}`
          : `经验写入被拒（${settled.code}）：${characterId}`
      );
    }
    return settled;
  };

  return { store, grantExperience };
}