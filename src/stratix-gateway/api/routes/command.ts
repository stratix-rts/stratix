import { Router, Request, Response } from 'express';

import { StratixCommandData } from '../../../stratix-core/stratix-protocol';
import { StratixRequestHelper } from '../../../stratix-core/utils';
import { CommandTransformer } from '../../command-transformer/CommandTransformer';
import { dataStoreService } from '../../dataStoreService';
import { StatusSyncService } from '../websocket/StatusSync';

const router = Router();
const commandTransformer = new CommandTransformer();
const requestHelper = StratixRequestHelper.getInstance();
let statusSyncService: StatusSyncService | null = null;

export function setStatusSyncService(service: StatusSyncService) {
  statusSyncService = service;
}

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

    statusSyncService?.notifyCommandStatus(
      command.commandId,
      agentId,
      'pending'
    );

    try {
      const result = await commandTransformer.transformAndExecute(command, agentConfig);
      statusSyncService?.notifyCommandStatus(
        command.commandId,
        agentId,
        'success',
        100,
        result
      );
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
