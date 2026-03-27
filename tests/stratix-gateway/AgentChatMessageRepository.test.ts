/**
 * AgentChatMessageRepository Unit Tests
 */

describe('AgentChatMessageRepository', () => {
  let AgentChatMessageRepository: any;
  let repository: any;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Mock the database
    const mockDb = {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        all: jest.fn().mockReturnValue([])
      })
    };

    jest.doMock('../../src/stratix-database/StratixDatabase', () => ({
      getDatabase: jest.fn().mockReturnValue({
        getDatabase: jest.fn().mockReturnValue(mockDb)
      })
    }));

    const module = require('../../src/stratix-database/AgentChatMessageRepository');
    AgentChatMessageRepository = module.AgentChatMessageRepository;
    repository = new AgentChatMessageRepository();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('saveMessage', () => {
    it('should insert message with correct parameters', () => {
      const msg = {
        messageId: 'msg-123',
        agentId: 'agent-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now()
      };

      repository.saveMessage(msg);

      const db = require('../../src/stratix-database/StratixDatabase').getDatabase();
      const mockPrepare = db.getDatabase().prepare;
      expect(mockPrepare).toHaveBeenCalled();
    });
  });

  describe('getMessagesByAgentId', () => {
    it('should query messages with correct SQL', () => {
      const db = require('../../src/stratix-database/StratixDatabase').getDatabase();
      const mockStmt = {
        all: jest.fn().mockReturnValue([
          {
            messageId: 'msg-1',
            agentId: 'agent-1',
            role: 'user',
            content: 'Hello',
            timestamp: Date.now(),
            createdAt: Date.now()
          }
        ])
      };
      db.getDatabase().prepare.mockReturnValue(mockStmt);

      const messages = repository.getMessagesByAgentId('agent-1', 20, 0);

      expect(mockStmt.all).toHaveBeenCalledWith('agent-1', 20, 0);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('msg-1');
    });

    it('should return empty array when no messages', () => {
      const db = require('../../src/stratix-database/StratixDatabase').getDatabase();
      const mockStmt = {
        all: jest.fn().mockReturnValue([])
      };
      db.getDatabase().prepare.mockReturnValue(mockStmt);

      const messages = repository.getMessagesByAgentId('agent-1', 20, 0);

      expect(messages).toHaveLength(0);
    });
  });

  describe('searchMessages', () => {
    it('should return empty array for empty keywords', () => {
      const messages = repository.searchMessages('agent-1', [], 10);
      expect(messages).toEqual([]);
    });

    it('should build correct SQL with keywords', () => {
      const db = require('../../src/stratix-database/StratixDatabase').getDatabase();
      const mockStmt = {
        all: jest.fn().mockReturnValue([])
      };
      db.getDatabase().prepare.mockReturnValue(mockStmt);

      repository.searchMessages('agent-1', ['hello', 'world'], 10);

      expect(mockStmt.all).toHaveBeenCalledWith(
        'agent-1',
        '%hello%',
        '%world%',
        10
      );
    });
  });

  describe('deleteMessagesByAgentId', () => {
    it('should execute delete SQL', () => {
      const db = require('../../src/stratix-database/StratixDatabase').getDatabase();
      const mockStmt = {
        run: jest.fn()
      };
      db.getDatabase().prepare.mockReturnValue(mockStmt);

      repository.deleteMessagesByAgentId('agent-1');

      expect(mockStmt.run).toHaveBeenCalledWith('agent-1');
    });
  });
});
