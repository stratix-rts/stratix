/**
 * 文件职责：世界态的唯一持有者 —— 极简响应式 store（自建，未引入任何状态库）。
 * 输入：不可变 WorldState 补丁（由 core 内部命令处理或桥接层写入）。
 * 输出：getState() 快照 + subscribe() 变更通知；状态一变即广播给 world / hud 两侧。
 * 禁止事项：
 *   1. 引入 Vue / Pinia / 任何响应式库 —— core 必须能脱离渲染层独立单测；
 *   2. 直接 import world/ 或 hud/ —— 铁律：core 不认识两侧，只认识 ./types 契约；
 *   3. 存放可变对象引用 —— 状态一律不可变，否则订阅者拿到的是"已经变了的旧引用"；
 *   4. 让 notices / selection 无限增长 —— 超过契约上限必须截断（见 types.ts 常量）。
 */

import { resolveInfoLayer } from './info-layer';
import {
  MAX_CHARACTERS,
  MAX_MISSIONS,
  MAX_NOTICES,
  MAX_SESSIONS,
  MAX_TASKS,
  type CharacterTask,
  type CharacterView,
  type DetectedAgent,
  type InfoLayer,
  type LayerTrigger,
  type MissionView,
  type Notice,
  type ScreenId,
  type SelectionState,
  type SessionRecord,
  type UnitView,
  type WorldState,
} from './types';
import { applySelectionAction } from './unit/selection';

export type StateListener = (state: WorldState) => void;
export type StateUpdater = (state: WorldState) => WorldState;

/**
 * 实体集合快照（@since v3.3，task_179 / M1-05）—— **副本里的全部业务实体**。
 *
 * why 是这五个而不是「WorldState 的全部字段」：切副本换的是**业务实体**
 *   （missions / tasks / sessions / characters / units），
 *   而选择集 / 编组槽位 / 提示 / 当前屏是**表现态与交互态**（换实例时随实体一起清，不换）。
 * why 放在 store.ts 而不是 core/types.ts：它是** store 认得的形状**（写入口的入参），
 *   不是总线契约（WorldState 才是）；app 侧的端口实现直接 import 这个类型即可。
 */
export interface EntitySnapshot {
  /** 战场编组任务（mission）。 */
  readonly missions: readonly MissionView[];
  /** 角色任务队列（character task）。 */
  readonly tasks: readonly CharacterTask[];
  /** 会话摘要（session 记录；事件本体不在这）。 */
  readonly sessions: readonly SessionRecord[];
  /** 角色档案（定义 + 养成运行态）。 */
  readonly characters: readonly CharacterView[];
  /** 单位投影（战场单位）。 */
  readonly units: readonly UnitView[];
}

