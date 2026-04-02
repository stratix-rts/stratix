import { ExecutorFactory } from '../../stratix-core/executor';
import type { ExecutorResult } from '../../stratix-core/executor';
import { StratixCommandData, StratixAgentConfig } from '../../stratix-core/stratix-protocol';
import { ConnectionPool } from '../../stratix-openclaw-adapter';

export class CommandTransformer {
  private executorFactory: ExecutorFactory;
  private connectionPool: ConnectionPool;

  constructor(connectionPool?: ConnectionPool) {
    this.connectionPool = connectionPool || new ConnectionPool();
    this.executorFactory = ExecutorFactory.getInstance(this.connectionPool);
  }

  public async transformAndExecute(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): Promise<any> {
    const executor = this.executorFactory.getExecutor(agentConfig);
    const result: ExecutorResult = await executor.execute(command, agentConfig);

    if (!result.success) {
      throw new Error(result.error || 'Execution failed');
    }

    return result.data;
  }

  public async executeWithResult(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): Promise<ExecutorResult> {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.execute(command, agentConfig);
  }

  public validateCommand(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): { valid: boolean; errors: string[] } {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.validate(command, agentConfig);
  }

  public async testConnection(
    agentConfig: StratixAgentConfig
  ): Promise<{ success: boolean; message: string }> {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.testConnection(agentConfig);
  }

  public getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  public getExecutorFactory(): ExecutorFactory {
    return this.executorFactory;
  }
}

export default CommandTransformer;
