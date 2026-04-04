/**
 * ZoneRepository Unit Tests
 *
 * Tests ZoneRepository CRUD operations with mocked database.
 */

import { ZoneRepository } from '../../src/stratix-database/ZoneRepository';
import { createMockDatabase, createMockStatement, createMockZoneRow, createMockZoneFileRow } from './helpers/mockDatabase';

jest.mock('../../src/stratix-database/StratixDatabase', () => ({
  getDatabase: jest.fn()
}));

import { getDatabase } from '../../src/stratix-database/StratixDatabase';

describe('ZoneRepository', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let repository: ZoneRepository;

  beforeEach(() => {
    mockDb = createMockDatabase();
    (getDatabase as jest.Mock).mockReturnValue({
      getDatabase: () => mockDb
    });
    repository = new ZoneRepository();
    jest.clearAllMocks();
  });

  describe('getZonesByProject', () => {
    it('should return empty array when no zones exist', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZonesByProject('proj-1');

      expect(result).toEqual([]);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should return zones with files', () => {
      const zoneRow = createMockZoneRow({ zone_id: 'zone-1', title: 'Test Zone' });
      const fileRow = createMockZoneFileRow({ file_id: 'file-1', zone_id: 'zone-1' });

      const zoneStmt = createMockStatement('SELECT...', { returns: [zoneRow] });
      const filesStmt = createMockStatement('SELECT...', { returns: [fileRow] });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('zone_contexts')) return zoneStmt;
        if (sql.includes('zone_files') && sql.includes('IN')) return filesStmt;
        return createMockStatement(sql, { returns: [fileRow] });
      });

      const result = repository.getZonesByProject('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('zone-1');
      expect(result[0].title).toBe('Test Zone');
    });

    it('should return zones with parsed members and presentAgentIds', () => {
      const zoneRow = createMockZoneRow({
        members: '["agent-1","agent-2"]',
        present_agent_ids: '["agent-1"]'
      });

      const zoneStmt = createMockStatement('SELECT...', { returns: [zoneRow] });
      mockDb.prepare.mockReturnValue(zoneStmt);

      const result = repository.getZonesByProject('proj-1');

      expect(result[0].members).toEqual(['agent-1', 'agent-2']);
      expect(result[0].presentAgentIds).toEqual(['agent-1']);
    });
  });

  describe('getZone', () => {
    it('should return null when zone not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZone('non-existent');

      expect(result).toBeNull();
    });

    it('should return zone when found', () => {
      const zoneRow = createMockZoneRow({ zone_id: 'zone-1', title: 'Found Zone' });
      const mockStmt = createMockStatement('SELECT...', { returns: zoneRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZone('zone-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('zone-1');
      expect(result!.title).toBe('Found Zone');
    });

    it('should handle malformed JSON in members', () => {
      const zoneRow = createMockZoneRow({
        members: 'invalid-json',
        present_agent_ids: 'also-invalid'
      });
      const mockStmt = createMockStatement('SELECT...', { returns: zoneRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZone('zone-1');

      expect(result).not.toBeNull();
      expect(result!.members).toEqual([]);
      expect(result!.presentAgentIds).toEqual([]);
    });
  });

  describe('createZone', () => {
    it('should create zone with INSERT and return created zone', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.createZone('proj-1', 'New Zone', 'Test prompt');

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^zone_/);
      expect(result.projectId).toBe('proj-1');
      expect(result.title).toBe('New Zone');
      expect(result.prompt).toBe('Test prompt');
      expect(result.members).toEqual([]);
      expect(result.files).toEqual([]);
    });

    it('should use empty string as default prompt', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.createZone('proj-1', 'Zone Title');

      expect(result.prompt).toBe('');
    });
  });

  describe('updateZone', () => {
    it('should return null when zone does not exist', () => {
      const mockGetStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockGetStmt);

      const result = repository.updateZone('non-existent', { title: 'New Title' });

      expect(result).toBeNull();
    });

    it('should update zone title', () => {
      const existingZone = createMockZoneRow({ zone_id: 'zone-1', title: 'Old Title' });
      const updatedZone = createMockZoneRow({ zone_id: 'zone-1', title: 'New Title' });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('zone_id = ?')) {
          return createMockStatement(sql, { returns: existingZone });
        }
        return createMockStatement(sql, { returns: updatedZone });
      });

      const result = repository.updateZone('zone-1', { title: 'New Title' });

      expect(result).not.toBeNull();
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it('should update members array', () => {
      const existingZone = createMockZoneRow({
        members: '["agent-1"]'
      });
      const updatedZone = createMockZoneRow({
        members: '["agent-1","agent-2"]'
      });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('zone_id = ?')) {
          return createMockStatement(sql, { returns: existingZone });
        }
        return createMockStatement(sql, { returns: updatedZone });
      });

      const result = repository.updateZone('zone-1', {
        members: ['agent-1', 'agent-2']
      });

      expect(result).not.toBeNull();
    });

    it('should update presentAgentIds separately', () => {
      const existingZone = createMockZoneRow();
      const updatedZone = createMockZoneRow({ present_agent_ids: '["agent-2"]' });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('zone_id = ?')) {
          return createMockStatement(sql, { returns: existingZone });
        }
        return createMockStatement(sql, { returns: updatedZone });
      });

      const result = repository.updateZone('zone-1', {
        presentAgentIds: ['agent-2']
      });

      expect(result).not.toBeNull();
    });
  });

  describe('deleteZone (soft delete)', () => {
    it('should return false when zone does not exist', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteZone('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when zone is deleted', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteZone('zone-1');

      expect(result).toBe(true);
    });
  });

  describe('getDeletedZones', () => {
    it('should return empty array when no deleted zones', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getDeletedZones('proj-1');

      expect(result).toEqual([]);
    });

    it('should return deleted zones', () => {
      const deletedZone = createMockZoneRow({
        zone_id: 'zone-deleted',
        deleted_at: 1234567890
      });
      const mockStmt = createMockStatement('SELECT...', { returns: [deletedZone] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getDeletedZones('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('zone-deleted');
    });
  });

  describe('restoreZone', () => {
    it('should return null when zone not found', () => {
      const mockStmt = createMockStatement('UPDATE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.restoreZone('non-existent');

      expect(result).toBeNull();
    });

    it('should return restored zone', () => {
      const mockUpdateStmt = createMockStatement('UPDATE...', { changes: 1 });
      const restoredZone = createMockZoneRow({ zone_id: 'zone-1' });
      const mockSelectStmt = createMockStatement('SELECT...', { returns: restoredZone });

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) return mockSelectStmt;
        return mockUpdateStmt;
      });

      const result = repository.restoreZone('zone-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('zone-1');
    });
  });

  describe('permanentlyDeleteZone', () => {
    it('should return false when zone does not exist', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.permanentlyDeleteZone('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when zone is deleted', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.permanentlyDeleteZone('zone-1');

      expect(result).toBe(true);
    });
  });

  describe('searchZones', () => {
    it('should return empty array when no matches', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchZones('nonexistent');

      expect(result).toEqual([]);
    });

    it('should return matching zones', () => {
      const matchingZone = createMockZoneRow({ title: 'Marketing Zone' });
      const mockStmt = createMockStatement('SELECT...', { returns: [matchingZone] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchZones('marketing');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Marketing Zone');
    });

    it('should respect limit parameter', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.searchZones('test', 5);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('LIMIT ?');
    });
  });

  describe('addMember', () => {
    it('should return null when zone does not exist', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addMember('non-existent', 'agent-1');

      expect(result).toBeNull();
    });

    it('should not add duplicate member', () => {
      const existingZone = createMockZoneRow({
        members: '["agent-1"]',
        present_agent_ids: '["agent-1"]'
      });
      const mockStmt = createMockStatement('SELECT...', { returns: existingZone });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addMember('zone-1', 'agent-1');

      expect(result).not.toBeNull();
    });
  });

  describe('removeMember', () => {
    it('should return null when zone does not exist', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.removeMember('non-existent', 'agent-1');

      expect(result).toBeNull();
    });
  });

  describe('addMembers (bulk)', () => {
    it('should return null when zone does not exist', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addMembers('non-existent', ['agent-1', 'agent-2']);

      expect(result).toBeNull();
    });
  });

  describe('removeMembers (bulk)', () => {
    it('should return null when zone does not exist', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.removeMembers('non-existent', ['agent-1']);

      expect(result).toBeNull();
    });
  });

  describe('getFilesByZone', () => {
    it('should return empty array when no files', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFilesByZone('zone-1');

      expect(result).toEqual([]);
    });

    it('should return files', () => {
      const fileRow = createMockZoneFileRow();
      const mockStmt = createMockStatement('SELECT...', { returns: [fileRow] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFilesByZone('zone-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-1');
    });
  });

  describe('getFilesBatch', () => {
    it('should return empty map for empty input', () => {
      const result = repository.getFilesBatch([]);

      expect(result.size).toBe(0);
    });

    it('should batch load files for multiple zones', () => {
      const files = [
        createMockZoneFileRow({ file_id: 'file-1', zone_id: 'zone-1' }),
        createMockZoneFileRow({ file_id: 'file-2', zone_id: 'zone-2' })
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: files });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFilesBatch(['zone-1', 'zone-2']);

      expect(result.size).toBe(2);
    });
  });

  describe('getFile', () => {
    it('should return null when file not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFile('non-existent');

      expect(result).toBeNull();
    });

    it('should return file when found', () => {
      const fileRow = createMockZoneFileRow();
      const mockStmt = createMockStatement('SELECT...', { returns: fileRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFile('file-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('file-1');
    });
  });

  describe('searchFiles', () => {
    it('should return empty array when no matches', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchFiles('zone-1', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('should search by name', () => {
      const fileRow = createMockZoneFileRow({ name: 'readme.md' });
      const mockStmt = createMockStatement('SELECT...', { returns: [fileRow] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchFiles('zone-1', 'readme');

      expect(result).toHaveLength(1);
    });

    it('should search by content in text files', () => {
      const fileRow = createMockZoneFileRow({
        name: 'test.md',
        content: 'Hello world',
        file_type: 'md'
      });
      const mockStmt = createMockStatement('SELECT...', { returns: [fileRow] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchFiles('zone-1', 'hello');

      expect(result).toHaveLength(1);
    });

    it('should not search content in non-text files', () => {
      const fileRow = createMockZoneFileRow({
        name: 'image.png',
        content: 'binary data',
        file_type: 'image'
      });
      const mockStmt = createMockStatement('SELECT...', { returns: [fileRow] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.searchFiles('zone-1', 'binary');

      expect(result).toHaveLength(0);
    });
  });

  describe('addFile', () => {
    it('should add file and return created file', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addFile(
        'zone-1',
        'test.md',
        'local',
        '/path/to/test.md',
        'md',
        { version: 1 }
      );

      expect(result.id).toMatch(/^zf_/);
      expect(result.zoneId).toBe('zone-1');
      expect(result.name).toBe('test.md');
      expect(result.fileType).toBe('md');
    });

    it('should handle file without fileType', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addFile(
        'zone-1',
        'test.txt',
        'url',
        'http://example.com/test.txt'
      );

      expect(result.fileType).toBeUndefined();
    });
  });

  describe('updateFile', () => {
    it('should return null when file not found', () => {
      const mockGetStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockGetStmt);

      const result = repository.updateFile('non-existent', { content: 'new content' });

      expect(result).toBeNull();
    });

    it('should update file content', () => {
      const existingFile = createMockZoneFileRow();
      const updatedFile = { ...existingFile, content: 'updated content' };

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) {
          return createMockStatement(sql, { returns: existingFile });
        }
        return createMockStatement(sql, { returns: updatedFile });
      });

      const result = repository.updateFile('file-1', { content: 'updated content' });

      expect(result).not.toBeNull();
    });
  });

  describe('deleteFile', () => {
    it('should return false when file not found', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteFile('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when file deleted', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteFile('file-1');

      expect(result).toBe(true);
    });
  });

  describe('getFileVersions', () => {
    it('should return null when file not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFileVersions('non-existent');

      expect(result).toBeNull();
    });

    it('should return versions from metadata', () => {
      const fileRow = createMockZoneFileRow({
        metadata: JSON.stringify({
          versions: [
            { id: 'v1', content: 'Version 1', createdAt: 1000 }
          ],
          currentVersionId: 'v1'
        })
      });
      const mockStmt = createMockStatement('SELECT...', { returns: fileRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getFileVersions('file-1');

      expect(result).not.toBeNull();
      expect(result!.versions).toHaveLength(1);
      expect(result!.currentVersionId).toBe('v1');
    });
  });

  describe('addFileVersion', () => {
    it('should return null when file not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addFileVersion('non-existent', 'new content');

      expect(result).toBeNull();
    });

    it('should add new version', () => {
      const existingFile = createMockZoneFileRow();
      const updatedFile = {
        ...existingFile,
        metadata: JSON.stringify({
          versions: [{ id: 'v1', content: 'content', createdAt: 1000 }],
          currentVersionId: 'v1'
        })
      };

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) {
          return createMockStatement(sql, { returns: existingFile });
        }
        return createMockStatement(sql, { returns: updatedFile });
      });

      const result = repository.addFileVersion('file-1', 'new content', 'Update description');

      expect(result).not.toBeNull();
    });

    it('should limit versions to 10', () => {
      const existingFile = createMockZoneFileRow({
        metadata: JSON.stringify({
          versions: Array.from({ length: 10 }, (_, i) => ({
            id: `v${i}`,
            content: `Version ${i}`,
            createdAt: i * 1000
          })),
          currentVersionId: 'v9'
        })
      });
      const updatedFile = { ...existingFile };

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) {
          return createMockStatement(sql, { returns: existingFile });
        }
        return createMockStatement(sql, { returns: updatedFile });
      });

      const result = repository.addFileVersion('file-1', 'new content');

      expect(result).not.toBeNull();
    });
  });

  describe('rollbackFileToVersion', () => {
    it('should return null when file not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.rollbackFileToVersion('non-existent', 'v1');

      expect(result).toBeNull();
    });

    it('should return null when version not found', () => {
      const fileRow = createMockZoneFileRow({
        metadata: JSON.stringify({ versions: [] })
      });
      const mockStmt = createMockStatement('SELECT...', { returns: fileRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.rollbackFileToVersion('file-1', 'non-existent');

      expect(result).toBeNull();
    });

    it('should rollback to target version', () => {
      const fileRow = createMockZoneFileRow({
        content: 'current content',
        metadata: JSON.stringify({
          versions: [
            { id: 'v1', content: 'Version 1', createdAt: 1000 },
            { id: 'v2', content: 'Version 2', createdAt: 2000 }
          ],
          currentVersionId: 'v2'
        })
      });
      const updatedFile = { ...fileRow, content: 'Version 1' };

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('file_id = ?')) {
          return createMockStatement(sql, { returns: fileRow });
        }
        return createMockStatement(sql, { returns: updatedFile });
      });

      const result = repository.rollbackFileToVersion('file-1', 'v1');

      expect(result).not.toBeNull();
    });
  });

  describe('getTasks', () => {
    it('should return empty array when no tasks', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getTasks('zone-1');

      expect(result).toEqual([]);
    });

    it('should respect limit and offset', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      repository.getTasks('zone-1', 10, 5);

      expect(mockDb.prepare).toHaveBeenCalled();
      const sqlArg = mockDb.prepare.mock.calls[0][0];
      expect(sqlArg).toContain('LIMIT ?');
      expect(sqlArg).toContain('OFFSET ?');
    });
  });

  describe('getTasksCount', () => {
    it('should return count', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: { count: 5 } });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getTasksCount('zone-1');

      expect(result).toBe(5);
    });

    it('should return 0 when no tasks', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: { count: 0 } });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getTasksCount('zone-1');

      expect(result).toBe(0);
    });
  });

  describe('getTask', () => {
    it('should return null when task not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getTask('non-existent');

      expect(result).toBeNull();
    });

    it('should return task when found', () => {
      const taskRow = {
        task_id: 'task-1',
        zone_id: 'zone-1',
        title: 'Test Task',
        status: 'pending',
        assignee: null,
        created_by: 'agent-1',
        created_at: 1234567890,
        updated_at: 1234567890
      };
      const mockStmt = createMockStatement('SELECT...', { returns: taskRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getTask('task-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('task-1');
      expect(result!.title).toBe('Test Task');
    });
  });

  describe('createTask', () => {
    it('should create task and return it', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.createTask('zone-1', 'New Task', 'agent-1');

      expect(result.id).toMatch(/^task_/);
      expect(result.zoneId).toBe('zone-1');
      expect(result.title).toBe('New Task');
      expect(result.status).toBe('pending');
      expect(result.assignee).toBeNull();
    });
  });

  describe('updateTask', () => {
    it('should return null when task not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.updateTask('non-existent', { status: 'done' });

      expect(result).toBeNull();
    });

    it('should update task status', () => {
      const existingTask = {
        task_id: 'task-1',
        zone_id: 'zone-1',
        title: 'Test Task',
        status: 'pending',
        assignee: null,
        created_by: 'agent-1',
        created_at: 1234567890,
        updated_at: 1234567890
      };
      const updatedTask = { ...existingTask, status: 'done' };

      // Track call count to return different values for SELECT calls
      let selectCallCount = 0;
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('SELECT')) {
          selectCallCount++;
          return createMockStatement(sql, { returns: selectCallCount === 1 ? existingTask : updatedTask });
        }
        return createMockStatement(sql, { returns: updatedTask });
      });

      const result = repository.updateTask('task-1', { status: 'done' });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('done');
    });
  });

  describe('deleteTask', () => {
    it('should return false when task not found', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 0 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteTask('non-existent');

      expect(result).toBe(false);
    });

    it('should return true when task deleted', () => {
      const mockStmt = createMockStatement('DELETE...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.deleteTask('task-1');

      expect(result).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('should return empty array when no messages', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: [] });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMessages('zone-1');

      expect(result).toEqual([]);
    });

    it('should return messages in ASC order', () => {
      const messages = [
        { message_id: 'msg-1', zone_id: 'zone-1', sender_id: 'agent-1', sender_type: 'agent', content: 'Hello', created_at: 1000 },
        { message_id: 'msg-2', zone_id: 'zone-1', sender_id: 'user-1', sender_type: 'user', content: 'Hi', created_at: 2000 }
      ];
      const mockStmt = createMockStatement('SELECT...', { returns: messages });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMessages('zone-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
    });
  });

  describe('getMessagesCount', () => {
    it('should return count', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: { count: 10 } });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getMessagesCount('zone-1');

      expect(result).toBe(10);
    });
  });

  describe('addMessage', () => {
    it('should add message and return it', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.addMessage('zone-1', 'agent-1', 'agent', 'Hello world');

      expect(result.id).toMatch(/^msg_/);
      expect(result.zoneId).toBe('zone-1');
      expect(result.senderId).toBe('agent-1');
      expect(result.senderType).toBe('agent');
      expect(result.content).toBe('Hello world');
    });
  });

  describe('exportZone', () => {
    it('should return null when zone not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.exportZone('non-existent');

      expect(result).toBeNull();
    });

    it('should export zone with files and tasks', () => {
      const zoneRow = createMockZoneRow({ title: 'Export Zone', prompt: 'Test' });
      const fileRow = createMockZoneFileRow({ name: 'test.md' });
      const taskRow = { task_id: 'task-1', zone_id: 'zone-1', title: 'Task 1', status: 'pending', assignee: null, created_by: 'agent-1', created_at: 1234567890, updated_at: 1234567890 };

      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes('zone_contexts')) {
          return createMockStatement(sql, { returns: zoneRow });
        }
        if (sql.includes('zone_files')) {
          return createMockStatement(sql, { returns: [fileRow] });
        }
        if (sql.includes('zone_tasks')) {
          return createMockStatement(sql, { returns: [taskRow] });
        }
        return createMockStatement(sql, { returns: [] });
      });

      const result = repository.exportZone('zone-1');

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Export Zone');
      expect(result!.prompt).toBe('Test');
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].name).toBe('test.md');
      expect(result!.tasks).toHaveLength(1);
    });
  });

  describe('getZoneContext', () => {
    it('should return null when zone not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZoneContext('non-existent');

      expect(result).toBeNull();
    });

    it('should return zone context', () => {
      const row = {
        task_policy: 'creator',
        task_creator_id: 'agent-1',
        members: '["agent-1","agent-2"]'
      };
      const mockStmt = createMockStatement('SELECT...', { returns: row });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZoneContext('zone-1');

      expect(result).not.toBeNull();
      expect(result!.taskPolicy).toBe('creator');
      expect(result!.taskCreatorId).toBe('agent-1');
      expect(result!.members).toEqual(['agent-1', 'agent-2']);
    });

    it('should handle malformed JSON in members', () => {
      const row = {
        task_policy: 'creator',
        task_creator_id: null,
        members: 'invalid'
      };
      const mockStmt = createMockStatement('SELECT...', { returns: row });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.getZoneContext('zone-1');

      expect(result).not.toBeNull();
      expect(result!.members).toEqual([]);
    });
  });

  describe('updateZoneContext', () => {
    it('should return false when zone not found', () => {
      const mockStmt = createMockStatement('SELECT...', { returns: undefined });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.updateZoneContext('non-existent', { taskPolicy: 'any' });

      expect(result).toBe(false);
    });

    it('should update zone context', () => {
      const existingRow = {
        task_policy: 'creator',
        task_creator_id: null,
        members: '[]'
      };
      const mockStmt = createMockStatement('SELECT...', { returns: existingRow });
      mockDb.prepare.mockReturnValue(mockStmt);

      const result = repository.updateZoneContext('zone-1', {
        taskPolicy: 'any',
        members: ['agent-1']
      });

      expect(result).toBe(true);
    });
  });

  describe('addFiles (bulk)', () => {
    it('should add multiple files', () => {
      const mockStmt = createMockStatement('INSERT...', { changes: 1 });
      mockDb.prepare.mockReturnValue(mockStmt);

      const files = [
        { name: 'test1.md', sourceType: 'local' as const, source: '/path1' },
        { name: 'test2.md', sourceType: 'local' as const, source: '/path2' }
      ];

      const result = repository.addFiles('zone-1', files);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('test1.md');
      expect(result[1].name).toBe('test2.md');
    });
  });
});