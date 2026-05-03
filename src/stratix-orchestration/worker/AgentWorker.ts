import { readdir, stat } from 'fs/promises';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

export interface AgentWorkerConfig {
  agentId: string;
  gatewayUrl: string;
  pollIntervalMs: number;
  llmProvider?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
}

interface Task {
  taskId: string;
  zoneId: string;
  name: string;
  description: string;
  type: string;
  priority: number;
  status: string;
  assignedAgentId: string;
  context?: {
    sandboxRoot?: string;
    [key: string]: unknown;
  };
}

interface TaskResult {
  success: boolean;
  output: string;
  files: string[];
  summary: string;
}

export class AgentWorker {
  private config: AgentWorkerConfig;
  private running: boolean;
  private timer: NodeJS.Timeout | null;

  constructor(config: AgentWorkerConfig) {
    this.config = config;
    this.running = false;
    this.timer = null;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const res = await fetch(
        `${this.config.gatewayUrl}/api/agent/${this.config.agentId}/tasks`
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch tasks: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { tasks: Task[]; count: number };
      const tasks = data.tasks.filter(
        (t) => t.status === 'assigned' || t.status === 'delegated'
      );

      for (const task of tasks) {
        await this.executeTask(task);
      }
    } catch (err) {
      console.error('[AgentWorker] Poll error:', err);
    }

    if (this.running) {
      this.timer = setTimeout(
        () => void this.poll(),
        this.config.pollIntervalMs || 5000
      );
    }
  }

  private async executeTask(task: Task): Promise<void> {
    try {
      const startRes = await fetch(
        `${this.config.gatewayUrl}/api/agent/${this.config.agentId}/tasks/${task.taskId}/start`,
        { method: 'POST' }
      );
      if (!startRes.ok) {
        throw new Error(
          `Failed to start task: ${startRes.status} ${startRes.statusText}`
        );
      }

      const sandboxRoot = task.context?.sandboxRoot;
      let beforeSnap: Set<string>;
      try {
        beforeSnap = sandboxRoot
          ? await this.buildFileSnapshot(sandboxRoot)
          : new Set<string>();
      } catch (snapErr) {
        console.error(
          `[AgentWorker] Failed to build snapshot for ${sandboxRoot}:`,
          snapErr
        );
        beforeSnap = new Set<string>();
      }

      const prompt = `你是 Agent ${this.config.agentId}。任务: ${task.name}\n描述: ${task.description}\n请在工作目录中完成此任务。`;
      const output = await this.callLLM(prompt);

      const files = sandboxRoot
        ? this.scanNewFiles(sandboxRoot, beforeSnap)
        : [];

      const result: TaskResult = {
        success: true,
        output,
        files,
        summary: `任务 "${task.name}" 已完成。`,
      };

      await this.reportComplete(task.taskId, result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[AgentWorker] Task ${task.taskId} execution failed:`,
        errorMessage
      );
      await this.reportFail(task.taskId, errorMessage);
    }
  }

  private async buildFileSnapshot(dir: string): Promise<Set<string>> {
    const snap = new Set<string>();
    await this.walkDir(dir, snap);
    return snap;
  }

  private async walkDir(dir: string, snap: Set<string>): Promise<void> {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const st = await stat(fullPath);
      if (st.isDirectory()) {
        await this.walkDir(fullPath, snap);
      } else if (st.isFile()) {
        snap.add(resolve(fullPath));
      }
    }
  }

  private scanNewFiles(sandboxRoot: string, beforeSnap: Set<string>): string[] {
    const newFiles: string[] = [];
    const walk = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          walk(fullPath);
        } else if (st.isFile()) {
          const absPath = resolve(fullPath);
          if (!beforeSnap.has(absPath)) {
            newFiles.push(absPath);
          }
        }
      }
    };
    walk(sandboxRoot);
    return newFiles;
  }

  private async callLLM(prompt: string): Promise<string> {
    const provider = this.config.llmProvider || 'openai';
    const baseUrl = this.config.llmBaseUrl || 'https://api.openai.com';
    const model = this.config.llmModel || 'gpt-4o-mini';
    const apiKey = this.config.llmApiKey || '';

    if (provider === 'ollama') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是一个执行任务的 AI Agent。' },
              { role: 'user', content: prompt },
            ],
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `LLM API error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as {
          message?: { content?: string };
          error?: string;
        };

        if (data.error) {
          throw new Error(`LLM API error: ${data.error}`);
        }

        return data.message?.content || '';
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // openai or custom
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是一个执行任务的 AI Agent。' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `LLM API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (data.error) {
        throw new Error(
          `LLM API error: ${data.error.message || JSON.stringify(data.error)}`
        );
      }

      return data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async reportComplete(taskId: string, result: TaskResult): Promise<void> {
    const res = await fetch(
      `${this.config.gatewayUrl}/api/agent/${this.config.agentId}/tasks/${taskId}/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ result }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `Failed to report complete: ${res.status} ${res.statusText}`
      );
    }
  }

  private async reportFail(taskId: string, error: string): Promise<void> {
    const res = await fetch(
      `${this.config.gatewayUrl}/api/agent/${this.config.agentId}/tasks/${taskId}/fail`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `Failed to report fail: ${res.status} ${res.statusText}`
      );
    }
  }
}
