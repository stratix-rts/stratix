import { execSync } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';

/**
 * ProcessManager - 统一管理 Playwright E2E 测试的进程清理
 *
 * 职责：
 * - 优雅关闭进程（SIGTERM → 等待 → SIGKILL）
 * - 按 PID 文件清理进程
 * - 按环境变量标记查找并清理进程组
 * - 端口扫描清理
 */
export class ProcessManager {
  static readonly BACKEND_PID_FILE = '/tmp/stratix-test-backend.pid';
  static readonly FRONTEND_PID_FILE = '/tmp/stratix-test-frontend.pid';
  static readonly PLAYWRIGHT_PID_FILE = '/tmp/playwright-test-lock.pid';

  private readonly testGroups: readonly string[] = [
    'stratix-gateway-test-group',
    'stratix-frontend-test-group',
  ];

  private readonly ports: readonly number[] = [7523, 7524];

  /**
   * 优雅关闭进程：先 SIGTERM 等待超时，再 SIGKILL 强制终止
   */
  async gracefulKill(pid: number, timeout = 5000): Promise<void> {
    return new Promise((resolve) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // 进程不存在，视为已退出
        resolve();
        return;
      }

      const interval = setInterval(() => {
        try {
          process.kill(pid, 0);
          // 进程还在
        } catch {
          // 进程已退出
          clearInterval(interval);
          resolve();
        }
      }, 200);

      setTimeout(() => {
        clearInterval(interval);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        resolve();
      }, timeout);

      // cleanup when resolved
      const cleanup = () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    });
  }

  /**
   * 读取 PID 文件并清理对应进程
   */
  async cleanupByPidFiles(): Promise<void> {
    const pidFiles = [
      ProcessManager.BACKEND_PID_FILE,
      ProcessManager.FRONTEND_PID_FILE,
      ProcessManager.PLAYWRIGHT_PID_FILE,
    ];
    for (const pidFile of pidFiles) {
      if (existsSync(pidFile)) {
        const pid = parseInt(readFile(pidFile), 10);
        if (pid && !isNaN(pid) && pid !== process.pid) {
          await this.gracefulKill(pid);
        }
      }
    }
  }

  /**
   * 通过环境变量标记查找并清理进程组
   */
  async cleanupByEnvMark(markers: string[]): Promise<void> {
    for (const groupName of markers) {
      try {
        const output = execSync(
          `ps aux | grep "${groupName}" | grep -v grep | awk '{print $2}'`,
          { stdio: 'pipe' }
        )
          .toString()
          .trim();
        if (output) {
          for (const pid of output.split('\n').filter(Boolean)) {
            const num = parseInt(pid, 10);
            if (num && num !== process.pid) {
              await this.gracefulKill(num);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * 端口扫描清理
   */
  async scanPorts(ports: number[]): Promise<void> {
    for (const port of ports) {
      try {
        const output = execSync(`lsof -ti :${port} 2>/dev/null`, {
          stdio: 'pipe',
        })
          .toString()
          .trim();
        if (output) {
          for (const pid of output.split('\n').filter(Boolean)) {
            const num = parseInt(pid, 10);
            if (num && num !== process.pid) {
              await this.gracefulKill(num);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * 依次执行所有清理
   */
  async fullCleanup(): Promise<void> {
    // 1. pkill playwright test 兜底
    try {
      execSync('pkill -f "playwright test" 2>/dev/null || true', {
        stdio: 'ignore',
      });
    } catch {
      // ignore
    }

    // 2. 按 PID 文件清理
    await this.cleanupByPidFiles();

    // 3. 按环境标记清理进程组
    await this.cleanupByEnvMark([...this.testGroups]);

    // 4. 端口扫描清理
    await this.scanPorts([...this.ports]);
  }
}
