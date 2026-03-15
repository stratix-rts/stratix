export class AutoSaver {
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private onSave: () => Promise<void>,
    debounceMs: number = 5000
  ) {
    this.debounceMs = debounceMs;
  }

  trigger(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(async () => {
      try {
        await this.onSave();
        console.log('Auto-save completed');
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, this.debounceMs);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.onSave();
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
