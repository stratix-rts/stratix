import { existsSync, unlinkSync } from 'fs';
import { ProcessManager } from './lib/ProcessManager';

/**
 * 全局清理（所有测试跑完后执行）
 *
 * 职责：
 * 1. 清理所有测试进程和 dev server
 * 2. 删除锁文件
 */
export default async () => {
  const pm = new ProcessManager();

  // 1. 清理所有进程
  await pm.fullCleanup();

  // 2. 删除锁文件
  const pidFile = ProcessManager.PLAYWRIGHT_PID_FILE;
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }

  console.log('[global-teardown] 清理完成');
};