export interface CoreStore {
  getState(): WorldState;
  setState(updater: StateUpdater): WorldState;
  patch(partial: Partial<WorldState>): WorldState;
  subscribe(listener: StateListener): () => void;
  pushNotice(notice: Notice): WorldState;
  /**
   * @since v3.6 写当前屏（ui.navigate 的落库入口；'chat' 不入 currentScreen，
   *   由抽屈自治 —— 见 types.ts WorldState.currentScreen 注释）。
   * why 放 store 而不放 runtime：currentScreen 也不经状态机，落库动作等同替换一个可选字段，
   * 与 setCurrentScreen 同一口径 —— 都是"换一个字段"，由 store 统一承担"是否广播"。
   */
  setCurrentScreen(screen: ScreenId | null): WorldState;
  /**
   * @since v3.3（task_081）写导演模式开关（WorldState.directorEnabled 的落库入口）。
   * why 放 store 而不放 runtime：导演开关是**一个布尔字段**（与 currentScreen 同级 ——
   *   不经状态机、只是「换字段」），由 store 统一承担「值没变就不广播」。
   * 广播是必须的：HUD 顶栏按钮要靠它回显，且 world 侧手动介入会把开关写回 false。
   */
  setDirectorEnabled(enabled: boolean): WorldState;
  /**
   * @since v3.4（task_096）写 HUD 信息层级的**手动档**（WorldState.layerBase 的落库入口）。
   * why 放 store 而不放 runtime：层级**不经状态机**、只是「换一个字段」（与 currentScreen /
   *   directorEnabled 同一口径），由 store 统一承担「值没变就不广播」。
   * 广播是必须的：HUD 侧据此降 L1 对比 / 收起 L2，world 侧据此让位（L3 元素）。
   *
   * ★ task_094：本方法写的是**手动档**（layerBase），不是有效档 —— 有效档由
   *   「手动档 + 演出占用」裁决得出（见 resolveInfoLayer），存在 WorldState.infoLayer。
   */
  setInfoLayer(layer: InfoLayer): WorldState;
  /**
   * @since v3.4（task_094）占用 / 释放一个演出（WorldState.layerHolds 的落库入口）。
   * 语义：非空占用 = 有效档锁 L3（L1 降到 18% 对比、L2 收起）；占用清空 = 回到手动档。
   * why 独立成一个入口：三个演出可同时在演，占用是**计数**语义（谁先结束谁先放手），
   *   不能用「切到某档」表达（那样先结束的那个会把另一个的沉浸态一起撤掉）。
   */
  setLayerHold(trigger: LayerTrigger, active: boolean): WorldState;
  /**
   * @since v3.8 写本地 CLI agent 检测结果（WorldState.detectedAgents 的落库入口）。
   * 语义：**整份替换**（调用方给的是当前快照，不是增量补丁）——
   *   检测是「逐条到达」的，但状态里只留一份当前快照，读取方不必自己拼（拼两份就成两份真相）。
   * 写入方：app/services/agent-detector 的结果经 IPC 到达渲染层后，由 app/main/main-entry.ts 调用。
   * 无实质变化就**原样返回同一引用** → 不广播（与 setCurrentScreen 同一口径：
   *   重复扫描出同样结果时不该把两侧无谓地重渲染一遍）。
   */
  setDetectedAgents(agents: readonly DetectedAgent[]): WorldState;
  /**
   * @since v3.3（task_179 / M1-05）实体集合**整份替换** —— 切副本的落点。
   *
   * 语义（design §7.1 M1-05 行 / §2.2「切副本 = 全量重载，不是增量合并」）：
   *   - 传入的五类实体**整份**写进 store：旧实例的实体**一个不剩**（不做增量合并）；
   *   - 选择集与编组槽位一并清空：它们存的是**单位 id**，换实例后指向的是旧实例的单位
   *     —— 留着就是悬空引用（「旧实例的实体一个不剩」的自然延伸）；
   *   - 其余字段（提示 / 当前屏 / 导演开关 / 信息层级 / activeInstanceId 等）**原样保留**：
   *     它们不属于「这个副本有什么」，换副本不该顺手改用户的界面状态；
   *   - 一次写入 = 一次广播（读取方不会看到「单位换了但角色还没换」的中间态）。
   *
   * why 单独开一个入口而不是让调用方自己 setState：全量替换有**固定的三条附带语义**
   *   （清选择 / 清编组 / 一次广播），散在调用方就会各写一份、慢慢漂移。
   */
  replaceEntities(entities: EntitySnapshot): WorldState;
}

