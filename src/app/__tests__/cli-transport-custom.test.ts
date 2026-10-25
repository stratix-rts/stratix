/**
 * 文件职责：**自定义 agent 的 CliAdapter**测试（task_056 规格⑥）—— 模板渲染的注入安全、
 *   两种输出解析器（plain / json）、无 session 语义。跑的是完整 transport 回路
 *   （真实 runtime + 假进程工厂），与 cli-transport.test.ts 同一手法 —— 契约行为
 *   （done 事件 / 错误口径）不是 mock 出来的断言，是真 runtime 跑出来的证据。
 * 安全口径（对应 adapters/custom.ts 文件头）：
 *   1. prompt 带 shell 注入载荷 → 永远只是**一个 argv 元素**（binary 不被改写、不会被拆）；
 *   2. 预览串的单引号包裹：`'` 逃逸成 `'\''`，载荷出不了引号；
 *   3. 渲染时重校验：注册后模板被改坏 → fail closed（抛错，runtime 转错误事件）。
 */

import { createCustomAdapter, parseCustomJsonOutput, quoteSingle, renderCustomRunArgv, renderCustomRunCommandPreview } from '../../app/services/cli-transport/adapters/custom';
import { createCliTransport } from '../../app/services/cli-transport/runtime';
import type { TransportEvent } from '../../app/services/cli-transport/transport';
import { collect, createFakeProcessFactory } from './helpers/fake-process';

/** 收集一轮 spawn 的全部事件。 */
async function collectEvents(events: AsyncIterable<TransportEvent>): Promise<TransportEvent[]> {
  return collect(events);
}

