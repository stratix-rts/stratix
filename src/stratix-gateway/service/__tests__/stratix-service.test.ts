/**
 * 文件职责：headless 组合根（createStratixService）的单测 —— 覆盖 A1 的四条接线纪律：
 *   ① boot 返回六件套、runtime 已接通；
 *   ② 命令经总线落地 store（mission.create 可见）；
 *   ③ stop 之后命令不再落地（订阅真的退干净了）；
 *   ④ 可选端口缺席时的降级口径（pipeline 走「未落地」、落库口缺席时养成照常）。
 * 输入：无（自足单测，用 createStore() 隔离世界态）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. 在本文件 import 渲染层 / 宿主层的东西 —— 被测模块必须能脱离渲染进程跑；
 *   2. 直接改 store 来"造"状态 —— 状态必须经总线命令落地（否则测的不是真实通路）。
 */

import { emitCommand, emitWorldEvent, resetBus } from '../../../core/bus';
import { createStore } from '../../../core/store';
import type { HudCommand, WorldEvent } from '../../../core/types';
import { createStratixService } from '../stratix-service';

describe('createStratixService（headless 组合根）', () => {
  afterEach(() => {
    // 总线是进程内单例：每个用例之间清一次，避免上一个用例的订阅串味。
    resetBus();
  });

  it('boot：返回六件套，runtime 已接通，store 是注入的那一份', () => {
    const store = createStore();
    const service = createStratixService({ store });

    expect(service.store).toBe(store);
    expect(service.runtime.running).toBe(true);
    expect(typeof service.character.createCharacter).toBe('function');
    expect(typeof service.mission.createMission).toBe('function');
    expect(typeof service.task.assignTask).toBe('function');
    expect(typeof service.stop).toBe('function');

    service.stop();
  });

  it('mission.create 经总线落地 store（命令真的被状态机接住）', () => {
    const service = createStratixService({ store: createStore() });

    emitCommand({ type: 'mission.create', title: '单测任务', unitIds: [] });

    const missions = service.store.getState().missions;
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ title: '单测任务', phase: 'draft' });

    service.stop();
  });

  it('stop 之后命令不再落地（runtime 退订干净）', () => {
    const service = createStratixService({ store: createStore() });
    service.stop();

    emitCommand({ type: 'mission.create', title: '停机后的任务', unitIds: [] });

    expect(service.runtime.running).toBe(false);
    expect(service.store.getState().missions).toHaveLength(0);
  });

  it('pipeline 端口缺省：pipeline.start 按「未落地」处理（走 onUnhandled）', () => {
    const unhandled: { channel: string; type: string }[] = [];
    const service = createStratixService({
      store: createStore(),
      onUnhandled: (channel, payload: HudCommand | WorldEvent) => {
        unhandled.push({ channel, type: payload.type });
      },
    });

    emitCommand({
      type: 'pipeline.start',
      spec: { name: '测试线', steps: [{ promptTemplate: '干活' }] },
      issue: '议题',
    });

    expect(unhandled).toEqual([{ channel: 'command', type: 'pipeline.start' }]);

    service.stop();
  });

  it('养成回路：exp.gained → 角色经验累加；落库口缺席时照常工作', () => {
    const service = createStratixService({ store: createStore() });
    const created = service.character.createCharacter({
      name: 'Neo',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
    expect(created.ok).toBe(true);

    emitWorldEvent({
      type: 'exp.gained',
      characterId: created.ok ? created.character.id : '',
      source: 'chat_round',
      amount: 5,
    });

    const character = service.store.getState().characters[0];
    expect(character?.experience).toBe(5);

    service.stop();
  });

  it('经验事件落库口注入时被调用（可选端口范式）', () => {
    const inserted: { characterId: string; delta: number }[] = [];
    const service = createStratixService({
      store: createStore(),
      persistExpEvent: (insert) => {
        inserted.push({ characterId: insert.characterId, delta: insert.delta });
      },
    });
    const created = service.character.createCharacter({
      name: 'Neo',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });

    emitWorldEvent({
      type: 'exp.gained',
      characterId: created.ok ? created.character.id : '',
      source: 'chat_round',
      amount: 7,
    });

    expect(inserted).toEqual([
      { characterId: created.ok ? created.character.id : '', delta: 7 },
    ]);

    service.stop();
  });
});