/** 初始状态：空世界。字段名与契约一一对应，便于 bridge 直接整体替换。 */
export function createInitialState(): WorldState {
  const selection: SelectionState = { unitIds: [], previewUnitIds: [], revision: 0 };
  // links / messages（@since v3.1）由 core/agent-link 投影写入，这里只是空数组起点
  // tasks（@since v3.16）由 core/task 投影写入（task.assign 派发队列），空数组即「无任务」
  return {
    units: [],
    missions: [],
    selection,
    characters: [],
    notices: [],
    links: [],
    messages: [],
    // detectedAgents（@since v3.8）：本地 CLI agent 检测结果，空数组即「尚未检测」
    detectedAgents: [],
    // tasks（@since v3.16）：角色任务队列，空数组即「无在办/历史任务」
    tasks: [],
    // selectionGroups（@since v3.34，task_058）：编组槽位表，空 Map 即「无编组」。
    // why 起步就建空表而不是缺省：读方（召回 / HUD）不用每次判 undefined，
    //   runtime 的槽位写入也永远从一份确定的基础表出发（与 tasks 同一「起步即有形」口径）。
    selectionGroups: new Map<number, readonly string[]>(),
    // sessions（@since v3.40，task_091）：会话摘要列表，空数组即「无会话」。
    // 与 links / messages / tasks 同一口径：起步即有形，读方不用每次判 undefined。
    sessions: [],
  };
}

/**
 * 当前屏写入（纯函数，@since v3.6）—— 值没变就**原样返回同一引用**，
 *   让 store 「引用未变即不广播」约定自动生效。
 *
 * 输入约定：
 *   - 传 null 表示「返回主屏」：清空 currentScreen 字段（缺省回落 'main' 的职责在读取方）。
 *     'chat' 既不被允许进入 currentScreen（见 types.ts 注释），runtime 也不应将 'chat' 转 null
 *     —— 这里只做"接到什么就如实写"，语义过滤在 runtime。
 *   - 同一屏重复 → 返回同一引用，不广播。
 */
export function applyCurrentScreen(
  current: ScreenId | undefined,
  next: ScreenId | null
): ScreenId | undefined {
  const nextValue = next ?? undefined;
  if (current === nextValue) return current;
  return nextValue;
}

/**
 * 导演模式开关写入（纯函数，@since v3.3，task_081）—— 与 applyCurrentScreen 同一口径：
 *   值没变就**原样返回同一引用** → store 的「引用未变即不广播」约定自动生效。
 * 缺省（undefined）按「关闭」处理 —— 导演模式默认关，与 DEMO-PLAN §7 的开关语义一致。
 */
export function applyDirectorEnabled(
  current: boolean | undefined,
  next: boolean
): boolean | undefined {
  const nextValue = next === true;
  // 值没变就**原样返回当前引用**（含 undefined）—— 让 store 的「引用未变即不广播」约定生效。
  if ((current ?? false) === nextValue) return current;
  return nextValue;
}

/**
 * HUD 信息层级写入（纯函数，@since v3.4，task_096）—— 与 applyDirectorEnabled 同一口径：
 *   值没变就**原样返回同一引用** → store 的「引用未变即不广播」约定自动生效。
 * 缺省（undefined）按 L1（常驻档）处理 —— 层级默认无特殊状态。
 *
 * ★ task_094：这个函数现在管的是**手动档**（layerBase）；有效档（infoLayer）是
 *   「手动档 + 演出占用」裁决出来的结果（resolveInfoLayer）。
 */
export function applyInfoLayer(
  current: InfoLayer | undefined,
  next: InfoLayer
): InfoLayer | undefined {
  // 值没变就**原样返回当前引用**（含 undefined）—— 让 store 的「引用未变即不广播」生效。
  if ((current ?? 'L1') === next) return current;
  return next;
}

/**
 * 有效档 → 落库值（纯函数，@since v3.4，task_094）。
 * L1（常驻档）回落 undefined —— 与其它可选字段同一口径（缺省即 L1，少一个字段要判）。
 * why 不是「有占用就 L3、没占用就原样」：有效档必须是**算出来的**（手动档 + 占用），
 *   否则「演出结束后回手动档」这条规则就没有落点。
 */
export function effectiveInfoLayerValue(
  base: InfoLayer | undefined,
  holds: readonly LayerTrigger[] | undefined
): InfoLayer | undefined {
  const resolved = resolveInfoLayer(base, holds);
  return resolved === 'L1' ? undefined : resolved;
}

