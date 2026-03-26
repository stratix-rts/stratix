import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object for Project Management (ProjectListPanel, ProjectConfigPanel)
 */
export class ProjectPage {
  readonly page: Page;

  // ProjectListPanel locators
  readonly projectListPanel: Locator;
  readonly projectItems: Locator;
  readonly createProjectButton: Locator;
  readonly refreshButton: Locator;
  readonly projectCount: Locator;

  // ProjectConfigPanel locators
  readonly configModal: Locator;
  readonly projectNameInput: Locator;
  readonly projectDescriptionInput: Locator;
  readonly localFolderPathInput: Locator;
  readonly requirementTextarea: Locator;
  readonly prioritySelect: Locator;
  readonly agentModeSelect: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  // Project item actions
  readonly startButton: Locator;
  readonly pauseButton: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // ProjectListPanel
    this.projectListPanel = page.locator('.project-list-panel');
    this.projectItems = page.locator('.project-item');
    this.createProjectButton = page.locator('.btn-create');
    this.refreshButton = page.locator('.btn-refresh');
    this.projectCount = page.locator('.project-count');

    // ProjectConfigPanel modal
    this.configModal = page.locator('.stratix-modal');
    this.projectNameInput = page.locator('input[placeholder="请输入项目名称"]');
    this.projectDescriptionInput = page.locator('textarea[placeholder*="项目描述"]');
    this.localFolderPathInput = page.locator('input[placeholder*="文件夹路径"]');
    this.requirementTextarea = page.locator('textarea[placeholder*="项目需求"]');
    this.prioritySelect = page.locator('.project-config-form select').first();
    this.agentModeSelect = page.locator('.project-config-form select').nth(1);
    this.saveButton = page.locator('.dialog-footer button:has-text("保存")');
    this.cancelButton = page.locator('.dialog-footer button:has-text("取消")');

    // Project item action buttons
    this.startButton = page.locator('.btn-start');
    this.pauseButton = page.locator('.btn-pause');
    this.editButton = page.locator('.btn-edit');
    this.deleteButton = page.locator('.btn-delete');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(2000);
  }

  async openProjectList(): Promise<void> {
    // Project list panel should be visible on main page
    await this.projectListPanel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      // Panel might not be visible by default, check if there's a toggle
      const toggleBtn = this.page.locator('button:has-text("项目")');
      if (toggleBtn.isVisible()) {
        toggleBtn.click();
      }
    });
  }

  async getProjectCount(): Promise<number> {
    const countText = await this.projectCount.textContent();
    const match = countText?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async selectProject(projectName: string): Promise<void> {
    await this.projectItems.filter({ hasText: projectName }).click();
    await this.page.waitForTimeout(300);
  }

  async createProject(data: {
    name: string;
    description?: string;
    localFolderPath: string;
    requirement: string;
    priority?: number;
  }): Promise<void> {
    await this.createProjectButton.click();
    await this.page.waitForTimeout(500);

    // Fill in the form
    await this.projectNameInput.fill(data.name);
    if (data.description) {
      await this.projectDescriptionInput.fill(data.description);
    }
    await this.localFolderPathInput.fill(data.localFolderPath);
    await this.requirementTextarea.fill(data.requirement);

    if (data.priority) {
      await this.prioritySelect.selectOption(String(data.priority));
    }

    // Submit
    await this.saveButton.click();
    await this.page.waitForTimeout(500);
  }

  async editProject(projectName: string, updates: {
    name?: string;
    description?: string;
    requirement?: string;
  }): Promise<void> {
    await this.selectProject(projectName);
    await this.editButton.click();
    await this.page.waitForTimeout(500);

    if (updates.name) {
      await this.projectNameInput.clear();
      await this.projectNameInput.fill(updates.name);
    }
    if (updates.description) {
      await this.projectDescriptionInput.clear();
      await this.projectDescriptionInput.fill(updates.description);
    }
    if (updates.requirement) {
      await this.requirementTextarea.clear();
      await this.requirementTextarea.fill(updates.requirement);
    }

    await this.saveButton.click();
    await this.page.waitForTimeout(500);
  }

  async deleteProject(projectName: string): Promise<void> {
    await this.selectProject(projectName);
    await this.deleteButton.click();
    // Handle confirmation dialog
    await this.page.waitForTimeout(300);
    const confirmDialog = this.page.locator('.stratix-confirm-dialog, [class*="confirm"]');
    if (await confirmDialog.isVisible()) {
      await confirmDialog.locator('button:has-text("确定"), button:has-text("确认")').click();
    } else if (this.page.locator('dialog').isVisible()) {
      await this.page.locator('dialog button:has-text("确定")').click();
    } else {
      // Native confirm - playwright handles it automatically
      this.page.on('dialog', dialog => dialog.accept());
      await this.deleteButton.click();
    }
    await this.page.waitForTimeout(500);
  }

  async startProject(projectName: string): Promise<void> {
    await this.selectProject(projectName);
    await this.startButton.click();
    await this.page.waitForTimeout(500);
  }

  async pauseProject(projectName: string): Promise<void> {
    await this.selectProject(projectName);
    await this.pauseButton.click();
    await this.page.waitForTimeout(500);
  }

  async getProjectStatus(projectName: string): Promise<string> {
    const item = this.projectItems.filter({ hasText: projectName });
    const statusEl = item.locator('.project-status');
    return await statusEl.textContent() || '';
  }
}
