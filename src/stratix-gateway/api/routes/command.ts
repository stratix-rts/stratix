import { Router, Request, Response } from 'express';

import { StratixCommandData } from '../../../stratix-core/stratix-protocol';
import { StratixRequestHelper } from '../../../stratix-core/utils';
import { CommandTransformer } from '../../command-transformer/CommandTransformer';
import { CommandSourceAdapter } from '../../../stratix-core/command';
import { dataStoreService } from '../../dataStoreService';
import { StatusSyncService } from '../websocket/StatusSync';

const router = Router();
const commandTransformer = new CommandTransformer();
const commandSourceAdapter = new CommandSourceAdapter(commandTransformer);
const requestHelper = StratixRequestHelper.getInstance();
let statusSyncService: StatusSyncService | null = null;

export function setStatusSyncService(service: StatusSyncService) {
  statusSyncService = service;
}

// Track registered agents to avoid re-registering on every request
const registeredAgents = new Set<string>();

router.post('/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const command: StratixCommandData = req.body;
    const { agentId } = command;

    const store = dataStoreService.getStore();
    const agentConfig = await store.getAgent(agentId);
    if (!agentConfig) {
      res.json(requestHelper.notFound('Agent not found'));
      return;
    }

    // Register agent's commands in the orchestrator (once per agent)
    if (!registeredAgents.has(agentId)) {
      commandSourceAdapter.registerAgentCommands(agentConfig);
      registeredAgents.add(agentId);
    }

    statusSyncService?.notifyCommandStatus(
      command.commandId,
      agentId,
      'pending'
    );

    try {
      const ctx = { agentId, sessionId: '', args: command.params || {} };
      const result = await commandSourceAdapter.executeCommand(command.skillId, ctx, command.commandId);
      if (result.success) {
        const output = result.output ? JSON.parse(result.output) : undefined;
        statusSyncService?.notifyCommandStatus(
          command.commandId,
          agentId,
          'success',
          100,
          output
        );
      } else {
        statusSyncService?.notifyCommandStatus(
          command.commandId,
          agentId,
          'failed',
          undefined,
          undefined,
          result.error
        );
      }
    } catch (error) {
      statusSyncService?.notifyCommandStatus(
        command.commandId,
        agentId,
        'failed',
        undefined,
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    res.json(requestHelper.success(
      { commandId: command.commandId, status: 'pending' },
      'Command execution started'
    ));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

// Command discovery endpoint - returns available commands for an agent
router.get('/commands', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId } = req.query;
    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json(requestHelper.serverError('agentId is required'));
      return;
    }

    const store = dataStoreService.getStore();
    const agentConfig = await store.getAgent(agentId);
    if (!agentConfig) {
      res.json(requestHelper.notFound('Agent not found'));
      return;
    }

    // Ensure agent's commands are registered
    if (!registeredAgents.has(agentId)) {
      commandSourceAdapter.registerAgentCommands(agentConfig);
      registeredAgents.add(agentId);
    }

    const ctx = { agentId, sessionId: '', args: {} };
    const commands = commandSourceAdapter.getAvailableCommands(ctx);
    const commandNames = commandSourceAdapter.getAvailableCommandNames(ctx);

    res.json(requestHelper.success({
      agentId,
      commands: commands.map(cmd => ({
        name: cmd.name,
        description: cmd.description,
        source: cmd.source,
      })),
      commandNames,
    }, 'Commands retrieved'));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { commandId } = req.body;

    res.json(requestHelper.success(
      { commandId, status: 'cancelled' },
      'Command cancelled'
    ));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const { commandId } = req.query;

    res.json(requestHelper.success(
      {
        commandId,
        status: 'success',
        progress: 100,
        result: 'Execution completed'
      },
      'Command status fetched'
    ));
  } catch (error) {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

export default router;
