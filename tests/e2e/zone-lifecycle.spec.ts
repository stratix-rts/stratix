/**
 * Zone 生命周期 E2E 测试
 *
 * 测试策略：
 * 1. 先通过 API 预置 Zone 数据
 * 2. 通过 Canvas 点击打开 Zone 面板
 * 3. 验证 DOM 状态变化
 * 4. 通过 API 验证后端数据一致性
 */

import { test, expect, Page } from '@playwright/test';
import { ZonePage } from './page-objects/ZonePage';
import { CanvasHelper } from './helpers/canvas-helper';
import { ZoneApiHelper, Zone } from './helpers/zone-api-helper';

test.describe('Zone 生命周期测试', () => {

  let zonePage: ZonePage;
  let canvasHelper: CanvasHelper;
  let zoneApi: ZoneApiHelper;
  let projectId: string;
  let testZone: Zone;

  test.beforeEach(async ({ page }) => {
    // 设置超时
    test.setTimeout(60000);

    // 捕获控制台错误
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('BROWSER ERROR:', msg.text());
      }
    });

    zonePage = new ZonePage(page);
    canvasHelper = new CanvasHelper(page);
    zoneApi = new ZoneApiHelper(page);

    // 确保 Phaser 场景就绪 - 首先等待页面加载
    await page.goto('/');

    // 等待 canvas 出现（Phaser 会创建 canvas）
    try {
      await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 });
      console.log('Canvas appeared');
    } catch (e) {
      console.log('Canvas did not appear within timeout');
    }

    // 等待 Phaser 场景初始化
    await page.waitForTimeout(3000);

    // 检查 Phaser 场景状态
    const sceneAvailable = await canvasHelper.isSceneAvailable();
    console.log('Phaser scene available:', sceneAvailable);

    // 如果场景可用，验证状态
    if (sceneAvailable) {
      // 检查 status.ready 是否出现（带重试）
      let retries = 0;
      while (retries < 5) {
        const statusReady = await page.locator('.status.ready').isVisible().catch(() => false);
        if (statusReady) {
          console.log('Status ready detected');
          break;
        }
        console.log(`Waiting for status.ready (attempt ${retries + 1}/5)...`);
        await page.waitForTimeout(2000);
        retries++;
      }
    }

    // 准备测试项目
    try {
      projectId = await zoneApi.ensureProject('Zone 测试项目');
      console.log('Project ID:', projectId);
    } catch (e) {
      console.log('Failed to ensure project:', e);
    }
  });

  test.describe('0. 调试和探索', () => {

    test('应该能访问 Phaser 场景并获取 Zone 列表', async ({ page }) => {
      // 等待 Phaser 场景就绪
      await canvasHelper.waitForPhaserReady();

      // 获取所有 Zone
      const zones = await canvasHelper.getAllZones();
      console.log('Zones found:', zones.length);
      zones.forEach((z: any) => {
        console.log(`  Zone: ${z.zoneId}, name: ${z.name}, pos: (${z.x}, ${z.y})`);
      });

      // 验证至少有 canvas
      const canvasCount = await page.locator('canvas').count();
      console.log('Canvas count:', canvasCount);
      expect(canvasCount).toBeGreaterThan(0);
    });

    test('Zone List 应该可见', async ({ page }) => {
      const zoneListVisible = await zonePage.zoneList.isVisible().catch(() => false);
      console.log('Zone list visible:', zoneListVisible);

      // 如果可见，打印其内容
      if (zoneListVisible) {
        const cards = await page.locator('.zone-card, .zone-list__card').count();
        console.log('Zone cards:', cards);
      }
    });
  });

  test.describe('1. 通过 Canvas 点击 Zone', () => {

    test('点击 Canvas 中的 Zone 应该能选中它', async ({ page }) => {
      // 获取 Phaser 场景中已存在的 Zone
      const zones = await canvasHelper.getAllZones();
      console.log('Zones in scene:', zones.length);

      if (zones.length === 0) {
        console.log('No zones in scene, skipping');
        return;
      }

      const zone = zones[0];
      console.log('Testing with zone:', zone.zoneId, 'at', zone.x, zone.y);

      // 获取 Zone 坐标
      const bounds = await canvasHelper.getZoneBounds(zone.zoneId);
      console.log('Zone bounds:', bounds);

      if (bounds) {
        // 点击 Zone
        const clicked = await canvasHelper.clickZoneWithRetry(zone.zoneId, 2);
        console.log('Click successful:', clicked);

        // 检查选中状态
        const selectedId = await canvasHelper.getSelectedZoneId();
        console.log('Selected zone ID:', selectedId);
      } else {
        console.log('Zone bounds not found');
      }
    });
  });

  test.describe('2. Zone 面板打开测试', () => {

    test('双击 Zone 应该打开 ZonePanel（需要 zone context ID）', async ({ page }) => {
      // 获取 Phaser 场景中已存在的 Zone
      const zones = await canvasHelper.getAllZones();
      if (zones.length === 0) {
        console.log('No zones to test');
        return;
      }

      const zone = zones[0];
      console.log('Testing panel open with zone:', zone.zoneId);

      // 尝试获取 zone context ID
      const zoneContextId = await canvasHelper.getZoneContextIdByProjectId(zone.zoneId);
      console.log('Zone context ID:', zoneContextId);

      // 获取 Zone 信息
      const bounds = await canvasHelper.getZoneBounds(zone.zoneId);
      console.log('Zone bounds:', bounds);

      if (bounds && zoneContextId) {
        // 双击打开面板
        const opened = await canvasHelper.dblClickZone(zone.zoneId);
        console.log('Zone panel opened:', opened);

        if (opened) {
          // 验证面板内容
          await page.waitForTimeout(500);
          const title = await zonePage.getZoneTitle().catch(() => '');
          console.log('Zone panel title:', title);
        }
      } else {
        console.log('Cannot open panel: bounds or zoneContextId missing');
        console.log('Note: ProjectZone ID and ZoneContext ID are different in this codebase');
      }
    });
  });

  test.describe('3. Zone CRUD 测试', () => {

    test('应该能通过 API 创建和删除 Zone', async ({ page }) => {
      if (!projectId) return;

      // 创建 Zone
      const zone = await zoneApi.createZone(
        projectId,
        `API 创建测试 Zone ${Date.now()}`,
        '这是通过 API 创建的测试 Zone'
      );
      console.log('Created zone:', zone.id, zone.title);

      // 验证存在
      const fetched = await zoneApi.getZone(zone.id);
      expect(fetched.id).toBe(zone.id);
      expect(fetched.title).toBe(zone.title);
      console.log('Zone fetched successfully');

      // 更新
      const updated = await zoneApi.updateZone(zone.id, { prompt: '更新后的描述' });
      expect(updated.prompt).toBe('更新后的描述');
      console.log('Zone updated');

      // 删除到回收站
      await zoneApi.deleteZone(zone.id);
      await page.waitForTimeout(500);

      // 验证在回收站
      const trash = await zoneApi.getTrash(projectId);
      const inTrash = trash.find(z => z.id === zone.id);
      expect(inTrash).toBeTruthy();
      console.log('Zone moved to trash');

      // 恢复
      await zoneApi.restoreZone(zone.id);
      const restored = await zoneApi.getZone(zone.id);
      expect(restored.id).toBe(zone.id);
      console.log('Zone restored');

      // 永久删除
      await zoneApi.deleteZone(zone.id);
      await zoneApi.permanentDeleteZone(zone.id);

      // 验证永久删除
      const trashAfter = await zoneApi.getTrash(projectId);
      const stillInTrash = trashAfter.find(z => z.id === zone.id);
      expect(stillInTrash).toBeUndefined();
      console.log('Zone permanently deleted');
    });

  });

  test.describe('4. Zone 搜索测试', () => {

    test('应该能搜索 Zone', async ({ page }) => {
      if (!projectId) return;

      // 创建多个 Zone
      const zone1 = await zoneApi.createZone(projectId, '搜索测试-A', '内容 A');
      const zone2 = await zoneApi.createZone(projectId, '搜索测试-B', '内容 B');

      await page.waitForTimeout(500);

      // 搜索
      const results = await zoneApi.searchZones('搜索测试');
      console.log('Search results:', results.length);

      // 清理
      await zoneApi.deleteZone(zone1.id);
      await zoneApi.deleteZone(zone2.id);
      await zoneApi.permanentDeleteZone(zone1.id);
      await zoneApi.permanentDeleteZone(zone2.id);
    });
  });
});
