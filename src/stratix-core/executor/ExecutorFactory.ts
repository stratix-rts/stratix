import type { StratixAgentConfig, AgentBackendType } from '../stratix-protocol';
import type { AgentExecutor } from './AgentExecutor';
import { OpenClawExecutor } from './OpenClawExecutor';
import { DirectLLMExecutor } from './DirectLLMExecutor';
import { ConnectionPool } from '../../stratix-openclaw-adapter';
import { DirectLLMService } from '../services/DirectLLMService';

export class ExecutorFactory {
  private static instance: ExecutorFactory;
  private openClawExecutor: OpenClawExecutor;
  private directLLMExecutor: DirectLLMExecutor;

  private constructor(
    connectionPool?: ConnectionPool,
    llmService?: DirectLLMService
  ) {
    this.openClawExecutor = new OpenClawExecutor(connectionPool);
    this.directLLMExecutor = new DirectLLMExecutor(llmService);
  }

  static getInstance(
    connectionPool?: ConnectionPool,
    llmService?: DirectLLMService
  ): ExecutorFactory {
    if (!ExecutorFactory.instance) {
      ExecutorFactory.instance = new ExecutorFactory(connectionPool, llmService);
    }
    return ExecutorFactory.instance;
  }

  getExecutor(agentConfig: StratixAgentConfig): AgentExecutor {
    const backendType = agentConfig.backendType || this.inferBackendType(agentConfig);
    
    switch (backendType) {
      case 'openclaw':
        return this.openClawExecutor;
      case 'direct':
        return this.directLLMExecutor;
      default:
        throw new Error(`Unknown backend type: ${backendType}`);
    }
  }

  getExecutorByType(backendType: AgentBackendType): AgentExecutor {
    switch (backendType) {
      case 'openclaw':
        return this.openClawExecutor;
      case 'direct':
        return this.directLLMExecutor;
      default:
        throw new Error(`Unknown backend type: ${backendType}`);
    }
  }

  private inferBackendType(agentConfig: StratixAgentConfig): AgentBackendType {
    if (agentConfig.openClawConfig) {
      return 'openclaw';
    }
    if (agentConfig.directConfig) {
      return 'direct';
    }
    return 'direct';
  }

  getOpenClawExecutor(): OpenClawExecutor {
    return this.openClawExecutor;
  }

  getDirectLLMExecutor(): DirectLLMExecutor {
    return this.directLLMExecutor;
  }
}

export function createExecutorFactory(
  connectionPool?: ConnectionPool,
  llmService?: DirectLLMService
): ExecutorFactory {
  return ExecutorFactory.getInstance(connectionPool, llmService);
}

export default ExecutorFactory;
