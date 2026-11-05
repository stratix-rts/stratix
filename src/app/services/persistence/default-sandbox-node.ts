/**
 * 文件职责：**默认沙盒的 node 侧取法**（task_181 / M1-07）—— 进程 cwd 快照。
 *
 * why 单独一个文件：默认沙盒的 `path` = **进程 cwd 快照**（design §2.4 / §7.1 M1-07 行），
 *   而 `process.cwd()` 是 **node 专属**的 —— 默认沙盒模块（default-sandbox.ts）必须保持
 *   **零 IO / 零 node 依赖**（渲染层也能安全 import），故取法住在这里（与 instance-loader-node.ts 同一纪律：
 *   有 IO 的一半落在唯一持有 node 能力的那一层）。
 *
 * 输入：无（读进程自身的 cwd）。
 * 输出：cwd 的**绝对路径**（realpath 归一；取不到 = 空串）。
 * 禁止事项：
 *   1. 在这里写库 / 读文件 —— 本模块只回答「当前进程在哪个目录」；
 *   2. 抛错 —— cwd 取不到是**事实**（沙盒路径退化成空串），不是错误
 *      （默认沙盒的路径校验本来就是特例豁免：恒 pathOk = true）。
 *
 * why realpath 归一：dsh 的 workspace 挂载校验是 `realpath(header.cwd) === workspace.path`
 *   （`packages/workspace/workspace/src/entity.ts:110-141`）⇒ 存进去的路径要能与 realpath 比对。
 *   macOS 上 `/tmp` → `/private/tmp` 这类软链差异会让等值判断落空 ⇒ 归一后再存。
 *
 * @since v3.3（task_181 / M1-07）。
 */

import { realpathSync } from 'fs';

/**
 * 进程 cwd 快照（**绝对路径**；realpath 归一）。
 *
 * why 吞错返回空串：cwd 取不到（进程被 chroot / cwd 被删）时，沙盒仍必须存在
 *   （它的路径校验恒豁免）—— 路径空着不影响「能进」，只是卡片上没有路径尾段。
 */
export function nodeProcessCwd(): string {
  try {
    const cwd = process.cwd();
    if (!cwd) return '';
    try {
      return realpathSync(cwd);
    } catch {
      // realpath 失败（目录已删 / 权限异常）⇒ 用原样的 cwd（绝对路径仍然成立）。
      return cwd;
    }
  } catch {
    return '';
  }
}
