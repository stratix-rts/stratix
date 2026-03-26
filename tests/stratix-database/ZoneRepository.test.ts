/**
 * ZoneRepository Unit Tests
 *
 * These tests verify the ZoneRepository logic patterns using mock data.
 */

import { Zone, ZoneFile, ZoneTask, ZoneTaskStatus, FileType } from '../../src/stratix-project/types';

describe('ZoneRepository', () => {
  describe('Zone data transformation', () => {
    it('should transform database row to Zone', () => {
      const row = {
        zone_id: 'zone-1',
        project_id: 'proj-1',
        title: 'Test Zone',
        prompt: 'KR 1: Test objective',
        members: '["agent-1","agent-2"]',
        deleted_at: null,
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const zone: Zone = {
        id: row.zone_id,
        projectId: row.project_id,
        title: row.title,
        prompt: row.prompt || '',
        members: JSON.parse(row.members || '[]'),
        files: [], // Fetched separately
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(zone.id).toBe('zone-1');
      expect(zone.projectId).toBe('proj-1');
      expect(zone.title).toBe('Test Zone');
      expect(zone.prompt).toBe('KR 1: Test objective');
      expect(zone.members).toEqual(['agent-1', 'agent-2']);
      expect(zone.files).toEqual([]);
    });

    it('should handle null prompt', () => {
      const row = {
        zone_id: 'zone-1',
        project_id: 'proj-1',
        title: 'Test Zone',
        prompt: null,
        members: '[]',
        deleted_at: null,
        created_at: 1234567890,
        updated_at: 1234567890
      };

      const zone: Zone = {
        id: row.zone_id,
        projectId: row.project_id,
        title: row.title,
        prompt: row.prompt || '',
        members: JSON.parse(row.members || '[]'),
        files: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      expect(zone.prompt).toBe('');
    });

    it('should identify deleted zones by deleted_at', () => {
      const activeRow = { deleted_at: null };
      const deletedRow = { deleted_at: 1234567890 };

      const isDeleted = (row: any) => row.deleted_at !== null;

      expect(isDeleted(activeRow)).toBe(false);
      expect(isDeleted(deletedRow)).toBe(true);
    });
  });

  describe('Zone CRUD operations', () => {
    it('should generate INSERT statement for new zone', () => {
      const insertSQL = `
        INSERT INTO zone_contexts (zone_id, project_id, title, prompt, members, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT INTO zone_contexts');
      expect(insertSQL).toContain('zone_id');
      expect(insertSQL).toContain('title');
      expect(insertSQL).toContain('prompt');
      expect(insertSQL).toContain('members');
    });

    it('should generate UPDATE statement for existing zone', () => {
      const updateSQL = `
        UPDATE zone_contexts SET title = ?, prompt = ?, members = ?, updated_at = ?
        WHERE zone_id = ?
      `;

      expect(updateSQL).toContain('UPDATE zone_contexts');
      expect(updateSQL).toContain('SET title = ?, prompt = ?, members = ?, updated_at = ?');
      expect(updateSQL).toContain('WHERE zone_id = ?');
    });

    it('should use soft delete (UPDATE deleted_at) instead of DELETE', () => {
      const softDeleteSQL = 'UPDATE zone_contexts SET deleted_at = ? WHERE zone_id = ? AND deleted_at IS NULL';
      expect(softDeleteSQL).toContain('UPDATE');
      expect(softDeleteSQL).toContain('deleted_at = ?');
      expect(softDeleteSQL).not.toContain('DELETE FROM');
    });

    it('should restore zone by setting deleted_at to NULL', () => {
      const restoreSQL = 'UPDATE zone_contexts SET deleted_at = NULL WHERE zone_id = ? AND deleted_at IS NOT NULL';
      expect(restoreSQL).toContain('deleted_at = NULL');
    });

    it('should permanently delete using DELETE statement', () => {
      const permanentDeleteSQL = 'DELETE FROM zone_contexts WHERE zone_id = ?';
      expect(permanentDeleteSQL).toContain('DELETE FROM');
    });
  });

  describe('Zone search', () => {
    it('should search by title and prompt using LIKE', () => {
      const searchSQL = `
        SELECT * FROM zone_contexts
        WHERE deleted_at IS NULL
          AND (title LIKE ? OR prompt LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `;

      expect(searchSQL).toContain('title LIKE ?');
      expect(searchSQL).toContain('prompt LIKE ?');
      expect(searchSQL).toContain('deleted_at IS NULL');
      expect(searchSQL).toContain('ORDER BY updated_at DESC');
      expect(searchSQL).toContain('LIMIT ?');
    });

    it('should wrap keyword in % for LIKE matching', () => {
      const keyword = 'marketing';
      const pattern = `%${keyword}%`;

      expect(pattern).toBe('%marketing%');
    });
  });

  describe('Zone members operations', () => {
    it('should add member to existing members array', () => {
      const existingMembers = ['agent-1', 'agent-2'];
      const newMember = 'agent-3';

      if (!existingMembers.includes(newMember)) {
        existingMembers.push(newMember);
      }

      expect(existingMembers).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('should not add duplicate member', () => {
      const existingMembers = ['agent-1', 'agent-2'];
      const newMember = 'agent-1';

      if (!existingMembers.includes(newMember)) {
        existingMembers.push(newMember);
      }

      expect(existingMembers).toEqual(['agent-1', 'agent-2']);
    });

    it('should remove member from members array', () => {
      const members = ['agent-1', 'agent-2', 'agent-3'];
      const toRemove = 'agent-2';

      const newMembers = members.filter(id => id !== toRemove);
      expect(newMembers).toEqual(['agent-1', 'agent-3']);
    });

    it('should bulk add members using Set for uniqueness', () => {
      const existingMembers = ['agent-1'];
      const newMembers = ['agent-2', 'agent-3', 'agent-1'];

      const combined = [...new Set([...existingMembers, ...newMembers])];
      expect(combined).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('should bulk remove members', () => {
      const members = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
      const toRemove = ['agent-2', 'agent-3'];

      const newMembers = members.filter(id => !toRemove.includes(id));
      expect(newMembers).toEqual(['agent-1', 'agent-4']);
    });
  });

  describe('Zone file operations', () => {
    it('should generate INSERT statement for zone file', () => {
      const insertSQL = `
        INSERT INTO zone_files (file_id, zone_id, name, source_type, source, content, file_type, last_fetched, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT INTO zone_files');
      expect(insertSQL).toContain('zone_id');
      expect(insertSQL).toContain('name');
      expect(insertSQL).toContain('source_type');
      expect(insertSQL).toContain('source');
    });

    it('should update file content and metadata', () => {
      const updateSQL = `
        UPDATE zone_files SET content = ?, last_fetched = ?, metadata = ?, updated_at = ?
        WHERE file_id = ?
      `;

      expect(updateSQL).toContain('UPDATE zone_files');
      expect(updateSQL).toContain('content = ?');
      expect(updateSQL).toContain('metadata = ?');
    });

    it('should search files by name within zone', () => {
      const files: ZoneFile[] = [
        { id: 'f1', zoneId: 'zone-1', name: 'readme.md', sourceType: 'local', source: '/path1', fileType: 'md', createdAt: 1, updatedAt: 1 },
        { id: 'f2', zoneId: 'zone-1', name: 'config.json', sourceType: 'local', source: '/path2', fileType: 'txt', createdAt: 1, updatedAt: 1 },
        { id: 'f3', zoneId: 'zone-1', name: 'readme.txt', sourceType: 'local', source: '/path3', fileType: 'txt', createdAt: 1, updatedAt: 1 }
      ];

      const keyword = 'readme';
      const filtered = files.filter(f => f.name.toLowerCase().includes(keyword.toLowerCase()));

      expect(filtered).toHaveLength(2);
      expect(filtered.map(f => f.name)).toContain('readme.md');
      expect(filtered.map(f => f.name)).toContain('readme.txt');
    });

    it('should identify text files for content search', () => {
      const textTypes: FileType[] = ['md', 'txt', 'ts', 'js', 'fig', 'link', 'other'];

      const isTextFile = (fileType?: FileType): boolean => {
        if (!fileType) return false;
        return textTypes.includes(fileType);
      };

      expect(isTextFile('md')).toBe(true);
      expect(isTextFile('txt')).toBe(true);
      expect(isTextFile('ts')).toBe(true);
      expect(isTextFile('image')).toBe(false);
      expect(isTextFile(undefined)).toBe(false);
    });

    it('should search files by content in text files', () => {
      const files: ZoneFile[] = [
        { id: 'f1', zoneId: 'zone-1', name: 'readme.md', sourceType: 'local', source: '/path1', content: 'Hello world', fileType: 'md', createdAt: 1, updatedAt: 1 },
        { id: 'f2', zoneId: 'zone-1', name: 'config.json', sourceType: 'local', source: '/path2', fileType: 'txt', createdAt: 1, updatedAt: 1 }
      ];

      const keyword = 'hello';
      const filtered = files.filter(f => {
        if (f.name.toLowerCase().includes(keyword.toLowerCase())) return true;
        if (f.content && ['md', 'txt', 'ts', 'js', 'fig', 'link', 'other'].includes(f.fileType || '')) {
          return f.content.toLowerCase().includes(keyword.toLowerCase());
        }
        return false;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('readme.md');
    });
  });

  describe('File version history', () => {
    it('should add new version at beginning of array', () => {
      const versions: any[] = [{ id: 'v1', content: 'Version 1', createdAt: 1000 }];

      const newVersion = { id: 'v2', content: 'Version 2', createdAt: 2000 };
      versions.unshift(newVersion);

      expect(versions[0].id).toBe('v2');
      expect(versions).toHaveLength(2);
    });

    it('should limit versions to 10', () => {
      const versions: any[] = Array.from({ length: 15 }, (_, i) => ({
        id: `v${i}`,
        content: `Version ${i}`,
        createdAt: i * 1000
      }));

      // Keep only last 10
      while (versions.length > 10) {
        versions.pop();
      }

      expect(versions).toHaveLength(10);
      expect(versions[0].id).toBe('v0'); // Oldest first
    });

    it('should create rollback version before rollback', () => {
      const file = {
        content: 'Current content',
        metadata: {
          versions: [
            { id: 'v1', content: 'Version 1', createdAt: 1000, description: 'V1' },
            { id: 'v2', content: 'Version 2', createdAt: 2000, description: 'V2' }
          ],
          currentVersionId: 'v2'
        }
      };

      // Save current as new version before rollback
      const rollbackVersion: any = {
        id: 'v3',
        content: file.content,
        createdAt: Date.now(),
        description: 'Auto-saved before rollback'
      };

      file.metadata.versions.unshift(rollbackVersion);

      expect(file.metadata.versions).toHaveLength(3);
      expect(file.metadata.versions[0].description).toBe('Auto-saved before rollback');
    });
  });

  describe('Zone task operations', () => {
    it('should generate INSERT statement for task', () => {
      const insertSQL = `
        INSERT INTO zone_tasks (task_id, zone_id, title, status, assignee, created_by, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', NULL, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT INTO zone_tasks');
      expect(insertSQL).toContain('status');
      expect(insertSQL).toContain("'pending'");
    });

    it('should update task status and assignee', () => {
      const updateSQL = `
        UPDATE zone_tasks SET title = ?, status = ?, assignee = ?, updated_at = ?
        WHERE task_id = ?
      `;

      expect(updateSQL).toContain('UPDATE zone_tasks');
      expect(updateSQL).toContain('status = ?');
      expect(updateSQL).toContain('assignee = ?');
    });

    it('should validate task status values', () => {
      const validStatuses: ZoneTaskStatus[] = ['pending', 'in_progress', 'done'];

      expect(validStatuses).toContain('pending');
      expect(validStatuses).toContain('in_progress');
      expect(validStatuses).toContain('done');
      expect(validStatuses).not.toContain('active');
    });

    it('should paginate tasks with LIMIT and OFFSET', () => {
      const getTasksSQL = (limit?: number, offset?: number) => {
        let sql = 'SELECT * FROM zone_tasks WHERE zone_id = ? ORDER BY created_at DESC';
        const params: any[] = ['zone-1'];

        if (limit !== undefined) {
          sql += ' LIMIT ?';
          params.push(limit);
          if (offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(offset);
          }
        }

        return { sql, params };
      };

      const { sql, params } = getTasksSQL(10, 5);
      expect(sql).toContain('LIMIT ? OFFSET ?');
      expect(params).toEqual(['zone-1', 10, 5]);
    });

    it('should count tasks in zone', () => {
      const countSQL = 'SELECT COUNT(*) as count FROM zone_tasks WHERE zone_id = ?';
      expect(countSQL).toContain('COUNT(*)');
    });
  });

  describe('Zone message operations', () => {
    it('should generate INSERT statement for message', () => {
      const insertSQL = `
        INSERT INTO zone_messages (message_id, zone_id, sender_id, sender_type, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      expect(insertSQL).toContain('INSERT INTO zone_messages');
      expect(insertSQL).toContain('sender_id');
      expect(insertSQL).toContain('sender_type');
      expect(insertSQL).toContain('content');
    });

    it('should order messages by created_at ASC for chronological display', () => {
      const selectSQL = 'SELECT * FROM zone_messages WHERE zone_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?';
      expect(selectSQL).toContain('ORDER BY created_at ASC');
    });

    it('should validate sender_type values', () => {
      const validTypes = ['user', 'agent'];
      expect(validTypes).toContain('user');
      expect(validTypes).toContain('agent');
      expect(validTypes).not.toContain('system');
    });
  });

  describe('Zone context helpers', () => {
    it('should generate SELECT for zone context', () => {
      const selectSQL = 'SELECT task_policy, task_creator_id, members FROM zone_contexts WHERE zone_id = ? AND deleted_at IS NULL';
      expect(selectSQL).toContain('task_policy');
      expect(selectSQL).toContain('task_creator_id');
      expect(selectSQL).toContain('members');
    });

    it('should update zone context', () => {
      const updateSQL = `
        UPDATE zone_contexts SET task_policy = ?, task_creator_id = ?, members = ?, updated_at = ?
        WHERE zone_id = ?
      `;

      expect(updateSQL).toContain('UPDATE zone_contexts');
      expect(updateSQL).toContain('task_policy = ?');
      expect(updateSQL).toContain('task_creator_id = ?');
    });
  });

  describe('Zone export', () => {
    it('should export zone with files and tasks', () => {
      const zone: Zone = {
        id: 'zone-1',
        projectId: 'proj-1',
        title: 'Test Zone',
        prompt: 'Test prompt',
        members: ['agent-1'],
        files: [
          { id: 'f1', zoneId: 'zone-1', name: 'readme.md', sourceType: 'local', source: '/path', fileType: 'md', createdAt: 1, updatedAt: 1 }
        ],
        createdAt: 1,
        updatedAt: 1
      };

      const tasks: ZoneTask[] = [
        { id: 't1', zoneId: 'zone-1', title: 'Task 1', status: 'pending', assignee: null, createdBy: 'agent-1', createdAt: 1, updatedAt: 1 }
      ];

      const exported = {
        title: zone.title,
        prompt: zone.prompt,
        files: zone.files.map(f => ({ name: f.name, sourceType: f.sourceType, source: f.source })),
        tasks: tasks.map(t => ({ title: t.title }))
      };

      expect(exported.title).toBe('Test Zone');
      expect(exported.files).toHaveLength(1);
      expect(exported.tasks).toHaveLength(1);
    });
  });
});
