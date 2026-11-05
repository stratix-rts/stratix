/**
 * 文件职责：**默认沙盒的 node 侧取法**（task_181 / M1-07）—— 进程 cwd 快照；
 *   追加（@since v3.3，task_187 / M1-13）：进程 cwd 所在仓库的**当前分支**。
 *
 * why 单独一个文件：默认沙盒的 `path` = **进程 cwd 快照**（design §2.4 / §7.1 M1-07 行），
 *   而 `process.cwd()` 是 **node 专属**的 —— 默认沙盒模块（default-sandbox.ts）必须保持
 *   **零 IO / 零 node 依赖**（渲染层也能安全 import），故取法住在这里（与 instance-loader-node.ts 同一纪律：
 *   有 IO 的一半落在唯一持有 node 能力的那一层）。分支同理（`git rev-parse` 是 node 专属的 IO）。
 *
 * 输入：无（读进程自身的 cwd / 问 git 当前分支）。
 * 输出：cwd 的**绝对路径**（realpath 归一；取不到 = 空串）+ **分支短名**（取不到 = null）。
 * 禁止事项：
 *   1. 在这里写库 / 读文件 —— 本模块只回答「当前进程在哪个目录 / 哪个分支」；
 *   2. 抛错 —— 取不到是**事实**（沙盒路径退化成空串 / 分支未知），不是错误
 *      （默认沙盒的路径校验本来就是特例豁免：恒 pathOk = true）。
 *
 * why realpath 归一：dsh 的 workspace 挂载校验是 `realpath(header.cwd) === workspace.path`
 *   （`packages/workspace/workspace/src/entity.ts:110-141`）⇒ 存进去的路径要能与 realpath 比对。
 *   macOS 上 `/tmp` → `/private/tmp` 这类软链差异会让等值判断落空 ⇒ 归一后再存。
 *
 * @since v3.3（task_181 / M1-07；task_187 / M1-13 追加分支读取）。
 */

import { execFileSync } from 'child_process';
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

/**
 * 进程 cwd 所在仓库的**当前分支短名**（@since v3.3，task_187 / M1-13）。
 *
 * why 要读分支：副本名牌上有「分支」这一行（design §2.2 / §3.3.3）——
 *   分支是**运行态事实**（同一逻辑项目的主仓 / worktree 可以停在不同分支），
 *   不在 `.stratix/project.json` 里（契约随 git 传播 ⇒ 里面放分支会弄脏工作区）。
 *
 * 取法与 e2e 的项目上下文同款：`git rev-parse --abbrev-ref HEAD`。
 * why 走 execFile 而非 shell：命令与参数都是字面量，不给 shell 留注入面。
 *
 * 边界：
 *   - 不在 git 仓库里 / 没有 git ⇒ 抛错 ⇒ 吞掉返回 null（**未知不是错误**）；
 *   - detached HEAD ⇒ git 报 `HEAD` ⇒ 视作未知（不是分支名）；
 *   - 超时 1s：git 卡住不能拖住启动（perf：启动路径上的 IO 必须有上限）。
 */
export function nodeProcessGitBranch(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out || out === 'HEAD') return null;
    return out;
  } catch {
    return null;
  }
}
