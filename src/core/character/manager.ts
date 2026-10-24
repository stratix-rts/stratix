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
 *
 * @since v3.7 角色建档（character.create）：
 *   新增 createCharacter —— 建档合法性裁决在 profile.ts（纯函数），本文件只做「找冲突 → 落库 → 上报」。
 *   落库后由 core/runtime.ts 的 store 订阅**全量广播** WorldState.characters（广播出口仍只有一处）。
 *
 * @since v3.9 角色 → 战场单位（task_026）：
 *   建档成功的**同一次** setState 里，一并写入该角色的战场单位（投影见 unit-projection.ts）——
 *   「战场上的组织单位是 Agent 单位」（D5 组织模型），角色建档即入战场。
 */

import { worldStore, type CoreStore } from '../store';
import {
  MAX_CHARACTERS,
  NOTICE_TTL_MS,
  type AgentKind,
  type AgentProfile,
  type CharacterAppearance,
  type CharacterView,
  type NoticeLevel,
} from '../types';

import { grantExperience as applyExperience, type GrowthErrorCode } from './growth';
import { updatePersona as applyPersona, type PersonaErrorCode } from './persona';
import {
  createAgentProfile,
  hasDuplicateCharacterName,
  isSameCharacterAppearance,
  resolveAppearance,
  type ProfileErrorCode,
} from './profile';
import { toCharacterUnit, CHARACTER_UNIT_ID_PREFIX } from './unit-projection';

/** 写经验 / persona 被拒的机器可读原因（对应纯函数错误码 + "角色不在状态里"）。 */
export type CharacterRejectionCode = 'not-found' | GrowthErrorCode | PersonaErrorCode;

/**
 * 建档被拒的机器可读原因（@since v3.7）。
 * - ProfileErrorCode：单个档案本身不合法（名字 / agent 种类 / 皮肤 / 人设），来自 profile.ts；
 * - duplicate-name：状态里已有同名角色（**要看状态，故判在 manager**，不在纯函数里）；
 * - limit-exceeded：角色数已达上限（MAX_CHARACTERS）—— 拒绝新建，绝不静默挤掉已有角色。
 */
export type CharacterCreateRejectionCode = ProfileErrorCode | 'duplicate-name' | 'limit-exceeded';

/** 建档入参。字段类型按契约收，运行时脏值由 profile.ts 兜（unknown 校验在纯函数里）。 */
export interface CharacterCreateInput {
  readonly name: string;
  readonly agentKind: AgentKind;
  readonly skinId: string;
  /** 人设提示词；缺省 / 空串 → 套默认模板（profile.ts 的 DEFAULT_PERSONA_TEMPLATE）。 */
  readonly persona?: string;
  /** 外部会话 id（各 CLI 原样透传）；缺省为 null。 */
  readonly externalSessionId?: string | null;
  /**
   * 角色外观（@since v3.10）：体型 + 部位变体。
   * 缺省 / null = 不带外观（老档案照旧合法）；非法形状由 profile.ts 裁决（拒发）。
   */
  readonly appearance?: CharacterAppearance | null;
}

export type CharacterCreateResult =
  | {
      readonly ok: true;
      /** 落库后的角色（WorldState.characters 里那一条）。 */
      readonly character: CharacterView;
      /** agent 视角的同一份档案（投影，不是第二份存储）。 */
      readonly profile: AgentProfile;
    }
  | { readonly ok: false; readonly code: CharacterCreateRejectionCode };


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

/**
 * 改形象被拒的机器可读原因（@since v3.20，task_041）。
 * - not-found：状态里没有这个角色；
 * - invalid-appearance：外观形状非法（profile.ts 的 resolveAppearance 口径 —— 体型不在词表 /
 *   部位字典非法 / 条数或长度超限），或载荷根本没给外观（改形象必须带一份真外观）。
 */
export type CharacterAppearanceResult =
  | {
      readonly ok: true;
      readonly character: CharacterView;
      /** 写入后生效的外观（已校验 / 规范化，与 store 里那份同引用）。 */
      readonly appearance: CharacterAppearance;
    }
  | { readonly ok: false; readonly code: 'not-found' | 'invalid-appearance'; readonly characterId: string };

export interface CharacterManagerOptions {
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
  /** 角色档案条数上限；默认契约常量 MAX_CHARACTERS（perf：characters 全量广播，必须有界）。 */
  readonly maxCharacters?: number;
  /** 角色 id 生成器；默认按 `character_<时间戳>_<序号>` 生成（与 mission 域同一形状）。 */
  readonly createId?: (prefix: string) => string;
}

