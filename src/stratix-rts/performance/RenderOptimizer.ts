export class RenderOptimizer {
  private dirtyRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  private renderQueue: Set<string> = new Set();
  private lastRenderTime: number = 0;
  private renderInterval: number = 16;
  private enabled: boolean = true;

  addDirtyRegion(x: number, y: number, width: number, height: number): void {
    this.dirtyRegions.push({ x, y, width, height });
  }

  needsRender(id: string): boolean {
    if (!this.enabled) return true;

    const now = performance.now();
    if (now - this.lastRenderTime < this.renderInterval) {
      return this.renderQueue.has(id);
    }

    this.renderQueue.clear();
    this.lastRenderTime = now;
    return true;
  }

  queueRender(id: string): void {
    this.renderQueue.add(id);
  }

  clearDirtyRegions(): void {
    this.dirtyRegions = [];
  }

  getDirtyRegions(): Array<{ x: number; y: number; width: number; height: number }> {
    return [...this.dirtyRegions];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setRenderInterval(interval: number): void {
    this.renderInterval = interval;
  }
}