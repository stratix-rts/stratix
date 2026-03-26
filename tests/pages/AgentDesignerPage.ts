import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for the Agent Designer (Hero Designer) page
 */
export class AgentDesignerPage {
  readonly page: Page;

  // HeroForm locators
  readonly newAgentButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly backButton: Locator;
  readonly exportButton: Locator;
  readonly heroBadge: Locator;
  readonly headerTitle: Locator;
  readonly toastMessage: Locator;
  readonly agentList: Locator;

  // Tab navigation
  readonly tabSoul: Locator;
  readonly tabSkills: Locator;
  readonly tabMemory: Locator;
  readonly tabModel: Locator;

  // Type selector
  readonly typeSelect: Locator;

  // Soul editor fields
  readonly identityTextarea: Locator;
  readonly personalityTextarea: Locator;
  readonly goalInputs: Locator;
  readonly addGoalButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // HeroForm header buttons - "新建" is inside HeroManagementModal dropdown
    this.newAgentButton = page.locator('.stratix-modal button:has-text("新建"), button:has-text("新建")');
    this.saveButton = page.locator('button:has-text("保存"), button:has-text("Save")');
    this.cancelButton = page.locator('button:has-text("取消"), button:has-text("Cancel")');
    this.backButton = page.locator('button:has-text("返回"), button:has-text("Back")');
    this.exportButton = page.locator('button:has-text("导出"), button:has-text("Export")');
    this.heroBadge = page.locator('.hero-badge');
    this.headerTitle = page.locator('.header-title');
    this.toastMessage = page.locator('.toast, .message, [class*="toast"]');
    this.agentList = page.locator('[class*="agent-list"], [class*="hero-list"]');

    // Tab navigation
    this.tabSoul = page.locator('.tab-btn:has-text("Soul")');
    this.tabSkills = page.locator('.tab-btn:has-text("技能")');
    this.tabMemory = page.locator('.tab-btn:has-text("记忆")');
    this.tabModel = page.locator('.tab-btn:has-text("模型")');

    // Type selector
    this.typeSelect = page.locator('.type-select');

    // Soul editor fields
    this.identityTextarea = page.locator('.soul-editor textarea').first();
    this.personalityTextarea = page.locator('.soul-editor textarea').nth(1);
    this.goalInputs = page.locator('.goal-input input');
    this.addGoalButton = page.locator('button:has-text("添加目标"), button:has-text("Add Goal")');
  }

  async goto(): Promise<void> {
    // Navigate to main app and open hero modal via toolbar button
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
    // Click the hero button in toolbar to open HeroManagementModal
    await this.page.locator('.toolbar button:has-text("英雄")').click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Create a new agent with basic info via the HeroForm
   */
  async createNewAgent(): Promise<void> {
    await this.newAgentButton.click();
    await this.page.waitForTimeout(500);
    await this.saveButton.click();
    await this.waitForToast('success');
  }

  /**
   * Fill in the Soul editor with identity, goals, and personality
   */
  async fillSoulEditor(identity: string, goals: string[], personality: string): Promise<void> {
    // Make sure Soul tab is active
    await this.tabSoul.click();
    await this.page.waitForTimeout(300);

    // Fill identity
    if (identity) {
      await this.identityTextarea.fill(identity);
    }

    // Fill goals
    if (goals.length > 0) {
      const goalCount = await this.goalInputs.count();
      for (let i = 0; i < Math.min(goals.length, goalCount); i++) {
        await this.goalInputs.nth(i).fill(goals[i]);
      }
    }

    // Fill personality
    if (personality) {
      await this.personalityTextarea.fill(personality);
    }
  }

  /**
   * Set the agent type (writer, dev, analyst)
   */
  async setAgentType(type: 'writer' | 'dev' | 'analyst'): Promise<void> {
    await this.typeSelect.selectOption(type);
  }

  /**
   * Navigate to a specific tab
   */
  async selectTab(tab: 'soul' | 'skills' | 'memory' | 'model'): Promise<void> {
    switch (tab) {
      case 'soul':
        await this.tabSoul.click();
        break;
      case 'skills':
        await this.tabSkills.click();
        break;
      case 'memory':
        await this.tabMemory.click();
        break;
      case 'model':
        await this.tabModel.click();
        break;
    }
    await this.page.waitForTimeout(300);
  }

  async waitForToast(type: 'success' | 'error' = 'success', timeout: number = 5000): Promise<void> {
    // Wait for toast to appear
    await this.page.waitForTimeout(500);

    const toast = type === 'success'
      ? this.page.locator('.toast-success, [class*="toast"][class*="success"], .toast:has-text("成功"), .toast:has-text("saved")')
      : this.page.locator('.toast-error, [class*="toast"][class*="error"], .toast:has-text("失败"), .toast:has-text("error")');

    await toast.first().waitFor({ state: 'visible', timeout });
  }

  async getAgentCount(): Promise<number> {
    return await this.page.locator('[class*="agent-item"], [class*="hero-item"]').count();
  }

  async selectAgent(agentName: string): Promise<void> {
    await this.page.locator(`text=${agentName}`).click();
    await this.page.waitForTimeout(200);
  }

  async deleteAgent(agentName: string): Promise<void> {
    await this.selectAgent(agentName);
    await this.page.locator('button:has-text("删除"), button:has-text("Delete")').click();
    await this.page.locator('button:has-text("确认"), button:has-text("Confirm")').click();
    await this.waitForToast('success');
  }

  async isHeroFormVisible(): Promise<boolean> {
    return await this.heroBadge.isVisible({ timeout: 2000 }).catch(() => false);
  }
}

