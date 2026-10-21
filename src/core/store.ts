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

import {
  DEFAULT_SETTINGS,
  MAX_NOTICES,
  type BooleanPreferenceKey,
  type Notice,
  type SelectionState,
  type SettingsView,
  type WorldState,
} from './types';

export type StateListener = (state: WorldState) => void;
export type StateUpdater = (state: WorldState) => WorldState;

export interface CoreStore {
  getState(): WorldState;
  setState(updater: StateUpdater): WorldState;
  patch(partial: Partial<WorldState>): WorldState;
  subscribe(listener: StateListener): () => void;
  pushNotice(notice: Notice): WorldState;
  /**
   * @since v3.5 写一条布尔偏好（settings.set 的落库入口）。
   * why 放 store 而不放 runtime：偏好没有领域语义、不经状态机，落库动作就是"换个字段"，
   * 放在 store 里才能被两侧独立单测（runtime 接线是薄薄一层，见 core/runtime.ts TODO）。
   */
  setPreference(key: BooleanPreferenceKey, value: boolean): WorldState;
}

/** 初始状态：空世界。字段名与契约一一对应，便于 bridge 直接整体替换。 */
export function createInitialState(): WorldState {
  const selection: SelectionState = { unitIds: [], previewUnitIds: [], revision: 0 };
  // links / messages（@since v3.1）由 core/agent-link 投影写入，这里只是空数组起点
  // settings（@since v3.5）按契约默认值起步，hud/screens/settings-screen 直接读它即可
  return {
    units: [],
    missions: [],
    selection,
    characters: [],
    notices: [],
    links: [],
    messages: [],
    settings: DEFAULT_SETTINGS,
  };
}

/**
 * 写一条布尔偏好（纯函数，@since v3.5）。抽成纯函数是为了能脱离 store 单测"写完是否变引用"。
 * 值没变就**原样返回同一引用**：与 setState 的约定一致 —— 无实质变化的广播会把两侧无谓地重绘一遍。
 */
export function applyPreference(
  settings: SettingsView | undefined,
  key: BooleanPreferenceKey,
  value: boolean
): SettingsView {
  const base = settings ?? DEFAULT_SETTINGS;
  return base[key] === value ? base : { ...base, [key]: value };
}

/** 剔除已过期通知，并按时间倒序截断到 MAX_NOTICES（每次写入都做，队列长度天然有界）。 */
function pruneNotices(notices: readonly Notice[], now: number): Notice[] {
  return notices.filter((n) => n.expiresAt > now).slice(0, MAX_NOTICES);
}

export function createStore(initial?: Partial<WorldState>): CoreStore {
  let state: WorldState = { ...createInitialState(), ...initial };
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
    setPreference: (key, value) => {
      const next = applyPreference(state.settings, key, value);
      if (next === state.settings) return state;
      return notify({ ...state, settings: next });
    },
  };

  return store;
}

/** 默认单例：world/hud 两侧的 bus-adapter 共用它，保证同一份世界态。测试请用 createStore() 隔离。 */
export const worldStore: CoreStore = createStore();