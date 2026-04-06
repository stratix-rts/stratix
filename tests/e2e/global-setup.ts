import { execSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';

/**
 * 全局初始化：确保每次只运行一组 Playwright 测试
 *
 * 职责：
 * 1. 检测并 kill 残留的 Playwright 测试进程
 * 2. kill 残留的 dev server (port 7523/7524)
 * 3. 写锁文件
 */
export default async () => {
  const pidFile = '/tmp/playwright-test-lock.pid';

  // 1. 检查并清理残留 Playwright 测试进程
  if (existsSync(pidFile)) {
    const oldPid = parseInt(readFile(pidFile), 10);
    try {
      process.kill(oldPid, 0);
      console.log(`\n[global-setup] 检测到旧测试进程 PID ${oldPid}，正在 kill...\n`);
      process.kill(oldPid, 'SIGKILL');
    } catch {
      // 进程已不存在，忽略
    }
    unlinkSync(pidFile);
  }

  // 2. 额外保险：pkill 所有 playwright test 进程（兜底）
  try {
    execSync('pkill -f "playwright test" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}

  // 3. kill 残留的 dev server（port 7523 frontend 和 7524 backend）
  for (const port of [7523, 7524]) {
    try {
      const output = execSync(`lsof -ti :${port} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (output) {
        const pids = output.split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
            console.log(`[global-setup] 已 kill port ${port} 上的进程 PID ${pid}`);
          } catch {}
        }
      }
    } catch {
      // 没有进程占用该端口，忽略
    }
  }

  // 4. 写入当前进程 PID
  writeFileSync(pidFile, String(process.pid));
  console.log(`[global-setup] 测试进程 PID: ${process.pid}，锁文件已创建`);
};

function readFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8').trim();
}
