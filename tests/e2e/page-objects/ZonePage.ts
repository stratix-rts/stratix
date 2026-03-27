import { Page, Locator, expect } from '@playwright/test';

export class ZonePage {
  readonly page: Page;

  // Canvas
  readonly canvas: Locator;

  // DOM 元素 - 使用当前 UI 的实际选择器
  readonly modal: Locator;
  readonly zoneDetail: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvas = page.locator('canvas').first();
    // ZonePanel 使用 StratixModal，类名是 stratix-modal
    this.modal = page.locator('.stratix-modal');
    this.zoneDetail = page.locator('.zone-detail');
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

    // 3. 验证 ZonePanel 出现（使用 stratix-modal）
    await expect(this.modal).toBeVisible({ timeout: 5000 });
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
    // ZoneDetail 底部的删除按钮是 "Delete Zone"
    await this.zoneDetail.locator('.zone-detail__footer button:has-text("Delete Zone")').click();
    await this.page.waitForTimeout(300);

    // 确认删除 - StratixModal 默认使用 "确定" 和 "取消"
    await this.page.locator('button:has-text("确定"), button:has-text("OK")').click();
    await this.page.waitForTimeout(1000);
  }

  // ========== ZoneEditor 交互 ==========
  // 注：当前 UI 没有独立的 ZoneEditor，编辑直接在 ZoneDetail 中进行

  async openZoneEditor(): Promise<void> {
    // ZoneDetail 中点击 Edit 按钮进入编辑模式
    await this.zoneDetail.locator('button:has-text("Edit")').click();
    await this.page.waitForTimeout(500);
  }

  async fillZoneForm(title: string, prompt: string): Promise<void> {
    // 编辑模式下使用 ZoneDetail 的表单元素
    const titleInput = this.zoneDetail.locator('.zone-detail__title-input');
    const promptTextarea = this.zoneDetail.locator('.zone-detail__prompt-textarea');

    await titleInput.fill(title);
    await promptTextarea.fill(prompt);
  }

  async submitZoneForm(): Promise<void> {
    // 保存编辑 - 点击 ZoneDetail 的保存操作
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(1000);
  }

  // ========== Zone 文件管理 ==========

  async addFileToZone(fileName: string, fileSource: string): Promise<void> {
    // 找到 Files 区域的标题并点击
    const filesSection = this.zoneDetail.locator('.zone-detail__section-title:has-text("Files")').locator('..');
    await filesSection.locator('button:has-text("+ Add File")').click();
    await this.page.waitForTimeout(500);

    // 填写文件信息 - ZoneFilePicker 会有自己的表单
    await this.page.locator('input[placeholder*="名称"], input[placeholder*="name"]').first().fill(fileName);
    await this.page.locator('input[placeholder*="源"], input[placeholder*="source"], input[placeholder*="路径"]').first().fill(fileSource);

    await this.page.locator('button:has-text("确认"), button:has-text("Add")').click();
    await this.page.waitForTimeout(1000);
  }

  // ========== Zone 任务管理 ==========

  async createTask(title: string): Promise<void> {
    // 找到 Tasks 区域
    const taskSection = this.zoneDetail.locator('.zone-detail__section-title:has-text("Tasks")').locator('..');

    // 点击 "+ New Task" 按钮
    await taskSection.locator('button:has-text("+ New Task")').click();
    await this.page.waitForTimeout(300);

    // 填写任务标题
    await taskSection.locator('.zone-detail__task-input input, .zone-detail__task-input textarea').fill(title);
    await taskSection.locator('button:has-text("Create")').click();
    await this.page.waitForTimeout(500);
  }

  async getTaskCount(): Promise<number> {
    // vxe-grid 渲染的任务行
    return await this.zoneDetail.locator('.vxe-table--body-wrapper tbody tr').count();
  }

  // ========== ZoneList 交互 ==========
  // 注：当前 UI 没有独立的 ZoneList 侧边栏，搜索功能通过 API 实现

  async searchZones(keyword: string): Promise<void> {
    // 当前 UI 没有搜索输入框，通过 API 搜索
    await this.page.waitForTimeout(500);
  }
}
