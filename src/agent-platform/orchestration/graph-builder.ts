import { StateGraph, END, START } from '@langchain/langgraph';

import { providerRegistry } from '../providers/registry';
import type { WorkflowDefinition, WorkflowStep } from '../workflow/types';

import { AgentGraphState } from './state';

export async function buildGraphFromWorkflow(definition: WorkflowDefinition) {
  const builder = new GraphBuilder();
  const graph = builder.buildFromDefinition(definition);
  return graph.compile();
}

export class GraphBuilder {
  buildFromDefinition(definition: WorkflowDefinition): StateGraph<typeof AgentGraphState> {
    const graph = new StateGraph(AgentGraphState);

    for (const step of definition.sequence) {
      this.addNode(graph, step);
    }

    this.addEdges(graph, definition.sequence);

    if (definition.sequence.length > 0) {
      graph.addEdge(START, definition.sequence[0].id as any);
    }

    return graph;
  }

  private addNode(
    graph: StateGraph<typeof AgentGraphState>,
    step: WorkflowStep
  ): void {
    switch (step.type) {
      case 'llm':
        graph.addNode(step.id, this.createLLMNode(step));
        break;
      case 'router':
        graph.addNode(step.id, this.createRouterNode(step));
        break;
      case 'human':
        graph.addNode(step.id, this.createHumanNode(step));
        break;
      case 'parallel':
        graph.addNode(step.id, this.createParallelNode(step));
        break;
      default:
        graph.addNode(step.id, this.createPassThroughNode(step));
    }
  }

  private createLLMNode(step: WorkflowStep) {
    return async (state: typeof AgentGraphState.State) => {
      const { providerId, model, systemPrompt, temperature, maxTokens } = step.properties;

      if (!providerId || !model) {
        return {
          ...state,
          error: `Missing provider or model for step ${step.name}`,
          status: 'error' as const,
        };
      }

      try {
        const llm = providerRegistry.createModel({
          providerId,
          model,
          apiKey: await this.getApiKey(providerId),
          temperature,
          maxTokens,
        });

        const messages = [];
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: state.input });

        const response = await llm.invoke(messages);

        return {
          ...state,
          results: {
            ...state.results,
            [step.id]: response.content,
          },
          currentStep: step.id,
        };
      } catch (error) {
        return {
          ...state,
          error: (error as Error).message,
          status: 'error' as const,
        };
      }
    };
  }

  private createRouterNode(step: WorkflowStep) {
    return async (state: typeof AgentGraphState.State) => {
      const { expression, trueBranch, falseBranch } = step.properties;
      let branchResult: string;

      try {
        // Evaluate simple condition: check if input contains expression keyword
        if (expression && state.input.toLowerCase().includes(expression.toLowerCase())) {
          branchResult = trueBranch ?? 'true';
        } else {
          branchResult = falseBranch ?? 'false';
        }
      } catch {
        branchResult = falseBranch ?? 'false';
      }

      return {
        ...state,
        results: {
          ...state.results,
          [step.id]: branchResult,
        },
        currentStep: step.id,
      };
    };
  }

  private createHumanNode(step: WorkflowStep) {
    return async (state: typeof AgentGraphState.State) => {
      // Human node passes through the input as human response
      // In a real implementation, this would interrupt and wait for external input
      return {
        ...state,
        results: {
          ...state.results,
          [step.id]: state.input,
        },
        currentStep: step.id,
      };
    };
  }

  private createParallelNode(step: WorkflowStep) {
    return async (state: typeof AgentGraphState.State) => {
      const sequences = step.sequences ?? [];
      const branchResults: Record<string, unknown> = {};

      // Execute all branches concurrently
      const branchPromises = sequences.map(async (branch, index) => {
        const branchId = `${step.id}_branch_${index}`;
        try {
          // For now, execute LLM steps in each branch sequentially
          // Each branch is an array of WorkflowStep
          const branchResult = await this.executeBranch(branch, state);
          branchResults[branchId] = branchResult;
        } catch (error) {
          branchResults[branchId] = {
            error: (error as Error).message,
            status: 'error' as const,
          };
        }
      });

      await Promise.all(branchPromises);

      return {
        ...state,
        results: {
          ...state.results,
          [step.id]: branchResults,
        },
        currentStep: step.id,
      };
    };
  }

  private async executeBranch(
    branch: WorkflowStep[],
    state: typeof AgentGraphState.State
  ): Promise<unknown> {
    // Simple sequential execution of branch steps
    const results: Record<string, unknown> = {};
    for (const step of branch) {
      if (step.type === 'llm') {
        const node = this.createLLMNode(step);
        const result = await node({ ...state, results });
        if (result.error) {
          throw new Error(result.error);
        }
        Object.assign(results, result.results);
      } else {
        results[step.id] = { status: 'skipped', reason: 'unsupported step type in branch' };
      }
    }
    return results;
  }

  private createPassThroughNode(step: WorkflowStep) {
    return async (state: typeof AgentGraphState.State) => {
      return {
        ...state,
        currentStep: step.id,
      };
    };
  }

  private addEdges(
    graph: StateGraph<typeof AgentGraphState>,
    steps: WorkflowStep[]
  ): void {
    for (let i = 0; i < steps.length; i++) {
      const current = steps[i];
      const next = steps[i + 1];

      if (next) {
        graph.addEdge(current.id as any, next.id as any);
      } else {
        graph.addEdge(current.id as any, END);
      }
    }
  }

  private async getApiKey(providerId: string): Promise<string | undefined> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.load) {
      const result = await (window as any).electronAPI.apiKey.load(providerId);
      if (result.success && result.data) {
        return result.data;
      }
    }
    return undefined;
  }
}
