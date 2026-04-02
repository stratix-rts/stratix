/**
 * MCPResultTransformer Tests
 *
 * Coverage:
 * - Text truncation (> 10000 chars) - per-block truncation flag
 * - Image size handling (> 2MB)
 * - Binary temp file handling
 * - Total size cap (50KB) - sets wasTruncated
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { MCPResultTransformer } from '@/stratix-core/mcp/MCPResultTransformer';

describe('MCPResultTransformer', () => {
  let transformer: MCPResultTransformer;
  const tmpFiles: string[] = [];

  beforeEach(() => {
    transformer = new MCPResultTransformer();
  });

  afterEach(async () => {
    // Clean up any temp files created
    for (const f of tmpFiles) {
      try {
        await fs.unlink(f);
      } catch {}
    }
    tmpFiles.length = 0;
  });

  describe('transformResult', () => {
    it('should pass through empty result', async () => {
      const result = await transformer.transformResult({});

      expect(result.content).toHaveLength(0);
      expect(result.wasTruncated).toBe(false);
      expect(result.warnings).toHaveLength(0);
      expect(result.totalSizeBytes).toBe(0);
    });

    it('should pass through text under limit unchanged', async () => {
      const result = await transformer.transformResult({
        content: [{ type: 'text', text: 'Hello, world!' }],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello, world!' });
      expect(result.wasTruncated).toBe(false);
    });

    it('should truncate text over 10000 chars (per-block flag)', async () => {
      const longText = 'A'.repeat(15000);
      const result = await transformer.transformResult({
        content: [{ type: 'text', text: longText }],
      });

      expect(result.content).toHaveLength(1);
      expect((result.content[0] as any).text.length).toBeLessThan(longText.length);
      expect((result.content[0] as any).truncated).toBe(true);
      // wasTruncated is only set when TOTAL size exceeds limit, not per-block
      expect(result.wasTruncated).toBe(false);
    });

    it('should preserve text exactly at limit', async () => {
      const exactText = 'B'.repeat(10000);
      const result = await transformer.transformResult({
        content: [{ type: 'text', text: exactText }],
      });

      expect(result.content).toHaveLength(1);
      expect((result.content[0] as any).text.length).toBe(10000);
      expect((result.content[0] as any).truncated).toBeUndefined();
    });

    it('should handle image under 2MB', async () => {
      const smallBase64 = Buffer.from('fake image data').toString('base64');
      const result = await transformer.transformResult({
        content: [{
          type: 'image',
          base64: smallBase64,
          mimeType: 'image/png',
          sizeBytes: 100,
        }],
      });

      expect(result.content).toHaveLength(1);
      expect((result.content[0] as any).resized).toBe(false);
      expect((result.content[0] as any).sizeBytes).toBe(100);
    });

    it('should mark image over 2MB as resized', async () => {
      const largeBase64 = 'A'.repeat(3 * 1024 * 1024); // ~3MB base64
      const result = await transformer.transformResult({
        content: [{
          type: 'image',
          base64: largeBase64,
          mimeType: 'image/png',
          sizeBytes: 3 * 1024 * 1024,
        }],
      });

      expect(result.content).toHaveLength(1);
      expect((result.content[0] as any).resized).toBe(true);
    });

    it('should save binary to temp file', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const result = await transformer.transformResult({
        content: [{
          type: 'binary',
          data: binaryData.toString('base64'),
          mimeType: 'application/octet-stream',
          fileName: 'test.bin',
        }],
      });

      expect(result.content).toHaveLength(1);
      const binaryBlock = result.content[0] as any;
      expect(binaryBlock.type).toBe('binary');
      expect(binaryBlock.fileName).toBe('test.bin');
      expect(binaryBlock.sizeBytes).toBe(4);

      // Verify file was actually written
      const content = await fs.readFile(binaryBlock.filePath);
      expect(content).toEqual(binaryData);
      tmpFiles.push(binaryBlock.filePath);
    });

    it('should use generated filename when not provided', async () => {
      const result = await transformer.transformResult({
        content: [{
          type: 'binary',
          data: Buffer.from('test').toString('base64'),
          mimeType: 'application/octet-stream',
        }],
      });

      const binaryBlock = result.content[0] as any;
      expect(binaryBlock.fileName).toContain('mcp_binary_');
      tmpFiles.push(binaryBlock.filePath);
    });

    it('should pass through resource blocks unchanged', async () => {
      const result = await transformer.transformResult({
        content: [{
          type: 'resource',
          uri: 'file:///some/resource',
          mimeType: 'text/plain',
          sizeBytes: 100,
        }],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'resource',
        uri: 'file:///some/resource',
        mimeType: 'text/plain',
        sizeBytes: 100,
      });
    });

    it('should respect total 50KB cap', async () => {
      // Each block is ~5010 bytes (5010 * 10 = 50100 > 51200 limit)
      // The 11th block would exceed the limit
      const texts = Array.from({ length: 11 }, (_, i) => ({
        type: 'text' as const,
        text: '0123456789'.repeat(500) + ` block${i}`,
      }));

      const result = await transformer.transformResult({ content: texts });

      expect(result.wasTruncated).toBe(true);
      expect(result.content.length).toBeLessThan(texts.length);
    });

    it('should calculate totalSizeBytes correctly', async () => {
      const result = await transformer.transformResult({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'resource', uri: 'file:///test', mimeType: 'text/plain', sizeBytes: 10 },
        ],
      });

      expect(result.totalSizeBytes).toBe(5 + 10); // 'Hello' = 5 bytes
    });
  });

  describe('transformResultSync', () => {
    it('should throw for binary blocks', () => {
      expect(() => transformer.transformResultSync({
        content: [{
          type: 'binary',
          data: Buffer.from('test').toString('base64'),
          mimeType: 'application/octet-stream',
        }],
      })).toThrow('Binary blocks require async transformation');
    });

    it('should work for text and resource blocks', () => {
      const result = transformer.transformResultSync({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'resource', uri: 'file:///test', mimeType: 'text/plain', sizeBytes: 5 },
        ],
      });

      expect(result.content).toHaveLength(2);
      expect(result.totalSizeBytes).toBeGreaterThan(0);
    });
  });

  describe('custom config', () => {
    it('should respect custom maxTextLength', async () => {
      const custom = new MCPResultTransformer({ maxTextLength: 5 });
      const result = await custom.transformResult({
        content: [{ type: 'text', text: 'Hello, world!' }],
      });

      expect((result.content[0] as any).text).toBe('Hello');
      expect((result.content[0] as any).truncated).toBe(true);
    });

    it('should respect custom maxImageBytes', async () => {
      const custom = new MCPResultTransformer({ maxImageBytes: 10 });
      const result = await custom.transformResult({
        content: [{
          type: 'image',
          base64: 'A'.repeat(100),
          mimeType: 'image/png',
          sizeBytes: 50,
        }],
      });

      expect((result.content[0] as any).resized).toBe(true);
    });

    it('should respect custom maxTotalBytes', async () => {
      const custom = new MCPResultTransformer({ maxTotalBytes: 20 });
      const result = await custom.transformResult({
        content: [
          { type: 'text', text: '12345678901234567890' }, // 20 chars
          { type: 'text', text: 'extra' },
        ],
      });

      expect(result.wasTruncated).toBe(true);
      expect(result.content).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content array', async () => {
      const result = await transformer.transformResult({
        content: [] as any,
      });

      expect(result.content).toHaveLength(0);
    });

    it('should handle missing content field', async () => {
      const result = await transformer.transformResult({} as any);
      expect(result.content).toHaveLength(0);
    });
  });
});
