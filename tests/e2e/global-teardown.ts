import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';

// PID 文件路径常量
const BACKEND_PID_FILE = '/tmp/stratix-test-backend.pid';
const FRONTEND_PID_FILE = '/tmp/stratix-test-frontend.pid';
const TEST_PID_FILE = '/tmp/playwright-test-lock.pid';
const TEST_GROUP_NAMES = ['stratix-gateway-test-group', 'stratix-frontend-test-group'];
const TEST_PORTS = [7523, 7524];

/**
 * 全局清理（所有测试跑完后执行）
 *
 * 职责：
 * 1. 清理测试进程和 dev server（与 globalSetup 相同）
 * 2. 清理锁文件
 */
export default async () => {
  // 1. 读取 PID 文件并 kill 对应进程（优先级最高）
  for (const pidFile of [BACKEND_PID_FILE, FRONTEND_PID_FILE]) {
    if (existsSync(pidFile)) {
      const oldPid = parseInt(readFile(pidFile), 10);
      if (oldPid && !isNaN(oldPid)) {
        await killProcess(oldPid, `PID 文件 ${pidFile} PID ${oldPid}`);
      }
      unlinkSync(pidFile);
    }
  }

  // 2. kill 锁文件记录的测试进程
  if (existsSync(TEST_PID_FILE)) {
    const oldPid = parseInt(readFile(TEST_PID_FILE), 10);
    if (oldPid && !isNaN(oldPid)) {
      await killProcess(oldPid, `旧测试进程 PID ${oldPid}`);
    }
    unlinkSync(TEST_PID_FILE);
  }

  // 3. pkill playwright test
  try {
    execSync('pkill -f "playwright test" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}

  // 4. kill 标记的进程组
  for (const groupName of TEST_GROUP_NAMES) {
    try {
      const output = execSync(
        `ps aux | grep "${groupName}" | grep -v grep | awk '{print $2}'`,
        { stdio: 'pipe' }
      ).toString().trim();
      if (output) {
        for (const pid of output.split('\n').filter(Boolean)) {
          const num = parseInt(pid);
          if (num && num !== process.pid) {
            await killProcess(-num, `进程组 ${groupName} PID ${num}`);
          }
        }
      }
    } catch {}
  }

  // 5. 端口扫尾
  for (const port of TEST_PORTS) {
    try {
      const output = execSync(`lsof -ti :${port} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (output) {
        for (const pid of output.split('\n').filter(Boolean)) {
          const num = parseInt(pid);
          if (num && num !== process.pid) {
            await killProcess(-num, `port ${port} PID ${num}`);
          }
        }
      }
    } catch {}
  }

  console.log('[global-teardown] 清理完成');
};

/**
 * 优雅关闭进程：先 SIGTERM 等待 5 秒，再 SIGKILL 强制终止
 * 不使用 execSync，避免 fork 大量子进程
 */
function killProcess(pid: number, label: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      // 阶段 1：SIGTERM 优雅终止
      process.kill(pid, 'SIGTERM');
      console.log(`[global-teardown] SIGTERM 已发送 ${label}`);
    } catch {
      // 进程不存在，视为已退出
      console.log(`[global-teardown] 进程不存在 ${label}`);
      resolve();
      return;
    }

    // 轮询检测进程是否退出（200ms 粒度）
    const interval = setInterval(() => {
      try {
        process.kill(pid, 0);
        // 进程还在
      } catch {
        // 进程已退出
        clearInterval(interval);
        console.log(`[global-teardown] 进程已优雅退出 ${label}`);
        resolve();
      }
    }, 200);

    // 超过 5 秒还没退出，SIGKILL 强制杀死
    const timeout = setTimeout(() => {
      clearInterval(interval);
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[global-teardown] SIGKILL 强制终止 ${label}`);
      } catch {}
      resolve();
    }, 5000);
  });
}

function readFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8').trim();
}
