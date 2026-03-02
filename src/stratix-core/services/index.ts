/**
 * Stratix 服务层
 * 
 * 提供统一的服务访问接口，支持 Web 和 Electron 双模式
 */

export type { ServiceProvider, TailscaleNode, AppConfiguration } from './ServiceProvider';

export { WebServiceProvider } from './WebServiceProvider';
export { ElectronServiceProvider } from './ElectronServiceProvider';

export { ServiceLocator, services } from './ServiceLocator';

export { textureManager } from './TextureManager';
export { default as TextureManager } from './TextureManager';

// 默认导出服务实例
export { services as default } from './ServiceLocator';
