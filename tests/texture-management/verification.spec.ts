import { test, expect } from '@playwright/test';

/**
 * Texture Management Verification Tests
 */

test.describe('Texture Management - System Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('should display main canvas', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('should open hero modal', async ({ page }) => {
    await page.click('.toolbar button:has-text("英雄")');
    await expect(page.locator('.stratix-modal')).toBeVisible({ timeout: 5000 });
  });
});
