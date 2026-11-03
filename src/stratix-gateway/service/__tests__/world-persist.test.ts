/**
 * 文件职责：世界态快照落盘（world-persist / world-snapshot，task_133）的单测 ——
 *   验四件事：
 *     ① **往返**：missions（含正文与检查点）+ 角色名册落盘后能被读回并恢复进另一个 store；
 *     ② **防抖**：写侧不每事件同步写盘 —— 一串快速变化合并成一次落盘；
 *     ③ **相位一致**：done / cancelled 的任务重启后仍是终态（不是回到 pending）；
 *     ④ **坏档降级**：快照文件是坏 JSON 时读档降级成空态 + 一行警告，**不抛**（服务照常起）。
 * 输入：无（自足单测；真文件落在临时目录里，跑完删掉）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. mock 掉文件系统 —— 这里验的就是「真文件真往返」，mock 掉就什么都没验；
 *   2. 直接往 store 里塞 mission 字面量来「造」任务 —— 任务必须经 core 的写入面进来
 *      （否则测的不是真实链路的相位与正文归一）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createCharacterManager } from '../../../core/character';
import { createMissionManager } from '../../../core/mission';
import { createStore } from '../../../core/store';

import { createWorldPersister, readWorldSnapshotFile } from '../world-persist';
import { restoreWorldFromSnapshot } from '../world-snapshot';

describe('世界态快照落盘（missions + characters）', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-world-snapshot-'));
    filePath = path.join(dir, 'world-snapshot.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('往返：任务（正文 + 检查点）与角色名册都能读回来', () => {
    // ---- 第一次进程：建角色 + 建任务 + 记两条检查点，然后落盘 ----
    const store = createStore();
    const characters = createCharacterManager({ store });
    const missions = createMissionManager({ store });

    const created = characters.createCharacter({
      name: '工头',
      agentKind: 'claude-code',
      skinId: 'default',
      persona: '专盯验收标准',
    });
    expect(created.ok).toBe(true);
    const character = created.ok ? created.character : null;
    expect(character).not.toBeNull();

    const mission = missions.createMission({
      title: '加固城墙',
      unitIds: [],
      brief: { requirements: '把墙修到 3 格高', acceptance: '截图里墙高 ≥ 3' },
    });
    expect(mission).not.toBeNull();
    expect(missions.checkpointMission(mission!.id, '第一步：脚手架搭好')).not.toBeNull();
    expect(missions.checkpointMission(mission!.id, '第二步：砖砌到 2 格')).not.toBeNull();

    const persister = createWorldPersister({ store, filePath, debounceMs: 0 });
    persister.start();
    persister.flush();
    persister.stop();

    expect(fs.existsSync(filePath)).toBe(true);

    // ---- 第二个进程：读回快照 → 恢复进一个空 store ----
    const snapshot = readWorldSnapshotFile(filePath);
    expect(snapshot).not.toBeNull();

    const restoredStore = createStore();
    const result = restoreWorldFromSnapshot(restoredStore, snapshot!);
    expect(result.characters).toBe(1);
    expect(result.missions).toBe(1);

    const restoredMission = restoredStore.getState().missions[0];
    expect(restoredMission?.title).toBe('加固城墙');
    expect(restoredMission?.brief?.requirements).toBe('把墙修到 3 格高');
    expect(restoredMission?.brief?.acceptance).toBe('截图里墙高 ≥ 3');
    expect(restoredMission?.checkpoints?.map((c) => c.note)).toEqual([
      '第一步：脚手架搭好',
      '第二步：砖砌到 2 格',
    ]);

    const restoredCharacter = restoredStore.getState().characters[0];
    expect(restoredCharacter?.name).toBe('工头');
    expect(restoredCharacter?.persona).toBe('专盯验收标准');
    expect(restoredCharacter?.agentKind).toBe('claude-code');
    // 建档即上场：角色单位也要恢复出来（单位 id 与建档时同一投影口径）。
    expect(restoredStore.getState().units.length).toBe(1);
  });

  it('防抖：一串快速变化只落一次盘', () => {
    const store = createStore();
    const missions = createMissionManager({ store });
    let writes = 0;
    const persister = createWorldPersister({
      store,
      filePath,
      debounceMs: 50,
      writeSnapshot: (_path, contents) => {
        writes += 1;
        fs.writeFileSync(filePath, contents, 'utf8');
      },
    });
    persister.start();

    missions.createMission({ title: 'A', unitIds: [] });
    missions.createMission({ title: 'B', unitIds: [] });
    missions.createMission({ title: 'C', unitIds: [] });

    persister.flush();
    expect(writes).toBe(1);
    persister.stop();
  });

  it('相位一致：done / cancelled 的任务重启后仍是终态', () => {
    const store = createStore();
    const characters = createCharacterManager({ store });
    const missions = createMissionManager({ store });

    // 有个单位才能把任务推进到 pending（指派名单非空才进 pending —— 见 core/mission/machine.ts）。
    characters.createCharacter({ name: '干活的', agentKind: 'claude-code', skinId: 'default' });
    const unitId = store.getState().units[0]?.id;
    expect(unitId).toBeTruthy();

    const done = missions.createMission({ title: '已收尾', unitIds: [unitId!] });
    expect(done).not.toBeNull();
    expect(done!.phase).toBe('pending');
    expect(missions.decideMission(done!.id, 'accept')).not.toBeNull();
    expect(missions.completeMission(done!.id)).not.toBeNull();

    const cancelled = missions.createMission({ title: '已叫停', unitIds: [unitId!] });
    expect(cancelled).not.toBeNull();
    expect(missions.cancelMission(cancelled!.id)).not.toBeNull();

    const persister = createWorldPersister({ store, filePath, debounceMs: 0 });
    persister.start();
    persister.flush();
    persister.stop();

    const snapshot = readWorldSnapshotFile(filePath);
    const restoredStore = createStore();
    restoreWorldFromSnapshot(restoredStore, snapshot!);

    const phases = new Map(
      restoredStore.getState().missions.map((mission) => [mission.title, mission.phase])
    );
    expect(phases.get('已收尾')).toBe('done');
    expect(phases.get('已叫停')).toBe('cancelled');
  });

  it('坏档降级：坏 JSON 读档降级成空态 + 警告，不抛', () => {
    fs.writeFileSync(filePath, '{ this is not json', 'utf8');
    const warnings: string[] = [];
    const snapshot = readWorldSnapshotFile(filePath, (line) => warnings.push(line));

    expect(snapshot).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join('\n')).toContain('降级为空世界');

    // 空档恢复进 store 不炸（世界态为空，服务照常起）。
    const store = createStore();
    const result = restoreWorldFromSnapshot(store, {
      version: 1,
      savedAt: 0,
      missions: [],
      characters: [],
    });
    expect(result.missions).toBe(0);
    expect(store.getState().missions).toEqual([]);
  });

  it('坏档降级：结构不对的档（版本不认识）也降级成空态', () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 999, missions: [], characters: [] }), 'utf8');
    const warnings: string[] = [];
    const snapshot = readWorldSnapshotFile(filePath, (line) => warnings.push(line));
    expect(snapshot).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('单条脏数据只丢那一条（整档仍可用）', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        savedAt: 1,
        missions: [
          { id: 'm1', title: '好的', phase: 'running', unitIds: [], createdAt: 1 },
          { id: '', title: '没 id', phase: 'running', unitIds: [], createdAt: 1 },
          { id: 'm3', title: '相位非法', phase: '乱写', unitIds: [], createdAt: 1 },
        ],
        characters: [],
      }),
      'utf8'
    );
    const snapshot = readWorldSnapshotFile(filePath);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.missions.map((m) => m.id)).toEqual(['m1']);
  });
});
