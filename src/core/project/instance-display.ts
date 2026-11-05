/**
 * 文件职责：**副本（project instance）展示口径的共享纯函数**（@since v3.3，task_188 / M1-14）——
 *   「路径尾段」「在办任务数」「副本显示名」「任务归属」四份口径的**唯一**出处。
 *   方案来源：docs/DESIGN-project-map.md §7.1「M1-14」行（大厅卡片字段）
 *             + §1.2.1（`ProjectInstanceView` 契约）+ §2.4（默认沙盒的 COALESCE 归属口径）。
 * 输入：core 契约里的纯数据（`ProjectInstanceView` / `CharacterTask` / 字符串）。
 * 输出：纯函数结果（字符串 / 计数 / 归属过滤后的任务数组）。
 * 禁止事项：
 *   1. 任何 IO（fs / sqlite / persistence）—— core 零 IO 铁律；
 *   2. import hud / world —— core 是被依赖方，禁止反向依赖（core/README.md 铁律）；
 *   3. 猜事实 —— 缺省就是缺省（分支未知就报「未知」，不编一个分支名出来）。
 *
 * ★ 为什么这份口径住在 core（而不是各层各写一份）：
 *   同一份「路径尾段」「在办任务数」已经被**两个层**消费 ——
 *   world 的进副本名牌（M1-13，task_187）与 HUD 的大厅卡片（M1-14，task_188）。
 *   HUD 不得 import world（铁律：HUD 不认识 world），world 也不该 import hud（铁律：world 只认识 core）
 *   ⇒ 共同口径只能落在 core。两层各抄一份必然漂移：改了一处，另一处的名牌与卡片就各说各话。
 *
 * @since v3.3（task_188 / M1-14）。
 */

import {
  DEFAULT_INSTANCE_ID,
  type CharacterTask,
  type ProjectInstanceId,
  type ProjectInstanceView,
} from '../types';

/**
 * 路径尾段（@since v3.3，task_187 / M1-13）—— 副本的目录名（名牌与大厅卡片同款）。
 *
 * why 只取尾段：整条绝对路径放不下，也没信息量（尾段就是「这是哪个副本」的落点）。
 * 兼容 posix / windows 分隔符；空路径 = null（未知就不画那一段）。
 */
export function pathTailOf(path: string): string | null {
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * 在办任务数（@since v3.3，task_187 / M1-13）—— 「在办 N 条任务」。
 *
 * 口径 = **未终结**的任务条数（queued / running / awaiting_approval）：
 *   终态（completed / failed / cancelled）是历史，不算「在办」。
 *
 * why 入参是「已经按副本过滤好的任务」：world 侧的任务已被桥接层按 scope 过滤（M1-10），
 *   HUD 侧则由调用方先用 {@link tasksOfInstance} 按归属过滤 —— 本函数只负责**数相态**，
 *   不负责判归属（判归属的口径在 {@link tasksOfInstance}，两件事不许混在一处）。
 */
export function countActiveTasks(tasks: readonly CharacterTask[]): number {
  let count = 0;
  for (const task of tasks) {
    if (
      task.status === 'queued' ||
      task.status === 'running' ||
      task.status === 'awaiting_approval'
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * 该实例是不是**默认沙盒**（@since v3.3，task_188 / M1-14）。
 *
 * why 两个来源都认：`sandbox: true` 是注册表的显式标记（写侧唯一权威），
 *   `instanceId === DEFAULT_INSTANCE_ID` 是契约常量（读侧兜底）——
 *   快照来自别的进程时标记可能缺（老快照 / 手工构造的夹具），但 id 不会变。
 *   两者都认 ⇒ 大厅的「默认沙盒」标牌不会因为少一个字段就丢。
 */
export function isSandboxInstance(view: ProjectInstanceView): boolean {
  return view.sandbox === true || view.instanceId === DEFAULT_INSTANCE_ID;
}

/**
 * 副本的**显示名**（@since v3.3，task_188 / M1-14）—— 大厅卡片的名字。
 *
 * 口径：`title`（注册表给的展示标题）→ 路径尾段 → 实例 id。
 * why 不回落项目名：副本是**物理**单位（目录），项目名是逻辑单位（随 git 传播）——
 *   同源的主仓与 worktree 项目名相同，只有路径能区分它们（design §1.1 不变量 2）。
 */
export function instanceDisplayName(view: ProjectInstanceView, fallback: string): string {
  const title = view.title.trim();
  if (title.length > 0) return title;
  const tail = pathTailOf(view.path);
  if (tail) return tail;
  return fallback;
}

/**
 * 属于某个实例的任务（@since v3.3，task_188 / M1-14）。
 *
 * ★ 归属口径（design §2.4 R1-04）：默认沙盒额外**认领**没有实例归属的老任务
 *   （`instanceId` 缺省 / null —— 落库时 `instance_id IS NULL` 的历史行）。
 *   why：那些行按 `COALESCE(instance_id, 'wsp_sandbox')` 命中默认沙盒（数据可达），
 *   大厅卡片若不把它们算进「在办任务数」，沙盒卡就会显示 0 —— 与「数据就在那儿」矛盾。
 *   非沙盒实例**不**认领无归属任务（不猜归属：那份任务到底属于谁，契约没写）。
 */
export function tasksOfInstance(
  tasks: readonly CharacterTask[],
  instanceId: ProjectInstanceId,
): readonly CharacterTask[] {
  const sandbox = instanceId === DEFAULT_INSTANCE_ID;
  return tasks.filter((task) => {
    const owner = task.instanceId;
    if (owner === instanceId) return true;
    if (sandbox && (owner === null || owner === undefined)) return true;
    return false;
  });
}
