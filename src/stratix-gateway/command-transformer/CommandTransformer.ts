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

}

export default CommandTransformer;
