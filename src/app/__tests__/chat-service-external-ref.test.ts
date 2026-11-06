/**
 * 集成测试：角色对话的**外部会话引用链**（@since v3.3，task_200 / M2-03 N4b-1）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「`externalSessionId` 的处置（R1-40）」
 *   + §3.4 **R3**（chat / 互聊会话不得跨副本续发）。
 *
 * 四条断言：
 *   ① 读链 = **联合匹配**：种子来自 `session_external_refs` 的 `(characterId, instanceId)` 匹配，
 *      **不是**角色档案上的镜像列 `character.externalSessionId`（新代码不读镜像）；
 *   ② 写链 = 外部会话**建立处**：CLI 回 session id ⇒ 落一条 (extId, instanceId) 凭据；
 *   ③ **跨副本**：B 副本查不到 A 副本的凭据 ⇒ 不 resume（按首发重建，不跨副本携带上下文）；
 *   ④ 兼容：端口未接（无库形态）⇒ 回落读镜像列（旧口径不破）。
 */

import type { AgentKind, CharacterView, DetectedAgent, WorldState } from '../../core/types';
import { DEFAULT_INSTANCE_ID } from '../../core/types';
import type { SpawnOptions, TransportEvent } from '../services/cli-transport/transport';
import {
  buildFirstPrompt,
  chatSessionRestoredText,
  createChatService,
  type ChatExternalSessionRefPort,
  type ChatDrawerView,
  type ChatTransportFactory,
} from '../services/chat-service';

// ============================================================================
// 夹具
// ============================================================================

/** A 副本（本副本）与 B 副本（另一个副本 —— 切过去就查不到凭据）。 */
const INSTANCE_A = 'wsp_a';
const INSTANCE_B = 'wsp_b';

const characterInA: CharacterView = {
  id: 'ch-1',
  name: '阿尔法',
  persona: '冷静的战术分析师，回答简短。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
  skinId: null,
  externalSessionId: null,
  instanceId: INSTANCE_A,
};

const detectedClaude: DetectedAgent = {
  kind: 'claude-code',
  tier: 'T1',
  installed: true,
  status: 'installed',
  version: '2.1.0',
  path: '/usr/local/bin/claude',
};

function makeView(): { view: ChatDrawerView; messages: Array<{ role: string; text: string }> } {
  const messages: Array<{ role: string; text: string }> = [];
  return {
    view: {
      addMessage(message): void {
        messages.push({ role: message.role, text: message.text });
      },
      appendStream(): void { /* 本测试只关心种子与写点 */ },
      finalizeStream(): void { /* 同上 */ },
      setSending(): void { /* 同上 */ },
    },
    messages,
  };
}

function scripted(...events: TransportEvent[]): AsyncGenerator<TransportEvent> {
  return (async function* script(): AsyncGenerator<TransportEvent> {
    for (const event of events) yield event;
  })();
}

interface HarnessOptions {
  readonly characters?: readonly CharacterView[];
  readonly port?: ChatExternalSessionRefPort;
}

interface Harness {
  readonly service: ReturnType<typeof createChatService>;
  readonly calls: Array<{ prompt: string; options: SpawnOptions | undefined }>;
  readonly messages: Array<{ role: string; text: string }>;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const { view, messages } = makeView();
  const calls: Array<{ prompt: string; options: SpawnOptions | undefined }> = [];
  const factory: ChatTransportFactory = (kind: AgentKind) => ({
    spawn: (prompt: string, spawnOptions?: SpawnOptions): AsyncIterable<TransportEvent> => {
      calls.push({ prompt, options: spawnOptions });
      const run = scripted(
        { type: 'message', text: 'ok' },
        { type: 'done', exitCode: 0, text: 'ok', sessionId: null },
      );
      return { [Symbol.asyncIterator]: () => run };
    },
  });
  const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
    characters: [...(options.characters ?? [characterInA])],
    detectedAgents: [detectedClaude],
    units: [],
  };
  const service = createChatService({
    view,
    getState: () => state,
    createTransport: factory,
    persistSessionId: () => { /* 镜像写入不在本测试的范围 */ },
    ...(options.port ? { externalSessionRefs: options.port } : {}),
  });
  return { service, calls, messages };
}

/** 记一次 resolve 调用并按表返回（表 = (characterId, instanceId) → 外部会话 id）。 */
function makePort(table: Record<string, string | null>): ChatExternalSessionRefPort & {
  readonly resolved: Array<[string, string]>;
  readonly recorded: Array<{
    externalSessionId: string;
    instanceId: string;
    characterId: string;
    sessionId: string | null;
  }>;
} {
  const resolved: Array<[string, string]> = [];
  const recorded: Array<{
    externalSessionId: string;
    instanceId: string;
    characterId: string;
    sessionId: string | null;
  }> = [];
  return {
    resolved,
    recorded,
    async resolve(characterId: string, instanceId: string): Promise<string | null> {
      resolved.push([characterId, instanceId]);
      return table[`${characterId}@${instanceId}`] ?? null;
    },
    record(ref): void {
      recorded.push(ref);
    },
  };
}

// ============================================================================
// 用例
// ============================================================================

