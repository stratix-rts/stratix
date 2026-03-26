/**
 * OrchestrationSync Unit Tests
 */

// Mock database
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    run: jest.fn().mockReturnValue({ changes: 1 }),
    get: jest.fn(),
    all: jest.fn().mockReturnValue([]),
  }),
};

jest.mock('@/stratix-database/StratixDatabase', () => ({
  getDatabase: jest.fn().mockReturnValue({
    getDatabase: jest.fn().mockReturnValue(mockDb),
  }),
}));

// Create persistent mock instances for tracking
const mockZoneManagerInstance = {
  on: jest.fn(),
  off: jest.fn(),
};

const mockTaskQueueInstance = {
  on: jest.fn(),
  off: jest.fn(),
};

const mockBackgroundServiceInstance = {
  onEvent: jest.fn(),
  offEvent: jest.fn(),
};

const mockMessageRouterInstance = {
  on: jest.fn(),
  off: jest.fn(),
};

const mockStatusSync = {
  notifyZoneUpdate: jest.fn(),
  notifyTaskAssigned: jest.fn(),
  notifyTaskCompleted: jest.fn(),
  notifyBackgroundAgentStatus: jest.fn(),
  notifyAgentMessageSent: jest.fn(),
};

// Mock ZoneManager
jest.mock('@/stratix-orchestration/zone/ZoneManager', () => ({
  ZoneManager: {
    getInstance: jest.fn().mockReturnValue(mockZoneManagerInstance),
  },
}));

// Mock TaskQueueService
jest.mock('@/stratix-orchestration/task-queue/TaskQueueService', () => ({
  TaskQueueService: {
    getInstance: jest.fn().mockReturnValue(mockTaskQueueInstance),
  },
}));

// Mock BackgroundAgentService
jest.mock('@/stratix-orchestration/background/BackgroundAgentService', () => ({
  BackgroundAgentService: {
    getInstance: jest.fn().mockReturnValue(mockBackgroundServiceInstance),
  },
}));

// Mock AgentMessageRouter
jest.mock('@/stratix-orchestration/messaging/AgentMessageRouter', () => ({
  AgentMessageRouter: {
    getInstance: jest.fn().mockReturnValue(mockMessageRouterInstance),
  },
}));

// Mock StatusSync
jest.mock('@/stratix-gateway/api/websocket/StatusSync', () => ({
  default: mockStatusSync,
}));

import { OrchestrationSync } from '@/stratix-orchestration/OrchestrationSync';

