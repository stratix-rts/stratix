import { HttpSkillExecutor } from '@/stratix-agent/core/executors/HttpSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';
import { SafetyValidator } from '@/stratix-agent/core/SafetyValidator';
import { writeFile } from 'fs/promises';

jest.mock('@/stratix-agent/core/SafetyValidator');
jest.mock('fs/promises');

describe('HttpSkillExecutor', () => {
  let executor: HttpSkillExecutor;
  let mockContext: ExecutionContext;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    executor = new HttpSkillExecutor();
    mockContext = { agentId: 'test-agent' };
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('web_search', () => {
    const searchSkill: SkillDefinition = {
      skillId: 'web_search',
      name: 'Web Search',
      description: 'Search the web',
      parameters: [],
      executor: 'http',
    };

    test('returns search results successfully', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          RelatedTopics: [
            { Text: 'Result 1 - description', FirstURL: 'https://example.com/1' },
            { Text: 'Result 2 - description', FirstURL: 'https://example.com/2' },
          ],
          AbstractText: 'Abstract summary',
          Heading: 'Test Heading',
          AbstractURL: 'https://example.com/abstract',
        }),
      });

      const result = await executor.execute(searchSkill, { query: 'test', num_results: 3 }, mockContext);

      expect(result.query).toBe('test');
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.results).toBeInstanceOf(Array);
      expect(result.results[0]).toHaveProperty('title');
      expect(result.results[0]).toHaveProperty('url');
      expect(result.results[0]).toHaveProperty('snippet');
    });

    test('returns empty results when no data', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          RelatedTopics: [],
        }),
      });

      const result = await executor.execute(searchSkill, { query: 'test' }, mockContext);

      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('limits results to num_results', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          RelatedTopics: Array.from({ length: 10 }, (_, i) => ({
            Text: `Result ${i}`,
            FirstURL: `https://example.com/${i}`,
          })),
        }),
      });

      const result = await executor.execute(searchSkill, { query: 'test', num_results: 3 }, mockContext);

      expect(result.results.length).toBeLessThanOrEqual(3);
    });

    test('throws when URL validation fails', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Domain not allowed',
      });

      await expect(executor.execute(searchSkill, { query: 'test' }, mockContext))
        .rejects.toThrow('URL validation failed');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('throws on network error', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(executor.execute(searchSkill, { query: 'test' }, mockContext))
        .rejects.toThrow('Web search failed');
    });

    test('includes Abstract when available and under limit', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        json: async () => ({
          RelatedTopics: [],
          AbstractText: 'Summary text',
          Heading: 'Heading',
          AbstractURL: 'https://example.com',
        }),
      });

      const result = await executor.execute(searchSkill, { query: 'test', num_results: 5 }, mockContext);

      expect(result.results.length).toBe(1);
      expect(result.results[0].title).toBe('Heading');
    });
  });

  describe('file_download', () => {
    const downloadSkill: SkillDefinition = {
      skillId: 'file_download',
      name: 'File Download',
      description: 'Download a file',
      parameters: [],
      executor: 'http',
    };

    test('downloads file successfully', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      const buffer = Buffer.from('file content');
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      });
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executor.execute(downloadSkill, { url: 'https://example.com/file.txt', path: '/tmp/file.txt' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.path).toBe('/tmp/file.txt');
      expect(result.size).toBeGreaterThan(0);
    });

    test('throws on HTTP error', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(executor.execute(downloadSkill, { url: 'https://example.com/missing.txt', path: '/tmp/missing.txt' }, mockContext))
        .rejects.toThrow('File download failed');
    });

    test('throws when URL validation fails', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Protocol not allowed',
      });

      await expect(executor.execute(downloadSkill, { url: 'ftp://example.com/file.txt', path: '/tmp/file.txt' }, mockContext))
        .rejects.toThrow('URL validation failed');
    });
  });

  describe('generic api_call', () => {
    const apiSkill: SkillDefinition = {
      skillId: 'api_call',
      name: 'API Call',
      description: 'Make generic API call',
      parameters: [],
      executor: 'http',
    };

    test('GET request returns JSON', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
        json: async () => ({ data: 'value' }),
      });

      const result = await executor.execute(apiSkill, { url: 'https://api.example.com/data', method: 'GET' }, mockContext);

      expect(result).toEqual({ data: 'value' });
    });

    test('GET request returns text when not JSON', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        headers: { get: (h: string) => h === 'content-type' ? 'text/plain' : null },
        text: async () => 'plain text response',
      });

      const result = await executor.execute(apiSkill, { url: 'https://api.example.com/text' }, mockContext);

      expect(result).toBe('plain text response');
    });

    test('POST request with body', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
        json: async () => ({ success: true }),
      });

      const result = await executor.execute(apiSkill, {
        url: 'https://api.example.com/create',
        method: 'POST',
        body: { name: 'test' },
        headers: { 'X-Custom': 'header' },
      }, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'header',
          }),
        })
      );
      expect(result).toEqual({ success: true });
    });

    test('uses endpoint as url fallback', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });

      await executor.execute(apiSkill, { endpoint: 'https://api.example.com/endpoint' }, mockContext);

      expect(SafetyValidator.validateUrl).toHaveBeenCalledWith('https://api.example.com/endpoint', mockContext);
    });

    test('throws when URL validation fails for generic call', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({
        valid: false,
        reason: 'Invalid URL format',
      });

      await expect(executor.execute(apiSkill, { url: 'not-a-url' }, mockContext))
        .rejects.toThrow('URL validation failed');
    });

    test('throws on network error for generic call', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      await expect(executor.execute(apiSkill, { url: 'https://api.example.com/data' }, mockContext))
        .rejects.toThrow('HTTP request failed');
    });

    test('defaults to GET method', async () => {
      (SafetyValidator.validateUrl as jest.Mock).mockReturnValue({ valid: true });
      (global.fetch as jest.Mock).mockResolvedValue({
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });

      await executor.execute(apiSkill, { url: 'https://api.example.com/data' }, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });
});
