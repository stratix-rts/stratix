import { readdir, stat } from 'fs/promises';
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

    let tasksToExecute: Task[] = [];

    try {
      const res = await this.fetchWithRetry(
        `${this.config.gatewayUrl}/api/agent/${this.config.agentId}/tasks`
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch tasks: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { tasks: Task[]; count: number };
      tasksToExecute = data.tasks.filter(
        (t) => t.status === 'assigned' || t.status === 'delegated'
      );
    } catch (err) {
      console.error(
        `[AgentWorker] Poll error for agent ${this.config.agentId}:`,
        err
      );
    }

    // Schedule next poll before executing tasks to avoid blocking the interval
    if (this.running) {
      this.timer = setTimeout(
        () => void this.poll(),
        this.config.pollIntervalMs || 5000
      );
    }

    // Execute tasks after scheduling next poll
    for (const task of tasksToExecute) {
      try {
        await this.executeTask(task);
      } catch (execErr) {
        console.error(
          `[AgentWorker] Unhandled execution error for task ${task.taskId} in zone ${task.zoneId}:`,
          execErr
        );
      }
    }
  }

  private async executeTask(task: Task): Promise<void> {
    const logPrefix = `[AgentWorker][${this.config.agentId}][zone:${task.zoneId}][task:${task.taskId}]`;

    try {
      console.log(`${logPrefix} Starting execution`);

      const startRes = await this.fetchWithRetry(
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
          `${logPrefix} Failed to build snapshot for ${sandboxRoot}:`,
          snapErr
        );
        beforeSnap = new Set<string>();
      }

      const prompt = `你是 Agent ${this.config.agentId}。任务: ${task.name}\n描述: ${task.description}\n请在工作目录中完成此任务。`;
      const output = await this.callLLM(prompt);

      const files = sandboxRoot
        ? await this.scanNewFiles(sandboxRoot, beforeSnap)
        : [];

      const result: TaskResult = {
        success: true,
        output,
        files,
        summary: `任务 "${task.name}" 已完成。`,
      };

      console.log(`${logPrefix} Execution completed, reporting success`);
      await this.reportComplete(task.taskId, result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`${logPrefix} Execution failed:`, errorMessage);
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

  private async scanNewFiles(sandboxRoot: string, beforeSnap: Set<string>): Promise<string[]> {
    const newFiles: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const st = await stat(fullPath);
        if (st.isDirectory()) {
          await walk(fullPath);
        } else if (st.isFile()) {
          const absPath = resolve(fullPath);
          if (!beforeSnap.has(absPath)) {
            newFiles.push(absPath);
          }
        }
      }
    };
    await walk(sandboxRoot);
    return newFiles;
  }

  private async callLLM(prompt: string): Promise<string> {
    const provider = this.config.llmProvider || 'openai';
    const baseUrl = this.config.llmBaseUrl || 'https://api.openai.com';
    const model = this.config.llmModel || 'gpt-4o-mini';
    const apiKey = this.config.llmApiKey || '';

    if (provider === 'ollama') {
      const response = await this.fetchWithRetry(`${baseUrl}/api/chat`, {
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
        signal: AbortSignal.timeout(60000),
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
    }

    // openai or custom
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await this.fetchWithRetry(`${baseUrl}/v1/chat/completions`, {
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
      signal: AbortSignal.timeout(60000),
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
  }

  /**
   * Fetch with retry support (exponential backoff, max 3 attempts).
   * Retries on network errors, timeouts, and 5xx server errors.
   */
  private async fetchWithRetry(
    url: string,
    options?: RequestInit,
    maxRetries: number = 2
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Retry on 5xx errors
        if (response.status >= 500 && attempt < maxRetries) {
          await this.delay(1000 * Math.pow(2, attempt));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryable =
          lastError.name === 'AbortError' ||
          lastError.message.includes('fetch') ||
          lastError.message.includes('network') ||
          lastError.message.includes('ECONNREFUSED');

        if (isRetryable && attempt < maxRetries) {
          await this.delay(1000 * Math.pow(2, attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error(`Fetch failed after ${maxRetries + 1} attempts`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async reportComplete(taskId: string, result: TaskResult): Promise<void> {
    const res = await this.fetchWithRetry(
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
    const res = await this.fetchWithRetry(
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
