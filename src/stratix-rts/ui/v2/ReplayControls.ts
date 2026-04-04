/**
 * Replay Controls - Phaser UI component for replay control
 */

import Phaser from 'phaser';

import { rtsEventBus } from '../../events/core/RTSEventBus';
import { replayManager, PlaybackState, PlaybackSpeed, RecordingSession } from '../../events/replay';

interface ReplayControlsConfig {
  x: number;
  y: number;
  width: number;
  onRecordingStarted?: () => void;
  onRecordingStopped?: (session: RecordingSession) => void;
  onPlaybackStarted?: () => void;
  onPlaybackPaused?: () => void;
  onPlaybackEnded?: () => void;
}

const COLORS = {
  background: 0x1a1a2e,
  backgroundHover: 0x252540,
  primary: 0x00d4ff,
  secondary: 0x6366f1,
  danger: 0xff4757,
  success: 0x00ff88,
  text: 0xffffff,
  textMuted: 0x888899,
  border: 0x3a3a5c,
};

const BUTTON_SIZE = 32;
const ICON_SIZE = 16;
const PADDING = 8;
const PROGRESS_HEIGHT = 8;

export class ReplayControls {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private config: ReplayControlsConfig;

  // State
  private isRecording = false;
  private playbackState: PlaybackState = 'idle';
  private currentSession: RecordingSession | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private currentSessionData: any = null;
  private progress = 0;
  private duration = 0;
  private speed: PlaybackSpeed = 1;

  // UI Elements
  private recordBtn!: Phaser.GameObjects.Container;
  private playPauseBtn!: Phaser.GameObjects.Container;
  private stopBtn!: Phaser.GameObjects.Container;
  private stepBackBtn!: Phaser.GameObjects.Container;
  private stepForwardBtn!: Phaser.GameObjects.Container;
  private progressBar!: Phaser.GameObjects.Graphics;
  private progressFill!: Phaser.GameObjects.Graphics;
  private timeText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private sessionNameText!: Phaser.GameObjects.Text;

  // Graphics
  private bgGraphics!: Phaser.GameObjects.Graphics;

  private unsubscribers: (() => void)[] = [];

  constructor(scene: Phaser.Scene, config: ReplayControlsConfig) {
    this.scene = scene;
    this.config = config;
    this.container = scene.add.container(config.x, config.y);
    this.setupEventListeners();
  }

  create(): this {
    this.drawBackground();
    this.createRecordButton();
    this.createPlaybackControls();
    this.createProgressBar();
    this.createTimeDisplay();
    this.createSpeedSelector();
    this.updateAll();
    return this;
  }

  mount(): void {
    // Container is already added in constructor
  }

  private drawBackground(): void {
    const { width } = this.config;
    const height = 60;

    this.bgGraphics = this.scene.add.graphics();
    this.bgGraphics.fillStyle(COLORS.background, 0.95);
    this.bgGraphics.fillRoundedRect(0, 0, width, height, 8);
    this.bgGraphics.lineStyle(1, COLORS.border, 0.5);
    this.bgGraphics.strokeRoundedRect(0, 0, width, height, 8);

    this.container.add(this.bgGraphics);

    // Session name
    this.sessionNameText = this.scene.add.text(PADDING, PADDING, 'No Recording', {
      fontSize: '12px',
      color: '#888899',
      fontFamily: 'monospace',
    });
    this.container.add(this.sessionNameText);
  }

  private createRecordButton(): void {
    const x = PADDING;
    const y = PADDING + 20;

    this.recordBtn = this.createButton(
      x,
      y,
      BUTTON_SIZE,
      BUTTON_SIZE,
      this.isRecording ? this.drawStopIcon.bind(this) : this.drawRecordIcon.bind(this),
      this.isRecording ? COLORS.danger : COLORS.danger,
      this.onRecordClick.bind(this)
    );
    this.container.add(this.recordBtn);
  }