describe('OrchestrationSync', () => {
  let orchestrationSync: OrchestrationSync;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton state for testing
    (OrchestrationSync as any).instance = undefined;

    // Reset mock instances
    mockZoneManagerInstance.on.mockClear();
    mockZoneManagerInstance.off.mockClear();
    mockTaskQueueInstance.on.mockClear();
    mockTaskQueueInstance.off.mockClear();
    mockBackgroundServiceInstance.onEvent.mockClear();
    mockBackgroundServiceInstance.offEvent.mockClear();
    mockMessageRouterInstance.on.mockClear();
    mockMessageRouterInstance.off.mockClear();

    orchestrationSync = OrchestrationSync.getInstance();
  });

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = OrchestrationSync.getInstance();
      const instance2 = OrchestrationSync.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should set isInitialized to true after initialization', () => {
      expect((orchestrationSync as any).isInitialized).toBe(false);
      orchestrationSync.initialize();
      expect((orchestrationSync as any).isInitialized).toBe(true);
    });

    it('should not re-initialize if already initialized', () => {
      orchestrationSync.initialize();
      const firstInstance = OrchestrationSync.getInstance();

      // Initialize again - should be idempotent
      orchestrationSync.initialize();

      // Should be the same instance
      expect(OrchestrationSync.getInstance()).toBe(firstInstance);
    });

    it('should register zone event listeners with wildcard', () => {
      orchestrationSync.initialize();

      // The ZoneManager.on should have been called with '*' to listen to all zone events
      expect(mockZoneManagerInstance.on).toHaveBeenCalledWith('*', expect.any(Function));
    });

    it('should register task queue event listeners with wildcard', () => {
      orchestrationSync.initialize();

      // The TaskQueueService.on should have been called with '*'
      expect(mockTaskQueueInstance.on).toHaveBeenCalledWith('*', expect.any(Function));
    });

    it('should register background service event listeners', () => {
      orchestrationSync.initialize();

      // The BackgroundAgentService.onEvent should have been called
      expect(mockBackgroundServiceInstance.onEvent).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should register message router event listeners for sent events', () => {
      orchestrationSync.initialize();

      // The AgentMessageRouter.on should have been called with 'sent'
      expect(mockMessageRouterInstance.on).toHaveBeenCalledWith('sent', expect.any(Function));
    });
  });

  describe('cleanup', () => {
    it('should set isInitialized to false after cleanup', () => {
      orchestrationSync.initialize();
      expect((orchestrationSync as any).isInitialized).toBe(true);

      orchestrationSync.cleanup();
      expect((orchestrationSync as any).isInitialized).toBe(false);
    });

    it('should not cleanup if not initialized', () => {
      expect((orchestrationSync as any).isInitialized).toBe(false);

      // Should not throw
      expect(() => orchestrationSync.cleanup()).not.toThrow();
    });

    it('should clear cleanup functions array after cleanup', () => {
      orchestrationSync.initialize();
      expect((orchestrationSync as any).cleanupFns.length).toBeGreaterThan(0);

      orchestrationSync.cleanup();

      // The cleanup functions should have been called and array should be cleared
      expect((orchestrationSync as any).cleanupFns).toEqual([]);
    });

    it('should call off methods to remove listeners', () => {
      orchestrationSync.initialize();
      orchestrationSync.cleanup();

      // Verify off methods were called to clean up listeners
      expect(mockZoneManagerInstance.off).toHaveBeenCalled();
      expect(mockTaskQueueInstance.off).toHaveBeenCalled();
      expect(mockBackgroundServiceInstance.offEvent).toHaveBeenCalled();
      expect(mockMessageRouterInstance.off).toHaveBeenCalled();
    });
  });

  describe('WebSocket notification integration', () => {
    it('should call StatusSync.notifyZoneUpdate when zone event is emitted', () => {
      // Initialize with a mock StatusSync
      orchestrationSync.initialize();

      // Clear previous calls
      mockStatusSync.notifyZoneUpdate.mockClear();

      // Find the zone handler that was registered
      const zoneHandler = mockZoneManagerInstance.on.mock.calls.find(
        call => call[0] === '*'
      )?.[1];

      // Simulate a zone event
      if (zoneHandler) {
        zoneHandler({
          type: 'status_change',
          zoneId: 'zone-1',
          timestamp: Date.now(),
          data: { status: 'active' },
        });
      }

      // StatusSync.notifyZoneUpdate should have been called
      expect(mockStatusSync.notifyZoneUpdate).toHaveBeenCalledWith(
        'zone-1',
        expect.objectContaining({
          type: 'status_change',
        })
      );
    });

    it('should call StatusSync.notifyTaskAssigned when task is assigned', () => {
      orchestrationSync.initialize();

      mockStatusSync.notifyTaskAssigned.mockClear();

      // Find the task handler
      const taskHandler = mockTaskQueueInstance.on.mock.calls.find(
        call => call[0] === '*'
      )?.[1];

      // Simulate task assigned event
      if (taskHandler) {
        taskHandler({
          type: 'assigned',
          taskId: 'task-1',
          agentId: 'agent-1',
          timestamp: Date.now(),
        });
      }

      expect(mockStatusSync.notifyTaskAssigned).toHaveBeenCalled();
    });

    it('should call StatusSync.notifyTaskCompleted when task is completed', () => {
      orchestrationSync.initialize();

      mockStatusSync.notifyTaskCompleted.mockClear();

      // Find the task handler
      const taskHandler = mockTaskQueueInstance.on.mock.calls.find(
        call => call[0] === '*'
      )?.[1];

      // Simulate task completed event
      if (taskHandler) {
        taskHandler({
          type: 'completed',
          taskId: 'task-1',
          agentId: 'agent-1',
          timestamp: Date.now(),
        });
      }

      expect(mockStatusSync.notifyTaskCompleted).toHaveBeenCalled();
    });

    it('should call StatusSync.notifyAgentMessageSent when message is sent', () => {
      orchestrationSync.initialize();

      mockStatusSync.notifyAgentMessageSent.mockClear();

      // Find the message handler
      const msgHandler = mockMessageRouterInstance.on.mock.calls.find(
        call => call[0] === 'sent'
      )?.[1];

      // Simulate message sent event
      if (msgHandler) {
        msgHandler({
          type: 'sent',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          recipientId: 'agent-2',
          timestamp: Date.now(),
        });
      }

      expect(mockStatusSync.notifyAgentMessageSent).toHaveBeenCalledWith(
        'msg-1',
        'conv-1',
        'agent-2',
        'direct'
      );
    });
  });

  describe('multiple initialize/cleanup cycles', () => {
    it('should handle multiple initialize calls without duplicating listeners', () => {
      orchestrationSync.initialize();
      const firstOnCalls = mockZoneManagerInstance.on.mock.calls.length;

      orchestrationSync.initialize();
      const secondOnCalls = mockZoneManagerInstance.on.mock.calls.length;

      // Should not have added duplicate listeners
      expect(secondOnCalls).toBe(firstOnCalls);
    });

    it('should handle initialize/cleanup/initialize cycles', () => {
      orchestrationSync.initialize();
      expect((orchestrationSync as any).isInitialized).toBe(true);

      orchestrationSync.cleanup();
      expect((orchestrationSync as any).isInitialized).toBe(false);

      // After cleanup, initialize again should register fresh listeners
      const offCallsAfterCleanup = mockZoneManagerInstance.off.mock.calls.length;

      orchestrationSync.initialize();
      const onCallsAfterReinit = mockZoneManagerInstance.on.mock.calls.length;

      // Should have called on again (to register new listeners)
      expect(onCallsAfterReinit).toBeGreaterThan(offCallsAfterCleanup);
    });
  });
});
