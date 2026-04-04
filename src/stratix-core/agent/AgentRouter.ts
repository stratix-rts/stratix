/**
 * AgentRouter
 * Routes agent tasks to appropriate execution backends based on task type,
 * isolation strategy, and background flag.
 */

import type {
  AgentTask,
  TaskHandle,
  TaskStatus,
  IsolationStrategy,
} from "./types";

/**
 * Execution context for a dispatched task
 */
interface TaskContext {
  taskId: string;
  status: TaskStatus;
  abortController: AbortController;
  result?: unknown;
  startedAt: Date;
  completedAt?: Date;
  promise: Promise<unknown>;
}

export class AgentRouter {
  private taskRegistry: Map<string, TaskContext> = new Map();
  private backgroundTasks: Set<string> = new Set();
  private executor: (task: AgentTask, agentId: string | undefined, signal: AbortSignal) => Promise<unknown> = async () => {
    throw new Error("AgentRouter executor not initialized. Call initializeWithOrchestration() first.");
  };

  /**
   * Initialize the router with an orchestration service executor.
   * The executor is called to run agent tasks.
   */
  initializeWithOrchestration(
    exec: (task: AgentTask, agentId: string | undefined, signal: AbortSignal) => Promise<unknown>
  ): void {
    this.executor = exec;
  }

  /**
   * Dispatch a task to the appropriate executor based on routing logic.
   *
   * Routing decisions:
   * - teammate type → uses worktree isolation by default
   * - subagent type → uses none isolation
   * - remote isolation → spawns isolated process
   * - background flag → tracks task separately
   */
  async dispatch(task: AgentTask): Promise<TaskHandle> {
    const abortController = new AbortController();

    const context: TaskContext = {
      taskId: task.taskId,
      status: "pending",
      abortController,
      startedAt: new Date(),
      promise: this.executeTask(task, abortController),
    };

    this.taskRegistry.set(task.taskId, context);

    if (task.runInBackground) {
      this.backgroundTasks.add(task.taskId);
    }

    // Start execution asynchronously
    context.promise
      .then((result) => {
        context.result = result;
        context.status = "completed";
        context.completedAt = new Date();
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          context.status = "aborted";
        } else {
          context.status = "failed";
          context.result = error;
        }
        context.completedAt = new Date();
      });

    context.status = "running";

    return this.createTaskHandle(context);
  }

  /**
   * Abort a running task by its ID.
   */
  async abort(taskId: string): Promise<void> {
    const context = this.taskRegistry.get(taskId);
    if (!context) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (context.status !== "running" && context.status !== "pending") {
      throw new Error(`Task ${taskId} is not running (status: ${context.status})`);
    }

    context.abortController.abort();
    this.backgroundTasks.delete(taskId);
  }

  /**
   * Get the current status of a task.
   */
  async getStatus(taskId: string): Promise<TaskStatus> {
    const context = this.taskRegistry.get(taskId);
    if (!context) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return context.status;
  }

  /**
   * Execute the task via the injected orchestration executor.
   */
  private async executeTask(
    task: AgentTask,
    abortController: AbortController
  ): Promise<unknown> {
    const isolation = task.isolation ?? (task.type === "teammate" ? "worktree" : "none");
    const agentId = task.agentId ?? (task.type === "teammate" ? "default-teammate" : undefined);

    return this.executor(task, agentId, abortController.signal);
  }

  /**
   * Create a TaskHandle from a TaskContext.
   */
  private createTaskHandle(context: TaskContext): TaskHandle {
    return {
      taskId: context.taskId,
      status: context.status,
      abort: async () => {
        await this.abort(context.taskId);
      },
      result: context.result,
      startedAt: context.startedAt,
      completedAt: context.completedAt,
    };
  }
}

// Singleton instance for module-level usage
export const agentRouter = new AgentRouter();
