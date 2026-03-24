import { test, expect } from '@playwright/test';

/**
 * Simplified texture management integration tests
 */

test.describe('Texture Management System - Basic Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test('should display main layout with game canvas', async ({ page }) => {
    await expect(page.locator('.main-layout')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('should open hero modal', async ({ page }) => {
    await page.click('.toolbar button:has-text("英雄")');
    await expect(page.locator('.stratix-modal')).toBeVisible({ timeout: 5000 });
  });
});
