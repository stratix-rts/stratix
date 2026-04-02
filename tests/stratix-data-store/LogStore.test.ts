/**
 * LogStore Unit Tests
 */

import { LogStore } from '@/stratix-data-store/LogStore';
import { StratixDataStore } from '@/stratix-data-store/StratixDataStore';
import type { StratixCommandLog } from '@/stratix-data-store/types';

describe('LogStore', () => {
  let store: StratixDataStore;
  let logStore: LogStore;
  let mockDb: any;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Mock the database
    mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        all: jest.fn().mockReturnValue([])
      }),
      exec: jest.fn()
    };

    jest.doMock('@/stratix-database', () => ({
      initializeDatabase: jest.fn(),
      getDatabase: jest.fn().mockReturnValue({
        getDatabase: jest.fn().mockReturnValue(mockDb)
      })
    }));

    // Now require the store after mocking
    const { StratixDataStore: StratixDataStoreMocked } = require('@/stratix-data-store/StratixDataStore');
    store = new StratixDataStoreMocked();
    logStore = new LogStore(store);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('generateId', () => {
    it('should generate unique log IDs', () => {
      const id1 = logStore.generateId();
      const id2 = logStore.generateId();

      expect(id1).toMatch(/^stratix-log-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^stratix-log-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('createLog', () => {
    it('should create a log with pending status', async () => {
      await store.initialize();

      const log = await logStore.createLog(
        'cmd-1',
        'agent-1',
        'skill-1',
        'Test Skill',
        { param1: 'value1' }
      );

      expect(log.logId).toMatch(/^stratix-log-/);
      expect(log.commandId).toBe('cmd-1');
      expect(log.agentId).toBe('agent-1');
      expect(log.skillId).toBe('skill-1');
      expect(log.skillName).toBe('Test Skill');
      expect(log.params).toEqual({ param1: 'value1' });
      expect(log.status).toBe('pending');
      expect(log.startTime).toBeDefined();
    });
  });

  describe('updateStatus', () => {
    it('should update log status to running', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.updateStatus('log-1', 'running');
      expect(result).toBe(true);
    });

    it('should update log status with result', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.updateStatus('log-1', 'success', 'Operation completed');
      expect(result).toBe(true);
    });

    it('should update log status with error', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.updateStatus('log-1', 'failed', undefined, 'Error occurred');
      expect(result).toBe(true);
    });

    it('should set endTime when status is success', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      await logStore.updateStatus('log-1', 'success');
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should set endTime when status is failed', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      await logStore.updateStatus('log-1', 'failed');
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('markRunning', () => {
    it('should mark log as running', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.markRunning('log-1');
      expect(result).toBe(true);
    });
  });

  describe('markSuccess', () => {
    it('should mark log as success with result', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.markSuccess('log-1', 'done');
      expect(result).toBe(true);
    });

    it('should mark log as success without result', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.markSuccess('log-1');
      expect(result).toBe(true);
    });
  });

  describe('markFailed', () => {
    it('should mark log as failed with error', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.markFailed('log-1', 'Something went wrong');
      expect(result).toBe(true);
    });

    it('should mark log as failed without error', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      const result = await logStore.markFailed('log-1');
      expect(result).toBe(true);
    });
  });

  describe('getLog', () => {
    it('should return null for non-existent log', async () => {
      await store.initialize();
      const log = await logStore.getLog('non-existent');
      expect(log).toBeNull();
    });
  });

  describe('getRecentLogs', () => {
    it('should return recent logs for agent', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      });

      const logs = await logStore.getRecentLogs('agent-1', 5);
      expect(logs).toEqual([]);
    });

    it('should return recent logs without agent filter', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      });

      const logs = await logStore.getRecentLogs(undefined, 10);
      expect(logs).toEqual([]);
    });
  });

  describe('getLogs', () => {
    it('should return logs with options', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      });

      const logs = await logStore.getLogs({ status: 'pending', limit: 20 });
      expect(logs).toEqual([]);
    });

    it('should return all logs with empty options', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      });

      const logs = await logStore.getLogs({});
      expect(logs).toEqual([]);
    });
  });

  describe('getLogsByStatus', () => {
    it('should return logs filtered by status', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            log_id: 'log-1',
            command_id: 'cmd-1',
            agent_id: 'agent-1',
            skill_id: 'skill-1',
            skill_name: 'Test',
            params: '{}',
            status: 'success',
            start_time: Date.now(),
            end_time: Date.now()
          }
        ])
      });

      const logs = await logStore.getLogsByStatus('success');
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('success');
    });
  });

  describe('clearAllLogs', () => {
    it('should clear all logs', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({ run: jest.fn() });

      await logStore.clearAllLogs();
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe('getDuration', () => {
    it('should return null for non-existent log', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([])
      });

      const duration = await logStore.getDuration('non-existent');
      expect(duration).toBeNull();
    });

    it('should return null when log has no endTime', async () => {
      await store.initialize();
      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            log_id: 'log-1',
            command_id: 'cmd-1',
            agent_id: 'agent-1',
            skill_id: 'skill-1',
            skill_name: 'Test',
            params: '{}',
            status: 'running',
            start_time: Date.now()
          }
        ])
      });

      const duration = await logStore.getDuration('log-1');
      expect(duration).toBeNull();
    });

    it('should return duration when log has endTime', async () => {
      await store.initialize();
      const startTime = Date.now() - 1000;
      const endTime = Date.now();

      mockDb.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            log_id: 'log-1',
            command_id: 'cmd-1',
            agent_id: 'agent-1',
            skill_id: 'skill-1',
            skill_name: 'Test',
            params: '{}',
            status: 'success',
            start_time: startTime,
            end_time: endTime
          }
        ])
      });

      const duration = await logStore.getDuration('log-1');
      expect(duration).toBeGreaterThanOrEqual(999);
      expect(duration).toBeLessThanOrEqual(1001);
    });
  });
});
