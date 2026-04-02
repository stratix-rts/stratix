/**
 * VersionBadge Tests
 */

import { VersionBadge, VERSION, BUILD_TIMESTAMP } from '@/stratix-rts/ui/VersionBadge';

function createMockScene() {
  const mockText = {
    setOrigin: jest.fn(),
    setScrollFactor: jest.fn(),
    setDepth: jest.fn(),
    setAlpha: jest.fn(),
    getBounds: jest.fn().mockReturnValue({ width: 100, height: 20 }),
    destroy: jest.fn(),
  };

  const mockRect = {
    setOrigin: jest.fn(),
    setScrollFactor: jest.fn(),
    setDepth: jest.fn(),
    setInteractive: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
  };

  const mockCamera = {
    width: 1920,
    height: 1080,
  };

  const scene = {
    add: {
      text: jest.fn().mockReturnValue(mockText),
      rectangle: jest.fn().mockReturnValue(mockRect),
    },
    cameras: {
      main: mockCamera,
    },
  };

  return { scene, mockText, mockRect };
}

describe('VersionBadge', () => {
  let badge: VersionBadge;
  let mockScene: ReturnType<typeof createMockScene>;

  beforeEach(() => {
    mockScene = createMockScene();
    badge = new VersionBadge(mockScene.scene as any);
  });

  it('should export VERSION constant', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('should export BUILD_TIMESTAMP as ISO string', () => {
    expect(BUILD_TIMESTAMP).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should create badge from scene', () => {
    const result = badge.create();
    expect(result).toBe(badge);
  });

  it('should add text with correct initial alpha', () => {
    badge.create();
    expect(mockScene.mockText.setAlpha).toHaveBeenCalledWith(0.4);
  });

  it('should set text origin to bottom-right', () => {
    badge.create();
    expect(mockScene.mockText.setOrigin).toHaveBeenCalledWith(1, 1);
  });

  it('should set scroll factor to 0 for fixed position', () => {
    badge.create();
    expect(mockScene.mockText.setScrollFactor).toHaveBeenCalledWith(0, 0);
    expect(mockScene.mockRect.setScrollFactor).toHaveBeenCalledWith(0, 0);
  });

  it('should set high depth for always-on-top', () => {
    badge.create();
    expect(mockScene.mockText.setDepth).toHaveBeenCalledWith(9999);
    expect(mockScene.mockRect.setDepth).toHaveBeenCalledWith(9998);
  });

  it('should respond to pointerover with alpha 0.8', () => {
    badge.create();
    const calls = mockScene.mockRect.on.mock.calls as any[][];
    const pointeroverCall = calls.find((call) => call[0] === 'pointerover');
    const onCallback = pointeroverCall?.[1] as (() => void) | undefined;
    onCallback?.();
    expect(mockScene.mockText.setAlpha).toHaveBeenLastCalledWith(0.8);
  });

  it('should respond to pointerout with alpha 0.4', () => {
    badge.create();
    const onCallback = mockScene.mockRect.on.mock.calls.find(
      (call: any[]) => call[0] === 'pointerout'
    )?.[2] as () => void;
    onCallback?.();
    expect(mockScene.mockText.setAlpha).toHaveBeenCalledWith(0.4);
  });

  it('should destroy text and hitArea on destroy()', () => {
    badge.create();
    badge.destroy();
    expect(mockScene.mockText.destroy).toHaveBeenCalled();
    expect(mockScene.mockRect.destroy).toHaveBeenCalled();
  });

  it('should handle destroy when not created', () => {
    expect(() => badge.destroy()).not.toThrow();
  });
});
