import type { Command, CommandContext, CommandResult, CommandSource } from './types';
import type { StratixCommandData, StratixAgentConfig } from '../stratix-protocol';
import type { ExecutorResult } from '../executor/AgentExecutor';
import { ExecutorFactory } from '../executor/ExecutorFactory';
import { ConnectionPool } from '../../stratix-openclaw-adapter';

/**
 * Command Orchestrator — 命令发现与注册中心。
 *
 * 职责：
 * - 管理命令注册（register/unregister）
 * - 命令发现与上下文过滤（getCommands/getCommandNames）
 * - 命令执行调度（execute — 委托给 ExecutorFactory）
 *
 * 不负责：
 * - 命令的实际执行逻辑（由 CommandSourceAdapter 的 execute 回调处理）
 * - 命令的协议转换（由 CommandTransformer 处理）
 */
const SOURCE_PRIORITY: Record<CommandSource, number> = {
  builtin: 0,
  plugin: 1,
  skill: 2,
  workflow: 3,
  mcp: 4,
};

export class CommandOrchestrator {
  private commands = new Map<string, Command>();
  private connectionPool: ConnectionPool;
  private executorFactory: ExecutorFactory;

  constructor(connectionPool?: ConnectionPool) {
    this.connectionPool = connectionPool || new ConnectionPool();
    this.executorFactory = ExecutorFactory.getInstance(this.connectionPool);
  }

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  unregister(name: string): void {
    this.commands.delete(name);
  }

  async execute(name: string, ctx: CommandContext): Promise<CommandResult> {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error(`Command not found: ${name}`);
    }
    return command.execute(ctx);
  }

  getCommands(ctx: CommandContext): Command[] {
    return Array.from(this.commands.values()).filter(
      (cmd) => !cmd.availability || cmd.availability(ctx)
    );
  }

  getCommandNames(ctx: CommandContext): string[] {
    return this.getCommands(ctx)
      .sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])
      .map((cmd) => cmd.name);
  }

  async transformAndExecute(
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

  async executeWithResult(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): Promise<ExecutorResult> {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.execute(command, agentConfig);
  }

  validateCommand(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): { valid: boolean; errors: string[] } {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.validate(command, agentConfig);
  }

  async testConnection(
    agentConfig: StratixAgentConfig
  ): Promise<{ success: boolean; message: string }> {
    const executor = this.executorFactory.getExecutor(agentConfig);
    return executor.testConnection(agentConfig);
  }

  getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  getExecutorFactory(): ExecutorFactory {
    return this.executorFactory;
  }
}

export { Command, CommandContext, CommandResult, CommandSource } from './types';
