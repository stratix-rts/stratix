/**
 * 单测：协议编解码层（core/agent-link/protocol.ts）。
 *
 * 这些用例的价值在于**锁住线上形状**：帧字段名一旦漂移，网关侧的代理与现网 OpenClaw
 * 适配器就会同时失联，而这种失联在联调前不会报错。故逐字段断言，不做模糊匹配。
 */

import {
  buildWsUrl,
  chatFrame,
  decodeInboundFrame,
  encodeOutboundFrame,
  isGatewayOk,
  parseRemoteMessage,
  parseRemoteStatus,
  proxyKeyOf,
  redactEndpoint,
  toolFrame,
  type GatewayEnvelope,
} from '../protocol';

describe('地址与脱敏', () => {
  test('proxyKeyOf 与现网 computeProxyKey 同构：非字母数字全部替换为下划线', () => {
    expect(proxyKeyOf('http://127.0.0.1:18080')).toBe('http___127_0_0_1_18080');
    expect(proxyKeyOf('wss://host.dev/openclaw')).toBe('wss___host_dev_openclaw');
  });

  test('redactEndpoint 抹掉 query（凭据常藏在这里）', () => {
    expect(redactEndpoint('http://127.0.0.1:18080')).toBe('http://127.0.0.1:18080');
    expect(redactEndpoint('http://127.0.0.1:18080?token=secret')).toBe('http://127.0.0.1:18080?***');
  });

  test('buildWsUrl 拼出网关代理地址并做协议升级 + clientId 编码', () => {
    const url = buildWsUrl('http://127.0.0.1:7524', 'http://127.0.0.1:18080', 'account one');
    expect(url).toBe(
      'ws://127.0.0.1:7524/api/stratix/openclaw/proxy/http___127_0_0_1_18080/ws?clientId=account%20one'
    );
    // https → wss（现网 getWebSocketUrl 的 replace(/^http/, 'ws') 行为）
    expect(buildWsUrl('https://gw.example', 'https://agent.example', 'stratix')).toContain('wss://gw.example');
  });
});

describe('REST 信封', () => {
  test('isGatewayOk 只认 code=200（与 StratixRequestHelper.isSuccess 一致）', () => {
    const ok: GatewayEnvelope<{ proxyKey: string }> = {
      code: 200,
      message: 'OpenClaw connection configured',
      data: { proxyKey: 'k' },
      requestId: 'req_1',
    };
    const bad: GatewayEnvelope<null> = { code: 502, message: 'Connection failed', data: null, requestId: 'req_2' };
    expect(isGatewayOk(ok)).toBe(true);
    expect(isGatewayOk(bad)).toBe(false);
  });
});

describe('出站帧', () => {
  test('对话帧形状与 GatewayOpenClawAdapter.sendMessage 一致', () => {
    const frame = chatFrame('req_1', 'ping', { sessionId: 'sess_9', agentId: 'openclaw:writer' });
    expect(JSON.parse(encodeOutboundFrame(frame))).toEqual({
      type: 'text',
      requestId: 'req_1',
      message: 'ping',
      payload: { sessionId: 'sess_9', agentId: 'openclaw:writer' },
    });
  });

  test('工具帧形状与 invokeTool 一致（tool 名放 message，args/sessionKey 放 payload）', () => {
    const frame = toolFrame('req_2', 'sessions_list', { args: { a: 1 }, sessionKey: 'sess_9' });
    expect(JSON.parse(encodeOutboundFrame(frame))).toEqual({
      type: 'tool',
      requestId: 'req_2',
      message: 'sessions_list',
      payload: { args: { a: 1 }, sessionKey: 'sess_9' },
    });
  });
});

describe('入站帧解码', () => {
  test('response 帧：取 requestId 与正文，error 优先', () => {
    expect(decodeInboundFrame(JSON.stringify({ type: 'response', requestId: 'r1', message: 'hello' }))).toEqual({
      kind: 'response',
      requestId: 'r1',
      text: 'hello',
      error: null,
    });
    // 现网 resolve 逻辑是 message || content，两种字段都要认
    expect(decodeInboundFrame(JSON.stringify({ type: 'text', requestId: 'r2', content: 'body' }))).toEqual({
      kind: 'response',
      requestId: 'r2',
      text: 'body',
      error: null,
    });
    expect(decodeInboundFrame(JSON.stringify({ type: 'response', requestId: 'r3', error: 'boom' }))).toEqual({
      kind: 'response',
      requestId: 'r3',
      text: null,
      error: 'boom',
    });
  });

  test('event 帧：event 名缺失时归一为 unknown，payload 原样透传', () => {
    expect(decodeInboundFrame(JSON.stringify({ type: 'event', payload: { a: 1 } }))).toEqual({
      kind: 'event',
      event: 'unknown',
      data: { a: 1 },
    });
  });

  test('error 帧：错误字段缺失时给兜底文案', () => {
    expect(decodeInboundFrame(JSON.stringify({ type: 'error' }))).toEqual({
      kind: 'error',
      error: 'unknown gateway error',
    });
  });

  test('脏数据只降级不抛异常：非法 JSON / 非对象 / 无 requestId / 未知类型', () => {
    expect(decodeInboundFrame('{not json')).toEqual({ kind: 'ignored', reason: 'invalid-json' });
    expect(decodeInboundFrame('[1,2]')).toEqual({ kind: 'ignored', reason: 'not-an-object' });
    expect(decodeInboundFrame(JSON.stringify({ type: 'response', message: 'orphan' }))).toEqual({
      kind: 'ignored',
      reason: 'response-without-requestId',
    });
    expect(decodeInboundFrame(JSON.stringify({ type: 'tool_result' }))).toEqual({
      kind: 'ignored',
      reason: 'unknown-frame-type:tool_result',
    });
  });
});

describe('远端负载归一', () => {
  test('消息：字符串负载 / 对象负载（text|content|message 三选一）都能解析', () => {
    expect(parseRemoteMessage('hi')).toEqual({ text: 'hi', author: 'agent', id: null });
    expect(parseRemoteMessage({ content: 'hi', author: 'writer', id: 'm1' })).toEqual({
      text: 'hi',
      author: 'writer',
      id: 'm1',
    });
    expect(parseRemoteMessage({ message: 'from message field' })).toEqual({
      text: 'from message field',
      author: 'agent',
      id: null,
    });
  });

  test('消息：没有正文的事件不当消息处理（返回 null，交由上层走 raw 分支）', () => {
    expect(parseRemoteMessage({ sessionId: 's1' })).toBeNull();
    expect(parseRemoteMessage(42)).toBeNull();
    expect(parseRemoteMessage('')).toBeNull();
  });

  test('状态：字符串 / {status} / {busy} 三种写法都归一到 UnitStatus 词表', () => {
    expect(parseRemoteStatus('busy')).toBe('busy');
    expect(parseRemoteStatus({ status: 'running' })).toBe('busy');
    expect(parseRemoteStatus({ status: 'idle' })).toBe('idle');
    expect(parseRemoteStatus({ busy: true })).toBe('busy');
    expect(parseRemoteStatus({ busy: false })).toBe('idle');
    expect(parseRemoteStatus({ status: 'disconnected' })).toBe('offline');
    expect(parseRemoteStatus({ status: 'failed' })).toBe('error');
  });

  test('状态：认不出的值返回 null（上层据此保持原状态，不臆造）', () => {
    expect(parseRemoteStatus({ status: 'thinking-harder' })).toBeNull();
    expect(parseRemoteStatus({ progress: 0.5 })).toBeNull();
    expect(parseRemoteStatus(null)).toBeNull();
  });
});