describe('task_056 custom adapter：渲染与注入安全', () => {
  describe('renderCustomRunArgv（执行路径：argv 直拼不经 shell）', () => {
    it('模板渲染：占位符位置插入 prompt 为单个 argv 元素', () => {
      const rendered = renderCustomRunArgv('myagent ask {prompt} --json', '你好 世界');
      expect(rendered).toEqual({ binary: 'myagent', args: ['ask', '你好 世界', '--json'] });
    });

    it('占位符收尾：prompt 是最后一个参数', () => {
      const rendered = renderCustomRunArgv('myagent --prompt {prompt}', 'hi');
      expect(rendered).toEqual({ binary: 'myagent', args: ['--prompt', 'hi'] });
    });

    it('注入载荷不逃逸：`; rm -rf /` 整段只是一个 argv 元素（构造上无 shell 可解释）', () => {
      const payload = "'; rm -rf /; echo 'pwned";
      const rendered = renderCustomRunArgv('myagent ask {prompt}', payload);
      expect(rendered.binary).toBe('myagent'); // binary 不被载荷改写
      expect(rendered.args).toEqual(['ask', payload]); // 载荷原样单元素，不拆不拼
    });

    it.each([
      'myagent {prompt} | sh',
      'myagent {prompt}; rm -rf /',
      "myagent '{prompt}'",
      'myagent {prompt} $(reboot)',
      'myagent {prompt} `id`',
      'myagent {prompt}\nls',
    ])('渲染时重校验：脏模板直接抛错（fail closed）：%s', (template) => {
      expect(() => renderCustomRunArgv(template, 'x')).toThrow();
    });

    it('占位符数量不对（零个 / 两个）抛错', () => {
      expect(() => renderCustomRunArgv('myagent', 'x')).toThrow();
      expect(() => renderCustomRunArgv('myagent {prompt} {prompt}', 'x')).toThrow();
    });
  });

  describe('quoteSingle / 预览串（单引号包裹只用于人可读展示）', () => {
    it("单引号内容零解释：it's → 'it'\\''s'", () => {
      expect(quoteSingle("it's")).toBe(`'it'\\''s'`);
    });

    it("载荷逃不出引号：'; rm -rf / 包裹后仍是完整一段", () => {
      const quoted = quoteSingle("'; rm -rf /; echo '");
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      // 拼回 sh 语义验证：整串被包住（开闭引号成对，中间载荷完整）。
      expect(quoted).toBe(`''\\''; rm -rf /; echo '\\'''`);
    });

    it('预览串与执行同源：prompt 段单引号包裹，其余 argv 原样', () => {
      expect(renderCustomRunCommandPreview('myagent ask {prompt}', 'hi "you"')).toBe(
        `myagent ask 'hi "you"'`
      );
      expect(renderCustomRunCommandPreview('myagent ask {prompt}', "it's")).toBe(
        `myagent ask 'it'\\''s'`
      );
    });
  });

  describe('parseCustomJsonOutput（json 解析器：提字段 + 容错降级 plain）', () => {
    it('.text 命中', () => {
      expect(parseCustomJsonOutput(JSON.stringify({ text: '回答甲' }))).toEqual([
        { type: 'message', text: '回答甲' },
      ]);
    });

    it('.text 空串时取 .content', () => {
      expect(parseCustomJsonOutput(JSON.stringify({ text: '', content: '回答乙' }))).toEqual([
        { type: 'message', text: '回答乙' },
      ]);
    });

    it('.text/.content 都缺时取 .output', () => {
      expect(parseCustomJsonOutput(JSON.stringify({ output: '回答丙' }))).toEqual([
        { type: 'message', text: '回答丙' },
      ]);
    });

    it('字段全空 / 类型不对 → 降级（返 []，runtime 兜底整段当文本）', () => {
      expect(parseCustomJsonOutput(JSON.stringify({ text: '  ', content: null }))).toEqual([]);
      expect(parseCustomJsonOutput(JSON.stringify({ text: 42 }))).toEqual([]);
      expect(parseCustomJsonOutput(JSON.stringify({ other: 'x' }))).toEqual([]);
    });

    it('不是 JSON → 降级（返 []）', () => {
      expect(parseCustomJsonOutput('就是一段普通文本，不是 JSON')).toEqual([]);
      expect(parseCustomJsonOutput('{"broken": ')).toEqual([]);
    });

    it('数组 / 标量 JSON 不是文档 → 降级', () => {
      expect(parseCustomJsonOutput('[1,2]')).toEqual([]);
      expect(parseCustomJsonOutput('42')).toEqual([]);
    });
  });

  describe('createCustomAdapter 契约', () => {
    it('kind = custom:<id>；binary 取模板首 token；buildArgs 忽略 sessionId（无 session 语义）', () => {
      const adapter = createCustomAdapter({ id: 'myagent', runCmdTemplate: 'myagent ask {prompt}', outputParser: 'plain' });
      expect(adapter.kind).toBe('custom:myagent');
      expect(adapter.binary).toBe('myagent');
      const withSession = adapter.buildArgs('hi', { sessionId: 'old-session' });
      const fresh = adapter.buildArgs('hi');
      expect(withSession).toEqual(fresh); // 传入历史 session id 也不透传 —— 每轮新会话
      expect(withSession).toEqual(['ask', 'hi']);
    });

    it('工厂期就解析模板：注册行坏了立刻抛（别等第一轮对话才失败）', () => {
      expect(() => createCustomAdapter({ id: 'x', runCmdTemplate: 'no-placeholder', outputParser: 'plain' })).toThrow();
      expect(() => createCustomAdapter({ id: 'x', runCmdTemplate: 'bad; cmd {prompt}', outputParser: 'plain' })).toThrow();
    });
  });

  describe('真 runtime 回路（plain / json 两种解析器）', () => {
    it('plain：整段 stdout 是一条回答；spawn 参数按模板渲染（prompt 单元素）', async () => {
      const fake = createFakeProcessFactory({ stdout: ['第一行', '第二行'] });
      const adapter = createCustomAdapter({ id: 'myagent', runCmdTemplate: 'myagent ask {prompt}', outputParser: 'plain' });
      const transport = createCliTransport(adapter, { factory: fake.factory });
      const events = await collectEvents(transport.spawn('你好；rm -rf /', {}));
      expect(fake.calls).toEqual([{ command: 'myagent', args: ['ask', '你好；rm -rf /'] }]);
      expect(events.some((event) => event.type === 'message' && event.text.includes('第一行'))).toBe(true);
      expect(events.at(-1)?.type).toBe('done');
      const done = events.find((event) => event.type === 'done');
      expect(done && done.type === 'done' ? done.sessionId : undefined).toBeNull(); // 无 session 语义
    });

    it('json：提取 .text 字段为回答', async () => {
      const fake = createFakeProcessFactory({ stdout: [JSON.stringify({ content: '结构化回答' })] });
      const adapter = createCustomAdapter({ id: 'j', runCmdTemplate: 'jtool run {prompt}', outputParser: 'json' });
      const transport = createCliTransport(adapter, { factory: fake.factory });
      const events = await collectEvents(transport.spawn('hi', {}));
      const message = events.find((event) => event.type === 'message');
      expect(message && message.type === 'message' ? message.text : null).toBe('结构化回答');
    });

    it('json 但输出不是 JSON：降级 plain（整段当一条 message，不报错）', async () => {
      const fake = createFakeProcessFactory({ stdout: ['兜底整段文本'] });
      const adapter = createCustomAdapter({ id: 'j', runCmdTemplate: 'jtool run {prompt}', outputParser: 'json' });
      const transport = createCliTransport(adapter, { factory: fake.factory });
      const events = await collectEvents(transport.spawn('hi', {}));
      const message = events.find((event) => event.type === 'message');
      expect(message && message.type === 'message' ? message.text : null).toBe('兜底整段文本');
      const error = events.find((event) => event.type === 'error');
      expect(error).toBeUndefined();
    });
  });
});
