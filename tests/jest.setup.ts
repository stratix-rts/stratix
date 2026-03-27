/**
 * Jest setup file - Global polyfills for Node.js 16 compatibility
 *
 * Some dependencies (like LangChain) require ReadableStream which is
 * only available in Node.js 18+. This file provides a minimal polyfill.
 */

// Minimal ReadableStream polyfill for compatibility
// Note: This only provides enough API for modules to load, not full functionality
if (typeof global.ReadableStream === 'undefined') {
  (global as any).ReadableStream = class ReadableStream {
    constructor(_options?: any) {}
    getReader() {
      return {
        read(): Promise<{ done: boolean; value?: any }> {
          return Promise.resolve({ done: true, value: undefined });
        },
        releaseLock() {},
      };
    }
    cancel(_reason?: any): Promise<void> {
      return Promise.resolve();
    }
    pipeTo(_dest: any): Promise<void> {
      return Promise.resolve();
    }
    pipeThrough(_transform: any): any {
      return {};
    }
    tee(): [any, any] {
      return [{}, {}];
    }
    locked: boolean = false;
  };
}