/**
 * 演出占用写入（纯函数，@since v3.4，task_094）—— 与 applyInfoLayer 同一口径：
 *   值没变就**原样返回同一引用** → store 的「引用未变即不广播」约定自动生效。
 * 语义：active=true 占一个位（追加到占用列表）；active=false 释放（从列表里摘掉）。
 * why 占用列表用「词表」而不是计数：三个演出可同时在演，计数分不清是谁没放手；
 *   词表还能回答「现在是谁在演」（调试观察口）。
 * 体积天然有界：最多三个词（LAYER_TRIGGERS）—— 不会无限增长（perf）。
 */
export function applyLayerHold(
  current: readonly LayerTrigger[] | undefined,
  trigger: LayerTrigger,
  active: boolean
): readonly LayerTrigger[] | undefined {
  const list = current ?? [];
  const held = list.includes(trigger);
  // 已经是这个状态 → 原样返回当前引用（不广播）。
  if (held === active) return current;
  if (!active) {
    const next = list.filter((item) => item !== trigger);
    // 空列表回落 undefined（缺省 = 无占用）—— 少一个字段要判。
    return next.length === 0 ? undefined : next;
  }
  return [...list, trigger];
}

/** 剔除已过期通知，并按时间倒序截断到 MAX_NOTICES（每次写入都做，队列长度天然有界）。 */
function pruneNotices(notices: readonly Notice[], now: number): Notice[] {
  return notices.filter((n) => n.expiresAt > now).slice(0, MAX_NOTICES);
}

/**
 * 检测结果逐项比较（@since v3.8）—— 判断「这次扫描的结果与上次是否实质相同」。
 * why 要内容比较而不是引用比较：IPC 每次推送的都是新数组（引用必不同），
 * 若按引用判会每次重扫都广播一遍，两侧白白重渲染（与 setCurrentScreen 的「引用未变即不广播」同一目的，
 * 只是这里的数组是**新引用但同内容**）。
 */
function sameDetectedAgents(a: readonly DetectedAgent[], b: readonly DetectedAgent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((agent, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      agent.kind === other.kind &&
      agent.tier === other.tier &&
      agent.installed === other.installed &&
      agent.status === other.status &&
      agent.version === other.version &&
      agent.path === other.path
    );
  });
}

