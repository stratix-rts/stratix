/**
 * ZoneFileService Unit Tests
 */

import { ZoneFileService } from '../../../src/stratix-gateway/project/ZoneFileService';
import { Zone, ZoneFile, FileType, FileVersion } from '../../../src/stratix-project/types';

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

const mockFile = (overrides: Partial<ZoneFile> = {}): ZoneFile => ({
  id: 'file-1',
  zoneId: 'zone-test-1',
  name: 'test.ts',
  sourceType: 'url',
  source: 'https://example.com/test.ts',
  content: 'console.log("hello")',
  fileType: 'ts' as FileType,
  lastFetched: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('ZoneFileService', () => {
  let service: ZoneFileService;
  let mockCheckPermission: jest.Mock;
  let mockEnsureInitialized: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockCheckPermission = jest.fn();
    mockEnsureInitialized = jest.fn().mockResolvedValue(undefined);

    service = new ZoneFileService(mockCheckPermission, mockEnsureInitialized);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================
  // addFile
  // ============================================
  describe('addFile', () => {
    it('should add URL file and publish event', async () => {
      const zone = mockZone();
      const file = mockFile({ content: undefined, lastFetched: undefined });
      const finalFile = mockFile();

      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.addFile.mockReturnValue(file);
      MockedZoneRepository.getFile.mockReturnValue(finalFile);

      const result = await service.addFile('zone-test-1', 'test.ts', 'url', 'https://example.com/test.ts', 'ts', 'agent-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('add_file', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.addFile).toHaveBeenCalledWith('zone-test-1', 'test.ts', 'url', 'https://example.com/test.ts', 'ts');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:file_added',
        'zone-test-1',
        'zone-test-1',
        { file: finalFile }
      );
      expect(result).toEqual(finalFile);
    });

    it('should use default agentId when not provided', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.addFile.mockReturnValue(mockFile());
      MockedZoneRepository.getFile.mockReturnValue(mockFile());

      await service.addFile('zone-test-1', 'test.ts', 'url', 'https://example.com/test.ts');

      expect(mockCheckPermission).toHaveBeenCalledWith('add_file', 'zone:zone-test-1', 'system');
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.addFile('zone-test-1', 'test.ts', 'url', 'https://example.com/test.ts')).rejects.toThrow('Zone not found: zone-test-1');
    });

    it('should throw when permission denied', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.addFile('zone-test-1', 'test.ts', 'url', 'https://example.com/test.ts')).rejects.toThrow('Permission denied');
    });
  });

  // ============================================
  // removeFile
  // ============================================
  describe('removeFile', () => {
    it('should remove file and publish event', async () => {
      const zone = mockZone();
      const file = mockFile();

      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.deleteFile.mockReturnValue(true);

      const result = await service.removeFile('zone-test-1', 'file-1', 'agent-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('remove_file', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.deleteFile).toHaveBeenCalledWith('file-1');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:file_removed',
        'zone-test-1',
        'zone-test-1',
        { fileId: 'file-1', fileName: 'test.ts' }
      );
      expect(result).toBe(true);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.removeFile('zone-test-1', 'file-1')).rejects.toThrow('Zone not found: zone-test-1');
    });

    it('should throw when file not in zone', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getFile.mockReturnValue(mockFile({ zoneId: 'other-zone' }));

      await expect(service.removeFile('zone-test-1', 'file-1')).rejects.toThrow('File file-1 not found in zone zone-test-1');
    });

    it('should throw when file not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getFile.mockReturnValue(null);

      await expect(service.removeFile('zone-test-1', 'file-1')).rejects.toThrow('File file-1 not found in zone zone-test-1');
    });
  });

  // ============================================
  // getFileWithContent
  // ============================================
  describe('getFileWithContent', () => {
    it('should return file and content on cache hit', async () => {
      const file = mockFile({ lastFetched: Date.now() });
      MockedZoneRepository.getFile.mockReturnValue(file);

      const result = await service.getFileWithContent('zone-test-1', 'file-1');

      expect(result.file).toEqual(file);
      expect(result.content).toBe('console.log("hello")');
      expect(result.cacheHit).toBe(true);
    });

    it('should return nulls when file not found', async () => {
      MockedZoneRepository.getFile.mockReturnValue(null);

      const result = await service.getFileWithContent('zone-test-1', 'file-1');

      expect(result).toEqual({ file: null, content: null, cacheHit: false });
    });

    it('should return nulls when file in different zone', async () => {
      MockedZoneRepository.getFile.mockReturnValue(mockFile({ zoneId: 'other-zone' }));

      const result = await service.getFileWithContent('zone-test-1', 'file-1');

      expect(result).toEqual({ file: null, content: null, cacheHit: false });
    });

    it('should refresh stale URL file and update repository', async () => {
      const file = mockFile({ sourceType: 'url', lastFetched: Date.now() - 7200000, content: 'old' });
      const updatedFile = mockFile({ sourceType: 'url', lastFetched: Date.now(), content: 'new content' });

      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.updateFile.mockReturnValue(updatedFile);

      service.configureFileCache({ allowedUrlPatterns: ['https://example.com/.*'] });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('new content'),
      } as any);

      const result = await service.getFileWithContent('zone-test-1', 'file-1');

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/test.ts');
      expect(MockedZoneRepository.updateFile).toHaveBeenCalledWith('file-1', expect.objectContaining({ content: 'new content' }));
      expect(result.content).toBe('new content');
      expect(result.cacheHit).toBe(false);
    });

    it('should fallback to stale cache when fetch fails', async () => {
      const file = mockFile({ sourceType: 'url', lastFetched: Date.now() - 7200000, content: 'stale' });

      MockedZoneRepository.getFile.mockReturnValue(file);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      const result = await service.getFileWithContent('zone-test-1', 'file-1');

      expect(result.content).toBe('stale');
      expect(result.cacheHit).toBe(false);
    });
  });

  // ============================================
  // searchFiles
  // ============================================
  describe('searchFiles', () => {
    it('should return matching files', async () => {
      const files = [mockFile({ name: 'test.ts' }), mockFile({ name: 'readme.md' })];
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.searchFiles.mockReturnValue([files[0]]);

      const result = await service.searchFiles('zone-test-1', 'test');

      expect(MockedZoneRepository.searchFiles).toHaveBeenCalledWith('zone-test-1', 'test');
      expect(result).toEqual([files[0]]);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.searchFiles('zone-test-1', 'test')).rejects.toThrow('Zone not found: zone-test-1');
    });
  });

  // ============================================
  // getFileVersions
  // ============================================
  describe('getFileVersions', () => {
    it('should return versions array', async () => {
      const versions: FileVersion[] = [
        { id: 'v1', content: 'v1 content', createdAt: Date.now() },
      ];
      MockedZoneRepository.getFile.mockReturnValue(mockFile());
      MockedZoneRepository.getFileVersions.mockReturnValue({ versions, currentVersionId: 'v1' });

      const result = await service.getFileVersions('zone-test-1', 'file-1');

      expect(result.versions).toEqual(versions);
      expect(result.currentVersionId).toBe('v1');
    });

    it('should return empty versions when repository returns null', async () => {
      MockedZoneRepository.getFile.mockReturnValue(mockFile());
      MockedZoneRepository.getFileVersions.mockReturnValue(null);

      const result = await service.getFileVersions('zone-test-1', 'file-1');

      expect(result.versions).toEqual([]);
    });

    it('should throw when file not in zone', async () => {
      MockedZoneRepository.getFile.mockReturnValue(mockFile({ zoneId: 'other-zone' }));

      await expect(service.getFileVersions('zone-test-1', 'file-1')).rejects.toThrow('File not found: file-1 in zone zone-test-1');
    });
  });

  // ============================================
  // shouldRefreshFile
  // ============================================
  describe('shouldRefreshFile', () => {
    it('should return true when no content', () => {
      const file = mockFile({ content: undefined });
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return true when no lastFetched', () => {
      const file = mockFile({ lastFetched: undefined });
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return false when cache is fresh', () => {
      const file = mockFile({ lastFetched: Date.now() - 1000 });
      expect(service.shouldRefreshFile(file)).toBe(false);
    });

    it('should return true when cache is expired', () => {
      const file = mockFile({ lastFetched: Date.now() - 7200000 });
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should respect configured cache expiry', () => {
      service.configureFileCache({ cacheExpiry: 5000 });
      const file = mockFile({ lastFetched: Date.now() - 6000 });
      expect(service.shouldRefreshFile(file)).toBe(true);

      const freshFile = mockFile({ lastFetched: Date.now() - 1000 });
      expect(service.shouldRefreshFile(freshFile)).toBe(false);
    });
  });

  // ============================================
  // isTextFile
  // ============================================
  describe('isTextFile', () => {
    it('should return true for text file types', () => {
      expect((service as any).isTextFile('md')).toBe(true);
      expect((service as any).isTextFile('txt')).toBe(true);
      expect((service as any).isTextFile('ts')).toBe(true);
      expect((service as any).isTextFile('js')).toBe(true);
      expect((service as any).isTextFile('fig')).toBe(true);
      expect((service as any).isTextFile('link')).toBe(true);
    });

    it('should return false for non-text file types', () => {
      expect((service as any).isTextFile('image')).toBe(false);
      expect((service as any).isTextFile('folder')).toBe(false);
      expect((service as any).isTextFile('other')).toBe(false);
    });

    it('should return false when fileType is undefined', () => {
      expect((service as any).isTextFile(undefined)).toBe(false);
    });
  });

  // ============================================
  // validateFilePath
  // ============================================
  describe('validateFilePath', () => {
    it('should allow safe paths', () => {
      expect(() => (service as any).validateFilePath('/home/user/file.txt')).not.toThrow();
      expect(() => (service as any).validateFilePath('relative/path/file.ts')).not.toThrow();
    });

    it('should reject path traversal', () => {
      expect(() => (service as any).validateFilePath('../../../etc/passwd')).toThrow('Path traversal not allowed');
      expect(() => (service as any).validateFilePath('foo/../../etc/passwd')).toThrow('Path traversal not allowed');
    });

    it('should enforce allowedBasePaths when configured', () => {
      service.configureFileCache({ allowedBasePaths: ['/allowed'] });
      expect(() => (service as any).validateFilePath('/allowed/file.txt')).not.toThrow();
      expect(() => (service as any).validateFilePath('/other/file.txt')).toThrow('File path not in allowed directories');
    });
  });

  // ============================================
  // isPrivateIp
  // ============================================
  describe('isPrivateIp', () => {
    it('should block localhost', () => {
      expect((service as any).isPrivateIp('127.0.0.1')).toBe(true);
      expect((service as any).isPrivateIp('127.0.0.53')).toBe(true);
    });

    it('should block private ranges', () => {
      expect((service as any).isPrivateIp('10.0.0.1')).toBe(true);
      expect((service as any).isPrivateIp('192.168.1.1')).toBe(true);
      expect((service as any).isPrivateIp('172.16.0.1')).toBe(true);
      expect((service as any).isPrivateIp('169.254.1.1')).toBe(true);
    });

    it('should allow public IPs', () => {
      expect((service as any).isPrivateIp('8.8.8.8')).toBe(false);
      expect((service as any).isPrivateIp('1.1.1.1')).toBe(false);
      expect((service as any).isPrivateIp('140.82.121.4')).toBe(false);
    });

    it('should allow hostnames', () => {
      expect((service as any).isPrivateIp('example.com')).toBe(false);
      expect((service as any).isPrivateIp('github.com')).toBe(false);
    });
  });
});
