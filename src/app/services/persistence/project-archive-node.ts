/**
 * 文件职责：切副本归档的 **node 侧 IO 适配**（task_180 / M1-06）—— 给
 *   `ProjectArchivePort` 实现（project-archive.ts）提供两件有 IO 的零件：
 *   ① **append-only 落盘口**（`createNodeArchiveAppender`）：只追加、不重写；
 *      写入失败 ⇒ **回滚到写入前**（不留半份文件）；
 *   ② 实例根目录解析口（`createInstanceRootResolver`）：从实例注册表取项目根路径。
 * 输入：实例注册表（InstanceRegistry 窄接口）+ 可注入的低阶写盘口（便于单测故障路径）。
 * 输出：ArchiveAppender 实现 / 根目录解析函数。
 * 禁止事项：
 *   1. 在这里做业务判断（哪条 mission 该归档）—— 那是 project-archive.ts 的职责；
 *   2. 重写归档文件 —— 只允许 O_APPEND 追加（**append-only 是归档的第一条不变量**）；
 *   3. 吞掉写入失败 —— 失败必须抛给上层（上层转成 `ok: false` ⇒ core 拒绝退出）。
 *
 * why 写入用「一次 write + fsync」而不是逐行写：逐行写中途失败会留下**半行 JSON**
 *   （读方遇到半行只能整文件拒绝）；一次写整批 + 失败回滚 ⇒ 文件要么是旧的完整内容，
 *   要么是新的完整内容，**没有中间态**（M1-06 验收②）。
 *
 * @since v3.3（task_180 / M1-06）。
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'fs';
import { dirname } from 'path';

import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

import type { InstanceRegistry } from './instance-loader';
import type { ArchiveAppender } from './project-archive';

// ============================================================================
// 低阶写盘口（可注入 ⇒ 单测能验「写到一半失败」的回滚）
// ============================================================================

/**
 * 落盘用到的低阶操作（**窄接口**：只有归档需要的那几个）。
 *
 * why 抽出来：回滚逻辑（truncate / remove）必须能被单测触达，
 *   而「写到一半失败」在真实 fs 上几乎造不出来（磁盘不给你造这种错）。
 */
export interface ArchiveFileOps {
  /** 确保目录存在（递归建）。 */
  ensureDir(dirPath: string): void;
  /** 文件是否存在。 */
  exists(filePath: string): boolean;
  /** 文件当前长度（字节）。 */
  size(filePath: string): number;
  /** 以**追加**方式打开（不存在则创建），返回句柄。 */
  openAppend(filePath: string): number;
  /** 追加写入一段文本。 */
  write(fd: number, payload: string): void;
  /** 把句柄截断到指定长度（回滚用）。 */
  truncate(fd: number, size: number): void;
  /** 落盘（fsync）。 */
  sync(fd: number): void;
  /** 关闭句柄。 */
  close(fd: number): void;
  /** 删除文件（回滚用：原本不存在 ⇒ 把新建出来的半份删掉）。 */
  remove(filePath: string): void;
}

/** node fs 的默认实现。 */
export const nodeArchiveFileOps: ArchiveFileOps = {
  ensureDir: (dirPath) => {
    mkdirSync(dirPath, { recursive: true });
  },
  exists: (filePath) => existsSync(filePath),
  size: (filePath) => statSync(filePath).size,
  // 'a' = O_APPEND：每次写都在文件末尾 ⇒ **只追加**，并发写也不会互相覆盖。
  openAppend: (filePath) => openSync(filePath, 'a'),
  write: (fd, payload) => {
    // 句柄以 O_APPEND 打开 ⇒ 写入永远落在文件末尾（只追加，不重写）。
    writeSync(fd, payload);
  },
  truncate: (fd, size) => {
    ftruncateSync(fd, size);
  },
  sync: (fd) => {
    fsyncSync(fd);
  },
  close: (fd) => {
    closeSync(fd);
  },
  remove: (filePath) => {
    unlinkSync(filePath);
  },
};

// ============================================================================
// append-only 落盘口
// ============================================================================

export interface NodeArchiveAppenderOptions {
  /**
   * 低阶写盘口（缺省 = node fs 实现）。
   *
   * why 可注入：单测要验「写到一半失败 ⇒ 不留半份文件」，
   *   真实 fs 造不出这种故障（磁盘满了才会），用替身注入才是诚实的测法。
   */
  readonly ops?: ArchiveFileOps;
}

/**
 * 造 append-only 落盘口（node 实现）。
 *
 * 失败语义（**不留半份文件**，M1-06 验收②）：
 *   写入前记下文件长度（原本不存在则记 0）；
 *   写入 / fsync 任一步失败 ⇒ 截回写入前的长度（原本不存在 ⇒ 删掉它）⇒ 再把错误抛出去。
 */
export function createNodeArchiveAppender(options: NodeArchiveAppenderOptions = {}): ArchiveAppender {
  const ops = options.ops ?? nodeArchiveFileOps;

  const append = (filePath: string, payload: string): void => {
    ops.ensureDir(dirname(filePath));

    const existed = ops.exists(filePath);
    const before = existed ? ops.size(filePath) : 0;

    let fd: number | undefined;
    try {
      fd = ops.openAppend(filePath);
      ops.write(fd, payload);
      ops.sync(fd);
      ops.close(fd);
      fd = undefined;
    } catch (error) {
      // ── 回滚：把文件恢复成「写入前」的样子（不留半份文件）。
      if (fd !== undefined) {
        try {
          ops.truncate(fd, before);
        } catch {
          /* 回滚尽力而为：下面的 remove 至少不会留下更大的半份文件 */
        }
        try {
          ops.close(fd);
        } catch {
          /* 忽略关闭失败（错误本身要往上传） */
        }
      }
      if (!existed) {
        try {
          ops.remove(filePath);
        } catch {
          /* 忽略删除失败 */
        }
      }
      throw error;
    }
  };

  return { append };
}

// ============================================================================
// 实例根目录解析
// ============================================================================

export interface InstanceRootResolverOptions {
  /**
   * 默认沙盒的项目根（缺省 = 进程 cwd）。
   *
   * why 需要回落：M1-07 之前默认沙盒还没有注册表记录，
   *   但它**必须**有确定的归档位置（M1-07 的口径：path = 进程 cwd 快照）。
   */
  readonly fallbackRoot?: string;
}

/**
 * 从实例注册表解析项目根（`.stratix` 所在目录）。
 *
 * why 注册表为准：实例根路径会变（副本被挪走），**id 才是稳定的那一份**（design §1.2.1）。
 * why 查不到就是查不到：普通实例没有记录 ⇒ 归档失败（拒绝退出），
 *   不猜路径、不写到别处 —— 写错地方比不写更糟。
 */
export function createInstanceRootResolver(
  registry: InstanceRegistry,
  options: InstanceRootResolverOptions = {}
): (instanceId: ProjectInstanceId) => string | undefined {
  const fallbackRoot = options.fallbackRoot ?? process.cwd();
  return (instanceId: ProjectInstanceId): string | undefined => {
    const view = registry.get(instanceId);
    if (view && view.path) return view.path;
    if (instanceId === DEFAULT_INSTANCE_ID) return fallbackRoot;
    return undefined;
  };
}