export function createStore(initial?: Partial<WorldState>): CoreStore {
  let state: WorldState = { ...createInitialState(), ...initial };
  // 手动档缺省取有效档（夹具只给了 infoLayer 时两者的语义必须对齐 ——
  //   否则「有效档 = 手动档 + 占用」这条裁决在起手就自相矛盾）。
  if (state.infoLayer !== undefined && state.layerBase === undefined) {
    state = { ...state, layerBase: state.infoLayer };
  }
  const listeners = new Set<StateListener>();
  const now = (): number => Date.now();

  const notify = (next: WorldState): WorldState => {
    state = next;
    listeners.forEach((l) => l(state));
    return state;
  };

  const store: CoreStore = {
    getState: () => state,

    // updater 原样返回当前引用 = "这次没变"。此时不广播：广播有成本（两侧都会因此重渲染），
    // 且 SelectionState.revision 的语义本就是"选择集实质变了才递增"，无变化的广播会把
    // revision 与渲染成本一起刷上去（core/runtime.ts 的动作 + 对账合并依赖这个约定）。
    setState: (updater) => {
      const next = updater(state);
      if (next === state) return state;
      return notify(next);
    },

    patch: (partial) => notify({ ...state, ...partial }),

    // 返回退订函数：桥接层组件卸载时必须调用，否则监听器泄漏（perf：资源必须可清理）
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    pushNotice: (notice) =>
      notify({ ...state, notices: pruneNotices([notice, ...state.notices], now()) }),

    // @since v3.5 偏好写入：同 setState 的约定 —— 值没实质变化就不广播。

    // @since v3.6 当前屏写入：同上 —— 同一屏不广播（main-screen 渲染判重会跳过重绘），
    // 不同屏则整屏重渲染（屏壳切换）。
    setCurrentScreen: (screen) => {
      const next = applyCurrentScreen(state.currentScreen, screen);
      if (next === state.currentScreen) return state;
      return notify({ ...state, currentScreen: next });
    },

    // @since v3.3（task_081）导演模式开关：同 setCurrentScreen 口径 —— 值没变不广播。
    // ★ task_094 追加：导演模式开着 = **沉浸演出在演**（Z6：导演取景框）→ 同步占一个
    //   'director' 占用位，有效档随之锁 L3（L1 降对比、L2 收起），导演期间中屏只留取景框。
    //   why 落在这里而不是 runtime：开关有两条入口（HUD 的 camera.director 命令 + world 的
    //   手动介入回写），都汇到这一个方法 —— 占用与开关永远同步，不会出现「框在但层级没进 L3」。
    setDirectorEnabled: (enabled) => {
      const next = applyDirectorEnabled(state.directorEnabled, enabled);
      const nextHolds = applyLayerHold(state.layerHolds, 'director', next === true);
      if (next === state.directorEnabled && nextHolds === state.layerHolds) return state;
      const nextInfo = effectiveInfoLayerValue(state.layerBase, nextHolds);
      return notify({ ...state, directorEnabled: next, layerHolds: nextHolds, infoLayer: nextInfo });
    },

    // @since v3.4（task_096/task_094）HUD 信息层级：写的是**手动档**（layerBase），
    //   有效档（infoLayer）按「手动档 + 演出占用」重算 —— 演出期间锁 L3，结束后回手动档。
    setInfoLayer: (layer) => {
      const nextBase = applyInfoLayer(state.layerBase, layer);
      if (nextBase === state.layerBase) return state;
      const nextInfo = effectiveInfoLayerValue(nextBase, state.layerHolds);
      return notify({ ...state, layerBase: nextBase, infoLayer: nextInfo });
    },

    // @since v3.4（task_094）演出占用：占一个位 → 有效档锁 L3；释放 → 回到手动档。
    //   三个演出可同时在演：谁先结束谁先放手，只要还有一个在演就仍是 L3。
    setLayerHold: (trigger, active) => {
      const nextHolds = applyLayerHold(state.layerHolds, trigger, active);
      if (nextHolds === state.layerHolds) return state;
      const nextInfo = effectiveInfoLayerValue(state.layerBase, nextHolds);
      return notify({ ...state, layerHolds: nextHolds, infoLayer: nextInfo });
    },

    // @since v3.8 本地 CLI agent 检测结果：整份替换；内容没变就不广播（同上口径）。
    setDetectedAgents: (agents) => {
      const current = state.detectedAgents ?? [];
      if (sameDetectedAgents(current, agents)) return state;
      return notify({ ...state, detectedAgents: [...agents] });
    },

    // @since v3.3（task_179 / M1-05）实体集合整份替换（切副本）：五类实体全换 + 清选择/编组。
    // 一次写入 = 一次广播（与 core/runtime 的「一次用户操作一次广播」同一纪律）。
    replaceEntities: (entities) => {
      // 截断到契约上限：这些集合随 WorldState 全量广播，体积必须有界（perf 铁律）。
      // why 在写入口截而不是在读口截：读口截会让「存了什么」与「看见什么」不一致。
      const selection = applySelectionAction(state.selection, { type: 'clear' });
      return notify({
        ...state,
        missions: entities.missions.slice(0, MAX_MISSIONS),
        tasks: entities.tasks.slice(0, MAX_TASKS),
        sessions: entities.sessions.slice(0, MAX_SESSIONS),
        characters: entities.characters.slice(0, MAX_CHARACTERS),
        units: [...entities.units],
        selection: selection.next,
        selectionGroups: new Map<number, readonly string[]>(),
      });
    },
  };

  return store;
}

/** 默认单例：world/hud 两侧的 bus-adapter 共用它，保证同一份世界态。测试请用 createStore() 隔离。 */
export const worldStore: CoreStore = createStore();