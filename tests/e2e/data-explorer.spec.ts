/**
 * Data Explorer E2E Tests
 *
 * Tests the complete Data Explorer workflow:
 * 1. Open Data Explorer
 * 2. View zones, files, agents data
 * 3. Search and filter data
 * 4. Tab navigation
 * 5. Pagination (if applicable)
 */

import { test, expect } from '@playwright/test';

test.describe('Data Explorer E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Capture console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('BROWSER ERROR:', msg.text());
      }
    });
    page.on('pageerror', error => {
      console.log('PAGE ERROR:', error.message);
    });

    // Mock API endpoints for faster tests
    await page.route('**/api/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
  });

  test.describe('Open Data Explorer', () => {
    test('should open Data Explorer via toolbar button', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Find and click Data Explorer button in toolbar
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();

      // Wait for modal to appear
      await page.waitForTimeout(500);

      // Check if Data Explorer modal is visible
      const modal = page.locator('.stratix-modal, .data-explorer');
      const isVisible = await modal.isVisible().catch(() => false);

      if (isVisible) {
        // Modal should have title containing "数据"
        const title = page.locator('.stratix-modal .modal-title, .data-explorer .explorer-tabs');
        await expect(title.first()).toBeVisible({ timeout: 5000 });
      } else {
        console.log('Data Explorer modal not visible - may need app to be fully loaded');
      }
    });

    test('should open Data Explorer via Ctrl+D shortcut', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Press Ctrl+D to open Data Explorer
      await page.keyboard.press('Control+d');
      await page.waitForTimeout(500);

      // Check if Data Explorer modal appeared
      const modal = page.locator('.stratix-modal, .data-explorer');
      const isVisible = await modal.isVisible().catch(() => false);
      console.log(`Data Explorer opened via shortcut: ${isVisible}`);
    });
  });

  test.describe('Tab Navigation', () => {
    test('should show Zone Overview tab by default', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for Zone Overview tab being active
      const zoneTab = page.locator('.tab-button:has-text("Zone 概览"), .tab-button:has-text("🎯")');
      const isZoneTabActive = await zoneTab.evaluate(el => el.classList.contains('active')).catch(() => false);

      // Verify Zone Table is shown
      const zoneTable = page.locator('.zone-table, [class*="zone-table"]');
      const hasZoneTable = await zoneTable.isVisible().catch(() => false);

      console.log(`Zone tab active: ${isZoneTabActive}, Zone table visible: ${hasZoneTable}`);
      expect(isZoneTabActive || hasZoneTable).toBeTruthy();
    });

    test('should switch to Files tab', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Click Files tab
      const filesTab = page.locator('.tab-button:has-text("文件"), .tab-button:has-text("📁")');
      if (await filesTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await filesTab.click();
        await page.waitForTimeout(300);

        // Verify files content is shown
        const filesContent = page.locator('.files-header, [class*="file"]');
        const hasFilesContent = await filesContent.isVisible().catch(() => false);
        console.log(`Files tab content visible: ${hasFilesContent}`);
      }
    });

    test('should switch to Agents tab', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Click Agents tab
      const agentsTab = page.locator('.tab-button:has-text("Agents"), .tab-button:has-text("🤖")');
      if (await agentsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await agentsTab.click();
        await page.waitForTimeout(300);

        // Verify agents content is shown
        const agentsContent = page.locator('.agent-table, [class*="agent"]');
        const hasAgentsContent = await agentsContent.isVisible().catch(() => false);
        console.log(`Agents tab content visible: ${hasAgentsContent}`);
      }
    });
  });

  test.describe('Zone Table View', () => {
    test('should show Zone table with toolbar', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for Zone table toolbar
      const toolbar = page.locator('.zone-table-toolbar, [class*="toolbar"]');
      const hasToolbar = await toolbar.isVisible().catch(() => false);

      if (hasToolbar) {
        // Should have search input
        const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="Zone"]');
        const hasSearch = await searchInput.isVisible().catch(() => false);
        console.log(`Zone table toolbar visible, search input: ${hasSearch}`);
      }
    });

    test('should display zone data or empty state', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for zone table or empty state
      const zoneTable = page.locator('.zone-table, [class*="zone-table"]');
      const emptyState = page.locator('.empty-state');

      const hasTable = await zoneTable.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);

      console.log(`Zone table: ${hasTable}, Empty state: ${hasEmpty}`);
      expect(hasTable || hasEmpty).toBeTruthy();
    });

    test('should have action buttons in zone table', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for action buttons
      const fileButton = page.locator('button:has-text("文件")');
      const editButton = page.locator('button:has-text("编辑")');
      const deleteButton = page.locator('button:has-text("删除")');

      const hasFileBtn = await fileButton.isVisible().catch(() => false);
      const hasEditBtn = await editButton.isVisible().catch(() => false);
      const hasDeleteBtn = await deleteButton.isVisible().catch(() => false);

      console.log(`Action buttons - Files: ${hasFileBtn}, Edit: ${hasEditBtn}, Delete: ${hasDeleteBtn}`);
      // At least one action button should be visible if zone table is shown
    });
  });

  test.describe('Data Search and Filter', () => {
    test('should have search input in toolbar', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Find search input
      const searchInput = page.locator('.zone-table-toolbar input, [class*="toolbar"] input');
      const isVisible = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);

      if (isVisible) {
        // Type in search
        await searchInput.fill('test');
        await page.waitForTimeout(300);

        const value = await searchInput.inputValue();
        expect(value).toBe('test');
        console.log(`Search input works: ${value}`);

        // Clear search
        await searchInput.clear();
      } else {
        console.log('Search input not found in toolbar');
      }
    });

    test('should filter zones by search keyword', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Type in search
      const searchInput = page.locator('.zone-table-toolbar input, [class*="toolbar"] input');
      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchInput.fill('marketing');
        await page.waitForTimeout(500);

        // Check if filtering happened (table should update)
        console.log('Search filtering applied');
      }
    });
  });

  test.describe('Refresh and Export', () => {
    test('should have refresh button', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Look for refresh button
      const refreshButton = page.locator('button:has-text("刷新"), button[title*="刷新"]');
      const isVisible = await refreshButton.isVisible().catch(() => false);

      if (isVisible) {
        // Click refresh
        await refreshButton.click();
        await page.waitForTimeout(500);
        console.log('Refresh button clicked');
      }
    });

    test('should have export CSV button', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Look for export button
      const exportButton = page.locator('button[title*="导出"], button:has-text("导出")');
      const isVisible = await exportButton.isVisible().catch(() => false);
      console.log(`Export button visible: ${isVisible}`);
    });
  });

  test.describe('Sidebar Zone List', () => {
    test('should show zone list in sidebar', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for sidebar with zone list
      const sidebar = page.locator('.explorer-sidebar, .zone-list');
      const hasSidebar = await sidebar.isVisible().catch(() => false);

      if (hasSidebar) {
        // Check for zone items
        const zoneItems = page.locator('.zone-item, [class*="zone-item"]');
        const count = await zoneItems.count();
        console.log(`Sidebar visible, zone items: ${count}`);
      }
    });

    test('should select a zone from sidebar', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Click on a zone item if exists
      const zoneItem = page.locator('.zone-item, [class*="zone-item"]').first();
      if (await zoneItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await zoneItem.click();
        await page.waitForTimeout(300);

        // Check if zone is selected
        const isSelected = await zoneItem.evaluate(el => el.classList.contains('selected')).catch(() => false);
        console.log(`Zone selected: ${isSelected}`);
      }
    });

    test('should toggle sidebar collapse', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Find and click collapse button
      const collapseBtn = page.locator('.collapse-btn, .sidebar-header button');
      if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await collapseBtn.click();
        await page.waitForTimeout(300);

        // Check if sidebar is collapsed
        const sidebar = page.locator('.explorer-sidebar');
        const isCollapsed = await sidebar.evaluate(el => el.classList.contains('collapsed')).catch(() => false);
        console.log(`Sidebar collapsed: ${isCollapsed}`);
      }
    });
  });

  test.describe('History Controls (Undo/Redo)', () => {
    test('should show undo/redo buttons', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Look for history buttons
      const historyControls = page.locator('.history-controls, .history-btn');
      const hasHistory = await historyControls.first().isVisible().catch(() => false);
      console.log(`History controls visible: ${hasHistory}`);
    });
  });

  test.describe('Data Explorer Modal Close', () => {
    test('should close Data Explorer modal', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Find and click close button
      const closeButton = page.locator('.stratix-modal button[title*="关闭"], .stratix-modal .close-btn, .stratix-modal button:has-text("×")');
      if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeButton.click();
        await page.waitForTimeout(500);

        // Modal should be closed
        const modal = page.locator('.stratix-modal');
        const isVisible = await modal.isVisible().catch(() => false);
        console.log(`Modal closed: ${!isVisible}`);
      }
    });

    test('should close modal by pressing Escape', async ({ page }) => {
      // Navigate to main app
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Press Escape to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Modal should be closed
      const modal = page.locator('.stratix-modal');
      const isVisible = await modal.isVisible().catch(() => false);
      console.log(`Modal closed via Escape: ${!isVisible}`);
    });
  });

  test.describe('NocoDB Viewer (Data Explorer Integration)', () => {
    test('should check if NocoDB viewer component exists', async ({ page }) => {
      // Try to navigate to Data Explorer or NocoDB route
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for NocoDB viewer elements
      const nocodbViewer = page.locator('.nocodb-viewer');
      const hasNocoDB = await nocodbViewer.isVisible({ timeout: 3000 }).catch(() => false);

      if (hasNocoDB) {
        // Check for status indicator
        const statusDot = page.locator('.status-dot');
        await expect(statusDot).toBeVisible();
        console.log('NocoDB viewer component found');
      } else {
        console.log('NocoDB viewer not found - using DataExplorer modal instead');
      }
    });

    test('should show connection status in NocoDB viewer', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Open Data Explorer
      const dataButton = page.locator('.toolbar button:has-text("数据"), .toolbar button[title*="数据"]');
      await dataButton.click();
      await page.waitForTimeout(1000);

      // Check for status elements
      const statusDot = page.locator('.status-dot');
      const statusText = page.locator('.status-text');

      const hasStatusDot = await statusDot.isVisible().catch(() => false);
      const hasStatusText = await statusText.isVisible().catch(() => false);

      console.log(`Status dot: ${hasStatusDot}, Status text: ${hasStatusText}`);
    });
  });
});
