import type { ProviderConfig } from '../providers/types';

export type WorkflowStepType = 'agent' | 'llm' | 'tool' | 'condition' | 'router' | 'human' | 'parallel' | 'delay' | 'loop';
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'stopped';

export interface WorkflowStepProperties {
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  userPrompt?: string;
  tools?: string[];
  condition?: string;
  maxIterations?: number;
  timeout?: number;
  role?: string;
  temperature?: number;
  maxTokens?: number;
  // Agent node properties
  agentId?: string;
  agentType?: string;
  // Condition node properties
  expression?: string;
  trueBranch?: string;
  falseBranch?: string;
  // Delay node properties
  delayDuration?: number;
  delayUnit?: 'ms' | 's' | 'm' | 'h';
}

export interface WorkflowStep {
  id: string;
  componentType: 'task' | 'decision' | 'parallel' | 'loop' | 'human' | 'condition' | 'delay';
  type: WorkflowStepType;
  name: string;
  properties: WorkflowStepProperties;
  sequences?: WorkflowStep[][];
}

export interface WorkflowProperties {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface WorkflowDefinition {
  properties: WorkflowProperties;
  sequence: WorkflowStep[];
}

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  category: 'single-agent' | 'multi-agent' | 'automation' | 'custom';
  icon?: string;
  definition: WorkflowDefinition;
}

export interface WorkflowExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
  steps?: StepExecutionResult[];
}

export interface StepExecutionResult {
  stepId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  output?: string;
  error?: string;
  duration?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowExecutionContext {
  workflowId: string;
  input: string;
  onProgress?: (step: StepExecutionResult) => void;
  onComplete?: (result: WorkflowExecutionResult) => void;
  onError?: (error: Error) => void;
}
