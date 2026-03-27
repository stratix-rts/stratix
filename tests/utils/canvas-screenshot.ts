import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export interface ScreenshotOptions {
  /** Wait time in ms after page load before screenshot (default: 1000) */
  waitAfterLoad?: number;
  /** Wait time in ms after action before screenshot (default: 300) */
  waitAfterAction?: number;
  /** Viewport width (default: 1280) */
  width?: number;
  /** Viewport height (default: 720) */
  height?: number;
}

const DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
  waitAfterLoad: 1000,
  waitAfterAction: 300,
  width: 1280,
  height: 720,
};

/**
 * Capture a screenshot of a Phaser canvas element
 */
export async function captureCanvasScreenshot(
  page: Page,
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  await page.setViewportSize({ width: opts.width, height: opts.height });
  await page.waitForTimeout(opts.waitAfterLoad);

  const canvas = page.locator('canvas').first();
  const screenshot = await canvas.screenshot();

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, screenshot);
}

/**
 * Capture full page screenshot
 */
export async function capturePageScreenshot(
  page: Page,
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  await page.setViewportSize({ width: opts.width, height: opts.height });
  await page.waitForTimeout(opts.waitAfterLoad);

  const screenshot = await page.screenshot();

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, screenshot);
}

/**
 * Get canvas as buffer for comparison
 */
export async function getCanvasBuffer(page: Page): Promise<Buffer> {
  const canvas = page.locator('canvas').first();
  return await canvas.screenshot();
}

/**
 * Wait for Phaser to be ready (canvas exists and has content)
 */
export async function waitForPhaserReady(
  page: Page,
  timeout: number = 5000
): Promise<void> {
  await page.waitForSelector('canvas', { timeout });

  // Wait for Phaser to render at least one frame
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true; // WebGL canvas
    // Check if canvas has non-transparent pixels
    const imageData = ctx.getImageData(0, 0, 1, 1);
    return imageData.data.some(v => v !== 0);
  }, { timeout });
}
