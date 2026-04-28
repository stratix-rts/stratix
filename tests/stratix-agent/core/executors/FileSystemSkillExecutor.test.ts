import { FileSystemSkillExecutor } from '@/stratix-agent/core/executors/FileSystemSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';
import { SafetyValidator } from '@/stratix-agent/core/SafetyValidator';
import * as fs from 'fs';
import { readFile, writeFile, appendFile, readdir, rm, stat } from 'fs/promises';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('@/stratix-agent/core/SafetyValidator');

describe('FileSystemSkillExecutor', () => {
  let executor: FileSystemSkillExecutor;
  let mockContext: ExecutionContext;
  let progressCallbacks: any[];

  beforeEach(() => {
    executor = new FileSystemSkillExecutor();
    progressCallbacks = [];
    mockContext = {
      agentId: 'test-agent',
      progressCallback: (p: any) => progressCallbacks.push(p),
    };
    jest.clearAllMocks();
  });

  describe('file_read', () => {
    const readSkill: SkillDefinition = {
      skillId: 'file_read',
      name: 'File Read',
      description: 'Read a file',
      parameters: [],
      executor: 'filesystem',
    };

    test('reads file content', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue('file contents');

      const result = await executor.execute(readSkill, { path: '/tmp/test.txt' }, mockContext);

      expect(result.content).toBe('file contents');
      expect(result.path).toBe('/tmp/test.txt');
      expect(result.preview.type).toBe('text');
    });

    test('truncates preview for large files', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue('a'.repeat(2000));

      const result = await executor.execute(readSkill, { path: '/tmp/large.txt' }, mockContext);

      expect(result.preview.content).toContain('...[truncated]');
      expect(result.preview.content.length).toBeLessThanOrEqual(1014); // 1000 + '...[truncated]' (14 chars)
    });

    test('throws when file does not exist', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(executor.execute(readSkill, { path: '/tmp/missing.txt' }, mockContext))
        .rejects.toThrow('File not found');
    });

    test('throws when path validation fails', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Path traversal detected',
      });

      await expect(executor.execute(readSkill, { path: '/etc/passwd' }, mockContext))
        .rejects.toThrow('File path validation failed');
    });

    test('uses custom encoding', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue('content');

      await executor.execute(readSkill, { path: '/tmp/test.txt', encoding: 'base64' }, mockContext);

      expect(readFile).toHaveBeenCalledWith('/tmp/test.txt', 'base64');
    });

    test('uses basePath from context for relative paths', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue('content');

      const contextWithBase = {
        ...mockContext,
        variables: { basePath: '/workspace' },
      };

      await executor.execute(readSkill, { path: 'relative.txt' }, contextWithBase);

      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('/workspace/relative.txt'), 'utf-8');
    });

    test('sends progress callbacks', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue('content');

      await executor.execute(readSkill, { path: '/tmp/test.txt' }, mockContext);

      expect(progressCallbacks).toHaveLength(2);
      expect(progressCallbacks[0].stage).toBe('processing');
      expect(progressCallbacks[1].stage).toBe('completed');
    });
  });

  describe('file_write', () => {
    const writeSkill: SkillDefinition = {
      skillId: 'file_write',
      name: 'File Write',
      description: 'Write a file',
      parameters: [],
      executor: 'filesystem',
    };

    test('writes file successfully', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executor.execute(writeSkill, { path: '/tmp/test.txt', content: 'hello' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.path).toBe('/tmp/test.txt');
      expect(writeFile).toHaveBeenCalledWith('/tmp/test.txt', 'hello', 'utf-8');
    });

    test('throws when path validation fails', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Only absolute paths allowed',
      });

      await expect(executor.execute(writeSkill, { path: 'relative.txt', content: 'hello' }, mockContext))
        .rejects.toThrow('File path validation failed');
    });
  });

  describe('file_append', () => {
    const appendSkill: SkillDefinition = {
      skillId: 'file_append',
      name: 'File Append',
      description: 'Append to a file',
      parameters: [],
      executor: 'filesystem',
    };

    test('appends to file', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (appendFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executor.execute(appendSkill, { path: '/tmp/test.txt', content: 'more' }, mockContext);

      expect(result.success).toBe(true);
      expect(appendFile).toHaveBeenCalledWith('/tmp/test.txt', 'more', 'utf-8');
    });
  });

  describe('file_list', () => {
    const listSkill: SkillDefinition = {
      skillId: 'file_list',
      name: 'File List',
      description: 'List directory',
      parameters: [],
      executor: 'filesystem',
    };

    test('lists directory contents', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (readdir as jest.Mock).mockResolvedValue(['file1.txt', 'file2.txt']);

      const result = await executor.execute(listSkill, { path: '/tmp' }, mockContext);

      expect(result.files).toEqual(['file1.txt', 'file2.txt']);
      expect(result.path).toBe('/tmp');
      expect(result.preview.type).toBe('table');
    });

    test('throws when directory does not exist', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(executor.execute(listSkill, { path: '/tmp/missing' }, mockContext))
        .rejects.toThrow('Directory not found');
    });
  });

  describe('file_delete', () => {
    const deleteSkill: SkillDefinition = {
      skillId: 'file_delete',
      name: 'File Delete',
      description: 'Delete a file',
      parameters: [],
      executor: 'filesystem',
    };

    test('deletes file', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (rm as jest.Mock).mockResolvedValue(undefined);

      const result = await executor.execute(deleteSkill, { path: '/tmp/test.txt' }, mockContext);

      expect(result.success).toBe(true);
      expect(rm).toHaveBeenCalledWith('/tmp/test.txt', { recursive: false });
    });

    test('deletes recursively when requested', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (rm as jest.Mock).mockResolvedValue(undefined);

      await executor.execute(deleteSkill, { path: '/tmp/dir', recursive: true }, mockContext);

      expect(rm).toHaveBeenCalledWith('/tmp/dir', { recursive: true });
    });
  });

  describe('file_info', () => {
    const infoSkill: SkillDefinition = {
      skillId: 'file_info',
      name: 'File Info',
      description: 'Get file info',
      parameters: [],
      executor: 'filesystem',
    };

    test('returns file statistics', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockStat = {
        size: 1024,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-06-01'),
        isDirectory: () => false,
        isFile: () => true,
      };
      (stat as jest.Mock).mockResolvedValue(mockStat);

      const result = await executor.execute(infoSkill, { path: '/tmp/test.txt' }, mockContext);

      expect(result.size).toBe(1024);
      expect(result.isFile).toBe(true);
      expect(result.isDirectory).toBe(false);
      expect(result.preview.type).toBe('json');
    });

    test('throws when file does not exist', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(executor.execute(infoSkill, { path: '/tmp/missing.txt' }, mockContext))
        .rejects.toThrow('File not found');
    });
  });

  describe('unknown operation', () => {
    test('throws for unknown skillId', async () => {
      (SafetyValidator.validateFilePath as jest.Mock).mockReturnValue({ valid: true });
      const unknownSkill: SkillDefinition = {
        skillId: 'file_unknown',
        name: 'Unknown',
        description: 'Unknown',
        parameters: [],
        executor: 'filesystem',
      };

      await expect(executor.execute(unknownSkill, { path: '/tmp/test.txt' }, mockContext))
        .rejects.toThrow('Unknown file operation');
    });
  });
});
