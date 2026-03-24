import Phaser from 'phaser';
import StratixRTSGameScene from '../StratixRTSGameScene';
import { AgentSprite, AgentStatus } from '../sprites/AgentSprite';
import { StratixAgentConfig } from '../../stratix-core/stratix-protocol';

const container = document.getElementById('stratix-rts-container')!;
const logEl = document.getElementById('test-log')!;

function log(message: string, type: string = 'info') {
  const item = document.createElement('div');
  item.className = `log-item log-${type}`;
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(item);
  logEl.scrollTop = logEl.scrollHeight;
}

log('初始化 Stratix RTS...', 'info');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: container,
  width: container.clientWidth,
  height: container.clientHeight,
  backgroundColor: 0x1a1a2e,
  pixelArt: true,
  scene: [StratixRTSGameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: container.clientWidth,
    height: container.clientHeight
  }
});

window.addEventListener('resize', () => {
  game.scale.resize(container.clientWidth, container.clientHeight);
});

let agentCounter = 0;
const agentTypes = ['writer', 'dev', 'analyst'];

function createAgentConfig(type: string): StratixAgentConfig {
  return {
    agentId: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${++agentCounter}`,
    type: type,
    profile: {
      characterId: `char-${Date.now()}`,
      name: `${type} Character`,
      bodyType: 'male',
      parts: {},
    },
    backendType: 'openclaw',
    configStatus: 'ready',
    soul: { identity: 'test', goals: [], personality: 'test' },
    memory: { shortTerm: [], longTerm: [], context: '' },
    skills: [],
    openClawConfig: { accountId: 'test', endpoint: 'test' }
  };
}

game.events.once('ready', () => {
  log('游戏场景就绪', 'success');
  
  const scene = game.scene.getScene('StratixRTSGameScene') as StratixRTSGameScene;
  (window as any).testScene = scene;
  
  scene.addAgentSprite(createAgentConfig('writer'));
  log('添加初始 Agent: Writer 1', 'success');
  
  document.getElementById('btn-add-agent')!.addEventListener('click', () => {
    const type = agentTypes[agentCounter % 3];
    scene.addAgentSprite(createAgentConfig(type));
    log(`添加 Agent: ${type} ${agentCounter}`, 'success');
  });
  
  document.getElementById('btn-add-multi')!.addEventListener('click', () => {
    for (let i = 0; i < 5; i++) {
      const type = agentTypes[(agentCounter + i) % 3];
      scene.addAgentSprite(createAgentConfig(type));
    }
    log('批量添加 5 个 Agent', 'success');
  });
  
  document.getElementById('btn-status-busy')!.addEventListener('click', () => {
    const selected = scene.getSelectedAgentIds();
    selected.forEach((id: string) => {
      const sprite = scene.getAgentSprites().get(id);
      if (sprite) sprite.setAgentStatus('busy');
    });
    log(`设置 ${selected.size} 个 Agent 为 Busy`, 'info');
  });
  
  document.getElementById('btn-status-error')!.addEventListener('click', () => {
    const selected = scene.getSelectedAgentIds();
    selected.forEach((id: string) => {
      const sprite = scene.getAgentSprites().get(id);
      if (sprite) sprite.setAgentStatus('error');
    });
    log(`设置 ${selected.size} 个 Agent 为 Error`, 'error');
  });
  
  document.getElementById('btn-status-online')!.addEventListener('click', () => {
    const selected = scene.getSelectedAgentIds();
    selected.forEach((id: string) => {
      const sprite = scene.getAgentSprites().get(id);
      if (sprite) sprite.setAgentStatus('online');
    });
    log(`设置 ${selected.size} 个 Agent 为 Online`, 'success');
  });
  
  document.getElementById('btn-clear-selection')!.addEventListener('click', () => {
    scene.clearSelection();
    log('清除所有选中', 'info');
  });
  
  document.getElementById('btn-log-sprites')!.addEventListener('click', () => {
    const sprites = scene.getAgentSprites();
    log(`当前共有 ${sprites.size} 个 Agent`, 'info');
    sprites.forEach((sprite: AgentSprite, id: string) => {
      log(`  - ${id}: ${sprite.getAgentName()} (${sprite.getAgentType()}) - ${sprite.getCurrentStatus()}`, 'info');
    });
  });
});