/**
 * Page Object for the Character Creator (Phaser scene)
 */
export class CharacterCreatorPage {
  readonly page: Page;
  readonly canvas: Locator;

  // Locators for parts
  readonly partSelector: Locator;
  readonly previewArea: Locator;
  readonly backendSelector: Locator;
  readonly chatPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvas = page.locator('canvas');
    this.partSelector = page.locator('[class*="part-selector"], [class*="PartSelector"]');
    this.previewArea = page.locator('[class*="preview"], [class*="Preview"]');
    this.backendSelector = page.locator('[class*="backend"], [class*="BackendSelector"]');
    this.chatPanel = page.locator('[class*="chat"], [class*="ChatPanel"]');
  }

  async goto(): Promise<void> {
    await this.page.goto('/character-creator');
    await this.page.waitForLoadState('networkidle');
    await this.waitForCanvasReady();
  }

  async waitForCanvasReady(timeout: number = 10000): Promise<void> {
    await this.canvas.waitFor({ state: 'visible', timeout });
    // Wait for Phaser to initialize
    await this.page.waitForTimeout(1000);
  }

  async getCanvas(): Promise<Locator> {
    return this.canvas;
  }

  async clickOnCanvas(x: number, y: number): Promise<void> {
    const canvasBox = await this.canvas.boundingBox();
    if (canvasBox) {
      await this.page.mouse.click(canvasBox.x + x, canvasBox.y + y);
    }
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.canvas.screenshot({ path: `tests/screenshots/${name}.png` });
  }
}

/**
 * Page Object for the main App shell
 */
export class AppPage {
  readonly page: Page;

  readonly navLinks: Locator;
  readonly header: Locator;

  constructor(page: Page) {
    this.page = page;
    this.navLinks = page.locator('nav a, [class*="nav"] a');
    this.header = page.locator('header, [class*="header"]');
  }

  async goto(path: string = '/'): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  async navigateTo(name: string): Promise<void> {
    await this.page.locator(`nav a:has-text("${name}"), [class*="nav"] a:has-text("${name}")`).click();
    await this.page.waitForLoadState('networkidle');
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }
}
