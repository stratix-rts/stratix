import { LRAClient } from './LRAClient';
import { LraTask } from './types';

/**
 * LRA Watcher Options
 */
export interface LRAWatcherOptions {
  /** 轮询间隔（毫秒） */
  interval?: number;
  /** 任务列表变更回调 */
  onTaskListChanged: (tasks: LraTask[]) => void;
}

/**
 * LRA Watcher - 前端版本
 * 
 * 使用轮询方式定期获取任务列表
 * 不再使用 chokidar 文件监听
 */
export class LRAWatcher {
  private client: LRAClient;
  private projectPath: string;
  private interval: number;
  private onTaskListChanged: (tasks: LraTask[]) => void;
  private intervalId: NodeJS.Timeout | null = null;
  private lastTaskCount: number = -1; // -1 表示第一次加载
  private isPolling: boolean = false;
  
  constructor(projectPath: string, options: LRAWatcherOptions) {
    this.client = new LRAClient();
    this.projectPath = projectPath;
    this.interval = options.interval || 3000; // 默认 3 秒
    this.onTaskListChanged = options.onTaskListChanged;
  }
  
  /**
   * 开始监听
   */
  start(): void {
    if (this.intervalId) {
      console.warn(`[LRAWatcher] Already watching: ${this.projectPath}`);
      return;
    }
    
    console.log(`[LRAWatcher] Started polling: ${this.projectPath} (interval: ${this.interval}ms)`);
    
    // 立即执行一次
    this.pollTasks();
    
    // 定时轮询
    this.intervalId = setInterval(() => {
      this.pollTasks();
    }, this.interval);
  }
  
  /**
   * 轮询任务列表
   */
  private async pollTasks(): Promise<void> {
    // 避免并发请求
    if (this.isPolling) {
      return;
    }
    
    this.isPolling = true;
    
    try {
      const tasks = await this.client.listTasks(this.projectPath);
      
      // 首次加载或任务数量变化时触发回调
      if (this.lastTaskCount === -1 || tasks.length !== this.lastTaskCount) {
        console.log(`[LRAWatcher] Tasks changed: ${this.lastTaskCount} → ${tasks.length}`);
        this.lastTaskCount = tasks.length;
        this.onTaskListChanged(tasks);
      }
    } catch (error) {
      console.error('[LRAWatcher] Poll error:', error);
    } finally {
      this.isPolling = false;
    }
  }
  
  /**
   * 停止监听
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log(`[LRAWatcher] Stopped polling: ${this.projectPath}`);
    }
    
    this.lastTaskCount = -1;
    this.isPolling = false;
  }
  
  /**
   * 获取当前状态
   */
  isActive(): boolean {
    return this.intervalId !== null;
  }
  
  /**
   * 获取项目路径
   */
  getProjectPath(): string {
    return this.projectPath;
  }
  
  /**
   * 获取轮询间隔
   */
  getInterval(): number {
    return this.interval;
  }
  
  /**
   * 设置轮询间隔
   */
  setInterval(interval: number): void {
    this.interval = interval;
    
    // 如果正在轮询，重启定时器
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        this.pollTasks();
      }, this.interval);
      
      console.log(`[LRAWatcher] Updated interval: ${this.interval}ms`);
    }
  }
  
  /**
   * 强制刷新任务列表
   */
  async forceRefresh(): Promise<void> {
    this.lastTaskCount = -1; // 重置计数，强制触发回调
    await this.pollTasks();
  }
}
