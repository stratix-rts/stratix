import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getCanvasBuffer, waitForPhaserReady } from './canvas-screenshot';

// Dynamic import for pixelmatch (CommonJS module)
let pixelmatch: any;
async function loadPixelmatch() {
  if (!pixelmatch) {
    const module = await import('pixelmatch');
    pixelmatch = module.default;
  }
  return pixelmatch;
}

export interface VisualDiffOptions {
  /** Threshold for pixel difference (0-1, default: 0.1 = 10%) */
  threshold?: number;
  /** Whether to save diff image on failure */
  saveDiffOnFailure?: boolean;
  /** Path to save diff images */
  diffPath?: string;
}

const DEFAULT_OPTIONS: Required<VisualDiffOptions> = {
  threshold: 0.1,
  saveDiffOnFailure: true,
  diffPath: 'tests/screenshots/diff',
};

const BASELINE_PATH = 'tests/screenshots/baseline';

/**
 * Get baseline screenshot path for a test
 */
export function getBaselinePath(
  testName: string,
  width: number = 1280,
  height: number = 720
): string {
  return path.join(BASELINE_PATH, `${testName}-${width}x${height}.png`);
}

/**
 * Get diff screenshot path
 */
export function getDiffPath(
  testName: string,
  width: number = 1280,
  height: number = 720
): string {
  return path.join(DEFAULT_OPTIONS.diffPath, `${testName}-${width}x${height}-diff.png`);
}

/**
 * Assert that a Phaser canvas matches the baseline screenshot
 */
export async function expectCanvasMatch(
  page: Page,
  testName: string,
  options: VisualDiffOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const width = 1280;
  const height = 720;

  await page.setViewportSize({ width, height });
  await waitForPhaserReady(page);

  const baselinePath = getBaselinePath(testName, width, height);
  const diffPath = getDiffPath(testName, width, height);

  // If no baseline exists, create it
  if (!fs.existsSync(baselinePath)) {
    console.log(`⚠️  No baseline found for "${testName}", creating new baseline at ${baselinePath}`);
    const dir = path.dirname(baselinePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const buffer = await getCanvasBuffer(page);
    fs.writeFileSync(baselinePath, buffer);
    return; // Pass - we just created the baseline
  }

  // Compare with baseline
  const baselineBuffer = fs.readFileSync(baselinePath);
  const currentBuffer = await getCanvasBuffer(page);

  // Load pixelmatch dynamically
  const pm = await loadPixelmatch();

  // Create PNG buffers from screenshots
  // pixelmatch expects raw RGBA data, but we have PNG
  // We need to decode PNG first - use a simple approach
  const baselineData = await decodePngToRgba(baselineBuffer);
  const currentData = await decodePngToRgba(currentBuffer);

  if (!baselineData || !currentData) {
    throw new Error('Failed to decode PNG images for comparison');
  }

  const { width: w, height: h, data: baselineRgba } = baselineData;
  const { data: currentRgba } = currentData!;

  // Create diff buffer
  const diff = Buffer.alloc(w * h * 3);

  const numDiffPixels = pm(baselineRgba, currentRgba, diff, w, h, {
    threshold: opts.threshold,
  });

  const totalPixels = w * h;
  const diffPercent = (numDiffPixels / totalPixels) * 100;

  if (diffPercent > opts.threshold * 100) {
    if (opts.saveDiffOnFailure) {
      const dir = path.dirname(diffPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Create a visual diff image (red pixels where differences exist)
      const diffImage = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const baselinePixel = i * 4;
        const currentPixel = i * 4;
        const diffPixel = i * 4;

        if (baselineRgba[baselinePixel] !== currentRgba[currentPixel] ||
            baselineRgba[baselinePixel + 1] !== currentRgba[currentPixel + 1] ||
            baselineRgba[baselinePixel + 2] !== currentRgba[currentPixel + 2]) {
          // Red pixel for difference
          diffImage[diffPixel] = 255;     // R
          diffImage[diffPixel + 1] = 0;   // G
          diffImage[diffPixel + 2] = 0;   // B
          diffImage[diffPixel + 3] = 255;  // A
        } else {
          // Semi-transparent for same
          diffImage[diffPixel] = 0;
          diffImage[diffPixel + 1] = 0;
          diffImage[diffPixel + 2] = 0;
          diffImage[diffPixel + 3] = 50;
        }
      }
      fs.writeFileSync(diffPath, Buffer.from(diffImage));
    }

    throw new Error(
      `Canvas visual mismatch: ${diffPercent.toFixed(2)}% pixels differ ` +
      `(threshold: ${(opts.threshold * 100).toFixed(0)}%). ` +
      `Diff saved to: ${diffPath}`
    );
  }
}

/**
 * Simple PNG decoder to extract RGBA data
 * Note: This is a minimal implementation. For production, consider using 'pngjs'
 */
async function decodePngToRgba(buffer: Buffer): Promise<{ width: number; height: number; data: Buffer } | null> {
  try {
    // Check PNG signature
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
      // Not a PNG, might be raw RGBA
      return null;
    }

    // Dynamic import pngjs
    const { default: PNG } = await import('pngjs');
    const png = PNG.sync.read(buffer);

    // Convert to RGBA (png.data is already RGBA, 4 bytes per pixel)
    const rgba = Buffer.alloc(png.width * png.height * 4);
    for (let i = 0; i < png.width * png.height; i++) {
      const src = i * 4;
      const dst = i * 4;
      rgba[dst] = png.data[src];     // R
      rgba[dst + 1] = png.data[src + 1]; // G
      rgba[dst + 2] = png.data[src + 2]; // B
      rgba[dst + 3] = png.data[src + 3]; // A (preserve transparency)
    }

    return { width: png.width, height: png.height, data: rgba };
  } catch (e) {
    // Fallback: if not a valid PNG, assume it's raw RGBA data
    const size = Math.sqrt(buffer.length / 4);
    if (Number.isInteger(size)) {
      return { width: size, height: size, data: buffer };
    }
    return null;
  }
}

/**
 * Update baseline screenshot for a test
 */
export async function updateBaseline(
  page: Page,
  testName: string,
  width: number = 1280,
  height: number = 720
): Promise<void> {
  await page.setViewportSize({ width, height });
  await waitForPhaserReady(page);

  const baselinePath = getBaselinePath(testName, width, height);
  const dir = path.dirname(baselinePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = await getCanvasBuffer(page);
  fs.writeFileSync(baselinePath, buffer);
  console.log(`✅ Updated baseline: ${baselinePath}`);
}
