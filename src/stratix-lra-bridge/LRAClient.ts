import axios from 'axios';

import { LraTask, LraTaskDetail } from './types';

/**
 * LRA Client - 前端版本
 * 
 * 通过 HTTP API 调用 Gateway 后端
 * 不再直接使用 Node.js 模块
 */
export class LRAClient {
  private baseURL: string;
  
  constructor(baseURL: string = '/api/lra') {
    this.baseURL = baseURL;
  }
  
  /**
   * 初始化 LRA 项目
   */
  async init(projectPath: string, name: string): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/init`, { projectPath, name });
      console.log(`[LRAClient] LRA initialized: ${projectPath}`);
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
      const { data } = await axios.post(`${this.baseURL}/tasks`, {
        projectPath,
        description,
        template
      });
      
      const taskId = data.taskId;
      console.log(`[LRAClient] Task created: ${taskId}`);
      return taskId;
    } catch (error) {
      throw new Error(`Failed to create task: ${error}`);
    }
  }
  
  /**
   * 列出所有任务
   */
  async listTasks(projectPath: string): Promise<LraTask[]> {
    try {
      const { data } = await axios.get(`${this.baseURL}/tasks`, {
        params: { projectPath }
      });
      
      const tasks = data.tasks || [];
      return tasks;
    } catch (error) {
      console.error('[LRAClient] Failed to list tasks:', error);
      return [];
    }
  }
  
  /**
   * 认领任务（带锁）
   */
  async claimTask(projectPath: string, taskId: string): Promise<string> {
    try {
      const { data } = await axios.post(
        `${this.baseURL}/tasks/${taskId}/claim`,
        { projectPath }
      );
      
      const sessionId = data.sessionId;
      console.log(`[LRAClient] Task claimed: ${taskId} (session: ${sessionId})`);
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
      const { data } = await axios.post(
        `${this.baseURL}/tasks/${taskId}/heartbeat`,
        { projectPath }
      );
      
      const alive = data.alive;
      console.log(`[LRAClient] Heartbeat for ${taskId}: ${alive}`);
      return alive;
    } catch (error) {
      console.error(`[LRAClient] Heartbeat failed for ${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * 发布任务（释放锁）
   */
  async publish(projectPath: string, taskId: string): Promise<boolean> {
    try {
      const { data } = await axios.post(
        `${this.baseURL}/tasks/${taskId}/publish`,
        { projectPath }
      );
      
      const published = data.published;
      console.log(`[LRAClient] Task published: ${taskId} (success: ${published})`);
      return published;
    } catch (error) {
      console.error(`[LRAClient] Failed to publish task ${taskId}:`, error);
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
      await axios.put(
        `${this.baseURL}/tasks/${taskId}/status`,
        { projectPath, status }
      );
      console.log(`[LRAClient] Task status updated: ${taskId} → ${status}`);
    } catch (error) {
      throw new Error(`Failed to set task status: ${error}`);
    }
  }
  
  /**
   * 查看任务详情
   */
  async showTask(projectPath: string, taskId: string): Promise<LraTaskDetail> {
    try {
      const { data } = await axios.get(`${this.baseURL}/tasks/${taskId}`, {
        params: { projectPath }
      });
      
      return data.task;
    } catch (error) {
      throw new Error(`Failed to show task ${taskId}: ${error}`);
    }
  }
}
