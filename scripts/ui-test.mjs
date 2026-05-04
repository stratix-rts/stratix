#!/usr/bin/env node
/**
 * UI Auto-Tester for Stratix
 * 
 * 1. Launch browser, navigate to app
 * 2. Take screenshots of key states
 * 3. Output screenshot paths for analysis
 * 
 * Usage: node scripts/ui-test.mjs [--state <state>] [--screenshot-dir <dir>]
 * 
 * States: idle, zone-created, agent-created, theme-switched
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const BASE_URL = getArg('url') || 'http://localhost:7523';
const SCREENSHOT_DIR = getArg('screenshot-dir') || path.join(ROOT, '.ui-test-screenshots');
const STATE = getArg('state') || 'all';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureBackend() {
  try {
    const res = await fetch('http://localhost:7524/health');
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

async function run() {
  console.log('[UI-Test] Checking backend...');
  const backendOk = await ensureBackend();
  if (!backendOk) {
    console.error('[UI-Test] Backend not running on :7524');
    process.exit(1);
  }
  console.log('[UI-Test] Backend OK');

  // Clean screenshot dir
  if (fs.existsSync(SCREENSHOT_DIR)) {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true });
  }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('[UI-Test] Launching browser...');
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Collect console messages
  const consoleMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.log(`[Browser Console ERROR] ${text}`);
    }
  });

  // Collect network errors
  const networkErrors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      const url = response.url().replace(BASE_URL, '');
      networkErrors.push({ status: response.status(), url });
      console.log(`[Network Error] ${response.status()} ${url}`);
    }
  });

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(error.message);
    console.log(`[Page Error] ${error.message}`);
  });

  try {
    console.log('[UI-Test] Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000); // Wait for Phaser to init

    // Screenshot 1: Initial state
    if (STATE === 'all' || STATE === 'idle') {
      const path1 = path.join(SCREENSHOT_DIR, '01-idle.png');
      await page.screenshot({ path: path1, fullPage: true });
      console.log(`[UI-Test] Screenshot: ${path1}`);
    }

    // Screenshot 2: Right-click on canvas (test agent move command)
    if (STATE === 'all' || STATE === 'right-click') {
      const canvas = await page.locator('canvas').first();
      if (await canvas.count() > 0) {
        const box = await canvas.boundingBox();
        if (box) {
          // Right-click in center of canvas
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await sleep(500);
          const path2 = path.join(SCREENSHOT_DIR, '02-right-click.png');
          await page.screenshot({ path: path2, fullPage: true });
          console.log(`[UI-Test] Screenshot: ${path2}`);
        }
      }
    }

    // Screenshot 3: Draw a zone (click and drag)
    if (STATE === 'all' || STATE === 'zone-draw') {
      const canvas = await page.locator('canvas').first();
      if (await canvas.count() > 0) {
        const box = await canvas.boundingBox();
        if (box) {
          // First need to enable zone drawing mode - look for zone button
          // Try clicking the zone draw button in UI
          const zoneBtn = page.locator('button:has-text("Zone"), [data-testid="zone-btn"]').first();
          if (await zoneBtn.count() > 0) {
            await zoneBtn.click();
            await sleep(500);
          }
          
          // Draw zone by click-drag on canvas
          const startX = box.x + 200;
          const startY = box.y + 200;
          const endX = box.x + 500;
          const endY = box.y + 400;
          
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await sleep(100);
          // Move slowly
          for (let i = 0; i <= 10; i++) {
            const x = startX + (endX - startX) * i / 10;
            const y = startY + (endY - startY) * i / 10;
            await page.mouse.move(x, y);
            await sleep(50);
          }
          await page.mouse.up();
          await sleep(1000);

          const path3 = path.join(SCREENSHOT_DIR, '03-zone-drawn.png');
          await page.screenshot({ path: path3, fullPage: true });
          console.log(`[UI-Test] Screenshot: ${path3}`);
        }
      }
    }

    // Screenshot 4: After theme switch
    if (STATE === 'all' || STATE === 'theme') {
      // Look for theme selector
      const themeBtn = page.locator('[data-testid="theme-btn"], button:has-text("Theme"), .theme-selector').first();
      if (await themeBtn.count() > 0) {
        await themeBtn.click();
        await sleep(500);
        // Click second theme option
        const options = page.locator('.theme-option, [data-theme]');
        if (await options.count() > 1) {
          await options.nth(1).click();
          await sleep(2000);
        }
      }

      const path4 = path.join(SCREENSHOT_DIR, '04-theme-switched.png');
      await page.screenshot({ path: path4, fullPage: true });
      console.log(`[UI-Test] Screenshot: ${path4}`);
    }

  } catch (err) {
    console.error('[UI-Test] Error:', err.message);
    // Take error screenshot
    const errorPath = path.join(SCREENSHOT_DIR, 'error.png');
    try {
      await page.screenshot({ path: errorPath, fullPage: true });
      console.log(`[UI-Test] Error screenshot: ${errorPath}`);
    } catch {}
  }

  // Output report
  const report = {
    consoleErrors: consoleMessages.filter(m => m.type === 'error'),
    networkErrors,
    pageErrors,
    screenshots: fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png')),
  };

  const reportPath = path.join(SCREENSHOT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[UI-Test] Report: ${reportPath}`);
  console.log(`[UI-Test] Console errors: ${report.consoleErrors.length}`);
  console.log(`[UI-Test] Network errors: ${report.networkErrors.length}`);
  console.log(`[UI-Test] Page errors: ${report.pageErrors.length}`);
  console.log(`[UI-Test] Screenshots: ${report.screenshots.join(', ')}`);

  await browser.close();
  
  // Exit with error code if there are critical issues
  if (report.pageErrors.length > 0 || report.networkErrors.filter(e => e.status >= 500).length > 0) {
    process.exit(2);
  }
}

run().catch(err => {
  console.error('[UI-Test] Fatal:', err);
  process.exit(1);
});
