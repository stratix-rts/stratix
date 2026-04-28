/**
 * ZoneMessageService Unit Tests
 */

import { ZoneMessageService } from '../../../src/stratix-gateway/project/ZoneMessageService';
import { Zone, ZoneMessage } from '../../../src/stratix-project/types';

jest.mock('../../../src/stratix-database/ZoneRepository');
jest.mock('../../../src/stratix-gateway/GatewayEventBus');

import { zoneRepository } from '../../../src/stratix-database/ZoneRepository';
import { gatewayEventBus } from '../../../src/stratix-gateway/GatewayEventBus';

const MockedZoneRepository = zoneRepository as jest.Mocked<typeof zoneRepository>;
const MockedGatewayEventBus = gatewayEventBus as jest.Mocked<typeof gatewayEventBus>;

const mockZone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-test-1',
  projectId: 'proj-1',
  title: 'Test Zone',
  prompt: 'Test prompt',
  members: [],
  files: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const mockMessage = (overrides: Partial<ZoneMessage> = {}): ZoneMessage => ({
  id: 'msg-1',
  zoneId: 'zone-test-1',
  senderId: 'agent-1',
  senderType: 'agent',
  content: 'Hello',
  createdAt: Date.now(),
  ...overrides,
});

describe('ZoneMessageService', () => {
  let service: ZoneMessageService;
  let mockCheckPermission: jest.Mock;
  let mockEnsureInitialized: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    mockCheckPermission = jest.fn();
    mockEnsureInitialized = jest.fn().mockResolvedValue(undefined);

    service = new ZoneMessageService(mockCheckPermission, mockEnsureInitialized);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================
  // getMessages
  // ============================================
  describe('getMessages', () => {
    it('should return messages for a zone', async () => {
      const messages = [mockMessage(), mockMessage({ id: 'msg-2' })];
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getMessages.mockReturnValue(messages);

      const result = await service.getMessages('zone-1', 50, 0);

      expect(mockEnsureInitialized).toHaveBeenCalled();
      expect(MockedZoneRepository.getZone).toHaveBeenCalledWith('zone-1');
      expect(MockedZoneRepository.getMessages).toHaveBeenCalledWith('zone-1', 50, 0);
      expect(result).toEqual(messages);
    });

    it('should use default limit and offset', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getMessages.mockReturnValue([]);

      await service.getMessages('zone-1');

      expect(MockedZoneRepository.getMessages).toHaveBeenCalledWith('zone-1', 100, 0);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getMessages('zone-1')).rejects.toThrow('Zone not found: zone-1');
    });
  });

  // ============================================
  // getMessagesCount
  // ============================================
  describe('getMessagesCount', () => {
    it('should return message count for a zone', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getMessagesCount.mockReturnValue(42);

      const result = await service.getMessagesCount('zone-1');

      expect(MockedZoneRepository.getMessagesCount).toHaveBeenCalledWith('zone-1');
      expect(result).toBe(42);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getMessagesCount('zone-1')).rejects.toThrow('Zone not found: zone-1');
    });
  });

  // ============================================
  // addMessage
  // ============================================
  describe('addMessage', () => {
    it('should add message and publish event', async () => {
      const zone = mockZone();
      const message = mockMessage();
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.addMessage.mockReturnValue(message);

      const result = await service.addMessage('zone-1', 'agent-1', 'agent', 'Hello world');

      expect(mockCheckPermission).toHaveBeenCalledWith('add_message', 'zone:zone-1', 'agent-1');
      expect(MockedZoneRepository.addMessage).toHaveBeenCalledWith('zone-1', 'agent-1', 'agent', 'Hello world');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:message_added',
        'zone-1',
        'zone-test-1',
        { message }
      );
      expect(result).toEqual(message);
    });

    it('should add message from user sender', async () => {
      const message = mockMessage({ senderType: 'user', senderId: 'user-1' });
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.addMessage.mockReturnValue(message);

      const result = await service.addMessage('zone-1', 'user-1', 'user', 'User message');

      expect(MockedZoneRepository.addMessage).toHaveBeenCalledWith('zone-1', 'user-1', 'user', 'User message');
      expect(result.senderType).toBe('user');
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.addMessage('zone-1', 'agent-1', 'agent', 'Hello')).rejects.toThrow('Zone not found: zone-1');
    });

    it('should throw when permission denied', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.addMessage('zone-1', 'agent-1', 'agent', 'Hello')).rejects.toThrow('Permission denied');
    });
  });

  // ============================================
  // Pagination
  // ============================================
  describe('pagination', () => {
    it('should paginate messages correctly', async () => {
      const page1 = [mockMessage({ id: 'msg-1' }), mockMessage({ id: 'msg-2' })];
      const page2 = [mockMessage({ id: 'msg-3' })];

      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getMessages.mockReturnValueOnce(page1).mockReturnValueOnce(page2);

      const result1 = await service.getMessages('zone-1', 2, 0);
      const result2 = await service.getMessages('zone-1', 2, 2);

      expect(MockedZoneRepository.getMessages).toHaveBeenNthCalledWith(1, 'zone-1', 2, 0);
      expect(MockedZoneRepository.getMessages).toHaveBeenNthCalledWith(2, 'zone-1', 2, 2);
      expect(result1).toHaveLength(2);
      expect(result2).toHaveLength(1);
    });

    it('should return empty array when no messages', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getMessages.mockReturnValue([]);

      const result = await service.getMessages('zone-1');

      expect(result).toEqual([]);
    });
  });
});
