export type CommandSource = 'builtin' | 'plugin' | 'skill' | 'workflow' | 'mcp';

export interface CommandContext {
  agentId: string;
  sessionId: string;
  args: Record<string, unknown>;
  commandId?: string;
}

export interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Command {
  name: string;
  description: string;
  source: CommandSource;
  execute(ctx: CommandContext): Promise<CommandResult>;
  availability?(ctx: CommandContext): boolean;
}
