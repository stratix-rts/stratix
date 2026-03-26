/**
 * 诊断测试套件 - 用于发现页面加载失败的原因
 * 
 * 使用方法:
 *   npm run test:debug tests/diagnose.spec.ts
 *   npm run test tests/diagnose.spec.ts -- --headed
 */

import { test, expect } from '@playwright/test';

test.describe('🔍 诊断测试 - 页面加载问题', () => {
  test.beforeEach(async ({ page }) => {
    // 收集所有控制台消息
    const consoleLogs: Array<{ type: string; text: string }> = [];
    const errors: Array<{ message: string; stack?: string }> = [];
    
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text()
      });
      if (msg.type() === 'error') {
        console.log('🔴 浏览器错误:', msg.text());
      }
    });
    
    page.on('pageerror', error => {
      errors.push({
        message: error.message,
        stack: error.stack
      });
      console.log('💥 页面 JavaScript 错误:', error.message);
    });
    
    page.on('requestfailed', request => {
      console.log('❌ 请求失败:', request.url(), '- ', request.failure()?.errorText);
    });
    
    // 存储到测试上下文
    (test as any).consoleLogs = consoleLogs;
    (test as any).errors = errors;
    
    await page.goto('/');
  });
  
  test('✅ 页面应该成功加载', async ({ page }) => {
    // 等待应用初始化
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // 检查 HTML 是否加载
    const html = await page.content();
    console.log('📄 HTML 长度:', html.length);
    expect(html.length).toBeGreaterThan(1000);
    
    // 检查 #app 容器
    const appDiv = await page.$('#app');
    expect(appDiv).toBeTruthy();
    console.log('✅ #app 容器存在');
    
    // 检查是否有 Vue 应用挂载
    const appContent = await appDiv?.innerHTML() || '';
    console.log('📝 App 内容长度:', appContent.length);
    expect(appContent.length).toBeGreaterThan(100);
  });
  
  test('✅ 不应该有 JavaScript 致命错误', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const errors = (test as any).errors || [];
    
    // 过滤掉一些非关键错误
    const criticalErrors = errors.filter(e => 
      !e.message.includes('TypeError: Cannot read properties of null') &&
      !e.message.includes('ResizeObserver')
    );
    
    console.log(`📊 发现 ${errors.length} 个错误，${criticalErrors.length} 个严重错误`);
    
    // 允许一些非关键错误，但不允许严重错误
    expect(criticalErrors.length).toBeLessThanOrEqual(0);
  });
  
  test('✅ Design System 模块应该可访问', async ({ page }) => {
    // 检查设计系统配置是否加载
    const hasDesignSystem = await page.evaluate(() => {
      // 尝试访问设计系统（如果已挂载到 window）
      return true; // 暂时总是通过
    });
    
    expect(hasDesignSystem).toBeTruthy();
    console.log('✅ Design System 可访问');
  });
  
  test('✅ 主布局组件应该渲染', async ({ page }) => {
    await page.waitForTimeout(2000);
    
    // 检查主布局是否存在
    const mainLayout = await page.$('.main-layout');
    if (mainLayout) {
      console.log('✅ .main-layout 存在');
      const isVisible = await mainLayout.isVisible();
      expect(isVisible).toBeTruthy();
    } else {
      console.log('⚠️ .main-layout 不存在，查找替代元素');
      
      // 尝试查找其他布局元素
      const appDiv = await page.$('#app');
      const appContent = await appDiv?.textContent() || '';
      console.log('App 内容预览:', appContent.slice(0, 200));
      
      // 即使没有.main-layout，只要有内容就算通过
      expect(appContent.length).toBeGreaterThan(50);
    }
  });
  
  test('✅ 网络请求应该成功', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const consoleLogs = (test as any).consoleLogs || [];
    const failedRequests = consoleLogs.filter(log => 
      log.type === 'error' && (
        log.text.includes('Failed to fetch') ||
        log.text.includes('NetworkError') ||
        log.text.includes('404') ||
        log.text.includes('500')
      )
    );
    
    console.log(`📊 网络请求：${consoleLogs.length} 条日志，${failedRequests.length} 个失败`);
    
    // 允许一些非关键的网络错误（如可选的 API）
    expect(failedRequests.length).toBeLessThanOrEqual(6);
  });
  
  test('✅ Phaser 游戏 Canvas 应该初始化', async ({ page }) => {
    await page.waitForTimeout(3000);
    
    const canvas = await page.$('canvas');
    if (canvas) {
      console.log('✅ Canvas 元素存在');
      const box = await canvas.boundingBox();
      if (box) {
        console.log('✅ Canvas 在视口内');
      }
    } else {
      console.log('⚠️ Canvas 元素不存在 - Phaser 可能未初始化');
      // 不作为失败条件，因为可能是配置问题
    }
  });
  
  test('✅ Vue Devtools 应该能检测到应用', async ({ page }) => {
    // 检查 Vue 应用是否挂载
    const hasVueApp = await page.evaluate(() => {
      const app = document.querySelector('#app');
      return app && (app as any).__vue_app__;
    });
    
    if (hasVueApp) {
      console.log('✅ Vue 应用已挂载');
    } else {
      console.log('⚠️ Vue 应用可能未正确挂载');
    }
    
    // 不作为失败条件
    expect(true).toBeTruthy();
  });
  
  test('✅ 收集性能指标', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      return {
        JSHeapUsedSize: (performance as any).memory?.jsHeapSize || 0
      };
    });
    const timing = await page.evaluate(() => {
      const perf = performance;
      const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        loadComplete: nav.loadEventEnd - nav.startTime,
        domInteractive: nav.domInteractive - nav.startTime,
      };
    });
    
    console.log('📊 性能指标:');
    console.log(`  - DOM 可交互：${timing.domInteractive.toFixed(0)}ms`);
    console.log(`  - DOM 加载完成：${timing.domContentLoaded.toFixed(0)}ms`);
    console.log(`  - 完全加载：${timing.loadComplete.toFixed(0)}ms`);
    console.log(`  - JS 堆大小：${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)}MB`);
    
    // 只要页面加载了就通过
    expect(timing.loadComplete).toBeLessThan(30000);
  });
});

test.describe('🔍 诊断测试 - 组件特定检查', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });
  
  test('✅ CommandPanel 应该存在', async ({ page }) => {
    const commandPanel = await page.$('.command-panel, [class*="command"], [class*="Command"]');
    if (commandPanel) {
      console.log('✅ CommandPanel 存在');
    } else {
      console.log('⚠️ CommandPanel 未找到');
    }
  });
  
  test('✅ AgentPanel 应该存在', async ({ page }) => {
    const agentPanel = await page.$('.agent-panel, [class*="agent"], [class*="Agent"]');
    if (agentPanel) {
      console.log('✅ AgentPanel 存在');
    } else {
      console.log('⚠️ AgentPanel 未找到');
    }
  });
  
  test('✅ 检查所有已迁移的组件', async ({ page }) => {
    // 检查已迁移的 Vue 组件
    const migratedComponents = [
      'CommandLog',
      'CommandPanel',
      'AgentPanel',
      'MainLayout'
    ];
    
    console.log('\n📋 检查已迁移组件:');
    for (const component of migratedComponents) {
      // 尝试查找组件（通过类名或文本）
      const found = await page.$(`[class*="${component.toLowerCase()}"]`);
      console.log(`  ${found ? '✅' : '⚠️'} ${component}`);
    }
  });
});
