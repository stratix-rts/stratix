/**
 * MCPResultTransformer - Prevent large results from blowing up context
 *
 * Responsibilities:
 * - Text blocks: truncate if > 10000 chars
 * - Images: resize if > 2MB
 * - Binary: save to temp file, return file reference
 * - Overall result: cap at 50KB total
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TransformerConfig,
  DEFAULT_TRANSFORMER_CONFIG,
  TransformedResult,
  TransformedContentBlock,
  TextBlock,
  ImageBlock,
  BinaryBlock,
  ResourceBlock,
} from './types';

// Raw content block types from MCP responses
interface RawTextBlock {
  type: 'text';
  text: string;
}

interface RawImageBlock {
  type: 'image';
  url?: string;
  base64?: string;
  mimeType: string;
  sizeBytes?: number;
}

interface RawBinaryBlock {
  type: 'binary';
  data: string; // base64 encoded
  mimeType: string;
  fileName?: string;
}

interface RawResourceBlock {
  type: 'resource';
  uri: string;
  mimeType: string;
  sizeBytes?: number;
}

type RawContentBlock = RawTextBlock | RawImageBlock | RawBinaryBlock | RawResourceBlock;

export class MCPResultTransformer {
  private config: TransformerConfig;

  constructor(config: Partial<TransformerConfig> = {}) {
    this.config = { ...DEFAULT_TRANSFORMER_CONFIG, ...config };
  }

  /**
   * Transform an MCP result to prevent context overflow (async, handles binary blocks)
   */
  async transformResult(raw: { content?: RawContentBlock[] }): Promise<TransformedResult> {
    const content: TransformedContentBlock[] = [];
    const warnings: string[] = [];
    let totalSizeBytes = 0;
    let wasTruncated = false;

    const rawBlocks = raw.content ?? [];

    for (const block of rawBlocks) {
      // Check if adding this block would exceed total size cap
      const estimatedBlockSize = this.estimateBlockSize(block);
      if (totalSizeBytes + estimatedBlockSize > this.config.maxTotalBytes && content.length > 0) {
        wasTruncated = true;
        warnings.push(
          `Total result exceeded ${this.config.maxTotalBytes} bytes, ${rawBlocks.length - content.length} block(s) omitted`
        );
        break;
      }

      const transformed = await this.transformBlockAsync(block);
      if (transformed) {
        content.push(transformed);
        totalSizeBytes += this.getBlockSize(transformed);
      }
    }

    // If still over limit after all transforms, truncate text content
    if (totalSizeBytes > this.config.maxTotalBytes) {
      const excess = totalSizeBytes - this.config.maxTotalBytes;
      let lastTextIdx = -1;
      for (let i = content.length - 1; i >= 0; i--) {
        if (content[i].type === 'text') {
          lastTextIdx = i;
          break;
        }
      }

      if (lastTextIdx >= 0) {
        const lastText = content[lastTextIdx] as TextBlock;
        const charsToRemove = Math.ceil(excess / 2); // rough estimate
        const newText = lastText.text.slice(0, -charsToRemove);
        content[lastTextIdx] = { ...lastText, text: newText, truncated: true };
        wasTruncated = true;
        warnings.push(
          `Result truncated by ${charsToRemove} characters to fit ${this.config.maxTotalBytes} byte limit`
        );
        totalSizeBytes = this.recalculateSize(content);
      }
    }

    return {
      content,
      totalSizeBytes,
      wasTruncated,
      warnings,
    };
  }

  /**
   * Transform a single content block (async)
   */
  private async transformBlockAsync(block: RawContentBlock): Promise<TransformedContentBlock | null> {
    switch (block.type) {
      case 'text':
        return this.transformText(block);
      case 'image':
        return this.transformImage(block);
      case 'binary':
        return this.transformBinary(block);
      case 'resource':
        return this.transformResource(block);
      default:
        return null;
    }
  }

  /**
   * Transform text block: truncate if > maxTextLength
   */
  private transformText(block: RawTextBlock): TextBlock {
    if (block.text.length <= this.config.maxTextLength) {
      return { type: 'text', text: block.text };
    }

    const truncated = block.text.slice(0, this.config.maxTextLength);
    return { type: 'text', text: truncated, truncated: true };
  }

  /**
   * Transform image block: validate/reject if > maxImageBytes
   * Note: Actual resize would require image processing library
   * For now, we mark as resized if over limit (consumer handles actual resize)
   */
  private transformImage(block: RawImageBlock): ImageBlock {
    const base64Size = block.base64 ? Math.ceil((block.base64.length * 3) / 4) : 0;
    const sizeBytes = block.sizeBytes ?? base64Size;

    if (sizeBytes <= this.config.maxImageBytes) {
      return {
        type: 'image',
        url: block.url,
        base64: block.base64,
        mimeType: block.mimeType,
        sizeBytes,
        resized: false,
      };
    }

    return {
      type: 'image',
      url: block.url,
      base64: block.base64,
      mimeType: block.mimeType,
      sizeBytes,
      resized: true,
    };
  }

  /**
   * Transform binary block: save to temp file, return file reference
   */
  private async transformBinary(block: RawBinaryBlock): Promise<BinaryBlock> {
    const dataBuffer = Buffer.from(block.data, 'base64');
    const fileName = block.fileName ?? `mcp_binary_${Date.now()}`;
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, fileName);

    await fs.writeFile(filePath, dataBuffer);

    return {
      type: 'binary',
      filePath,
      fileName,
      mimeType: block.mimeType,
      sizeBytes: dataBuffer.length,
    };
  }

  /**
   * Transform resource block: pass through with size tracking
   */
  private transformResource(block: RawResourceBlock): ResourceBlock {
    return {
      type: 'resource',
      uri: block.uri,
      mimeType: block.mimeType,
      sizeBytes: block.sizeBytes ?? 0,
    };
  }

  /**
   * Estimate raw block size before transformation
   */
  private estimateBlockSize(block: RawContentBlock): number {
    switch (block.type) {
      case 'text':
        return new TextEncoder().encode(block.text).length;
      case 'image':
        return block.sizeBytes ?? (block.base64 ? Math.ceil((block.base64.length * 3) / 4) : 0);
      case 'binary':
        return Math.ceil((block.data.length * 3) / 4); // base64 -> bytes
      case 'resource':
        return block.sizeBytes ?? new TextEncoder().encode(block.uri).length;
      default:
        return 0;
    }
  }

  /**
   * Get actual size of a transformed block in bytes
   */
  private getBlockSize(block: TransformedContentBlock): number {
    switch (block.type) {
      case 'text':
        return new TextEncoder().encode(block.text).length;
      case 'image':
        return block.sizeBytes;
      case 'binary':
        return block.sizeBytes;
      case 'resource':
        return block.sizeBytes;
      default:
        return 0;
    }
  }

  /**
   * Recalculate total size of all blocks
   */
  private recalculateSize(blocks: TransformedContentBlock[]): number {
    return blocks.reduce((sum, b) => sum + this.getBlockSize(b), 0);
  }

  /**
   * Synchronous version of transformResult for cases where binary blocks
   * are not expected (throws if binary block encountered)
   */
  transformResultSync(raw: { content?: RawContentBlock[] }): TransformedResult {
    const content: TransformedContentBlock[] = [];
    const warnings: string[] = [];
    let totalSizeBytes = 0;
    let wasTruncated = false;

    const rawBlocks = raw.content ?? [];

    for (const block of rawBlocks) {
      if (block.type === 'binary') {
        throw new Error('Binary blocks require async transformation. Use transformResult() instead.');
      }

      const estimatedBlockSize = this.estimateBlockSize(block);
      if (totalSizeBytes + estimatedBlockSize > this.config.maxTotalBytes && content.length > 0) {
        wasTruncated = true;
        warnings.push(`Total result exceeded ${this.config.maxTotalBytes} bytes`);
        break;
      }

      const transformed = this.transformBlockSync(block);
      if (transformed) {
        content.push(transformed);
        totalSizeBytes += this.getBlockSize(transformed);
      }
    }

    return {
      content,
      totalSizeBytes,
      wasTruncated,
      warnings,
    };
  }

  /**
   * Transform a single content block (sync, for non-binary blocks)
   */
  private transformBlockSync(block: RawContentBlock): TransformedContentBlock | null {
    switch (block.type) {
      case 'text':
        return this.transformText(block);
      case 'image':
        return this.transformImage(block);
      case 'resource':
        return this.transformResource(block);
      default:
        return null;
    }
  }
}

// Singleton export
export const mcpResultTransformer = new MCPResultTransformer();
