/**
 * UI Recorder - UI录制器
 * 
 * 录制用户在UI上的所有交互操作
 * 用于测试、调试和回放
 */

import type { Scene } from 'phaser';
import { EventType, type RecordedEvent, type UIRecording, type RecordingOptions, type RecordingMetadata } from '../../core/types/recording.types';

export class UIRecorder {
  private scene: Scene;
  private isRecording: boolean = false;
  private events: RecordedEvent[] = [];
  private startTime: number = 0;
  private recordingId: string = '';
  private recordingName: string = '';
  private snapshotTimer: Phaser.Time.TimerEvent | null = null;
  
  // 默认配置
  private options: Required<RecordingOptions> = {
    snapshotInterval: 1000,
    recordSnapshots: true,
    eventTypes: [
      EventType.CLICK,
      EventType.DRAG_START,
      EventType.DRAG_END,
      EventType.KEY_PRESS,
      EventType.STATE_CHANGE,
    ],
    maxEvents: 10000,
  };
  
  constructor(scene: Scene) {
    this.scene = scene;
  }
  
  /**
   * 开始录制
   */
  startRecording(name: string = `Recording ${Date.now()}`, options?: RecordingOptions): void {
    if (this.isRecording) {
      console.warn('[UIRecorder] Already recording');
      return;
    }
    
    this.recordingId = this.generateId();
    this.recordingName = name;
    this.events = [];
    this.startTime = Date.now();
    this.isRecording = true;
    
    // 应用配置
    if (options) {
      this.options = { ...this.options, ...options };
    }
    
    // 开始定期快照
    if (this.options.recordSnapshots) {
      this.startPeriodicSnapshot();
    }
    
    console.log(`[UIRecorder] Started recording: ${name}`);
  }
  
  /**
   * 停止录制
   */
  stopRecording(): UIRecording | null {
    if (!this.isRecording) {
      console.warn('[UIRecorder] Not recording');
      return null;
    }
    
    this.isRecording = false;
    this.stopPeriodicSnapshot();
    
    const recording: UIRecording = {
      id: this.recordingId,
      name: this.recordingName,
      startTime: this.startTime,
      endTime: Date.now(),
      events: this.events,
      metadata: this.createMetadata(),
    };
    
    console.log(`[UIRecorder] Stopped recording: ${this.recordingName}, ${this.events.length} events captured`);
    
    return recording;
  }
  
  /**
   * 记录事件
   */
  recordEvent(type: EventType, target: string, data: any): void {
    if (!this.isRecording) return;
    if (!this.options.eventTypes.includes(type)) return;
    if (this.events.length >= this.options.maxEvents) {
      console.warn('[UIRecorder] Max events reached, stopping recording');
      this.stopRecording();
      return;
    }
    
    const event: RecordedEvent = {
      timestamp: Date.now() - this.startTime,
      type,
      target,
      data: this.sanitizeData(data),
    };
    
    this.events.push(event);
  }
  
  /**
   * 记录点击事件
   */
  recordClick(targetId: string, x: number, y: number): void {
    this.recordEvent(EventType.CLICK, targetId, { x, y });
  }
  
  /**
   * 记录拖拽开始
   */
  recordDragStart(targetId: string, x: number, y: number): void {
    this.recordEvent(EventType.DRAG_START, targetId, { x, y });
  }
  
  /**
   * 记录拖拽移动
   */
  recordDragMove(targetId: string, x: number, y: number): void {
    this.recordEvent(EventType.DRAG_MOVE, targetId, { x, y });
  }
  
  /**
   * 记录拖拽结束
   */
  recordDragEnd(targetId: string, x: number, y: number): void {
    this.recordEvent(EventType.DRAG_END, targetId, { x, y });
  }
  
  /**
   * 记录按键事件
   */
  recordKeyPress(key: string, ctrl?: boolean, shift?: boolean, alt?: boolean): void {
    this.recordEvent(EventType.KEY_PRESS, 'keyboard', { key, ctrl, shift, alt });
  }
  
  /**
   * 记录状态变化
   */
  recordStateChange(targetId: string, oldState: any, newState: any): void {
    this.recordEvent(EventType.STATE_CHANGE, targetId, { oldState, newState });
  }
  
  /**
   * 是否正在录制
   */
  isActive(): boolean {
    return this.isRecording;
  }
  
  /**
   * 获取已录制的事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }
  
  /**
   * 获取录制时长（毫秒）
   */
  getDuration(): number {
    if (!this.isRecording) return 0;
    return Date.now() - this.startTime;
  }
  
  /**
   * 清空录制
   */
  clear(): void {
    this.events = [];
    this.recordingId = '';
    this.recordingName = '';
  }
  
  // ============ Private Methods ============
  
  /**
   * 开始定期快照
   */
  private startPeriodicSnapshot(): void {
    this.snapshotTimer = this.scene.time.addEvent({
      delay: this.options.snapshotInterval,
      callback: () => this.captureSnapshot(),
      loop: true,
    });
  }
  
  /**
   * 停止定期快照
   */
  private stopPeriodicSnapshot(): void {
    if (this.snapshotTimer) {
      this.snapshotTimer.remove();
      this.snapshotTimer = null;
    }
  }
  
  /**
   * 捕获UI快照
   */
  private captureSnapshot(): void {
    if (!this.isRecording) return;
    
    // TODO: 实现UI树遍历和快照
    // 这里需要从UIManager获取完整的UI树
    const snapshot = {
      id: 'root',
      type: 'Scene',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      state: {},
      children: [],
    };
    
    this.recordEvent(EventType.SNAPSHOT, 'root', { snapshot });
  }
  
  /**
   * 创建元数据
   */
  private createMetadata(): RecordingMetadata {
    const game = this.scene.game;
    
    return {
      version: '1.0.0',
      gameVersion: '0.1.0', // TODO: 从package.json读取
      screenResolution: {
        width: game.config.width as number,
        height: game.config.height as number,
      },
      fps: 60, // TODO: 从game loop获取实际FPS
      tags: [],
      createdAt: this.startTime,
      duration: this.getDuration(),
      eventCount: this.events.length,
    };
  }
  
  /**
   * 清理数据（移除不可序列化的值）
   */
  private sanitizeData(data: any): any {
    try {
      // 尝试序列化和反序列化，以移除不可序列化的值
      return JSON.parse(JSON.stringify(data));
    } catch (error) {
      console.warn('[UIRecorder] Failed to sanitize data:', error);
      return {};
    }
  }
  
  /**
   * 生成唯一ID
   */
  private generateId(): string {
    const random = Math.random().toString(36).substring(2, 9);
    return `rec_${Date.now()}_${random}`;
  }
}
