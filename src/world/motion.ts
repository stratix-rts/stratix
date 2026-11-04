/**
 * 文件职责：**动效降级开关（reduced-motion）** 的 world 侧读口。
 *   任务：.long-run-agent/tasks/task_140.md「入场走位 —— reduced-motion 直接落位」。
 * 输入：Phaser game registry 里 app 层塞进来的布尔标志。
 * 输出：是否该把动效降级成"直接落位"。
 * 禁止事项：
 *   1. 直接调 window.matchMedia —— **world 层零 DOM**：判断由 app 层做（它是组合根，
 *      允许碰 DOM），world 只读一个布尔（与 UNIT_SPRITE_SOURCE_KEY 同一模式）；
 *   2. 在 world 里缓存一份全局状态 —— 开关由 app 侧随时可改，读口每次现取。
 *
 * ★ why 降级成"直接落位"而不是"缩短动画"：
 *   入场走位是一条 800ms 的位移 —— 对动效敏感的用户，它是"屏幕上有东西在滑动"，
 *   降级成瞬间落位最干净（用户要的信息是"这个角色在战场上"，不是"它怎么进来的"）。
 */

/**
 * reduced-motion 标志在 Phaser game registry 里的键。
 * why 走 registry：BattlefieldScene 由 Phaser 实例化（构造器拿不到注入），
 *   组合根在 preBoot 里塞，场景 create 时取 —— 与 UNIT_SPRITE_SOURCE_KEY 同一模式。
 */
export const REDUCED_MOTION_KEY = 'stratix:reduced-motion';

/** 只读的键值存储（Phaser 的 DataManager 满足这个形状）。 */
export interface MotionFlagStore {
  get(key: string): unknown;
}

/**
 * 读 reduced-motion 标志。
 *
 * @param store Phaser game registry（场景的 `this.registry`）。
 * @returns true = 用户要求减少动效（入场直接落位 / 下场直接移除）。
 */
export function readReducedMotion(store: MotionFlagStore | null | undefined): boolean {
  if (!store) return false;
  return store.get(REDUCED_MOTION_KEY) === true;
}
