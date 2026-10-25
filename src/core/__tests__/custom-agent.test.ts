/**
 * 文件职责：**自定义 agent 注册的纯校验层**测试（task_056 规格⑥）—— 名字 / slug /
 *   探测命令 / 执行模板的白名单与形状裁决，注入面封死在纯函数层的行为证据。
 * 测试口径：
 *   1. 白名单拒绝（shell 元字符 / 引号 / 反斜杠 / 换行 / 花括号杂串）逐类穷举；
 *   2. 模板占位符语义（缺失 / 多个 / 无可执行文件名）；
 *   3. 名字 → slug 派生（中文折叠 / 连字符去重 / 首尾修剪）与 empty-id 拒绝；
 *   4. 合法输入的规范化（trim / 大小写）；
 *   5. 上限裁决（条数 / 长度）。
 * 真数据：全部直接调被测纯函数（零 mock —— 被 IO 的面在 IPC / DAO 层另有测试）。
 */

import {
  CUSTOM_AGENT_OUTPUT_PARSERS,
  MAX_CUSTOM_AGENT_NAME_LEN,
  MAX_CUSTOM_AGENT_CMD_LEN,
  MAX_CUSTOM_AGENTS,
  canRegisterMoreCustomAgents,
  hasCharactersBoundToCustomKind,
  isAllowedCustomAgentCmd,
  slugifyCustomAgentId,
  validateCustomAgentDraft,
  type CustomAgentDraft,
} from '../../core/custom-agent';
import type { WorldState } from '../../core/types';

/** 合法草案样板（单测基线；各用例只覆写关心的字段）。 */
function validDraft(overrides: Partial<CustomAgentDraft> = {}): CustomAgentDraft {
  return {
    name: 'MyAgent',
    probeCmd: 'myagent --version',
    runCmdTemplate: 'myagent ask {prompt}',
    outputParser: 'plain',
    ...overrides,
  };
}