export interface CharacterManager {
  readonly store: CoreStore;
  /**
   * 新建角色档案（对应 HudCommand 'character.create'，@since v3.7）。
   * 合法性裁决在 profile.ts（纯函数）：名字 trim 非空且 ≤24 码点、agentKind 在词表内、
   * skinId 非空、persona 走 persona.ts 既有校验（空 → 默认模板）。
   * 状态相关的两件事判在本文件：**同名冲突**（大小写不敏感）与**条数上限**。
   * 成功 → 角色进 WorldState.characters，**且**同一次写入里投影出它的战场单位
   * （@since v3.9，投影见 unit-projection.ts）—— 一次广播两侧同时看到角色与单位；
   * 失败 → 拒发 + Notice（状态不变）。
   */
  createCharacter(input: CharacterCreateInput): CharacterCreateResult;
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
  /**
   * 改角色形象（外观写入面的唯一入口，对应 HudCommand 'character.appearance.update'，@since v3.20 task_041）。
   * 合法性裁决在 profile.ts 的 resolveAppearance（与建档同一口径）；语义相等（isSameCharacterAppearance）
   * 则不写库不广播。写入时在**同一次 setState** 里同步刷新该角色战场单位的 appearance 投影
   * （单位的 appearance 是建档时的快照引用，不同步刷新战场就还画旧形象）。
   * ★ 不判解锁：等级门槛是编辑 UI 的引导约束（见 types.ts 命令注释），写入面只管形状合法。
   */
  updateAppearance(characterId: string, appearance: unknown): CharacterAppearanceResult;
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

/**
 * 建档被拒的中文标签（Notice 用）。集中一处，免得 manager 与单测各写一份文案漂移。
 * why 分「error / warn」两级：
 *   - duplicate-name 是**冲突**（用户想建的角色已经存在），用 error 级；
 *   - 其余是**输入不合法**（名字/皮肤/人设写错了），用 warn 级。
 */
function createRejectionLabel(code: CharacterCreateRejectionCode, maxCharacters: number): string {
  switch (code) {
    case 'duplicate-name':
      return '已存在同名角色，请换一个名字';
    case 'limit-exceeded':
      return `角色数已达上限（${maxCharacters}），请先移除不需要的角色`;
    case 'empty-name':
      return '角色名不能为空';
    case 'name-too-long':
      return '角色名过长';
    case 'unknown-agent-kind':
      return '不认识这个 agent 类型';
    case 'invalid-skin-id':
      return '皮肤 id 不合法';
    case 'invalid-session-id':
      return '外部会话 id 不合法';
    case 'not-a-string':
      return '人设提示词必须是字符串';
    case 'too-long':
      return '人设提示词过长';
    case 'empty':
      return '人设提示词不能为空';
    default:
      return `角色创建被拒（${code}）`;
  }
}

export function createCharacterManager(options: CharacterManagerOptions = {}): CharacterManager {
  const store = options.store ?? worldStore;
  const maxCharacters = options.maxCharacters ?? MAX_CHARACTERS;
  let seq = 0;
  // id 生成器与 mission 域同一形状（时间戳 + 序号）：同一毫秒内连建两个角色也不会撞号。
  const createId = options.createId ?? ((prefix: string): string => `${prefix}_${Date.now()}_${++seq}`);

  /**
   * 建档（@since v3.7）：合法性 → profile.ts（纯函数）；冲突与上限 → 本文件（要看状态）；
   * 落库 → **同一次 setState** 内原子完成（与 grantExperience / updatePersona 同一口径）。
   * 广播：state 一变，core/runtime.ts 的 store 订阅会把整份 WorldState（含 characters）全量下发，
   * 本文件**不自己广播**（广播出口唯一，见文件头禁止事项第 1 条）。
   */
  const createCharacter = (input: CharacterCreateInput): CharacterCreateResult => {
    const id = createId('character');
    const built = createAgentProfile({
      id,
      name: input.name,
      agentKind: input.agentKind,
      skinId: input.skinId,
      persona: input.persona,
      externalSessionId: input.externalSessionId,
      appearance: input.appearance,
    });
    if (!built.ok) {
      reportFailure(store, `character-create-rejected:${built.code}`, createRejectionLabel(built.code, maxCharacters));
      return { ok: false, code: built.code };
    }
    const profile = built.profile;

    let result: CharacterCreateResult | null = null;
    store.setState((current) => {
      // 同名冲突与上限都判在**同一次** setState 内：判在前、写在后，中间没有别的写入插进来
      // （两个域都写同一个 store，陈旧快照判出的"不冲突"可能已被另一个写入抢先占了名字）。
      if (hasDuplicateCharacterName(current.characters, profile.displayName)) {
        result = { ok: false, code: 'duplicate-name' };
        return current;
      }
      if (current.characters.length >= maxCharacters) {
        result = { ok: false, code: 'limit-exceeded' };
        return current;
      }
      const character: CharacterView = {
        id: profile.id,
        name: profile.displayName,
        persona: profile.persona,
        level: profile.level,
        experience: profile.exp,
        agentKind: profile.agentKind,
        skinId: profile.skinId,
        externalSessionId: profile.externalSessionId ?? null,
        // 只有真给了外观才带上这个键：老档案的投影形状保持原样（不凭空多一个 undefined 字段）。
        ...(profile.appearance ? { appearance: profile.appearance } : {}),
      };
      result = { ok: true, character, profile };
      // @since v3.9（task_026）：角色建档 = 战场上多一个 agent 单位（投影见 unit-projection.ts）。
      // 与角色**同一次** setState 落库：一次广播两侧同时看到「角色 + 单位」，
      // 分两次写就会广播两遍（runtime 明令「一次用户操作只打一次 state」）。
      return {
        ...current,
        characters: [...current.characters, character],
        units: [...current.units, toCharacterUnit(character)],
      };
    });

    // setState 是同步的，返回时 result 必已赋值；保底兜一层（只可能是编程错误，不是用户路径）。
    if (result === null) return { ok: false, code: 'duplicate-name' };
    const settled = result as CharacterCreateResult;
    if (!settled.ok) {
      const level: NoticeLevel = settled.code === 'duplicate-name' ? 'error' : 'warn';
      reportFailure(
        store,
        `character-create-rejected:${settled.code}`,
        createRejectionLabel(settled.code, maxCharacters),
        level
      );
    }
    return settled;
  };

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

  /**
   * 改写形象（@since v3.20，task_041）—— 与 updatePersona 同一写入口径（一次 setState 内原子化）。
   * 与其它写入面的两处差异：
   *   1. 合法性校验直接复用建档的 resolveAppearance（同一份「什么算合法外观」真相，不分叉）；
   *      外观缺失（null）在这里是拒发而不是「不带」—— 改形象必须给一份真外观；
   *   2. 写 characters 的同一次 setState 里同步刷新战场单位的 appearance（建档投影是快照引用，
   *      只改 characters 不改 units 的话，战场继续画旧形象，两侧漂移）。
   */
  const updateAppearance = (characterId: string, appearance: unknown): CharacterAppearanceResult => {
    // 形状校验不需要看状态，前置到 setState 外面（省一次无效的原子化进入/退出）。
    const resolved = resolveAppearance(appearance);
    if ('error' in resolved || resolved.appearance === null) {
      reportFailure(store, `character-appearance-rejected:${characterId}:invalid-appearance`, `外观写入被拒（invalid-appearance）：${characterId}`);
      return { ok: false, code: 'invalid-appearance', characterId };
    }
    const next = resolved.appearance;

    let result: CharacterAppearanceResult | null = null;

    store.setState((current) => {
      const index = current.characters.findIndex((c) => c.id === characterId);
      if (index < 0) {
        result = { ok: false, code: 'not-found', characterId };
        return current;
      }

      const existing = current.characters[index] as CharacterView;
      // 语义相等（体型 + 逐部位值）→ 不写库不广播（与 updatePersona 的「与原值一致」同一约定）。
      if (existing.appearance && isSameCharacterAppearance(existing.appearance, next)) {
        result = { ok: true, character: existing, appearance: existing.appearance };
        return current;
      }

      const updated: CharacterView = { ...existing, appearance: next };
      const characters = current.characters.slice();
      characters[index] = updated;
      // 同步刷新战场单位的外观投影：单位 id 是稳定的 `unit_<角色id>`（见 unit-projection.ts），
      // 只刷新它自己的那一项，其余单位（含未关联角色的）不动。
      const unitId = `${CHARACTER_UNIT_ID_PREFIX}${characterId}`;
      const units = current.units.map((unit) => (unit.id === unitId ? { ...unit, appearance: next } : unit));
      result = { ok: true, character: updated, appearance: next };
      return { ...current, characters, units };
    });

    if (result === null) return { ok: false, code: 'not-found', characterId };
    const settled = result as CharacterAppearanceResult;
    if (!settled.ok) {
      reportFailure(
        store,
        `character-appearance-rejected:${characterId}:${settled.code}`,
        settled.code === 'not-found' ? `未找到角色：${characterId}` : `外观写入被拒（${settled.code}）：${characterId}`
      );
    }
    return settled;
  };

  return { store, createCharacter, grantExperience, updatePersona, updateAppearance };
}
