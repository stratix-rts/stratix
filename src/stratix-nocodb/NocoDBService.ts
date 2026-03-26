import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { getDatabase } from '../stratix-database';

export interface NocoDBServiceOptions {
  /** NocoDB 服务端口 */
  port?: number;
  /** JWT secret for NocoDB auth */
  jwtSecret?: string;
  /** 是否禁用遥测 */
  disableTelemetry?: boolean;
}

const DEFAULT_OPTIONS: Required<NocoDBServiceOptions> = {
  port: 8080,
  jwtSecret: 'stratix-nocodb-secret-2026',
  disableTelemetry: true,
};

export class NocoDBService {
  private process: ChildProcess | null = null;
  private readonly port: number;
  private readonly jwtSecret: string;
  private readonly disableTelemetry: boolean;
  private readonly dbPath: string;
  private readonly nocoDBPackagePath: string;
  private readonly distPath: string;

  constructor(options: NocoDBServiceOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    this.port = opts.port;
    this.jwtSecret = opts.jwtSecret;
    this.disableTelemetry = opts.disableTelemetry;

    // 获取 Stratix 数据库路径
    const db = getDatabase();
    this.dbPath = db.getPath();

    // NocoDB 路径
    this.nocoDBPackagePath = path.join(
      process.cwd(),
      'vendor/nocodb/packages/nocodb'
    );
    this.distPath = path.join(this.nocoDBPackagePath, 'dist');

    console.log(`[NocoDBService] Database path: ${this.dbPath}`);
    console.log(`[NocoDBService] NocoDB package path: ${this.nocoDBPackagePath}`);
  }

  /**
   * 检查 NocoDB 是否已构建
   */
  public isBuilt(): boolean {
    // 检查 dist 目录和 bundle.js
    const bundlePath = path.join(this.distPath, 'bundle.js');
    return fs.existsSync(bundlePath);
  }

  /**
   * 获取 NocoDB bundle 路径
   */
  public getBundlePath(): string {
    return path.join(this.distPath, 'bundle.js');
  }

  /**
   * 构建 NocoDB（如果未构建）
   */
  public async build(): Promise<void> {
    if (this.isBuilt()) {
      console.log('[NocoDBService] NocoDB already built, skipping build');
      return;
    }

    console.log('[NocoDBService] Building NocoDB...');
    console.log('[NocoDBService] This may take a few minutes on first run');

    return new Promise((resolve, reject) => {
      // 使用 pnpm 构建 NocoDB
      const buildProcess = spawn('pnpm', ['install', '&&', 'build'], {
        cwd: this.nocoDBPackagePath,
        shell: true,
        stdio: 'pipe',
      });

      buildProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        // 只显示重要信息
        if (output.includes('error') || output.includes('Error') || output.includes('Built')) {
          console.log(`[NocoDB build] ${output.trim()}`);
        }
      });

      buildProcess.stderr?.on('data', (data) => {
        console.error(`[NocoDB build error] ${data.toString()}`);
      });

      buildProcess.on('error', (err) => {
        console.error('[NocoDBService] Build process error:', err);
        reject(err);
      });

      buildProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('[NocoDBService] Build completed successfully');
          resolve();
        } else {
          reject(new Error(`Build exited with code ${code}`));
        }
      });
    });
  }

  /**
   * 启动 NocoDB 服务
   */
  public async start(): Promise<void> {
    // 确保已构建
    if (!this.isBuilt()) {
      console.log('[NocoDBService] NocoDB not built, attempting to build...');
      await this.build();
    }

    console.log('[NocoDBService] Starting NocoDB service...');

    return new Promise((resolve, reject) => {
      const bundlePath = this.getBundlePath();

      // 构建环境变量
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NC_DB: `sqlite://${this.dbPath}`,
        NC_AUTH_JWT_SECRET: this.jwtSecret,
        NC_PORT: String(this.port),
      };

      if (this.disableTelemetry) {
        env.NC_DISABLE_TELE = 'true';
      }

      this.process = spawn('node', [bundlePath], {
        env,
        cwd: this.nocoDBPackagePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;

      this.process.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`[NocoDB] ${output.trim()}`);

        // 检测启动成功
        if (
          !resolved &&
          (output.includes('listening') ||
            output.includes('ready') ||
            output.includes(`:${this.port}`) ||
            output.includes('NocoDB'))
        ) {
          resolved = true;
          setTimeout(resolve, 1000); // 等待服务完全就绪
        }
      });

      this.process.stderr?.on('data', (data) => {
        const output = data.toString();
        // 过滤常见的不重要警告
        if (
          !output.includes('ExperimentalWarning') &&
          !output.includes('DeprecationWarning')
        ) {
          console.error(`[NocoDB error] ${output.trim()}`);
        }
      });

      this.process.on('error', (err) => {
        console.error('[NocoDBService] Process error:', err);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      this.process.on('exit', (code) => {
        console.log(`[NocoDBService] Process exited with code ${code}`);
        this.process = null;
      });

      // 超时
      setTimeout(() => {
        if (!resolved) {
          console.log('[NocoDBService] Starting in background...');
          resolved = true;
          resolve();
        }
      }, 10000);
    });
  }

  /**
   * 停止 NocoDB 服务
   */
  public async stop(): Promise<void> {
    if (this.process) {
      console.log('[NocoDBService] Stopping NocoDB service...');

      // 保存进程引用到局部变量，避免 TypeScript 错误
      const proc = this.process;
      this.process = null;

      // 尝试优雅关闭
      proc.kill('SIGTERM');

      // 等待进程退出
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // 强制杀死
          if (proc) {
            console.log('[NocoDBService] Force killing process...');
            proc.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        proc.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  /**
   * 检查服务是否运行中
   */
  public isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * 获取 NocoDB URL
   */
  public getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * 获取 Dashboard URL
   */
  public getDashboardUrl(): string {
    return `${this.getUrl()}/dashboard`;
  }
}

// 单例
let nocoDBServiceInstance: NocoDBService | null = null;

export function getNocoDBService(): NocoDBService {
  if (!nocoDBServiceInstance) {
    nocoDBServiceInstance = new NocoDBService();
  }
  return nocoDBServiceInstance;
}

export function createNocoDBService(options?: NocoDBServiceOptions): NocoDBService {
  nocoDBServiceInstance = new NocoDBService(options);
  return nocoDBServiceInstance;
}
