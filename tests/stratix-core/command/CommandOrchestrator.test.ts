/**
 * CommandOrchestrator unit tests
 */

import { CommandOrchestrator } from '@/stratix-core/command/CommandOrchestrator';
import type { Command, CommandContext, CommandResult } from '@/stratix-core/command/types';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    args: {},
    ...overrides,
  };
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: 'test-cmd',
    description: 'A test command',
    source: 'builtin',
    execute: jest.fn().mockResolvedValue({ success: true, output: 'ok' }),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests: register / unregister
// --------------------------------------------------------------------------

describe('CommandOrchestrator', () => {
  describe('register / unregister', () => {
    it('registers a command', () => {
      const orch = new CommandOrchestrator();
      const cmd = makeCommand({ name: 'cmd-1' });
      orch.register(cmd);
      const found = orch.getCommands(makeContext());
      expect(found.some((c) => c.name === 'cmd-1')).toBe(true);
    });

    it('unregister removes a command', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.unregister('cmd-1');
      const found = orch.getCommands(makeContext());
      expect(found.some((c) => c.name === 'cmd-1')).toBe(false);
    });

    it('unregister on non-existent command is no-op', () => {
      const orch = new CommandOrchestrator();
      expect(() => orch.unregister('ghost')).not.toThrow();
    });

    it('register overwrites existing command with same name', () => {
      const orch = new CommandOrchestrator();
      const cmd1 = makeCommand({ name: 'cmd-1', description: 'first' });
      const cmd2 = makeCommand({ name: 'cmd-1', description: 'second' });
      orch.register(cmd1);
      orch.register(cmd2);
      expect(orch.getCommands(makeContext()).find((c) => c.name === 'cmd-1')?.description).toBe('second');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: getCommands / getCommandNames
  // --------------------------------------------------------------------------

  describe('getCommands / getCommandNames', () => {
    it('returns all registered commands', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.register(makeCommand({ name: 'cmd-2' }));
      expect(orch.getCommands(makeContext()).map((c) => c.name)).toEqual(['cmd-1', 'cmd-2']);
    });

    it('filters by availability function', () => {
      const orch = new CommandOrchestrator();
      orch.register(
        makeCommand({ name: 'cmd-1', availability: (ctx) => ctx.agentId === 'agent-1' })
      );
      orch.register(
        makeCommand({ name: 'cmd-2', availability: (ctx) => ctx.agentId === 'agent-2' })
      );

      const ctx1 = makeContext({ agentId: 'agent-1' });
      const ctx2 = makeContext({ agentId: 'agent-2' });

      expect(orch.getCommands(ctx1).map((c) => c.name)).toEqual(['cmd-1']);
      expect(orch.getCommands(ctx2).map((c) => c.name)).toEqual(['cmd-2']);
    });

    it('commands without availability are always included', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'cmd-1' }));
      orch.register(
        makeCommand({ name: 'cmd-2', availability: (ctx) => ctx.agentId === 'agent-2' })
      );

      const ctx = makeContext({ agentId: 'agent-1' });
      expect(orch.getCommands(ctx).map((c) => c.name)).toContain('cmd-1');
    });

    it('getCommandNames returns sorted names by source priority', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'a-skill', source: 'skill' }));
      orch.register(makeCommand({ name: 'b-builtin', source: 'builtin' }));
      orch.register(makeCommand({ name: 'c-mcp', source: 'mcp' }));

      const names = orch.getCommandNames(makeContext());
      // SOURCE_PRIORITY: builtin=0, plugin=1, skill=2, workflow=3, mcp=4
      expect(names).toEqual(['b-builtin', 'a-skill', 'c-mcp']);
    });

    it('sorts all sources in correct order', () => {
      const orch = new CommandOrchestrator();
      orch.register(makeCommand({ name: 'mcp', source: 'mcp' }));
      orch.register(makeCommand({ name: 'builtin', source: 'builtin' }));
      orch.register(makeCommand({ name: 'skill', source: 'skill' }));
      orch.register(makeCommand({ name: 'plugin', source: 'plugin' }));
      orch.register(makeCommand({ name: 'workflow', source: 'workflow' }));

      const names = orch.getCommandNames(makeContext());
      expect(names).toEqual(['builtin', 'plugin', 'skill', 'workflow', 'mcp']);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: execute
  // --------------------------------------------------------------------------

  describe('execute', () => {
    it('executes a registered command', async () => {
      const orch = new CommandOrchestrator();
      const executeFn = jest.fn().mockResolvedValue({ success: true, output: 'result' });
      orch.register(makeCommand({ name: 'cmd-1', execute: executeFn }));

      const result = await orch.execute('cmd-1', makeContext());
      expect(executeFn).toHaveBeenCalled();
      expect(result.output).toBe('result');
    });

    it('throws when command not found', async () => {
      const orch = new CommandOrchestrator();
      await expect(orch.execute('ghost', makeContext())).rejects.toThrow('Command not found');
    });

    it('passes context to command execute function', async () => {
      const orch = new CommandOrchestrator();
      const ctx = makeContext({ agentId: 'my-agent', args: { foo: 'bar' } });
      const executeFn = jest.fn().mockResolvedValue({ success: true, output: '' });
      orch.register(makeCommand({ name: 'cmd-1', execute: executeFn }));

      await orch.execute('cmd-1', ctx);
      expect(executeFn).toHaveBeenCalledWith(ctx);
    });

    it('returns CommandResult from execute', async () => {
      const orch = new CommandOrchestrator();
      const result: CommandResult = {
        success: true,
        output: 'the output',
      };
      orch.register(makeCommand({ name: 'cmd-1', execute: jest.fn().mockResolvedValue(result) }));

      const res = await orch.execute('cmd-1', makeContext());
      expect(res.success).toBe(true);
      expect(res.output).toBe('the output');
    });
  });
});