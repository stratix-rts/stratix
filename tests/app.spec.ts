import { test, expect } from '@playwright/test';

test.describe('Stratix Application', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('BROWSER ERROR:', msg.text());
      }
    });
    page.on('pageerror', error => {
      console.log('PAGE ERROR:', error.message);
    });
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('should load the application', async ({ page }) => {
    await expect(page.locator('.main-layout')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.logo-text')).toContainText('Stratix 星策系统');
  });

  test('should show system ready status', async ({ page }) => {
    await expect(page.locator('.status.ready')).toBeVisible({ timeout: 10000 });
  });

  test('should open hero modal', async ({ page }) => {
    // Click 英雄 button
    await page.click('.toolbar button:has-text("英雄")');
    // Modal should open
    await expect(page.locator('.stratix-modal')).toBeVisible({ timeout: 5000 });
  });

  test('should display RTS game canvas', async ({ page }) => {
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await expect(page.locator('canvas')).toBeVisible();
  });
});
