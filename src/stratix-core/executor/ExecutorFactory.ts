import type { StratixAgentConfig, AgentBackendType } from '../stratix-protocol';
import type { AgentExecutor } from './AgentExecutor';
import { OpenClawExecutor } from './OpenClawExecutor';
import { StratixAgentExecutor } from './StratixAgentExecutor';
import { ConnectionPool } from '../../stratix-openclaw-adapter';

export class ExecutorFactory {
  private static instance: ExecutorFactory;
  private openClawExecutor: OpenClawExecutor;
  private stratixAgentExecutor: StratixAgentExecutor;

  private constructor(connectionPool?: ConnectionPool) {
    this.openClawExecutor = new OpenClawExecutor(connectionPool);
    this.stratixAgentExecutor = new StratixAgentExecutor();
  }

  static getInstance(connectionPool?: ConnectionPool): ExecutorFactory {
    if (!ExecutorFactory.instance) {
      ExecutorFactory.instance = new ExecutorFactory(connectionPool);
    }
    return ExecutorFactory.instance;
  }

  getExecutor(agentConfig: StratixAgentConfig): AgentExecutor {
    const backendType = agentConfig.backendType || this.inferBackendType(agentConfig);

    switch (backendType) {
      case 'openclaw':
        return this.openClawExecutor;
      case 'stratix':
        return this.stratixAgentExecutor;
      default:
        throw new Error(`Unknown backend type: ${backendType}`);
    }
  }

  getExecutorByType(backendType: AgentBackendType): AgentExecutor {
    switch (backendType) {
      case 'openclaw':
        return this.openClawExecutor;
      case 'stratix':
        return this.stratixAgentExecutor;
      default:
        throw new Error(`Unknown backend type: ${backendType}`);
    }
  }

  private inferBackendType(agentConfig: StratixAgentConfig): AgentBackendType {
    if (agentConfig.openClawConfig) {
      return 'openclaw';
    }
    if (agentConfig.stratixConfig) {
      return 'stratix';
    }
    return 'openclaw';
  }

  getOpenClawExecutor(): OpenClawExecutor {
    return this.openClawExecutor;
  }

  getStratixAgentExecutor(): StratixAgentExecutor {
    return this.stratixAgentExecutor;
  }
}

export function createExecutorFactory(connectionPool?: ConnectionPool): ExecutorFactory {
  return ExecutorFactory.getInstance(connectionPool);
}

export default ExecutorFactory;
