import { Page, Locator, expect } from '@playwright/test';

export class ZonePage {
  readonly page: Page;

  // Canvas
  readonly canvas: Locator;

  // DOM 元素
  readonly zonePanel: Locator;
  readonly zoneDetail: Locator;
  readonly zoneEditor: Locator;
  readonly zoneList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvas = page.locator('canvas').first();
    this.zonePanel = page.locator('.zone-panel');
    this.zoneDetail = page.locator('.zone-detail');
    this.zoneEditor = page.locator('.zone-editor');
    this.zoneList = page.locator('.zone-list');
  }

  // ========== Canvas 交互 ==========

  /**
   * 通过 Phaser 场景获取 Zone 坐标并点击
   */
  async clickZoneInCanvas(zoneId: string): Promise<void> {
    const zoneInfo = await this.getZoneBounds(zoneId);
    if (!zoneInfo) throw new Error(`Zone ${zoneId} not found`);

    await this.canvas.click({
      position: { x: zoneInfo.x, y: zoneInfo.y }
    });
  }

  /**
   * 获取 Zone 在 Canvas 上的 bounds
   */
  async getZoneBounds(zoneId: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
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
   * 获取所有 Zone 的列表
   */
  async getAllZones(): Promise<any[]> {
    return await this.page.evaluate(() => {
      const scene = (window as any).__rtsGameScene__;
      if (!scene || !scene.getZoneList) return [];
      return scene.getZoneList();
    });
  }

  // ========== ZonePanel DOM 交互 ==========

  async openZonePanel(zoneId: string): Promise<void> {
    // 1. 先点击 Canvas 中的 Zone 选中
    await this.clickZoneInCanvas(zoneId);
    await this.page.waitForTimeout(500);

    // 2. 再次点击打开详情
    await this.clickZoneInCanvas(zoneId);
    await this.page.waitForTimeout(1000);

    // 3. 验证 ZonePanel 出现
    await expect(this.zonePanel).toBeVisible({ timeout: 5000 });
  }

  async closeZonePanel(): Promise<void> {
    await this.page.locator('.stratix-modal__close').click();
    await this.page.waitForTimeout(500);
  }

  // ========== ZoneDetail 交互 ==========

  async getZoneTitle(): Promise<string> {
    return await this.zoneDetail.locator('.zone-detail__title').textContent() ?? '';
  }

  async editZoneTitle(newTitle: string): Promise<void> {
    await this.zoneDetail.locator('.zone-detail__title').click();
    await this.page.waitForTimeout(300);

    const input = this.zoneDetail.locator('.zone-detail__title-input');
    await input.fill(newTitle);
    await input.press('Enter');
    await this.page.waitForTimeout(500);
  }

  async getZonePrompt(): Promise<string> {
    return await this.zoneDetail.locator('.zone-detail__prompt-textarea').inputValue();
  }

  async editZonePrompt(newPrompt: string): Promise<void> {
    const textarea = this.zoneDetail.locator('.zone-detail__prompt-textarea');
    await textarea.fill(newPrompt);
    await textarea.blur();
    await this.page.waitForTimeout(500);
  }

  async deleteZone(): Promise<void> {
    await this.zoneDetail.locator('.zone-detail__footer button:has-text("删除")').click();
    await this.page.waitForTimeout(300);

    // 确认删除
    await this.page.locator('button:has-text("确认")').click();
    await this.page.waitForTimeout(1000);
  }

  // ========== ZoneEditor 交互 ==========

  async openZoneEditor(): Promise<void> {
    // 尝试多种选择器打开 zone editor
    const addBtn = this.zoneList.locator('.zone-list__add-icon, .zone-list__header button, button:has-text("新建")').first();
    await addBtn.click();
    await this.page.waitForTimeout(500);

    // 等待 editor 出现
    await expect(this.zoneEditor).toBeVisible({ timeout: 5000 });
  }

  async fillZoneForm(title: string, prompt: string): Promise<void> {
    await this.page.locator('.zone-editor input, .zone-editor input[placeholder*="标题"], .zone-editor input[placeholder*="title"]').first().fill(title);
    await this.page.locator('.zone-editor textarea, .zone-editor textarea[placeholder*="描述"], .zone-editor textarea[placeholder*="prompt"]').first().fill(prompt);
  }

  async submitZoneForm(): Promise<void> {
    await this.page.locator('button:has-text("创建"), button:has-text("保存"), .zone-editor__footer button').click();
    await this.page.waitForTimeout(1000);
  }

  // ========== Zone 文件管理 ==========

  async addFileToZone(fileName: string, fileSource: string): Promise<void> {
    // 点击文件区域的标题展开
    const filesSection = this.zoneDetail.locator('.zone-detail__section').filter({ has: this.page.locator('.zone-detail__section-title:has-text("文件")') });
    await filesSection.locator('.zone-detail__section-title').click();
    await this.page.waitForTimeout(300);

    await filesSection.locator('button:has-text("添加文件")').click();
    await this.page.waitForTimeout(500);

    // 填写文件信息
    await this.page.locator('input[placeholder*="名称"], input[placeholder*="name"]').first().fill(fileName);
    await this.page.locator('input[placeholder*="源"], input[placeholder*="source"], input[placeholder*="路径"]').first().fill(fileSource);

    await this.page.locator('button:has-text("确认"), button:has-text("添加")').click();
    await this.page.waitForTimeout(1000);
  }

  // ========== Zone 任务管理 ==========

  async createTask(title: string): Promise<void> {
    const taskSection = this.zoneDetail.locator('.zone-detail__section').filter({ has: this.page.locator('.zone-detail__section-title:has-text("任务")') });

    await taskSection.locator('.zone-detail__task-create button, button:has-text("创建任务")').click();
    await this.page.waitForTimeout(300);

    await taskSection.locator('.zone-detail__task-input input, .zone-detail__task-input textarea, input[placeholder*="任务"]').fill(title);
    await taskSection.locator('button:has-text("创建")').click();
    await this.page.waitForTimeout(500);
  }

  async getTaskCount(): Promise<number> {
    return await this.zoneDetail.locator('.zone-detail__task-item').count();
  }

  // ========== ZoneList 交互 ==========

  async searchZones(keyword: string): Promise<void> {
    const searchInput = this.zoneList.locator('.zone-list__search-input, input[placeholder*="搜索"], input[placeholder*="search"]');
    await searchInput.fill(keyword);
    await this.page.waitForTimeout(500);
  }
}
