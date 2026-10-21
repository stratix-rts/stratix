/**
 * 文件职责：**角色域的写入面** —— 把「给某个角色加经验 / 改提示词」翻译成 growth.ts / persona.ts
 *   的纯动作，并把结果**投影进 store**（WorldState.characters），失败一律转 Notice（用户点了没反应最伤）。
 *   数值 / 字符串裁决全在纯函数（growth.ts、persona.ts），本文件只做三件事：找角色 → 跑动作 → 写库 + 上报。
 *   来源：docs/REFACTOR_PLAN_V3.md §2「character/ 角色域（D3）」+ D3「数值系统保留、提示词保留」。
 * 输入：core/store 的 CoreStore；characterId 与经验增量 / 新提示词（由调用方给出）。
 * 输出：WorldState.characters 的写入；失败 / 升级时的 Notice（source = 'core/character'）。
 * 禁止事项：
 *   1. 自己订阅总线 / 自己 emitState —— 状态广播的唯一出口是 core/runtime.ts 的 store 订阅
 *      （与 mission 同一铁律，否则一次加经验广播两遍，两侧白重渲染一次）；
 *   2. 在这里判定等级 / 经验怎么算 —— 那是 growth.ts 的职责，两处判定必然漂移；
 *   3. 在这里判定提示词是否合法 —— 那是 persona.ts 的职责（trim / 长度上限 / 空串拒绝）；
 *   4. 在调用链里抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；一切失败转 Notice；
 *   5. 自己发 HudCommand —— 角色域不主动往 command 通道写任何东西（铁律：只有 hud → core）；
 *   6. import hud / world / 任何渲染依赖 —— core 是依赖图底层。
 *
 * HudCommand 来源（@since v3.6 接线）：
 *   - `character.persona.update`（契约里自带的命令）：HUD 改角色提示词的**唯一**公开入口，
 *     由 core/runtime.ts 接线到 manager.updatePersona。本任务之前的 Phase 2 留 TODO，
 *     见 core/runtime.ts 的 handleCommand 'character.persona.update' case。
 *   - 经验（grantExperience）：契约里**没有**对应的 HudCommand 位（per HUD 手动涨经验会变成假养成），
 *     故仍只作为 manager 的程序化入口暴露给 world/agent-link 的回报链路使用。
 */

import { worldStore, type CoreStore } from '../store';
import { NOTICE_TTL_MS, type CharacterView, type NoticeLevel } from '../types';

import { grantExperience as applyExperience, type GrowthErrorCode } from './growth';
import { updatePersona as applyPersona, type PersonaErrorCode } from './persona';

/** 写经验 / persona 被拒的机器可读原因（对应纯函数错误码 + "角色不在状态里"）。 */
export type CharacterRejectionCode = 'not-found' | GrowthErrorCode | PersonaErrorCode;

export type CharacterGrantResult =
  | {
      readonly ok: true;
      readonly character: CharacterView;
      /** 本次跨越的级数；> 0 即升级（降级对账为负数，不发升级提示，见下）。 */
      readonly levelUps: number;
      readonly gained: number;
    }
  | { readonly ok: false; readonly code: CharacterRejectionCode; readonly characterId: string };

export type CharacterPersonaResult =
  | {
      readonly ok: true;
      readonly character: CharacterView;
      /** 写入后生效的提示词（trim 后）。便于调用方落字一致。 */
      readonly prompt: string;
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
  /**
   * 改角色提示词（persona 写入面的唯一入口，对应 HudCommand 'character.persona.update'）。
   * 与 grantExperience 同一写入口径：查找→判定→投影在**同一次 setState** 内完成，
   * 被拒时 updater 原样返回当前引用 → store「引用未变即不广播」约定自动生效；
   * 失败转 Notice（source = 'core/character'）。
   * 提示词合法性（空 / 非字符串 / 超长）由 persona.ts 的纯函数校验，本文件不重复判。
   */
  updatePersona(characterId: string, prompt: unknown): CharacterPersonaResult;
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

/**
 * 写人物角色结果上附带的中文标签（Notice 用）。
 * 把"非 not-found 的 error 怎么念"集中一处，免得 manager 与单测各写一份文案漂移。
 */
function rejectionLabel(code: CharacterRejectionCode, subject: '经验' | '提示词', characterId: string): string {
  if (code === 'not-found') return `未找到角色：${characterId}`;
  return `${subject}写入被拒（${code}）：${characterId}`;
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
        rejectionLabel(settled.code, '经验', characterId)
      );
    }
    return settled;
  };

  /**
   * 改写 persona —— 与 grantExperience 共用同一份写入口径（一次 setState 内原子化）。
   * why 不复用同一 updater：命令语义不同、HudCommand.type 不同、错误码不同，
   * 分两个函数让"被拒走 Notice"与"成功投影"各自的失败码映射都是自描述的。
   */
  const updatePersona = (characterId: string, prompt: unknown): CharacterPersonaResult => {
    let result: CharacterPersonaResult | null = null;

    store.setState((current) => {
      const index = current.characters.findIndex((c) => c.id === characterId);
      if (index < 0) {
        result = { ok: false, code: 'not-found', characterId };
        return current;
      }

      const transition = applyPersona(current.characters[index] as CharacterView, prompt);
      if (transition.error) {
        result = { ok: false, code: transition.error, characterId };
        return current;
      }
      result = { ok: true, character: transition.next, prompt: transition.prompt };
      if (!transition.changed) return current;

      const characters = current.characters.slice();
      characters[index] = transition.next;
      return { ...current, characters };
    });

    if (result === null) return { ok: false, code: 'not-found', characterId };
    const settled = result as CharacterPersonaResult;
    if (!settled.ok) {
      reportFailure(
        store,
        `character-persona-rejected:${characterId}:${settled.code}`,
        rejectionLabel(settled.code, '提示词', characterId)
      );
    }
    return settled;
  };

  return { store, grantExperience, updatePersona };
}