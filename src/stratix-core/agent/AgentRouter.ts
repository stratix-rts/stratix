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
   * Execute the task based on routing rules.
   */
  private async executeTask(
    task: AgentTask,
    abortController: AbortController
  ): Promise<unknown> {
    const isolation = task.isolation ?? this.determineIsolation(task);
    const agentId = task.agentId ?? this.determineAgentId(task);

    switch (task.type) {
      case "teammate":
        return this.executeTeammateTask(task, agentId, isolation, abortController);
      case "subagent":
        return this.executeSubagentTask(task, agentId, isolation, abortController);
      default:
        throw new Error(`Unknown task type: ${(task as AgentTask).type}`);
    }
  }

  /**
   * Determine default isolation strategy based on task type.
   */
  private determineIsolation(task: AgentTask): IsolationStrategy {
    if (task.isolation) {
      return task.isolation;
    }
    return task.type === "teammate" ? "worktree" : "none";
  }

  /**
   * Determine agent ID based on task type.
   */
  private determineAgentId(task: AgentTask): string | undefined {
    if (task.agentId) {
      return task.agentId;
    }
    return task.type === "teammate" ? "default-teammate" : undefined;
  }

  /**
   * Execute a teammate task with worktree isolation.
   */
  private async executeTeammateTask(
    task: AgentTask,
    agentId: string | undefined,
    isolation: IsolationStrategy,
    abortController: AbortController
  ): Promise<unknown> {
    // Teammate tasks route to the team coordination system
    // Worktree isolation creates an isolated git worktree for execution
    return this.executeWithIsolation(task, agentId, isolation, abortController);
  }

  /**
   * Execute a subagent task with no isolation (runs in current context).
   */
  private async executeSubagentTask(
    task: AgentTask,
    agentId: string | undefined,
    isolation: IsolationStrategy,
    abortController: AbortController
  ): Promise<unknown> {
    // Subagent tasks run directly in the current process context
    // Remote isolation would spawn a separate process
    return this.executeWithIsolation(task, agentId, isolation, abortController);
  }

  /**
   * Core execution with isolation strategy applied.
   */
  private async executeWithIsolation(
    task: AgentTask,
    agentId: string | undefined,
    isolation: IsolationStrategy,
    abortController: AbortController
  ): Promise<unknown> {
    // This is a placeholder for the actual execution logic
    // The actual implementation would:
    // 1. For worktree: create a git worktree and execute within it
    // 2. For remote: spawn a child process
    // 3. For none: execute in current context

    const executor = this.getExecutor(isolation);
    return executor(task, agentId, abortController.signal);
  }

  /**
   * Get the appropriate executor function for the isolation strategy.
   */
  private getExecutor(
    isolation: IsolationStrategy
  ): (
    task: AgentTask,
    agentId: string | undefined,
    signal: AbortSignal
  ) => Promise<unknown> {
    switch (isolation) {
      case "worktree":
        return this.executeInWorktree.bind(this);
      case "remote":
        return this.executeRemotely.bind(this);
      case "none":
      default:
        return this.executeInProcess.bind(this);
    }
  }

  /**
   * Execute in current process (no isolation).
   */
  private async executeInProcess(
    task: AgentTask,
    agentId: string | undefined,
    signal: AbortSignal
  ): Promise<unknown> {
    // Placeholder: in-process execution
    // Actual implementation would invoke the agent directly
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const timeout = setTimeout(() => {
        resolve({ taskId: task.taskId, agentId, status: "executed" });
      }, 0);

      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }

  /**
   * Execute in an isolated git worktree.
   */
  private async executeInWorktree(
    task: AgentTask,
    agentId: string | undefined,
    signal: AbortSignal
  ): Promise<unknown> {
    // Placeholder: worktree-based execution
    // Actual implementation would:
    // 1. Create a git worktree with a unique branch name
    // 2. Execute the agent within that worktree
    // 3. Clean up the worktree after completion

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // Simulate worktree isolation
    return {
      taskId: task.taskId,
      agentId,
      isolation: "worktree",
      status: "executed",
    };
  }

  /**
   * Execute in a remote/isolated process.
   */
  private async executeRemotely(
    task: AgentTask,
    agentId: string | undefined,
    signal: AbortSignal
  ): Promise<unknown> {
    // Placeholder: remote process execution
    // Actual implementation would spawn a child process

    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return {
      taskId: task.taskId,
      agentId,
      isolation: "remote",
      status: "executed",
    };
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
