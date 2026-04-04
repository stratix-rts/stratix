import type { WorkflowDefinition, WorkflowExecutionResult } from '../workflow/types';

interface ActiveExecution {
  id: string;
  workflowId: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  startTime: number;
  result?: WorkflowExecutionResult;
}

const activeExecutions = new Map<string, ActiveExecution>();

export function registerExecutionHandlers() {
  return {
    'execution:start': async (
      _event: any,
      workflowId: string,
      workflow: WorkflowDefinition,
      input: string
    ): Promise<{ success: boolean; executionId?: string; error?: string }> => {
      try {
        const executionId = `${workflowId}-${Date.now()}`;

        const execution: ActiveExecution = {
          id: executionId,
          workflowId,
          status: 'running',
          startTime: Date.now(),
        };

        activeExecutions.set(executionId, execution);

        try {
          const { buildGraphFromWorkflow } = await import('../orchestration/graph-builder');
          const graph = await buildGraphFromWorkflow(workflow);
          // Run execution in background - caller can poll status
          graph.invoke({ input, results: {}, messages: [] })
            .then(() => {
              execution.status = 'completed';
              execution.result = {
                success: true,
                output: 'Completed',
                duration: Date.now() - execution.startTime,
              };
            })
            .catch((error: Error) => {
              execution.status = 'error';
              execution.result = {
                success: false,
                error: error.message,
              };
            });
        } catch (error) {
          execution.status = 'error';
          execution.result = {
            success: false,
            error: (error as Error).message,
          };
        }

        return { success: true, executionId };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to start' };
      }
    },

    'execution:status': async (
      _event: any,
      executionId: string
    ): Promise<{ success: boolean; execution?: ActiveExecution; error?: string }> => {
      const execution = activeExecutions.get(executionId);
      if (execution) {
        return { success: true, execution };
      }
      return { success: false, error: 'Execution not found' };
    },

    'execution:list': async (): Promise<{ success: boolean; executions: ActiveExecution[] }> => {
      return { success: true, executions: Array.from(activeExecutions.values()) };
    },

    'execution:clear': async (_event: any, executionId?: string): Promise<{ success: boolean }> => {
      if (executionId) {
        activeExecutions.delete(executionId);
      } else {
        activeExecutions.clear();
      }
      return { success: true };
    },
  };
}
