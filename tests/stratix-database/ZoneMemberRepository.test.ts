/**
 * ZoneMemberRepository Unit Tests
 *
 * Tests ZoneMemberRepository CRUD operations with mocked database.
 */

import { ZoneMemberRepository, ZoneMemberRole } from '../../src/stratix-database/ZoneMemberRepository';
import { createMockDatabase, createMockStatement, createMockZoneMemberRow } from './helpers/mockDatabase';

jest.mock('../../src/stratix-database/StratixDatabase', () => ({
  getDatabase: jest.fn()
}));

import { getDatabase } from '../../src/stratix-database/StratixDatabase';

describe('ZoneMemberRepository', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let repository: ZoneMemberRepository;

  beforeEach(() => {
    mockDb = createMockDatabase();
    (getDatabase as jest.Mock).mockReturnValue({
      getDatabase: () => mockDb
    });
    repository = new ZoneMemberRepository();
    jest.clearAllMocks();
  });

  describe('addMember', () => {
    it('should return null when member already exists and is active', () => {
      const existingMember = createMockZoneMemberRow();
      const mockStmt = createMockStatement('SELECT...', { returns: existingMember });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addMember('zone-1', 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-1');
    });

    it('should add new member when none exists', () => {
      const mockSelectStmt = createMockStatement('SELECT...', { returns: undefined });
      const mockInsertStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockInsertStmt);

      const result = repository.addMember('zone-1', 'agent-1', 'executor');

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-1');
      expect(result!.role).toBe('executor');
    });

    it('should add member with coordinator role', () => {
      const mockSelectStmt = createMockStatement('SELECT...', { returns: undefined });
      const mockInsertStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockInsertStmt);

      const result = repository.addMember('zone-1', 'agent-1', 'coordinator');

      expect(result).not.toBeNull();
      expect(result!.role).toBe('coordinator');
    });
  });

  describe('removeMember', () => {
    it('should return false when member does not exist', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.removeMember('zone-1', 'agent-1');

      expect(result).toBe(false);
    });

    it('should return true when member is removed', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.removeMember('zone-1', 'agent-1');

      expect(result).toBe(true);
    });
  });

  describe('getMembers', () => {
    it('should return empty array when no members', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMembers('zone-1');

      expect(result).toEqual([]);
    });

    it('should return all active members', () => {
      const members = [
        createMockZoneMemberRow({ agent_id: 'agent-1', role: 'coordinator' }),
        createMockZoneMemberRow({ agent_id: 'agent-2', role: 'executor' })
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: members });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMembers('zone-1');

      expect(result).toHaveLength(2);
      expect(result[0].agentId).toBe('agent-1');
      expect(result[1].agentId).toBe('agent-2');
    });

    it('should parse member role correctly', () => {
      const member = createMockZoneMemberRow({ role: 'coordinator' });
      const mockStmt = createMockStatement('SELECT...', { returns: [member] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMembers('zone-1');

      expect(result[0].role).toBe('coordinator');
    });
  });

  describe('getMember', () => {
    it('should return null when member not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMember('zone-1', 'agent-1');

      expect(result).toBeNull();
    });

    it('should return member when found', () => {
      const member = createMockZoneMemberRow({ agent_id: 'agent-1' });
      const mockStmt = createMockStatement('SELECT...', { returns: member });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMember('zone-1', 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-1');
    });
  });

  describe('updateRole', () => {
    it('should return null when member not found', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.updateRole('zone-1', 'agent-1', 'coordinator');

      expect(result).toBeNull();
    });

    it('should update role and return member', () => {
      const mockUpdateStmt = createMockStatement('UPDATE...', { changes: 1 });
      const updatedMember = createMockZoneMemberRow({ role: 'coordinator' });
      const mockSelectStmt = createMockStatement('SELECT...', { returns: updatedMember });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) return mockSelectStmt;
        return mockUpdateStmt;
      });

      const result = repository.updateRole('zone-1', 'agent-1', 'coordinator');

      expect(result).not.toBeNull();
      expect(result!.role).toBe('coordinator');
    });
  });

  describe('getMembersByAgent', () => {
    it('should return empty array when agent is not in any zone', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMembersByAgent('agent-1');

      expect(result).toEqual([]);
    });

    it('should return all zones agent is currently in', () => {
      const memberships = [
        createMockZoneMemberRow({ zone_id: 'zone-1', agent_id: 'agent-1' }),
        createMockZoneMemberRow({ zone_id: 'zone-2', agent_id: 'agent-1' })
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: memberships });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMembersByAgent('agent-1');

      expect(result).toHaveLength(2);
      expect(result[0].zoneId).toBe('zone-1');
      expect(result[1].zoneId).toBe('zone-2');
    });
  });

  describe('getCoordinators', () => {
    it('should return empty array when no coordinators', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getCoordinators('zone-1');

      expect(result).toEqual([]);
    });

    it('should return all coordinators in zone', () => {
      const coordinators = [
        createMockZoneMemberRow({ agent_id: 'agent-1', role: 'coordinator' }),
        createMockZoneMemberRow({ agent_id: 'agent-2', role: 'coordinator' })
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: coordinators });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getCoordinators('zone-1');

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('coordinator');
    });
  });

  describe('getExecutors', () => {
    it('should return empty array when no executors', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getExecutors('zone-1');

      expect(result).toEqual([]);
    });

    it('should return all executors in zone', () => {
      const executors = [
        createMockZoneMemberRow({ agent_id: 'agent-1', role: 'executor' }),
        createMockZoneMemberRow({ agent_id: 'agent-2', role: 'executor' })
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: executors });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getExecutors('zone-1');

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('executor');
    });
  });

  describe('ZoneMember data mapping', () => {
    it('should map row to ZoneMember correctly', () => {
      const row = createMockZoneMemberRow({
        id: 'zmem-1',
        zone_id: 'zone-1',
        agent_id: 'agent-1',
        role: 'executor',
        entered_at: 1234567890,
        left_at: null
      });
      const mockStmt = createMockStatement('SELECT...', { returns: row });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMember('zone-1', 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('zmem-1');
      expect(result!.zoneId).toBe('zone-1');
      expect(result!.agentId).toBe('agent-1');
      expect(result!.role).toBe('executor');
      expect(result!.enteredAt).toBe(1234567890);
      expect(result!.leftAt).toBeNull();
    });

    it('should handle member with left_at timestamp', () => {
      const row = createMockZoneMemberRow({
        left_at: 1234567900
      });
      const mockStmt = createMockStatement('SELECT...', { returns: row });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMember('zone-1', 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.leftAt).toBe(1234567900);
    });
  });

  describe('ZoneMemberRole validation', () => {
    it('should accept valid roles', () => {
      const validRoles: ZoneMemberRole[] = ['coordinator', 'executor'];

      expect(validRoles).toContain('coordinator');
      expect(validRoles).toContain('executor');
    });
  });

  describe('SQL statement verification', () => {
    it('should use INSERT with NULL for left_at', () => {
      // First call is SELECT (getMember), second is INSERT
      let callCount = 0;
      mockDb.prepare.mockImplementation((sql: string) => {
        callCount++;
        if (sql.includes('SELECT')) {
          return createMockStatement(sql, { returns: undefined });
        }
        return createMockStatement(sql, { changes: 1 });
      });

      repository.addMember('zone-1', 'agent-1');

      // Verify INSERT was called (second call)
      expect(mockDb.prepare).toHaveBeenCalled();
      // Find INSERT call
      const insertCall = mockDb.prepare.mock.calls.find((call: any[]) => call[0].includes('INSERT'));
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain('INSERT INTO zone_members');
      expect(insertCall![0]).toContain('NULL'); // left_at should be NULL for new member
    });

    it('should use UPDATE with left_at for removal', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.removeMember('zone-1', 'agent-1');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('UPDATE zone_members');
      expect(sqlArg).toContain('left_at = ?');
    });

    it('should filter by left_at IS NULL for active members', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.getMembers('zone-1');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('left_at IS NULL');
    });

    it('should filter by role for coordinators query', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.getCoordinators('zone-1');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain("role = 'coordinator'");
    });

    it('should order by entered_at ASC for zone members', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.getMembers('zone-1');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('ORDER BY entered_at ASC');
    });

    it('should order by entered_at DESC for agent zones', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.getMembersByAgent('agent-1');

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('ORDER BY entered_at DESC');
    });
  });
});
