import {
  taskClaim,
  taskProgress,
  taskComplete,
  taskIssue,
  capabilityUpdate,
} from '@/stratix-agent/core/ZoneAgentSkills';

const mockAddFlow = jest.fn();
const mockGetLatestFlow = jest.fn();
const mockGetTaskFlowHistory = jest.fn();
const mockLog = jest.fn();
const mockSetCapability = jest.fn();
const mockDecrementLoad = jest.fn();

jest.mock('@/stratix-database', () => ({
  taskFlowRepository: {
    addFlow: (...args: any[]) => mockAddFlow(...args),
    getLatestFlow: (...args: any[]) => mockGetLatestFlow(...args),
    getTaskFlowHistory: (...args: any[]) => mockGetTaskFlowHistory(...args),
  },
  auditLogRepository: {
    log: (...args: any[]) => mockLog(...args),
  },
  agentCapabilityRepository: {
    setCapability: (...args: any[]) => mockSetCapability(...args),
    decrementLoad: (...args: any[]) => mockDecrementLoad(...args),
  },
}));

describe('ZoneAgentSkills', () => {
  let originalFetch: typeof global.fetch;
  let originalGatewayUrl: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    originalGatewayUrl = process.env.GATEWAY_URL;
    process.env.GATEWAY_URL = 'http://127.0.0.1:7524';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GATEWAY_URL = originalGatewayUrl;
  });

  describe('taskClaim', () => {
    test('claims task successfully', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-1' });

      const result = await taskClaim('agent-1', 'zone-1', 'task-1', 'coding');

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
      expect(result.agentId).toBe('agent-1');
      expect(result.zoneId).toBe('zone-1');
      expect(result.flowId).toBe('flow-1');
      expect(result.claimedAt).toBeDefined();

      expect(mockAddFlow).toHaveBeenCalledWith(
        'task-1',
        'zone-1',
        null,
        'agent-1',
        'claimed',
        expect.objectContaining({ reason: expect.stringContaining('agent-1') })
      );
      expect(mockLog).toHaveBeenCalledWith(
        'zone-1',
        'task_claimed',
        'agent-1',
        'task-1',
        { capability: 'coding' }
      );
    });

    test('returns error when agentId is missing', async () => {
      const result = await taskClaim('', 'zone-1', 'task-1', 'coding');

      expect(result.success).toBe(false);
      expect(result.error).toContain('agentId');
    });

    test('returns error when zoneId is missing', async () => {
      const result = await taskClaim('agent-1', '', 'task-1', 'coding');

      expect(result.success).toBe(false);
      expect(result.error).toContain('zoneId');
    });

    test('returns error when taskId is missing', async () => {
      const result = await taskClaim('agent-1', 'zone-1', '', 'coding');

      expect(result.success).toBe(false);
      expect(result.error).toContain('taskId');
    });

    test('returns error when capability is missing', async () => {
      const result = await taskClaim('agent-1', 'zone-1', 'task-1', '' as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('capability');
    });
  });

  describe('taskProgress', () => {
    test('reports progress for first start', async () => {
      mockGetLatestFlow.mockReturnValue({ action: 'claimed' });

      const result = await taskProgress('agent-1', 'zone-1', 'task-1', 50, 'in_progress', 'working', 'step-1');

      expect(result.success).toBe(true);
      expect(result.progress).toBe(50);
      expect(result.status).toBe('in_progress');
      expect(result.message).toBe('working');
      expect(result.currentStep).toBe('step-1');

      // Should log task_started and add flow for first start
      expect(mockLog).toHaveBeenCalled();
      expect(mockAddFlow).toHaveBeenCalledWith(
        'task-1',
        'zone-1',
        'agent-1',
        'agent-1',
        'started',
        expect.anything()
      );
    });

    test('reports progress for subsequent updates', async () => {
      mockGetLatestFlow.mockReturnValue({ action: 'started' });

      const result = await taskProgress('agent-1', 'zone-1', 'task-1', 75, 'in_progress');

      expect(result.success).toBe(true);
      expect(result.progress).toBe(75);

      // Should only log, not add flow
      expect(mockLog).toHaveBeenCalled();
      expect(mockAddFlow).not.toHaveBeenCalled();
    });

    test('throws when agentId is missing', async () => {
      const result = await taskProgress('', 'zone-1', 'task-1', 50, 'in_progress');

      expect(result.success).toBe(false);
      expect(result.error).toContain('agentId');
    });

    test('throws when progress is out of range', async () => {
      const result = await taskProgress('agent-1', 'zone-1', 'task-1', 150, 'in_progress');

      expect(result.success).toBe(false);
      expect(result.error).toContain('progress must be between 0 and 100');
    });

    test('throws when progress is negative', async () => {
      const result = await taskProgress('agent-1', 'zone-1', 'task-1', -1, 'in_progress');

      expect(result.success).toBe(false);
      expect(result.error).toContain('progress must be between 0 and 100');
    });
  });

  describe('taskComplete', () => {
    test('completes successful task', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-2' });
      mockGetTaskFlowHistory.mockReturnValue([]);

      const result = await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: true,
        output: 'done',
        summary: 'Task completed',
      });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
      expect(result.flowId).toBe('flow-2');

      expect(mockAddFlow).toHaveBeenCalledWith(
        'task-1',
        'zone-1',
        'agent-1',
        'agent-1',
        'completed',
        expect.anything()
      );
      expect(mockLog).toHaveBeenCalledWith(
        'zone-1',
        'task_completed',
        'agent-1',
        'task-1',
        expect.objectContaining({ success: true })
      );
    });

    test('completes failed task', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-3' });
      mockGetTaskFlowHistory.mockReturnValue([]);

      const result = await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: false,
        output: 'failed',
      });

      expect(result.success).toBe(true);
      expect(mockAddFlow).toHaveBeenCalledWith(
        'task-1',
        'zone-1',
        'agent-1',
        'agent-1',
        'failed',
        expect.anything()
      );
      expect(mockLog).toHaveBeenCalledWith(
        'zone-1',
        'task_failed',
        'agent-1',
        'task-1',
        expect.objectContaining({ success: false })
      );
    });

    test('decrements load when task was delegated', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-4' });
      mockGetTaskFlowHistory.mockReturnValue([
        { action: 'created' },
        { action: 'delegated' },
      ]);

      await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: true,
      });

      expect(mockDecrementLoad).toHaveBeenCalledWith('agent-1', 'zone-1');
    });

    test('does not decrement load when task was only claimed', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-5' });
      mockGetTaskFlowHistory.mockReturnValue([
        { action: 'claimed' },
      ]);

      await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: true,
      });

      expect(mockDecrementLoad).not.toHaveBeenCalled();
    });

    test('notifies zone coordinator via API', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-6' });
      mockGetTaskFlowHistory.mockReturnValue([]);

      await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: true,
        output: 'result',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7524/api/zones/zone-1/tasks/task-1/complete',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    test('returns success even when API notification fails', async () => {
      mockAddFlow.mockReturnValue({ flowId: 'flow-7' });
      mockGetTaskFlowHistory.mockReturnValue([]);
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await taskComplete('agent-1', 'zone-1', {
        taskId: 'task-1',
        success: true,
      });

      expect(result.success).toBe(true);
    });

    test('returns error when required fields missing', async () => {
      const result = await taskComplete('agent-1', 'zone-1', { taskId: '' } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('taskComplete requires');
    });
  });

  describe('taskIssue', () => {
    test('reports issue successfully', async () => {
      mockGetTaskFlowHistory.mockReturnValue([]);

      const result = await taskIssue('agent-1', 'zone-1', 'task-1', 'Something broke', 'high', 'restart');

      expect(result.success).toBe(true);
      expect(result.issue).toBe('Something broke');
      expect(result.severity).toBe('high');
      expect(result.suggestedFix).toBe('restart');

      expect(mockLog).toHaveBeenCalledWith(
        'zone-1',
        'task_failed',
        'agent-1',
        'task-1',
        expect.objectContaining({ issue: 'Something broke', severity: 'high', isIssueReport: true })
      );
      expect(mockAddFlow).toHaveBeenCalledWith(
        'task-1',
        'zone-1',
        'agent-1',
        'agent-1',
        'failed',
        expect.objectContaining({ issues: ['Something broke'] })
      );
    });

    test('decrements load when task was delegated', async () => {
      mockGetTaskFlowHistory.mockReturnValue([{ action: 'delegated' }]);

      await taskIssue('agent-1', 'zone-1', 'task-1', 'Error', 'critical');

      expect(mockDecrementLoad).toHaveBeenCalledWith('agent-1', 'zone-1');
    });

    test('does not decrement load when task was only claimed', async () => {
      mockGetTaskFlowHistory.mockReturnValue([{ action: 'claimed' }]);

      await taskIssue('agent-1', 'zone-1', 'task-1', 'Error', 'low');

      expect(mockDecrementLoad).not.toHaveBeenCalled();
    });

    test('returns error when required fields missing', async () => {
      const result = await taskIssue('', 'zone-1', 'task-1', 'Error', 'low');

      expect(result.success).toBe(false);
      expect(result.error).toContain('taskIssue requires');
    });
  });

  describe('capabilityUpdate', () => {
    test('updates capabilities successfully', async () => {
      mockSetCapability.mockReturnValue({ capability: 'coding', level: 3 });

      const result = await capabilityUpdate('agent-1', 'zone-1', [
        { capability: 'coding', level: 3 },
        { capability: 'writing', level: 2 },
      ]);

      expect(result.success).toBe(true);
      expect(result.capabilities).toHaveLength(2);
      expect(result.capabilities[0]).toEqual({ capability: 'coding', level: 3 });
      expect(result.updatedAt).toBeDefined();

      expect(mockSetCapability).toHaveBeenCalledTimes(2);
      expect(mockSetCapability).toHaveBeenCalledWith('agent-1', 'zone-1', 'coding', 3);
      expect(mockSetCapability).toHaveBeenCalledWith('agent-1', 'zone-1', 'writing', 2);

      expect(mockLog).toHaveBeenCalledWith(
        'zone-1',
        'skill_executed',
        'agent-1',
        'agent-1',
        expect.objectContaining({ skillId: 'capability_update' })
      );
    });

    test('returns error when agentId is missing', async () => {
      const result = await capabilityUpdate('', 'zone-1', [{ capability: 'coding', level: 3 }]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('agentId');
    });

    test('returns error when capabilities array is empty', async () => {
      const result = await capabilityUpdate('agent-1', 'zone-1', []);

      expect(result.success).toBe(false);
      expect(result.error).toContain('capabilities');
    });

    test('returns error when capabilities is undefined', async () => {
      const result = await capabilityUpdate('agent-1', 'zone-1', undefined as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('capabilities');
    });
  });
});
