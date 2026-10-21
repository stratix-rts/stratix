/**
 * 文件职责：世界层(world) 与 HUD 层(hud) 之间全部通信类型的唯一事实源（总线契约）。
 *   来源：docs/REFACTOR_PLAN_V3.md §5「总线契约草案」（V3.1 冻结版）。
 * 输入：无（纯类型 + 冻结常量，本文件无任何 import）。
 * 输出：WorldState（core → 两层广播）、HudCommand（hud → core）、WorldEvent（world → core）。
 * 禁止事项：
 *   1. 引入任何 import —— 契约文件必须是依赖图的叶子，任何依赖都会让两层间接耦合；
 *   2. 出现 any —— 契约类型必须可静态穷尽，any 会让调用方绕过总线铁律（编译期即失效）；
 *   3. 引用 Phaser / DOM / Vue 类型 —— 形状类型（Point/Bounds）在本文件自定义；
 *   4. 写业务逻辑或状态机 —— 状态机实现属于 core/unit、core/mission，本文件只描述"长什么样"。
 *
 * 通信铁律（P3）：
 *   hud → core  只允许 HudCommand；world → core 只允许 WorldEvent；core → 两层 只广播 WorldState。
 *   任何 hud ↔ world 的直接调用都是架构违规。
 *
 * 版本约定：新增字段走 `@since v3.x` 注释，不改已有字段语义，保证 world/hud 两层可并行开发。
 */

// ============================================================================
// 冻结常量（契约级上限：两层共用同一份数值，避免各自硬编码出不同上限）
// ============================================================================

/** 通知默认存活时长（ms）。超过 expiresAt 的通知由 core 自动剔除，HUD 只渲染未过期部分。 */
export const NOTICE_TTL_MS = 6000;

/** 通知队列上限。防止世界层高频事件把 notices 无限撑大（性能硬约束：数据不许无限增长）。 */
export const MAX_NOTICES = 50;

/** 选择集上限。全选/框选时按数组顺序保留前 N 个，避免超大编组拖垮状态广播与渲染。 */
export const MAX_SELECTION_SIZE = 256;

// ============================================================================
// 基础形状（core 自定义，与渲染引擎解耦）
// ============================================================================

/** 世界坐标点。世界层负责世界坐标 ↔ 屏幕坐标换算，HUD 拿到的永远是世界坐标。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 轴对齐矩形（世界坐标）。框选区域用左上角 + 宽高表达，避免依赖 Phaser.Geom.Rectangle。 */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 点击修饰键。world → core 上报点击时携带，core 据此决定 set/toggle 语义。 */
export interface ClickMods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
}

// ============================================================================
// 单位（Agent 单位即战场上的组织单位，Zone 已砍，见 D5）
// ============================================================================

export type UnitStatus = 'idle' | 'busy' | 'offline' | 'error';

/**
 * 单位业务态视图。注意：**不含位置**——位置由世界层自治，core 与 HUD 都不持有坐标真相。
 */
export interface UnitView {
  readonly id: string;
  readonly name: string;
  readonly status: UnitStatus;
  /** 当前承担的任务；空闲为 null。任务状态机的相位见 MissionView.phase。 */
  readonly missionId: string | null;
  readonly power: number;
}

// ============================================================================
// 任务
// ============================================================================

/** 任务相位。状态机迁移规则实现在 core/mission，本文件只冻结相位取值。 */
export type MissionPhase = 'draft' | 'pending' | 'confirmed' | 'running' | 'done' | 'cancelled';

export interface MissionView {
  readonly id: string;
  readonly title: string;
  readonly phase: MissionPhase;
  /** 指派对象：多选集合（编组）展开的单位 id 列表。 */
  readonly unitIds: readonly string[];
  readonly createdAt: number;
}

export type ConfirmDecision = 'accept' | 'reject';

// ============================================================================
// 选择 / 编组
// ============================================================================

/**
 * 选择态。**编组 = 当前多选集合**（D5：v3 不做持久化编队），因此这里不保留编队槽位。
 * revision 单调递增，供桥接层跳过无变化的渲染（perf：高频 preview 更新不打全量重渲染）。
 */
export interface SelectionState {
  readonly unitIds: readonly string[];
  /** 框选拖拽过程中的实时预览集合，松开后归零。 */
  readonly previewUnitIds: readonly string[];
  readonly revision: number;
}

// ============================================================================
// 角色
// ============================================================================

/** 角色档案 + 成长数值（技能树不迁移，见 D3）。 */
export interface CharacterView {
  readonly id: string;
  readonly name: string;
  readonly persona: string;
  readonly level: number;
  readonly experience: number;
}

// ============================================================================
// 通知
// ============================================================================

export type NoticeLevel = 'info' | 'warn' | 'error';

/** 待 HUD 提示的事件，自动过期（expiresAt 之前有效，过期由 core 剔除）。 */
export interface Notice {
  readonly id: string;
  readonly level: NoticeLevel;
  readonly text: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

// ============================================================================
// ★ 总线契约：core → 两层广播的完整世界快照
// ============================================================================

export interface WorldState {
  units: UnitView[]; // Agent 单位（位置由世界层自治，此处仅业务态）
  missions: MissionView[]; // 任务及状态机相位
  selection: SelectionState; // 当前选择集（编组 = 多选集合）
  characters: CharacterView[]; // 角色档案 + 成长数值（level/exp）
  notices: Notice[]; // 待 HUD 提示的事件（自动过期）
}

// ============================================================================
// ★ 总线契约：hud → core 的命令（单向，HUD 不发任何"事件"）
// ============================================================================

export type ScreenId = 'main' | 'settings' | 'character';

export type HudCommand =
  | { type: 'unit.select'; unitIds: string[]; mode: 'set' | 'toggle' }
  | { type: 'mission.assign'; missionId: string; unitIds: string[] }
  | { type: 'mission.confirm'; missionId: string; decision: ConfirmDecision }
  | { type: 'character.persona.update'; characterId: string; prompt: string }
  | { type: 'chat.send'; text: string }
  | { type: 'ui.navigate'; screen: ScreenId }
  | { type: 'theme.set'; themeId: 'default' | 'pixel' };

// ============================================================================
// ★ 总线契约：world → core 的交互事件（单向，world 不直接改 HUD）
// ============================================================================

export type WorldEvent =
  | { type: 'unit.click'; unitId: string; mods: ClickMods }
  | { type: 'selection.box'; bounds: Bounds }
  | { type: 'camera.moved'; center: Point; zoom: number };