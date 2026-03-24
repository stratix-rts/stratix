import { StratixError } from './types/result';

export { StratixError };

export class AgentError extends StratixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AGENT_ERROR', context);
    this.name = 'AgentError';
  }
}

export class DataStoreError extends StratixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DATA_STORE_ERROR', context);
    this.name = 'DataStoreError';
  }
}