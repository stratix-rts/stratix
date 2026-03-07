import fs from 'fs-extra';
import path from 'path';
import { TaskResult, RESULT_FILE_NAME } from '../types';

export class ResultCollector {
  private projectPath: string;
  
  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }
  
  async collectTaskResult(taskId: string, taskDir: string): Promise<TaskResult> {
    const resultFile = path.join(taskDir, RESULT_FILE_NAME);
    
    try {
      if (await fs.pathExists(resultFile)) {
        const content = await fs.readFile(resultFile, 'utf-8');
        const result = JSON.parse(content) as TaskResult;
        
        result.files = await this.getTaskFiles(taskDir);
        
        return result;
      }
      
      return {
        taskId,
        success: false,
        error: 'Result file not found',
      };
    } catch (error) {
      return {
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  async collectProjectResults(): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    
    try {
      const taskDirs = await this.getTaskDirectories();
      
      for (const taskDir of taskDirs) {
        const taskId = this.extractTaskId(taskDir);
        if (taskId) {
          const result = await this.collectTaskResult(taskId, taskDir);
          results.push(result);
        }
      }
    } catch (error) {
      console.error('[ResultCollector] Error collecting project results:', error);
    }
    
    return results;
  }
  
  async generateResultManifest(): Promise<string> {
    const results = await this.collectProjectResults();
    const manifestPath = path.join(this.projectPath, 'RESULTS.md');
    
    let markdown = `# 项目执行成果清单\n\n`;
    markdown += `生成时间: ${new Date().toLocaleString()}\n\n`;
    markdown += `---\n\n`;
    
    const successfulTasks = results.filter(r => r.success);
    const failedTasks = results.filter(r => !r.success);
    
    markdown += `## 执行摘要\n\n`;
    markdown += `- 总任务数: ${results.length}\n`;
    markdown += `- 成功: ${successfulTasks.length}\n`;
    markdown += `- 失败: ${failedTasks.length}\n\n`;
    
    if (successfulTasks.length > 0) {
      markdown += `## 成功的任务\n\n`;
      for (const result of successfulTasks) {
        markdown += `### ${result.taskId}\n\n`;
        if (result.summary) {
          markdown += `${result.summary}\n\n`;
        }
        if (result.files && result.files.length > 0) {
          markdown += `**生成文件:**\n`;
          for (const file of result.files) {
            markdown += `- ${file}\n`;
          }
          markdown += `\n`;
        }
      }
    }
    
    if (failedTasks.length > 0) {
      markdown += `## 失败的任务\n\n`;
      for (const result of failedTasks) {
        markdown += `### ${result.taskId}\n\n`;
        markdown += `**错误:** ${result.error}\n\n`;
      }
    }
    
    await fs.writeFile(manifestPath, markdown);
    console.log('[ResultCollector] Generated result manifest:', manifestPath);
    
    return manifestPath;
  }
  
  private async getTaskDirectories(): Promise<string[]> {
    const dirs: string[] = [];
    
    try {
      const entries = await fs.readdir(this.projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('task-')) {
          dirs.push(path.join(this.projectPath, entry.name));
        }
      }
    } catch (error) {
      console.error('[ResultCollector] Error reading project directory:', error);
    }
    
    return dirs;
  }
  
  private extractTaskId(taskDir: string): string | null {
    const dirName = path.basename(taskDir);
    const match = dirName.match(/^task-(.+)$/);
    return match ? match[1] : null;
  }
  
  private async getTaskFiles(taskDir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(taskDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const filePath = path.join(taskDir, entry.name);
        
        if (entry.isFile() && !entry.name.startsWith('.stratix-')) {
          files.push(entry.name);
        } else if (entry.isDirectory()) {
          const subFiles = await this.getTaskFiles(filePath);
          files.push(...subFiles.map(f => path.join(entry.name, f)));
        }
      }
    } catch (error) {
      console.error('[ResultCollector] Error getting task files:', error);
    }
    
    return files;
  }
  
  async writeTaskResult(taskId: string, result: TaskResult): Promise<void> {
    const taskDir = path.join(this.projectPath, `task-${taskId}`);
    const resultFile = path.join(taskDir, RESULT_FILE_NAME);
    
    await fs.ensureDir(taskDir);
    await fs.writeFile(resultFile, JSON.stringify(result, null, 2));
    
    console.log('[ResultCollector] Wrote result for task:', taskId);
  }
}