  private createPlaybackControls(): void {
    const startX = PADDING + BUTTON_SIZE + PADDING * 2;
    const y = PADDING + 20;

    // Step backward
    this.stepBackBtn = this.createButton(
      startX,
      y,
      BUTTON_SIZE,
      BUTTON_SIZE,
      this.drawStepBackIcon.bind(this),
      COLORS.secondary,
      this.onStepBack.bind(this)
    );
    this.container.add(this.stepBackBtn);

    // Play/Pause
    this.playPauseBtn = this.createButton(
      startX + BUTTON_SIZE + PADDING / 2,
      y,
      BUTTON_SIZE,
      BUTTON_SIZE,
      this.drawPlayIcon.bind(this),
      COLORS.primary,
      this.onPlayPauseClick.bind(this)
    );
    this.container.add(this.playPauseBtn);

    // Stop
    this.stopBtn = this.createButton(
      startX + (BUTTON_SIZE + PADDING / 2) * 2,
      y,
      BUTTON_SIZE,
      BUTTON_SIZE,
      this.drawStopIcon.bind(this),
      COLORS.textMuted,
      this.onStopClick.bind(this)
    );
    this.container.add(this.stopBtn);

    // Step forward
    this.stepForwardBtn = this.createButton(
      startX + (BUTTON_SIZE + PADDING / 2) * 3,
      y,
      BUTTON_SIZE,
      BUTTON_SIZE,
      this.drawStepForwardIcon.bind(this),
      COLORS.secondary,
      this.onStepForward.bind(this)
    );
    this.container.add(this.stepForwardBtn);
  }

