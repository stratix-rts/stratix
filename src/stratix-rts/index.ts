import Phaser from 'phaser';

import StratixRTSGameScene, { BG_COLOR } from './StratixRTSGameScene';
import StratixRTSUIScene from './StratixRTSUIScene';
import { rtsBridge } from './events/bridge/RTSBridge';
import { rtsEventBus, RTSEventBus } from './events/core/RTSEventBus';

export { rtsEventBus, RTSEventBus, rtsBridge };
export * from './events/types/RTSEventTypes';

export interface StratixRTSConfig {
  parent: string | HTMLElement;
  width?: number;
  height?: number;
}

export function createStratixRTS(config: StratixRTSConfig): Phaser.Game {
  const parentEl = typeof config.parent === 'string' 
    ? document.getElementById(config.parent) 
    : config.parent;
  
  const width = config.width ?? parentEl?.clientWidth ?? 800;
  const height = config.height ?? parentEl?.clientHeight ?? 600;
  
  const gameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: config.parent,
    width: width,
    height: height,
    backgroundColor: BG_COLOR(),
    pixelArt: true,
    scene: [StratixRTSGameScene, StratixRTSUIScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: width,
      height: height,
      parent: config.parent
    }
  };

  const game = new Phaser.Game(gameConfig);
  
  const handleContextMenu = (e: Event) => {
    e.preventDefault();
  };
  
  game.events.once('ready', () => {
    const canvas = game.canvas;
    if (canvas) {
      canvas.addEventListener('contextmenu', handleContextMenu);
    }
    
    const uiScene = game.scene.getScene('StratixRTSUIScene');
    if (uiScene && !game.scene.isActive('StratixRTSUIScene')) {
      game.scene.start('StratixRTSUIScene');
    }
    
    rtsEventBus.emit('game:vue:game_ready', { width, height });
  });
  
  const handleResize = () => {
    if (!parentEl) return;

    const newWidth = parentEl.clientWidth;
    const newHeight = parentEl.clientHeight;

    game.scale.resize(newWidth, newHeight);
    
    for (const scenePlugin of game.scene.scenes) {
      const scene = scenePlugin.scene;
      if (scene.key === 'StratixRTSGameScene' && 'resize' in scene) {
        (scene as any).resize(newWidth, newHeight);
      }
      if (scene.key === 'StratixRTSUIScene' && 'resize' in scene) {
        (scene as any).resize(newWidth, newHeight);
      }
    }
  };
  
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  
  const originalDestroy = game.destroy.bind(game);
  game.destroy = (removeCanvas: boolean = false, noReturn: boolean = false) => {
    const canvas = game.canvas;
    if (canvas) {
      canvas.removeEventListener('contextmenu', handleContextMenu);
    }
    
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('orientationchange', handleResize);
    rtsEventBus.unregisterScene('game');
    rtsEventBus.unregisterScene('ui');
    originalDestroy(removeCanvas, noReturn);
  };
  
  return game;
}

export { default as StratixRTSGameScene } from './StratixRTSGameScene';
export { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, BG_COLOR } from './constants';
export { AgentSprite, COLORS } from './sprites/AgentSprite';
export type { AgentStatus, CommandStatus, AgentType } from './sprites/AgentSprite';
export { StratixRTSEventManager } from './StratixRTSEventManager';
export { InputHandler } from './utils/InputHandler';
export type { InputConfig, InputCallbacks, InputMode } from './utils/InputHandler';
export { SelectBox } from './ui/SelectBox';
export type { SelectBoxConfig } from './ui/SelectBox';
export { TaskZone } from './zones/TaskZone';
export type { TaskZoneConfig, CornerPosition, TaskZoneStatus, TaskZoneType } from './zones/TaskZone';
export { TaskZonePreview } from './zones/TaskZonePreview';
export type { TaskZonePreviewConfig } from './zones/TaskZonePreview';
export { CommandSystem } from './systems/CommandSystem';
export type { Command, CommandType, MoveCommand, AttackCommand, AttackMoveCommand, StopCommand, PatrolCommand, HoldPositionCommand, GatherCommand, CommandContext } from './systems/CommandSystem';
export { ControlGroupSystem } from './systems/ControlGroupSystem';
export type { ControlGroup } from './systems/ControlGroupSystem';

export { TopBarV2 as TopBar, MinimapV2 as Minimap, CommandPanelV2 as CommandPanel, RTSUIFactory } from './ui/v2';
export type { TopBarStats, UnitInfo, Skill, AgentInfo, ZoneInfo, RTSUIComponents, RTSUIConfig } from './ui/v2';

export { ShortcutManager, shortcutManager, HelpPanel, ShortcutBar } from './ui';
export type { 
  ShortcutDefinition, 
  ShortcutCategory, 
  ActiveShortcut, 
  ShortcutContext,
  HelpPanelConfig,
  ShortcutBarConfig
} from './ui';
