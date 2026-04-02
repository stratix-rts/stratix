/**
 * 服务定位器
 * 
 * 自动检测环境并提供对应的服务实现
 * 前端通过此单例访问服务，无需关心底层实现
 */

import { ElectronServiceProvider } from './ElectronServiceProvider';
import type { ServiceProvider } from './ServiceProvider';
import { WebServiceProvider } from './WebServiceProvider';

export class ServiceLocator {
  private static instance: ServiceLocator;
  private provider: ServiceProvider | null = null;
  
  /**
   * 获取单例实例
   */
  static getInstance(): ServiceLocator {
    if (!ServiceLocator.instance) {
      ServiceLocator.instance = new ServiceLocator();
    }
    return ServiceLocator.instance;
  }
  
  /**
   * 获取服务提供者
   * 自动检测环境并创建对应的实现
   */
  getProvider(): ServiceProvider {
    if (!this.provider) {
      this.provider = this.createProvider();
    }
    return this.provider;
  }
  
  /**
   * 创建服务提供者
   * 根据运行环境自动选择实现
   */
  private createProvider(): ServiceProvider {
    if (this.isElectron()) {
      console.log('[ServiceLocator] Running in Electron mode');
      return new ElectronServiceProvider();
    } else {
      console.log('[ServiceLocator] Running in Web mode');
      return new WebServiceProvider();
    }
  }
  
  /**
   * 检测是否在 Electron 环境
   */
  private isElectron(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    
    // 检测 Electron API
    const hasElectronAPI = !!(window as any).electronAPI;
    
    // 检测 Electron userAgent
    const userAgent = navigator.userAgent.toLowerCase();
    const isElectronUA = userAgent.includes('electron');
    
    return hasElectronAPI || isElectronUA;
  }
  
  /**
   * 重置服务提供者（用于测试）
   */
  reset(): void {
    this.provider = null;
  }
}

// 全局访问点
const services = ServiceLocator.getInstance().getProvider();

export { services };
export default ServiceLocator;