  private createProgressBar(): void {
    const barX = PADDING + BUTTON_SIZE + PADDING * 2 + (BUTTON_SIZE + PADDING / 2) * 4 + PADDING;
    const barY = PADDING + 16;
    const barWidth = this.config.width - barX - PADDING * 2;
    const barHeight = PROGRESS_HEIGHT;

    // Background
    this.progressBar = this.scene.add.graphics();
    this.progressBar.fillStyle(COLORS.border, 0.5);
    this.progressBar.fillRoundedRect(barX, barY, barWidth, barHeight, 4);

    // Progress fill
    this.progressFill = this.scene.add.graphics();
    this.progressFill.fillStyle(COLORS.primary, 1);
    this.progressFill.fillRoundedRect(barX, barY, 0, barHeight, 4);

    this.container.add(this.progressBar);
    this.container.add(this.progressFill);

    // Make progress bar interactive
    const hitArea = this.scene.add.rectangle(
      barX + barWidth / 2,
      barY + barHeight / 2,
      barWidth,
      barHeight * 3,
      0x000000,
      0
    );
    hitArea.setInteractive({ useHandCursor: true });
    hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const localX = pointer.x - this.container.x - barX;
      const percentage = Math.max(0, Math.min(1, localX / barWidth));
      const targetTime = percentage * this.duration;
      replayManager.seek(targetTime);
    });
    this.container.add(hitArea);
  }

  private createTimeDisplay(): void {
    const timeX = this.config.width - PADDING;
    const timeY = PADDING + 40;

    this.timeText = this.scene.add.text(timeX, timeY, '0:00 / 0:00', {
      fontSize: '11px',
      color: '#888899',
      fontFamily: 'monospace',
    });
    this.timeText.setOrigin(1, 0);
    this.container.add(this.timeText);
  }

  private createSpeedSelector(): void {
    const speedX = PADDING + BUTTON_SIZE + PADDING * 2 + (BUTTON_SIZE + PADDING / 2) * 4 + PADDING;
    const speedY = PADDING + 36;

    const speeds: PlaybackSpeed[] = [0.25, 0.5, 1, 1.5, 2, 4];
    const currentIndex = speeds.indexOf(this.speed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];

    this.speedText = this.scene.add.text(speedX, speedY, `${this.speed}x`, {
      fontSize: '11px',
      color: '#6366f1',
      fontFamily: 'monospace',
    });
    this.speedText.setInteractive({ useHandCursor: true });
    this.speedText.on('pointerdown', () => {
      replayManager.setSpeed(nextSpeed);
      this.speed = nextSpeed;
      this.speedText.setText(`${nextSpeed}x`);
    });
    this.container.add(this.speedText);
  }

  private createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    drawFn: (graphics: Phaser.GameObjects.Graphics, size: number) => void,
    color: number,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);

    const bg = this.scene.add.graphics();
    bg.fillStyle(color, 0.2);
    bg.fillRoundedRect(0, 0, width, height, 6);
    bg.lineStyle(1, color, 0.5);
    bg.strokeRoundedRect(0, 0, width, height, 6);

    const icon = this.scene.add.graphics();
    drawFn(icon, ICON_SIZE);

    container.add(bg);
    container.add(icon);

    container.setSize(width, height);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(color, 0.4);
      bg.fillRoundedRect(0, 0, width, height, 6);
      bg.lineStyle(1, color, 0.8);
      bg.strokeRoundedRect(0, 0, width, height, 6);
    });

    container.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(color, 0.2);
      bg.fillRoundedRect(0, 0, width, height, 6);
      bg.lineStyle(1, color, 0.5);
      bg.strokeRoundedRect(0, 0, width, height, 6);
    });

    container.on('pointerdown', onClick);

    return container;
  }

  // Icon drawing methods
  private drawRecordIcon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 3;
    graphics.fillStyle(COLORS.danger, 1);
    graphics.fillCircle(cx, cy, r);
  }

  private drawStopIcon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const s = size * 0.3;
    const cx = size / 2;
    const cy = size / 2;
    graphics.fillStyle(COLORS.text, 1);
    graphics.fillRoundedRect(cx - s, cy - s, s * 2, s * 2, 2);
  }

  private drawPlayIcon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    const s = size * 0.35;

    if (this.playbackState === 'playing') {
      // Pause icon (two bars)
      graphics.fillStyle(COLORS.text, 1);
      graphics.fillRoundedRect(cx - s - 2, cy - s, s * 0.6, s * 2, 2);
      graphics.fillRoundedRect(cx + 2, cy - s, s * 0.6, s * 2, 2);
    } else {
      // Play icon (triangle)
      graphics.fillStyle(COLORS.text, 1);
      graphics.fillTriangle(
        cx - s * 0.6, cy - s,
        cx + s * 0.6, cy,
        cx - s * 0.6, cy + s
      );
    }
  }

  private drawStepBackIcon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    const s = size * 0.35;

    graphics.fillStyle(COLORS.text, 1);
    // Triangle
    graphics.fillTriangle(cx + s * 0.3, cy - s, cx + s * 0.3, cy + s, cx - s * 0.6, cy);
    // Bar
    graphics.fillRect(cx - s * 0.8, cy - s * 0.6, s * 0.25, s * 1.2);
  }

  private drawStepForwardIcon(graphics: Phaser.GameObjects.Graphics, size: number): void {
    const cx = size / 2;
    const cy = size / 2;
    const s = size * 0.35;

    graphics.fillStyle(COLORS.text, 1);
    // Triangle
    graphics.fillTriangle(cx - s * 0.3, cy - s, cx - s * 0.3, cy + s, cx + s * 0.6, cy);
    // Bar
    graphics.fillRect(cx + s * 0.55, cy - s * 0.6, s * 0.25, s * 1.2);
  }

  // Event handlers
  private onRecordClick(): void {
    if (this.isRecording) {
      const session = replayManager.stopRecording();
      this.isRecording = false;
      if (session) {
        this.currentSession = session;
        this.config.onRecordingStopped?.(session);
      }
    } else {
      replayManager.startRecording();
      this.isRecording = true;
      this.currentSession = null;
      this.config.onRecordingStarted?.();
    }
    this.updateAll();
  }

  private onPlayPauseClick(): void {
    if (!this.currentSession && !replayManager.isPlaybackActive()) {
      // Try to load from saved sessions
      const sessions = replayManager.getSavedSessions();
      if (sessions.length > 0) {
        replayManager.loadSession(sessions[sessions.length - 1]);
        this.currentSession = sessions[sessions.length - 1];
      }
    }

    replayManager.toggle();
  }

  private onStopClick(): void {
    replayManager.stop();
    this.playbackState = 'idle';
    this.updateAll();
  }

  private onStepBack(): void {
    replayManager.stepBackward();
  }

  private onStepForward(): void {
    replayManager.stepForward();
  }

  private setupEventListeners(): void {
    this.unsubscribers.push(
      rtsEventBus.on('replay:state_changed', (data) => {
        this.playbackState = data.state;
        this.updatePlayPauseIcon();
        if (data.state === 'ended') {
          this.config.onPlaybackEnded?.();
        }
      }) as any
    );

    this.unsubscribers.push(
      rtsEventBus.on('replay:progress', (data) => {
        this.progress = data.currentTime;
        this.duration = data.duration;
        this.updateProgress();
      }) as any
    );

    this.unsubscribers.push(
      rtsEventBus.on('replay:recording_started', () => {
        this.isRecording = true;
        this.updateAll();
      }) as any
    );

    this.unsubscribers.push(
      rtsEventBus.on('replay:recording_stopped', (data) => {
        this.isRecording = false;
        this.currentSessionData = data.session;
        this.currentSession = data.session as RecordingSession;
        this.updateAll();
      }) as any
    );

    this.unsubscribers.push(
      rtsEventBus.on('replay:session_loaded', (data) => {
        this.currentSessionData = data.session;
        this.currentSession = data.session as RecordingSession;
        this.duration = data.session.duration;
        this.updateAll();
      }) as any
    );
  }

  private updateAll(): void {
    this.updateRecordButton();
    this.updatePlayPauseIcon();
    this.updateSessionName();
    this.updateProgress();
    this.updateTimeDisplay();
  }

  private updateRecordButton(): void {
    const bg = this.recordBtn.getAt(0) as Phaser.GameObjects.Graphics;
    bg.clear();

    const color = this.isRecording ? COLORS.danger : COLORS.danger;
    bg.fillStyle(color, 0.2);
    bg.fillRoundedRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 6);
    bg.lineStyle(1, color, 0.5);
    bg.strokeRoundedRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 6);

    const icon = this.recordBtn.getAt(1) as Phaser.GameObjects.Graphics;
    icon.clear();
    if (this.isRecording) {
      this.drawStopIcon(icon, ICON_SIZE);
    } else {
      this.drawRecordIcon(icon, ICON_SIZE);
    }
  }

  private updatePlayPauseIcon(): void {
    const icon = this.playPauseBtn.getAt(1) as Phaser.GameObjects.Graphics;
    icon.clear();
    this.drawPlayIcon(icon, ICON_SIZE);
  }

  private updateSessionName(): void {
    if (this.isRecording) {
      this.sessionNameText.setText('Recording...');
      this.sessionNameText.setColor('#ff4757');
    } else if (this.currentSession) {
      this.sessionNameText.setText(this.currentSessionData?.name || this.currentSession?.name || 'No Recording');
      this.sessionNameText.setColor('#888899');
    } else {
      this.sessionNameText.setText('No Recording');
      this.sessionNameText.setColor('#888899');
    }
  }

  private updateProgress(): void {
    const barX = PADDING + BUTTON_SIZE + PADDING * 2 + (BUTTON_SIZE + PADDING / 2) * 4 + PADDING;
    const barY = PADDING + 16;
    const barWidth = this.config.width - barX - PADDING * 2;
    const barHeight = PROGRESS_HEIGHT;

    const percentage = this.duration > 0 ? this.progress / this.duration : 0;

    this.progressFill.clear();
    this.progressFill.fillStyle(COLORS.primary, 1);
    this.progressFill.fillRoundedRect(barX, barY, barWidth * percentage, barHeight, 4);
  }

  private updateTimeDisplay(): void {
    const current = this.formatTime(this.progress);
    const total = this.formatTime(this.duration);
    this.timeText.setText(`${current} / ${total}`);
  }

  private formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  resize(width: number): void {
    this.config.width = width;
    this.bgGraphics.clear();
    this.bgGraphics.fillStyle(COLORS.background, 0.95);
    this.bgGraphics.fillRoundedRect(0, 0, width, 60, 8);
    this.bgGraphics.lineStyle(1, COLORS.border, 0.5);
    this.bgGraphics.strokeRoundedRect(0, 0, width, 60, 8);
    this.updateProgress();
    this.timeText.setX(width - PADDING);
  }

  destroy(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.container.destroy();
  }
}
