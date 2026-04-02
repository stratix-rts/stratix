import { FRAME_SIZE, ANIMATION_OFFSETS, ALL_ANIMATIONS } from '@/stratix-character-creator/constants';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import type { StratixAgentConfig, CharacterProfile } from '@/stratix-core/stratix-protocol';

export interface TextureLoadTask {
  id: string;
  config: StratixAgentConfig;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: HTMLCanvasElement;
  error?: Error;
  callbacks: {
    onComplete?: (canvas: HTMLCanvasElement) => void;
    onError?: (error: Error) => void;
  };
}

export interface TextureLoadQueueOptions {
  maxConcurrency?: number;
  retryAttempts?: number;
}

type TextureLoadEvent = 'taskComplete' | 'taskError' | 'queueEmpty';

class TextureLoadQueue {
  private queue: TextureLoadTask[] = [];
  private running: Map<string, TextureLoadTask> = new Map();
  private completed: Map<string, HTMLCanvasElement> = new Map();
  private maxConcurrency: number;
  private retryAttempts: number;
  private eventListeners: Map<TextureLoadEvent, Set<Function>> = new Map();

  constructor(options: TextureLoadQueueOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.retryAttempts = options.retryAttempts ?? 2;
  }

  enqueue(
    config: StratixAgentConfig,
    priority: number = 5,
    callbacks?: { onComplete?: (canvas: HTMLCanvasElement) => void; onError?: (error: Error) => void }
  ): string {
    if (!config.profile) {
      throw new Error('Cannot enqueue task without profile data');
    }

    const taskId = config.profile.characterId;
    
    if (this.completed.has(taskId)) {
      callbacks?.onComplete?.(this.completed.get(taskId)!);
      return taskId;
    }

    const existingPending = this.queue.find(t => t.id === taskId);
    if (existingPending) {
      if (callbacks?.onComplete) {
        existingPending.callbacks.onComplete = callbacks.onComplete;
      }
      if (callbacks?.onError) {
        existingPending.callbacks.onError = callbacks.onError;
      }
      return taskId;
    }

    const existingRunning = this.running.get(taskId);
    if (existingRunning) {
      if (callbacks?.onComplete) {
        existingRunning.callbacks.onComplete = callbacks.onComplete;
      }
      if (callbacks?.onError) {
        existingRunning.callbacks.onError = callbacks.onError;
      }
      return taskId;
    }

    const task: TextureLoadTask = {
      id: taskId,
      config,
      priority,
      status: 'pending',
      callbacks: callbacks ?? {}
    };

    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);

    this.processQueue();

    return taskId;
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrency) {
      const task = this.queue.shift()!;
      this.running.set(task.id, task);
      task.status = 'running';

      this.executeTask(task).catch(error => {
        console.error(`[TextureLoadQueue] Task ${task.id} failed:`, error);
      });
    }
  }

  private async executeTask(task: TextureLoadTask): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        const profile = task.config.profile!;
        
        const result = await characterComposer.composeCharacter(
          profile.parts,
          {
            bodyType: profile.bodyType as any,
            animations: ALL_ANIMATIONS
          }
        );

        task.result = result.canvas;
        task.status = 'completed';
        this.completed.set(task.id, result.canvas);
        this.running.delete(task.id);

        task.callbacks.onComplete?.(result.canvas);
        this.emit('taskComplete', { taskId: task.id, canvas: result.canvas });

        this.processQueue();
        return;
      } catch (error) {
        lastError = error as Error;
        console.warn(`[TextureLoadQueue] Attempt ${attempt + 1} failed for ${task.id}:`, error);
        
        if (attempt < this.retryAttempts) {
          await this.delay(500 * (attempt + 1));
        }
      }
    }

    task.status = 'failed';
    task.error = lastError ?? new Error('Unknown error');
    this.running.delete(task.id);

    task.callbacks.onError?.(task.error);
    this.emit('taskError', { taskId: task.id, error: task.error });

    this.processQueue();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  on(event: TextureLoadEvent, callback: Function): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);

    return () => {
      this.eventListeners.get(event)?.delete(callback);
    };
  }

  private emit(event: TextureLoadEvent, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  getCompleted(taskId: string): HTMLCanvasElement | undefined {
    return this.completed.get(taskId);
  }

  isCompleted(taskId: string): boolean {
    return this.completed.has(taskId);
  }

  isPending(taskId: string): boolean {
    return this.queue.some(t => t.id === taskId) || this.running.has(taskId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  clear(): void {
    this.queue = [];
    this.running.clear();
    this.completed.clear();
  }
}

export const textureLoadQueue = new TextureLoadQueue({ maxConcurrency: 2 });
export default TextureLoadQueue;
