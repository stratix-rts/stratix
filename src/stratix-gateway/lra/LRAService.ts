import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';

import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';

import { LraTask, LraTaskDetail } from '../../stratix-lra-bridge/types';

const execAsync = promisify(exec);

/**
 * LRA Service - Gateway 后端服务
 * 
 * 负责：
 * - 执行 LRA CLI 命令
 * - 读取/写入 .lra/task_list.json
 * - 监听文件变化
 */
export class LRAService {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  
  private static readonly LRA_DIR = '.lra';
  private static readonly TASK_LIST_FILE = 'task_list.json';
  
  /**
   * 初始化 LRA 项目
   */
  async init(projectPath: string, name: string): Promise<void> {
    try {
      await execAsync(`lra init --name "${name}"`, { cwd: projectPath });
      console.log(`[LRAService] LRA initialized: ${projectPath}`);
    } catch (error) {
      throw new Error(`Failed to initialize LRA: ${error}`);
    }
  }
  
  /**
   * 创建任务
   */
  async createTask(
    projectPath: string, 
    description: string, 
    template?: string
  ): Promise<string> {
    try {
      const cmd = template 
        ? `lra create "${description}" --template ${template}`
        : `lra create "${description}"`;
      
      const { stdout } = await execAsync(cmd, { cwd: projectPath });
      const taskId = this.parseTaskId(stdout);
      
      console.log(`[LRAService] Task created: ${taskId}`);
      return taskId;
    } catch (error) {
      throw new Error(`Failed to create task: ${error}`);
    }
  }
  
  /**
   * 列出所有任务 - 使用新路径 .lra/task_list.json
   */
  async listTasks(projectPath: string): Promise<LraTask[]> {
    try {
      const taskListPath = path.join(
        projectPath, 
        LRAService.LRA_DIR,
        LRAService.TASK_LIST_FILE
      );
      
      const exists = await fs.pathExists(taskListPath);
      if (!exists) {
        console.log(`[LRAService] Task list not found: ${taskListPath}`);
        return [];
      }
      
      const content = await fs.readJson(taskListPath);
      const tasks = content.tasks || [];
      
      console.log(`[LRAService] Listed ${tasks.length} tasks from ${projectPath}`);
      return tasks;
    } catch (error) {
      console.error('[LRAService] Failed to list tasks:', error);
      return [];
    }
  }
  
  /**
   * 认领任务（带锁）
   */
  async claimTask(projectPath: string, taskId: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`lra claim ${taskId}`, { 
        cwd: projectPath 
      });
      
      const sessionId = this.parseSessionId(stdout);
      console.log(`[LRAService] Task claimed: ${taskId} (session: ${sessionId})`);
      return sessionId;
    } catch (error) {
      throw new Error(`Failed to claim task ${taskId}: ${error}`);
    }
  }
  
  /**
   * 发送心跳
   */
  async heartbeat(projectPath: string, taskId: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`lra heartbeat ${taskId}`, { 
        cwd: projectPath 
      });
      
      const alive = stdout.includes('ok: True');
      console.log(`[LRAService] Heartbeat for ${taskId}: ${alive}`);
      return alive;
    } catch (error) {
      console.error(`[LRAService] Heartbeat failed for ${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * 发布任务（释放锁）
   */
  async publish(projectPath: string, taskId: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`lra publish ${taskId}`, { 
        cwd: projectPath 
      });
      
      const published = stdout.includes('ok: True');
      console.log(`[LRAService] Task published: ${taskId} (success: ${published})`);
      return published;
    } catch (error) {
      console.error(`[LRAService] Failed to publish task ${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * 设置任务状态
   */
  async setTaskStatus(
    projectPath: string, 
    taskId: string, 
    status: string
  ): Promise<void> {
    try {
      await execAsync(`lra set ${taskId} ${status}`, { cwd: projectPath });
      console.log(`[LRAService] Task status updated: ${taskId} → ${status}`);
    } catch (error) {
      throw new Error(`Failed to set task status: ${error}`);
    }
  }
  
  /**
   * 查看任务详情
   */
  async showTask(projectPath: string, taskId: string): Promise<LraTaskDetail> {
    try {
      const { stdout } = await execAsync(`lra show ${taskId}`, { 
        cwd: projectPath 
      });
      
      return this.parseTaskDetail(stdout);
    } catch (error) {
      throw new Error(`Failed to show task ${taskId}: ${error}`);
    }
  }
  
  /**
   * 设置文件监听 - 使用新路径 .lra/task_list.json
   */
  setupWatcher(
    projectPath: string, 
    onTasksChanged: (tasks: LraTask[]) => void
  ): void {
    const taskListPath = path.join(
      projectPath, 
      LRAService.LRA_DIR,
      LRAService.TASK_LIST_FILE
    );
    
    const watcher = chokidar.watch(taskListPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });
    
    watcher.on('change', async () => {
      try {
        const tasks = await this.listTasks(projectPath);
        console.log(`[LRAService] Tasks changed: ${tasks.length} tasks`);
        onTasksChanged(tasks);
      } catch (error) {
        console.error('[LRAService] Watcher error:', error);
      }
    });
    
    watcher.on('error', (error) => {
      console.error('[LRAService] Watcher error:', error);
    });
    
    this.watchers.set(projectPath, watcher);
    console.log(`[LRAService] Started watching: ${taskListPath}`);
  }
  
  /**
   * 停止监听
   */
  stopWatcher(projectPath: string): void {
    const watcher = this.watchers.get(projectPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectPath);
      console.log(`[LRAService] Stopped watching: ${projectPath}`);
    }
  }
  
  /**
   * 停止所有监听
   */
  stopAllWatchers(): void {
    this.watchers.forEach((watcher, projectPath) => {
      watcher.close();
      console.log(`[LRAService] Stopped watching: ${projectPath}`);
    });
    this.watchers.clear();
  }
  
  /**
   * 解析任务 ID
   */
  private parseTaskId(output: string): string {
    const match = output.match(/任务已创建：(task_\d+)/);
    if (!match) {
      throw new Error('Failed to parse task ID from output');
    }
    return match[1];
  }
  
  /**
   * 解析 Session ID
   */
  private parseSessionId(output: string): string {
    const match = output.match(/session_id:\s*(\S+)/);
    if (!match) {
      throw new Error('Failed to parse session ID from output');
    }
    return match[1];
  }
  
  /**
   * 解析任务详情
   */
  private parseTaskDetail(output: string): LraTaskDetail {
    const lines = output.split('\n');
    const detail: any = {};
    
    lines.forEach(line => {
      const [key, ...valueParts] = line.split(': ');
      const value = valueParts.join(': ').trim();
      
      if (key && value) {
        const normalizedKey = key.trim().toLowerCase().replace(/ /g, '_');
        detail[normalizedKey] = value;
      }
    });
    
    return detail as LraTaskDetail;
  }
}
