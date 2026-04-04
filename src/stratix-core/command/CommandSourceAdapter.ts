import type { Command, CommandContext, CommandResult, CommandSource } from './types';
import { CommandOrchestrator } from './CommandOrchestrator';
import { CommandTransformer } from '../../stratix-gateway/command-transformer/CommandTransformer';
import type { StratixAgentConfig } from '../stratix-protocol';

/**
 * Adapter that bridges CommandTransformer (protocol-level) to CommandOrchestrator (unified command registry).
 *
 * - Registers agent skills as Commands in CommandOrchestrator
 * - Provides agent-specific command discovery
 * - Delegates execution back to CommandTransformer
 */
export class CommandSourceAdapter {
  private orchestrator: CommandOrchestrator;
  private transformer: CommandTransformer;

  constructor(transformer: CommandTransformer) {
    this.orchestrator = new CommandOrchestrator();
    this.transformer = transformer;
  }

  getOrchestrator(): CommandOrchestrator {
    return this.orchestrator;
  }

  /**
   * Register an agent's skills as Commands in the orchestrator.
   */
  registerAgentCommands(agentConfig: StratixAgentConfig): void {
    if (!agentConfig.skills) return;

    for (const skill of agentConfig.skills) {
      const command: Command = {
        name: skill.skillId,
        description: skill.description || skill.name,
        source: 'skill',
        execute: async (ctx: CommandContext): Promise<CommandResult> => {
          try {
            const result = await this.transformer.transformAndExecute(
              {
                commandId: ctx.commandId || `cmd-${Date.now()}`,
                skillId: skill.skillId,
                agentId: ctx.agentId,
                params: ctx.args,
                executeAt: Date.now(),
              },
              agentConfig
            );
            return { success: true, output: JSON.stringify(result) };
          } catch (error) {
            return {
              success: false,
              output: '',
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        },
        availability: (ctx: CommandContext) => ctx.agentId === agentConfig.agentId,
      };
      this.orchestrator.register(command);
    }
  }

  /**
   * Register a static command (e.g., builtin commands).
   */
  registerStaticCommand(command: Command): void {
    this.orchestrator.register(command);
  }

  /**
   * Get all available commands for a given context, sorted by source priority.
   */
  getAvailableCommands(ctx: CommandContext): Command[] {
    return this.orchestrator.getCommands(ctx);
  }

  /**
   * Get sorted command names for a given context.
   */
  getAvailableCommandNames(ctx: CommandContext): string[] {
    return this.orchestrator.getCommandNames(ctx);
  }

  /**
   * Execute a command by name.
   */
  async executeCommand(name: string, ctx: CommandContext, commandId?: string): Promise<CommandResult> {
    const ctxWithCommandId: CommandContext = {
      ...ctx,
      commandId: commandId || ctx.commandId,
    };
    return this.orchestrator.execute(name, ctxWithCommandId);
  }

  /**
   * Unregister a command by name.
   */
  unregister(name: string): void {
    this.orchestrator.unregister(name);
  }
}