describe('task_056 core/custom-agent：注册草案校验', () => {
  describe('合法输入', () => {
    it('样板草案过审：id 由名字派生成小写 slug', () => {
      const result = validateCustomAgentDraft(validDraft());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft).toEqual({
        name: 'MyAgent',
        id: 'myagent',
        probeCmd: 'myagent --version',
        runCmdTemplate: 'myagent ask {prompt}',
        outputParser: 'plain',
      });
    });

    it('常用旗标形态过审：路径 / = 赋值 / 相对路径', () => {
      const result = validateCustomAgentDraft(
        validDraft({ runCmdTemplate: './bin/myagent --mode=fast -p {prompt} --out /tmp/x' })
      );
      expect(result.ok).toBe(true);
    });

    it('占位符在首尾也过审（空段合法）', () => {
      expect(
        validateCustomAgentDraft(validDraft({ runCmdTemplate: 'myagent {prompt}' })).ok
      ).toBe(true);
      // 首段必须有可执行文件名 → 占位符打头 = 没有 binary → 拒。
      expect(
        validateCustomAgentDraft(validDraft({ runCmdTemplate: '{prompt} | tee' })).ok
      ).toBe(false);
    });

    it('前后空白被 trim（用户多打的空格不构成拒绝理由，也不进库）', () => {
      const result = validateCustomAgentDraft(
        validDraft({
          name: '  MyAgent  ',
          probeCmd: '  myagent --version ',
          runCmdTemplate: ' myagent ask {prompt} ',
        })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.probeCmd).toBe('myagent --version');
      expect(result.draft.runCmdTemplate).toBe('myagent ask {prompt}');
    });

    it('json 解析器过审（词表两种都收）', () => {
      expect(validateCustomAgentDraft(validDraft({ outputParser: 'json' })).ok).toBe(true);
    });
  });

  describe('名字裁决', () => {
    it('空名字 / 非字符串拒（empty-name）', () => {
      expect(validateCustomAgentDraft(validDraft({ name: '' })).ok).toBe(false);
      expect(validateCustomAgentDraft(validDraft({ name: '   ' })).ok).toBe(false);
      expect(validateCustomAgentDraft(validDraft({ name: 42 })).ok).toBe(false);
      const result = validateCustomAgentDraft(validDraft({ name: '' }));
      expect(result).toEqual({ ok: false, code: 'empty-name' });
    });

    it(`超长名字拒（> ${MAX_CUSTOM_AGENT_NAME_LEN} 码点，按 Unicode 码点计）`, () => {
      const result = validateCustomAgentDraft(validDraft({ name: '甲'.repeat(MAX_CUSTOM_AGENT_NAME_LEN + 1) }));
      expect(result).toEqual({ ok: false, code: 'name-too-long' });
      // 恰好达标 = 过（且 slug 非空 —— 首字符是字母，后面的中文折叠掉）。白名单的语义是封
      // 注入载体，不是替用户选命令 —— 字符集内的破坏性命令与用户自己在终端里敲是同一件事。
      expect(
        validateCustomAgentDraft(validDraft({ name: `a${'甲'.repeat(MAX_CUSTOM_AGENT_NAME_LEN - 1)}` })).ok
      ).toBe(true);
    });

    it('纯符号名折叠后 slug 为空 → 拒（empty-id，不替用户编造 id）', () => {
      const result = validateCustomAgentDraft(validDraft({ name: '中文特工' }));
      expect(result).toEqual({ ok: false, code: 'empty-id' });
    });

    it('混排名派生 slug：非 [a-z0-9] 折叠成连字符', () => {
      expect(slugifyCustomAgentId('My Cool Agent')).toBe('my-cool-agent');
      expect(slugifyCustomAgentId('Agent---X')).toBe('agent-x');
      expect(slugifyCustomAgentId('A/B:C')).toBe('a-b-c');
      expect(slugifyCustomAgentId('v2.1 工具')).toBe('v2-1');
      expect(slugifyCustomAgentId('___')).toBe('');
    });
  });

  describe('命令白名单（防命令注入的第一道门）', () => {
    it.each([
      'myagent;rm -rf /',
      'myagent && ls',
      'myagent | cat',
      'myagent `ls`',
      'myagent $(whoami)',
      "myagent 'x'",
      'myagent "x"',
      'myagent \\x',
      'myagent > out',
      'myagent < in',
      'myagent *',
      'myagent ?',
      'myagent [a]',
      'myagent #c',
      'myagent ~x',
      'myagent !x',
      'myagent\nls',
      'myagent\tls',
      'myagent (x)',
    ])('探测命令含注入载体被拒：%s', (probeCmd) => {
      expect(validateCustomAgentDraft(validDraft({ probeCmd })).ok).toBe(false);
      expect(isAllowedCustomAgentCmd(probeCmd)).toBe(false);
    });

    it.each([
      'myagent ask {prompt} | tee /tmp/x',
      'myagent ask {prompt} > /tmp/x',
      'myagent {prompt} `ls`',
      "myagent '{prompt}'",
      'myagent {prompt} && echo pwn',
      'myagent {prompt};ls',
      'myagent {prompt}$IFS',
      'myagent ${prompt}',
    ])('执行模板含注入载体被拒：%s', (runCmdTemplate) => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['cmd-invalid-chars', 'template-missing-prompt', 'template-duplicate-prompt', 'template-no-binary']).toContain(result.code);
      }
    });

    it('模板里的花括号杂串（非 {prompt}）被白名单拒 —— 侧段不允许任何花括号', () => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate: 'myagent {foo} {prompt}' }));
      expect(result).toEqual({ ok: false, code: 'cmd-invalid-chars' });
    });
  });

  describe('模板占位符语义', () => {
    it('缺 {prompt} 拒（template-missing-prompt）', () => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate: 'myagent ask' }));
      expect(result).toEqual({ ok: false, code: 'template-missing-prompt' });
    });

    it('两个 {prompt} 拒（template-duplicate-prompt）', () => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate: 'myagent {prompt} {prompt}' }));
      expect(result).toEqual({ ok: false, code: 'template-duplicate-prompt' });
    });

    it('无可执行文件名拒（template-no-binary：占位符打头）', () => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate: '{prompt} myagent' }));
      expect(result).toEqual({ ok: false, code: 'template-no-binary' });
    });

    it('空模板 / 非字符串拒（empty-template）', () => {
      expect(validateCustomAgentDraft(validDraft({ runCmdTemplate: '' }))).toEqual({ ok: false, code: 'empty-template' });
      expect(validateCustomAgentDraft(validDraft({ runCmdTemplate: '  ' }))).toEqual({ ok: false, code: 'empty-template' });
      expect(validateCustomAgentDraft(validDraft({ runCmdTemplate: null }))).toEqual({ ok: false, code: 'empty-template' });
    });
  });

  describe('长度与词表上限', () => {
    it(`探测命令超 ${MAX_CUSTOM_AGENT_CMD_LEN} 字符拒（cmd-too-long）`, () => {
      const result = validateCustomAgentDraft(validDraft({ probeCmd: `a${'x'.repeat(MAX_CUSTOM_AGENT_CMD_LEN)}` }));
      expect(result).toEqual({ ok: false, code: 'cmd-too-long' });
    });

    it(`执行模板超 ${MAX_CUSTOM_AGENT_CMD_LEN} 字符拒（cmd-too-long）`, () => {
      const result = validateCustomAgentDraft(validDraft({ runCmdTemplate: `a${'x'.repeat(MAX_CUSTOM_AGENT_CMD_LEN)} {prompt}` }));
      expect(result).toEqual({ ok: false, code: 'cmd-too-long' });
    });

    it('解析器词表外拒（unknown-parser）', () => {
      const result = validateCustomAgentDraft(validDraft({ outputParser: 'xml' }));
      expect(result).toEqual({ ok: false, code: 'unknown-parser' });
      expect(validateCustomAgentDraft(validDraft({ outputParser: undefined })).ok).toBe(false);
    });

    it('词表冻结：plain 与 json，不多不少', () => {
      expect([...CUSTOM_AGENT_OUTPUT_PARSERS]).toEqual(['plain', 'json']);
    });

    it(`注册条数上限 ${MAX_CUSTOM_AGENTS}：满了不再收`, () => {
      expect(canRegisterMoreCustomAgents(0)).toBe(true);
      expect(canRegisterMoreCustomAgents(MAX_CUSTOM_AGENTS - 1)).toBe(true);
      expect(canRegisterMoreCustomAgents(MAX_CUSTOM_AGENTS)).toBe(false);
    });
  });

  describe('删除注册的角色保留裁决（hasCharactersBoundToCustomKind）', () => {
    it('kind 仍被角色引用 → true（删除注册时提示保留语义）', () => {
      const state = {
        characters: [
          { id: 'c1', agentKind: 'custom:myagent' },
          { id: 'c2', agentKind: 'kimi' },
        ],
      } as unknown as Pick<WorldState, 'characters'>;
      expect(hasCharactersBoundToCustomKind(state, 'custom:myagent')).toBe(true);
      expect(hasCharactersBoundToCustomKind(state, 'custom:other')).toBe(false);
      expect(hasCharactersBoundToCustomKind(null, 'custom:myagent')).toBe(false);
    });
  });
});
