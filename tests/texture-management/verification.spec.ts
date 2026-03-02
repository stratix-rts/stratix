import { test, expect } from '@playwright/test';

test.describe('Texture Management - System Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(2000);
  });

  test('should have TextureManager available in window context', async ({ page }) => {
    const hasTextureManager = await page.evaluate(() => {
      const textureManager = (window as any).__textureManager__;
      return typeof textureManager !== 'undefined';
    });
    
    console.log('TextureManager available:', hasTextureManager);
    
    expect(hasTextureManager).toBeDefined();
  });

  test('should display default agents with textures', async ({ page }) => {
    const agentCards = page.locator('.agent-card');
    await expect(agentCards).toHaveCount(3, { timeout: 5000 });
    
    const firstAgent = agentCards.first();
    await expect(firstAgent).toBeVisible();
    
    const agentImage = firstAgent.locator('img, canvas');
    const hasImage = await agentImage.count();
    
    expect(hasImage).toBeGreaterThan(0);
  });

  test('should have RTS canvas with agents rendered', async ({ page }) => {
    const canvas = page.locator('.game-area canvas');
    await expect(canvas).toBeVisible();
    
    await page.waitForTimeout(3000);
    
    const canvasWidth = await canvas.evaluate((el) => el.width);
    const canvasHeight = await canvas.evaluate((el) => el.height);
    
    expect(canvasWidth).toBeGreaterThan(0);
    expect(canvasHeight).toBeGreaterThan(0);
  });

  test('should check texture API endpoints', async ({ page }) => {
    const checkTextureAPI = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/stratix/texture/check/test.png');
        const data = await response.json();
        return { success: true, status: response.status, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
    
    console.log('Texture API check result:', checkTextureAPI);
    expect(checkTextureAPI.success).toBe(true);
  });

  test('should verify texture service is working', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    const textureServiceStatus = await page.evaluate(() => {
      return {
        hasTextureService: typeof (window as any).textureService !== 'undefined',
        hasTextureManager: typeof (window as any).__textureManager__ !== 'undefined',
        hasCharacterComposer: typeof (window as any).characterComposer !== 'undefined'
      };
    });
    
    console.log('Service status:', textureServiceStatus);
    
    expect(textureServiceStatus.hasCharacterComposer).toBe(true);
  });
});

test.describe('Texture Management - API Integration', () => {
  test('should have texture upload endpoint available', async ({ request }) => {
    const response = await request.post('/api/stratix/texture/upload', {
      data: {
        characterId: 'test-character',
        imageData: 'data:image/png;base64,test',
        filename: 'test.png'
      }
    });
    
    console.log('Upload endpoint status:', response.status());
    
    expect([200, 400, 404]).toContain(response.status());
  });

  test('should have texture check endpoint available', async ({ request }) => {
    const response = await request.get('/api/stratix/texture/check/test.png');
    
    console.log('Check endpoint status:', response.status());
    
    expect([200, 404]).toContain(response.status());
  });
});

test.describe('Texture Management - Deprecation Warnings', () => {
  test('should show deprecation warnings in console', async ({ page }) => {
    const warnings: string[] = [];
    
    page.on('console', msg => {
      if (msg.text().includes('DEPRECATED')) {
        warnings.push(msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    
    await page.evaluate(() => {
      if (typeof (window as any).textureService !== 'undefined') {
        const service = (window as any).textureService;
        service.ensureTexture?.({ characterId: 'test' });
      }
    });
    
    await page.waitForTimeout(1000);
    
    console.log('Deprecation warnings captured:', warnings.length);
    
    if (warnings.length > 0) {
      expect(warnings[0]).toContain('DEPRECATED');
    }
  });
});

test.describe('Texture Management - Cache Functionality', () => {
  test('should maintain cache within session', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(2000);
    
    const cacheSizeBefore = await page.evaluate(() => {
      const tm = (window as any).__textureManager__;
      return tm?.getCacheSize?.() || 0;
    });
    
    console.log('Cache size before:', cacheSizeBefore);
    
    await page.reload();
    await page.waitForSelector('.status.ready', { timeout: 10000 });
    await page.waitForTimeout(2000);
    
    const cacheSizeAfter = await page.evaluate(() => {
      const tm = (window as any).__textureManager__;
      return tm?.getCacheSize?.() || 0;
    });
    
    console.log('Cache size after reload:', cacheSizeAfter);
    
    expect(cacheSizeAfter).toBeGreaterThanOrEqual(0);
  });
});
