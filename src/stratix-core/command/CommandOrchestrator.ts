import type { Command, CommandContext, CommandResult, CommandSource } from './types';

const SOURCE_PRIORITY: Record<CommandSource, number> = {
  builtin: 0,
  plugin: 1,
  skill: 2,
  workflow: 3,
  mcp: 4,
};

export class CommandOrchestrator {
  private commands = new Map<string, Command>();

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
}

export { Command, CommandContext, CommandResult, CommandSource } from './types';
