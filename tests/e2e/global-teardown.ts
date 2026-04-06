import { execSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';

/**
 * 全局清理（所有测试跑完后执行）
 *
 * 职责：
 * 1. 清理测试进程和 dev server（与 globalSetup 相同）
 * 2. 清理锁文件
 */
export default async () => {
  const pidFile = '/tmp/playwright-test-lock.pid';

  // 1. kill 锁文件记录的测试进程
  if (existsSync(pidFile)) {
    const oldPid = parseInt(readFile(pidFile), 10);
    if (oldPid && !isNaN(oldPid)) {
      killProcess(oldPid, `旧测试进程 PID ${oldPid}`);
    }
    unlinkSync(pidFile);
  }

  // 2. pkill playwright test
  try {
    execSync('pkill -f "playwright test" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}

  // 3. kill 标记的进程组
  for (const groupName of ['stratix-gateway-test-group', 'stratix-frontend-test-group']) {
    try {
      const output = execSync(
        `ps aux | grep "${groupName}" | grep -v grep | awk '{print $2}'`,
        { stdio: 'pipe' }
      ).toString().trim();
      if (output) {
        for (const pid of output.split('\n').filter(Boolean)) {
          const num = parseInt(pid);
          if (num && num !== process.pid) {
            killProcess(-num, `进程组 ${groupName} PID ${num}`);
          }
        }
      }
    } catch {}
  }

  // 4. 端口扫尾
  for (const port of [7523, 7524]) {
    try {
      const output = execSync(`lsof -ti :${port} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (output) {
        for (const pid of output.split('\n').filter(Boolean)) {
          const num = parseInt(pid);
          if (num && num !== process.pid) {
            killProcess(-num, `port ${port} PID ${num}`);
          }
        }
      }
    } catch {}
  }

  console.log('[global-teardown] 清理完成');
};

function killProcess(pid: number, label: string): void {
  try {
    execSync(`kill -TERM ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
    console.log(`[global-teardown] SIGTERM 已发送 ${label}`);

    const start = Date.now();
    while (Date.now() - start < 5000) {
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`, { stdio: 'ignore' });
        execSync('sleep 0.5', { stdio: 'ignore' });
      } catch {
        console.log(`[global-teardown] 进程已优雅退出 ${label}`);
        return;
      }
    }

    execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
    console.log(`[global-teardown] SIGKILL 强制终止 ${label}`);
  } catch {}
}

function readFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8').trim();
}
