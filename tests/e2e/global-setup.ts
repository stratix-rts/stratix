import { execSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { cleanTestData } from './scripts/clean-test-data';

// PID 文件路径常量
const BACKEND_PID_FILE = '/tmp/stratix-test-backend.pid';
const FRONTEND_PID_FILE = '/tmp/stratix-test-frontend.pid';
const TEST_PID_FILE = '/tmp/playwright-test-lock.pid';
const TEST_GROUP_NAMES = ['stratix-gateway-test-group', 'stratix-frontend-test-group'];
const TEST_PORTS = [7523, 7524];

/**
 * 全局初始化：确保每次只运行一组 Playwright 测试
 *
 * 职责：
 * 1. kill PID 文件记录的 dev server 进程（最高优先级）
 * 2. kill 残留的 Playwright 测试进程及其进程组
 * 3. kill 标记了 STRATIX_TEST_GROUP 的所有 dev server 进程组
 * 4. kill 占用测试端口的进程
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

  // 2. 检查并清理残留锁文件记录的 Playwright 测试进程
  if (existsSync(TEST_PID_FILE)) {
    const oldPid = parseInt(readFile(TEST_PID_FILE), 10);
    if (oldPid && !isNaN(oldPid)) {
      await killProcess(oldPid, `旧测试进程 PID ${oldPid}`);
    }
    unlinkSync(TEST_PID_FILE);
  }

  // 3. pkill 所有 playwright test 进程（兜底）
  try {
    execSync('pkill -f "playwright test" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}

  // 4. 用环境变量 STRATIX_TEST_GROUP 找到并 kill 整个进程组
  //    start-backend.sh / start-frontend.sh 会设置这个变量并创建进程组
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
            // 按进程组 kill，连带所有子进程一起清
            await killProcess(-num, `进程组 ${groupName} PID ${num}`);
          }
        }
      }
    } catch {}
  }

  // 5. 最后用端口扫一遍，确保没有漏网之鱼
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

  // 6. 清理上次测试留下的数据（projects/zones 含"测试"前缀的）
  cleanTestData();

  // 7. 写入当前进程 PID
  writeFileSync(TEST_PID_FILE, String(process.pid));
  console.log(`[global-setup] 测试进程 PID: ${process.pid}，锁文件已创建`);
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
      console.log(`[global-setup] SIGTERM 已发送 ${label}`);
    } catch {
      // 进程不存在，视为已退出
      console.log(`[global-setup] 进程不存在 ${label}`);
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
        console.log(`[global-setup] 进程已优雅退出 ${label}`);
        resolve();
      }
    }, 200);

    // 超过 5 秒还没退出，SIGKILL 强制杀死
    const timeout = setTimeout(() => {
      clearInterval(interval);
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[global-setup] SIGKILL 强制终止 ${label}`);
      } catch {}
      resolve();
    }, 5000);

    // cleanup when resolved
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  });
}

function readFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8').trim();
}