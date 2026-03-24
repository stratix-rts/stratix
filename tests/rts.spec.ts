import { test, expect } from '@playwright/test';

test.describe('Stratix RTS Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(500);
  });

  test('should render game canvas', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('should open hero modal', async ({ page }) => {
    await page.click('.toolbar button:has-text("英雄")');
    await expect(page.locator('.stratix-modal')).toBeVisible({ timeout: 5000 });
  });
});
