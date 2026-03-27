import { Page } from '@playwright/test';

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CanvasHelper {
  constructor(private page: Page) {}

  /**
   * 等待 Phaser 场景初始化完成
   */
  async waitForPhaserReady(timeout: number = 15000): Promise<void> {
    try {
      await this.page.waitForFunction(() => {
        const scene = (window as any).__rtsGameScene__;
        return scene && scene.sys && scene.sys.isReady();
      }, { timeout });
    } catch (e) {
      console.log('Phaser ready wait timed out, checking alternative...');
      // 等待 canvas 出现
      await this.page.locator('canvas').waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  /**
   * 点击 Canvas 指定坐标
   */
  async clickCanvas(x: number, y: number): Promise<void> {
    const canvas = this.page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await this.page.mouse.click(box.x + x, box.y + y);
  }

  /**
   * 多次尝试点击 Zone 直到成功
   * 解决 Zone 中心可能落在网格线上的问题
   */
  async clickZoneWithRetry(zoneId: string, retries: number = 3): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      const bounds = await this.getZoneBounds(zoneId);
      if (!bounds) {
        console.log(`Zone ${zoneId} bounds not found, attempt ${i + 1}`);
        continue;
      }

      // 尝试多个偏移点
      const offsets = [
        { x: 0, y: 0 },
        { x: -bounds.width * 0.2, y: -bounds.height * 0.2 },
        { x: bounds.width * 0.2, y: -bounds.height * 0.2 },
        { x: -bounds.width * 0.2, y: bounds.height * 0.2 },
        { x: bounds.width * 0.2, y: bounds.height * 0.2 },
      ];

      for (const offset of offsets) {
        await this.clickCanvas(bounds.x + offset.x, bounds.y + offset.y);
        await this.page.waitForTimeout(200);

        // 检查是否选中
        const selected = await this.getSelectedZoneId();
        if (selected === zoneId) return true;
      }
    }
    return false;
  }

  /**
   * 双击 Canvas 指定坐标
   */
  async dblClickCanvas(x: number, y: number): Promise<void> {
    const canvas = this.page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await this.page.mouse.dblclick(box.x + x, box.y + y);
  }

  /**
   * 双击 Zone
   */
  async dblClickZone(zoneId: string): Promise<boolean> {
    const bounds = await this.getZoneBounds(zoneId);
    if (!bounds) return false;

    // 尝试多个偏移点
    const offsets = [
      { x: 0, y: 0 },
      { x: -bounds.width * 0.2, y: -bounds.height * 0.2 },
      { x: bounds.width * 0.2, y: -bounds.height * 0.2 },
      { x: -bounds.width * 0.2, y: bounds.height * 0.2 },
      { x: bounds.width * 0.2, y: bounds.height * 0.2 },
    ];

    for (const offset of offsets) {
      await this.dblClickCanvas(bounds.x + offset.x, bounds.y + offset.y);
      await this.page.waitForTimeout(300);

      // 检查面板是否打开（通过检查某个面板元素）
      const panelVisible = await this.page.locator('.zone-panel, .zone-detail, .stratix-modal').first().isVisible().catch(() => false);
      if (panelVisible) return true;
    }
    return false;
  }

  /**
   * 通过 projectId 获取 zone context ID
   * 因为 ProjectZone 存储的是 projectId，但 App.vue 需要 zone context ID
   */
  async getZoneContextIdByProjectId(projectId: string): Promise<string | null> {
    return await this.page.evaluate(async (pId) => {
      try {
        const response = await fetch(`/api/zones?projectId=${pId}`);
        const data = await response.json();
        if (data.zones && data.zones.length > 0) {
          return data.zones[0].id;
        }
        return null;
      } catch (e) {
        return null;
      }
    }, projectId);
  }

  /**
   * 获取当前选中的 Zone ID
   */
  async getSelectedZoneId(): Promise<string | null> {
    return await this.page.evaluate(() => {
      return (window as any).__SELECTED_ZONE_ID__;
    });
  }

  /**
   * 获取 Zone bounds
   */
  async getZoneBounds(zoneId: string): Promise<ZoneBounds | null> {
    return await this.page.evaluate((id) => {
      const scene = (window as any).__rtsGameScene__;
      if (!scene) return null;

      const zone = scene.unifiedZoneManager?.getZone(id);
      if (!zone) return null;

      const bounds = zone.getBounds();
      return {
        x: zone.x,
        y: zone.y,
        width: bounds.width,
        height: bounds.height
      };
    }, zoneId);
  }

  /**
   * 获取所有 Zone 信息
   */
  async getAllZones(): Promise<Array<{
    zoneId: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>> {
    return await this.page.evaluate(() => {
      const scene = (window as any).__rtsGameScene__;
      if (!scene || !scene.getZoneList) return [];
      return scene.getZoneList();
    });
  }

  /**
   * 检查 Phaser 场景是否可用
   */
  async isSceneAvailable(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const scene = (window as any).__rtsGameScene__;
      return !!(scene && scene.unifiedZoneManager);
    });
  }
}