describe('外部会话引用链（task_200 / N4b-1）', () => {
  test('① 读链：种子来自引用表的联合匹配（不是档案镜像列）', async () => {
    // 角色档案上留着旧镜像值 'sess-mirror'，但引用表里 A 副本的凭据是 'sess-ref'。
    const port = makePort({ [`ch-1@${INSTANCE_A}`]: 'sess-ref' });
    const harness = makeHarness({
      characters: [{ ...characterInA, externalSessionId: 'sess-mirror' }],
      port,
    });

    await harness.service.send('ch-1', '接着说');

    expect(port.resolved).toEqual([['ch-1', INSTANCE_A]]); // 联合匹配带了副本维度
    expect(harness.calls[0].options?.sessionId).toBe('sess-ref'); // 用的是引用表的值
    expect(harness.calls[0].options?.sessionId).not.toBe('sess-mirror'); // 不是镜像列的值
    expect(harness.calls[0].prompt).toBe('接着说'); // 续发只发原文（不重拼 persona）
    expect(harness.messages).toEqual([
      { role: 'system', text: chatSessionRestoredText('sess-ref') },
    ]);
  });

  test('② 写链：外部会话建立处落一条 (extId, instanceId) 凭据', async () => {
    const port = makePort({});
    const calls: Array<{ prompt: string; options: SpawnOptions | undefined }> = [];
    const { view } = makeView();
    const factory: ChatTransportFactory = () => ({
      spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> => {
        calls.push({ prompt, options });
        const run = scripted(
          { type: 'session', sessionId: 'sess-new' },
          { type: 'done', exitCode: 0, text: '好', sessionId: 'sess-new' },
        );
        return { [Symbol.asyncIterator]: () => run };
      },
    });
    const state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'> = {
      characters: [characterInA],
      detectedAgents: [detectedClaude],
      units: [],
    };
    const service = createChatService({
      view,
      getState: () => state,
      createTransport: factory,
      persistSessionId: () => { /* 镜像写入不在本测试的范围 */ },
      externalSessionRefs: port,
    });

    await service.send('ch-1', '你好');

    expect(port.recorded).toEqual([
      { externalSessionId: 'sess-new', instanceId: INSTANCE_A, characterId: 'ch-1', sessionId: null },
    ]);
  });

  test('③ 跨副本：B 副本查不到 A 副本的凭据 ⇒ 不 resume（按首发重建）', async () => {
    // 凭据只登记在 A 副本；B 副本的同名角色查 (ch-1, wsp_b) ⇒ 查不到。
    const port = makePort({ [`ch-1@${INSTANCE_A}`]: 'sess-ext-a' });
    const harness = makeHarness({
      characters: [{ ...characterInA, instanceId: INSTANCE_B }],
      port,
    });

    await harness.service.send('ch-1', '第一句');

    expect(port.resolved).toEqual([['ch-1', INSTANCE_B]]); // 用的是 B 副本的键
    expect(harness.calls[0].options?.sessionId ?? null).toBeNull(); // 没续上 A 副本的会话
    expect(harness.calls[0].prompt).toBe(buildFirstPrompt(characterInA, '第一句')); // 首发重建（persona 重注入）
    expect(harness.messages).toEqual([]); // 没有「已恢复会话」提示
  });

  test('③ 跨副本：档案镜像里有旧会话 id 也救不回来（镜像不是真相源）', async () => {
    // 极端形态：切副本后角色档案里**还留着** A 副本的会话 id（镜像列），
    //   但引用表里 B 副本没有凭据 ⇒ 仍不许 resume（R3 的判据在引用表，不在镜像列）。
    const port = makePort({ [`ch-1@${INSTANCE_A}`]: 'sess-ext-a' });
    const harness = makeHarness({
      characters: [{ ...characterInA, instanceId: INSTANCE_B, externalSessionId: 'sess-ext-a' }],
      port,
    });

    await harness.service.send('ch-1', '第一句');

    expect(harness.calls[0].options?.sessionId ?? null).toBeNull();
    expect(harness.calls[0].prompt).toBe(buildFirstPrompt(characterInA, '第一句'));
  });

  test('④ 兼容：端口未接（无库形态）⇒ 回落读档案镜像（旧口径不破）', async () => {
    const harness = makeHarness({
      characters: [{ ...characterInA, externalSessionId: 'sess-old' }],
    });

    await harness.service.send('ch-1', '接着说');

    expect(harness.calls[0].options?.sessionId).toBe('sess-old');
    expect(harness.messages).toEqual([
      { role: 'system', text: chatSessionRestoredText('sess-old') },
    ]);
  });

  test('④ 兼容：端口未接 + 角色无 instanceId ⇒ 按默认沙盒的键去查', async () => {
    const port = makePort({ [`ch-1@${DEFAULT_INSTANCE_ID}`]: 'sess-sandbox' });
    const harness = makeHarness({
      characters: [{ ...characterInA, instanceId: undefined }],
      port,
    });

    await harness.service.send('ch-1', '接着说');

    expect(port.resolved).toEqual([['ch-1', DEFAULT_INSTANCE_ID]]);
    expect(harness.calls[0].options?.sessionId).toBe('sess-sandbox');
  });
});
