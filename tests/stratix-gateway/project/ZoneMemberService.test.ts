/**
 * ZoneMemberService Unit Tests
 */

import { ZoneMemberService } from '../../../src/stratix-gateway/project/ZoneMemberService';
import { Zone } from '../../../src/stratix-project/types';

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

describe('ZoneMemberService', () => {
  let service: ZoneMemberService;
  let mockCheckPermission: jest.Mock;
  let mockSyncZoneToStore: jest.Mock;
  let mockEnsureInitialized: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    mockCheckPermission = jest.fn();
    mockSyncZoneToStore = jest.fn();
    mockEnsureInitialized = jest.fn().mockResolvedValue(undefined);

    service = new ZoneMemberService(
      mockCheckPermission,
      mockSyncZoneToStore,
      mockEnsureInitialized
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================
  // addMember
  // ============================================
  describe('addMember', () => {
    it('should add agent to zone and publish event', async () => {
      const zone = mockZone({ members: ['agent-1'] });
      MockedZoneRepository.addMember.mockReturnValue(zone);
      MockedGatewayEventBus.publishZoneEvent.mockReturnValue(undefined);

      const result = await service.addMember('zone-1', 'agent-1', 'requester-1');

      expect(mockEnsureInitialized).toHaveBeenCalled();
      expect(mockCheckPermission).toHaveBeenCalledWith('add_member', 'zone:zone-1', 'requester-1');
      expect(MockedZoneRepository.addMember).toHaveBeenCalledWith('zone-1', 'agent-1');
      expect(mockSyncZoneToStore).toHaveBeenCalledWith(zone);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:member_joined',
        'zone-1',
        'proj-1',
        { agentId: 'agent-1' }
      );
      expect(result).toEqual(zone);
    });

    it('should use default requesterId when not provided', async () => {
      const zone = mockZone({ members: ['agent-1'] });
      MockedZoneRepository.addMember.mockReturnValue(zone);

      await service.addMember('zone-1', 'agent-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('add_member', 'zone:zone-1', 'system');
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.addMember.mockReturnValue(null);

      await expect(service.addMember('zone-1', 'agent-1')).rejects.toThrow('Zone not found: zone-1');
    });

    it('should throw when permission denied', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.addMember('zone-1', 'agent-1')).rejects.toThrow('Permission denied');
      expect(MockedZoneRepository.addMember).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // removeMember
  // ============================================
  describe('removeMember', () => {
    it('should remove agent from zone and publish event', async () => {
      const zone = mockZone({ members: [] });
      MockedZoneRepository.removeMember.mockReturnValue(zone);

      const result = await service.removeMember('zone-1', 'agent-1', 'requester-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('remove_member', 'zone:zone-1', 'requester-1');
      expect(MockedZoneRepository.removeMember).toHaveBeenCalledWith('zone-1', 'agent-1');
      expect(mockSyncZoneToStore).toHaveBeenCalledWith(zone);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:member_left',
        'zone-1',
        'proj-1',
        { agentId: 'agent-1' }
      );
      expect(result).toEqual(zone);
    });

    it('should throw when zone not found on remove', async () => {
      MockedZoneRepository.removeMember.mockReturnValue(null);

      await expect(service.removeMember('zone-1', 'agent-1')).rejects.toThrow('Zone not found: zone-1');
    });

    it('should throw when permission denied on remove', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.removeMember('zone-1', 'agent-1')).rejects.toThrow('Permission denied');
    });
  });

  // ============================================
  // addMembers
  // ============================================
  describe('addMembers', () => {
    it('should add multiple agents and publish events for each', async () => {
      const zone = mockZone({ members: ['agent-1', 'agent-2'] });
      MockedZoneRepository.addMembers.mockReturnValue(zone);

      const result = await service.addMembers('zone-1', ['agent-1', 'agent-2'], 'requester-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('add_members', 'zone:zone-1', 'requester-1');
      expect(MockedZoneRepository.addMembers).toHaveBeenCalledWith('zone-1', ['agent-1', 'agent-2']);
      expect(mockSyncZoneToStore).toHaveBeenCalledWith(zone);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(2);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenNthCalledWith(
        1,
        'zone:member_joined',
        'zone-1',
        'proj-1',
        { agentId: 'agent-1' }
      );
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenNthCalledWith(
        2,
        'zone:member_joined',
        'zone-1',
        'proj-1',
        { agentId: 'agent-2' }
      );
      expect(result).toEqual(zone);
    });

    it('should throw when zone not found on batch add', async () => {
      MockedZoneRepository.addMembers.mockReturnValue(null);

      await expect(service.addMembers('zone-1', ['agent-1'])).rejects.toThrow('Zone not found: zone-1');
    });

    it('should throw when permission denied on batch add', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.addMembers('zone-1', ['agent-1'])).rejects.toThrow('Permission denied');
    });
  });

  // ============================================
  // removeMembers
  // ============================================
  describe('removeMembers', () => {
    it('should remove multiple agents and publish events for each', async () => {
      const zone = mockZone({ members: [] });
      MockedZoneRepository.removeMembers.mockReturnValue(zone);

      const result = await service.removeMembers('zone-1', ['agent-1', 'agent-2'], 'requester-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('remove_members', 'zone:zone-1', 'requester-1');
      expect(MockedZoneRepository.removeMembers).toHaveBeenCalledWith('zone-1', ['agent-1', 'agent-2']);
      expect(mockSyncZoneToStore).toHaveBeenCalledWith(zone);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(2);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenNthCalledWith(
        1,
        'zone:member_left',
        'zone-1',
        'proj-1',
        { agentId: 'agent-1' }
      );
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenNthCalledWith(
        2,
        'zone:member_left',
        'zone-1',
        'proj-1',
        { agentId: 'agent-2' }
      );
      expect(result).toEqual(zone);
    });

    it('should throw when zone not found on batch remove', async () => {
      MockedZoneRepository.removeMembers.mockReturnValue(null);

      await expect(service.removeMembers('zone-1', ['agent-1'])).rejects.toThrow('Zone not found: zone-1');
    });

    it('should throw when permission denied on batch remove', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.removeMembers('zone-1', ['agent-1'])).rejects.toThrow('Permission denied');
    });
  });
});
