/**
 * ResultTransformer.ts
 *
 * MCP result transformation utility for handling large results safely.
 * Prevents oversized context from blowing up LLM context windows.
 *
 * @module stratix-core/openclaw
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Maximum character length for text blocks before truncation.
 */
export const MAX_TEXT_LENGTH = 50000;

/**
 * Maximum byte size for image data (5MB).
 */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * Suffix appended when text is truncated.
 */
const TRUNCATION_SUFFIX = '[truncated]';

/**
 * Union type of all possible result content blocks.
 */
export type ResultContent =
  | TextContent
  | ImageContent
  | FileRefContent;

/**
 * Text content block.
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Image content block with size tracking.
 */
export interface ImageContent {
  type: 'image';
  mimeType: string;
  sizeBytes: number;
  truncated?: boolean;
}

/**
 * File reference for binary data saved to temp file.
 */
export interface FileRefContent {
  type: 'file_ref';
  path: string;
  originalSize: number;
}

/**
 * ResultTransformer class for processing MCP tool results.
 * Handles text truncation, image size tracking, and binary data temp file storage.
 */
export class ResultTransformer {
  /**
   * Main entry point - transforms a raw result into structured content blocks.
   *
   * @param result - The raw result from MCP tool execution
   * @returns Array of ResultContent blocks
   */
  static transformResult(result: unknown): ResultContent[] {
    // Handle null/undefined
    if (result === null || result === undefined) {
      return [];
    }

    // Handle primitives
    if (typeof result === 'string') {
      return [this.transformText(result)];
    }

    if (typeof result === 'number' || typeof result === 'boolean') {
      return [this.transformText(String(result))];
    }

    // Handle arrays - flatten and process each item recursively
    if (Array.isArray(result)) {
      const blocks: ResultContent[] = [];
      for (const item of result) {
        blocks.push(...this.transformResult(item));
      }
      return blocks;
    }

    // Handle objects
    if (typeof result === 'object') {
      return this.transformObject(result as Record<string, unknown>);
    }

    // Fallback for unknown types
    return [this.transformText(String(result))];
  }

  /**
   * Transforms an object into appropriate content blocks.
   * Extracts from content/text/data fields and handles images/binary.
   */
  private static transformObject(obj: Record<string, unknown>): ResultContent[] {
    // Check for image type first
    if (this.isImage(obj)) {
      return [this.transformImage(obj)];
    }

    // Check for binary data that needs temp file storage
    if (this.isBinaryData(obj)) {
      return [this.transformBinaryToFile(obj)];
    }

    // Extract text from common fields
    const text = this.extractText(obj);
    if (text !== null) {
      return [this.transformText(text)];
    }

    // Fallback: serialize the object
    return [this.transformText(JSON.stringify(obj, null, 2))];
  }

  /**
   * Creates a TextContent block, truncating if necessary.
   */
  private static transformText(text: string): TextContent {
    const truncated = text.length > MAX_TEXT_LENGTH
      ? text.slice(0, MAX_TEXT_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
      : text;

    return { type: 'text', text: truncated };
  }

  /**
   * Detects if an object represents an image (base64 encoded).
   */
  private static isImage(obj: Record<string, unknown>): boolean {
    // Explicit type discriminator
    if (obj.type === 'image') return true;

    // Has base64 or data properties
    if (obj.data !== undefined || obj.base64 !== undefined) return true;

    // Has mimeType starting with image/
    if (typeof obj.mimeType === 'string' && obj.mimeType.startsWith('image/')) {
      return true;
    }

    return false;
  }

  /**
   * Transforms an image object into an ImageContent block.
   * Tracks size but does not compress - notes if > 5MB.
   */
  private static transformImage(obj: Record<string, unknown>): ImageContent {
    const data = (obj.data as string) || (obj.base64 as string) || '';
    const mimeType = (obj.mimeType as string) || 'image/png';

    // Calculate size: base64 is ~4/3 of original binary
    const sizeBytes = Math.round((data.length * 3) / 4);

    const truncated = sizeBytes > MAX_IMAGE_SIZE;

    return {
      type: 'image',
      mimeType,
      sizeBytes,
      truncated,
    };
  }

  /**
   * Detects binary data that should be written to temp file.
   */
  private static isBinaryData(obj: Record<string, unknown>): boolean {
    // Explicit type discriminator
    if (obj.type === 'binary' || obj.type === 'file') return true;

    // Has raw binary data as Buffer or Uint8Array
    if (obj.data instanceof Uint8Array || Buffer.isBuffer(obj.data)) return true;

    // Has data that looks like binary (not base64)
    if (
      typeof obj.data === 'object' &&
      obj.data !== null &&
      'type' in obj.data
    ) return true;

    return false;
  }

  /**
   * Writes binary data to a temp file and returns a reference.
   */
  private static transformBinaryToFile(obj: Record<string, unknown>): FileRefContent {
    const data = obj.data as Uint8Array | Buffer | string;
    const originalSize = data instanceof Uint8Array
      ? data.byteLength
      : Buffer.isBuffer(data)
        ? data.length
        : typeof data === 'string'
          ? new TextEncoder().encode(data).length
          : 0;

    // Write to temp file
    const tempDir = os.tmpdir();
    const fileName = `mcp_binary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(tempDir, fileName);

    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(filePath, data);
    } else if (data instanceof Uint8Array) {
      fs.writeFileSync(filePath, Buffer.from(data));
    } else {
      // Assume string, encode to buffer
      fs.writeFileSync(filePath, Buffer.from(data, 'utf-8'));
    }

    return {
      type: 'file_ref',
      path: filePath,
      originalSize,
    };
  }

  /**
   * Extracts text content from an object with various text fields.
   * Checks: text, content, description, message, result
   */
  private static extractText(obj: Record<string, unknown>): string | null {
    const fields = ['text', 'content', 'description', 'message', 'result'] as const;

    for (const field of fields) {
      if (typeof obj[field] === 'string') {
        return obj[field] as string;
      }
    }

    // Handle array with single string element
    if (Array.isArray(obj.content) && obj.content.length === 1 && typeof obj.content[0] === 'string') {
      return obj.content[0];
    }

    return null;
  }
}
