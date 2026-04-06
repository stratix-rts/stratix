import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { ProcessManager } from './lib/ProcessManager';
import { cleanTestData } from './scripts/clean-test-data';

/**
 * 全局初始化：确保每次只运行一组 Playwright 测试
 *
 * 职责：
 * 1. 清理所有残留进程
 * 2. 清理上次测试留下的数据（projects/zones 含"测试"前缀的）
 * 3. 写入当前进程 PID 锁文件
 */
export default async () => {
  const pm = new ProcessManager();

  // 1. 清理所有残留进程
  await pm.fullCleanup();

  // 2. 清理旧的 backend/frontend PID 文件（setup 时顺手清理，不等 teardown）
  for (const pidFile of [
    ProcessManager.BACKEND_PID_FILE,
    ProcessManager.FRONTEND_PID_FILE,
  ]) {
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
  }

  // 3. 清理上次测试留下的数据（projects/zones 含"测试"前缀的）
  cleanTestData();

  // 4. 写入当前进程 PID
  writeFileSync(ProcessManager.PLAYWRIGHT_PID_FILE, String(process.pid));
  console.log(
    `[global-setup] 测试进程 PID: ${process.pid}，锁文件已创建`
  );
};
