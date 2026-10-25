/**
 * 单元测试：任务成果物解析（app/services/task-artifacts.ts，task_048）。
 * 覆盖需求⑤的解析面：
 *   1. diff 块解析（git diff 格式）：文件头 / b 侧路径 / hunk 内 +/- 计数 / 多 hunk 多文件
 *      累加 / +++--- 头不计数 / 裸 patch（无 diff --git 行）；
 *   2. CLI 摘要格式：claude 英文「Updated x with N additions and M removals」/ 中文
 *      「修改了 x，新增 N 行、删除 M 行」/ git diff --stat 表；
 *   3. 路径行规约：bullet / 动词前缀 / :行号 后缀 / 去重 / URL 与散文嵌路径不误伤；
 *   4. 层间合并：diff 与摘要句同路径不双计（diff 权威）；路径行不覆盖统计；
 *   5. 降级：空串 / 纯叙述 / 版本号 → 空（克制：识别不出不编造）；
 *   6. 序列化往返：'' 口径 / 坏 JSON / 坏形状宽容降级 / 坏文件条目丢弃；
 *   7. 渲染模型：文件清单两态（有统计 / 无统计）、≤10 折叠、files 空 → 空串（报告兜底口径）。
 */

import {
  EMPTY_TASK_ARTIFACTS,
  formatTaskArtifactsBlock,
  MAX_TASK_ARTIFACT_FILES,
  parseTaskArtifacts,
  parseTaskArtifactsJson,
  serializeTaskArtifacts,
  TASK_ARTIFACT_SUMMARY_MAX_LEN,
  TASK_REPORT_FILES_LIMIT,
  type TaskArtifactFile,
  type TaskArtifacts,
} from '../services/task-artifacts';

// ============================================================================
// 夹具
// ============================================================================

function file(path: string, added?: number, removed?: number): TaskArtifactFile {
  return added === undefined && removed === undefined ? { path } : { path, added, removed };
}

function artifactsOf(files: TaskArtifactFile[], summary = ''): TaskArtifacts {
  return { files, summary };
}

// ============================================================================
// 层 1：git diff 块解析
// ============================================================================

describe('parseTaskArtifacts：git diff 块', () => {
  const GIT_DIFF_OUTPUT = [
    '我来处理这个任务。',
    '',
    'diff --git a/src/core/types.ts b/src/core/types.ts',
    'index 3f2a1bc..9d4e2fa 100644',
    '--- a/src/core/types.ts',
    '+++ b/src/core/types.ts',
    '@@ -10,7 +10,9 @@ export interface Foo {',
    '   keep: string;',
    '-  old: number;',
    '+  new: number;',
    '+  extra: boolean;',
    ' }',
    'diff --git a/src/app/services/task-service.ts b/src/app/services/task-service.ts',
    'index 111..222 100644',
    '--- a/src/app/services/task-service.ts',
    '+++ b/src/app/services/task-service.ts',
    '@@ -1,3 +1,4 @@',
    ' ctx',
    '-removed line',
    '+added line',
    '@@ -20,2 +20,3 @@',
    ' ctx2',
    '+another add',
  ].join('\n');

  test('文件清单：b 侧路径（剥 b/ 前缀）；+++ / --- 头不计数；多 hunk 累加', () => {
    const result = parseTaskArtifacts(GIT_DIFF_OUTPUT);
    expect(result.files).toEqual([
      file('src/core/types.ts', 2, 1),
      file('src/app/services/task-service.ts', 2, 1),
    ]);
  });

  test('summary：尾部全是 diff 噪音 → 回落头部关键句（克制不编造）', () => {
    const result = parseTaskArtifacts(GIT_DIFF_OUTPUT);
    expect(result.summary).toBe('我来处理这个任务。');
  });

  test('同一文件多个 diff 块：统计累加（真·多次改动），条目去重', () => {
    const output = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-x',
      '+y',
      'diff --git a/src/b.ts b/src/b.ts',
      '@@ -1,2 +1,2 @@',
      '-x',
      '+y',
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -5,2 +5,3 @@',
      '+z',
    ].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([
      file('src/a.ts', 2, 1),
      file('src/b.ts', 1, 1),
    ]);
  });

  test('裸 patch（无 diff --git 行）：+++ b/x 也能认文件', () => {
    const output = ['--- a/src/pure.ts', '+++ b/src/pure.ts', '@@ -1 +1,2 @@', '-old', '+new', '+newer'].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([file('src/pure.ts', 2, 1)]);
  });

  test('hunk 之外（index / 文件头之间的行）不计数', () => {
    const output = [
      'diff --git a/x.ts b/x.ts',
      'index 000..111 100644',
      '-这行在 hunk 外，看起来像删除但不是',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '+真改动',
    ].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([file('x.ts', 1, 0)]);
  });
});

// ============================================================================
// 层 2：CLI 摘要格式
// ============================================================================

describe('parseTaskArtifacts：CLI 摘要句 / diffstat', () => {
  test('claude 英文收尾句：「Updated x with N additions and M removals」', () => {
    const output = [
      '我先看了下代码结构。',
      '',
      'Updated src/app/foo.ts with 12 additions and 3 removals.',
      'Updated src/hud/bar.tsx with 4 additions and 0 removals.',
      '',
      '已完成全部修改，全部测试通过。',
    ].join('\n');
    const result = parseTaskArtifacts(output);
    expect(result.files).toEqual([file('src/app/foo.ts', 12, 3), file('src/hud/bar.tsx', 4, 0)]);
    expect(result.summary).toBe('已完成全部修改，全部测试通过。');
  });

  test('中文收尾句：「修改了 x，新增 N 行、删除 M 行」；只说新增时删除按缺省', () => {
    const output = ['修改了 src/app/x.ts，新增 8 行、删除 2 行', '另外把配置也改了。'].join('\n');
    const result = parseTaskArtifacts(output);
    expect(result.files).toEqual([file('src/app/x.ts', 8, 2)]);
    expect(result.summary).toBe('另外把配置也改了。');

    const onlyAdded = parseTaskArtifacts('编辑了 pkg.json，新增 6 行');
    expect(onlyAdded.files).toEqual([file('pkg.json', 6, 0)]);
  });

  test('git diff --stat 表：+/- 字符数即增删行数（竖杠前的总数不取）', () => {
    const output = [
      'Changes:',
      ' src/app/a.ts | 12 +++++---',
      ' src/hud/b.tsx |  4 ++++',
      ' 2 files changed, 16 insertions(+), 3 deletions(-)',
    ].join('\n');
    const result = parseTaskArtifacts(output);
    expect(result.files).toEqual([file('src/app/a.ts', 5, 3), file('src/hud/b.tsx', 4, 0)]);
    // 「Changes:」冒号结尾的标签行与汇总行都不当 summary —— 识别不出就空。
    expect(result.summary).toBe('');
  });
});

// ============================================================================
// 层 3：路径行规约
// ============================================================================

describe('parseTaskArtifacts：路径行规约', () => {
  test('bullet / 序号 / 动词前缀 / :行号:列号 后缀都认；条目无统计', () => {
    const output = [
      '改动清单：',
      '- src/app/services/task-artifacts.ts',
      '* src/hud/components/chat-drawer/chat-drawer.ts:42',
      '1. docs/README.md:12:8',
      'modified: package.json',
    ].join('\n');
    const result = parseTaskArtifacts(output);
    expect(result.files).toEqual([
      file('src/app/services/task-artifacts.ts'),
      file('src/hud/components/chat-drawer/chat-drawer.ts'),
      file('docs/README.md'),
      file('package.json'),
    ]);
    expect(result.summary).toBe('');
  });

  test('同路径去重（含与统计层合并去重）', () => {
    const output = ['src/a.ts', '- src/a.ts', '`src/a.ts`', './src/a.ts'].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([file('src/a.ts')]);
  });

  test('散文嵌路径不算（整行是路径才是强信号）；URL 不算；版本号不算', () => {
    const output = [
      '我把 src/a.ts 重构了一下。',
      '参考 https://example.com/guide.ts 了解更多。',
      '当前版本 v3.24。',
    ].join('\n');
    const result = parseTaskArtifacts(output);
    expect(result.files).toEqual([]);
    // 尾部扫描取**最后一个**合格句（CLI 结论习惯放最后）：这里落「当前版本 v3.24。」
    expect(result.summary).toBe('当前版本 v3.24。');
  });
});

// ============================================================================
// 层间合并
// ============================================================================

describe('parseTaskArtifacts：层间合并纪律', () => {
  test('diff 与摘要句同路径 → 不双计（diff 权威，统计以先到的 counted 为准）', () => {
    const output = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      '',
      'Updated src/a.ts with 100 additions and 100 removals.',
      'Updated src/other.ts with 1 addition and 1 removal.',
    ].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([
      file('src/a.ts', 1, 1), // diff 统计胜出，摘要句不叠加
      file('src/other.ts', 1, 1), // 只有摘要句的路径照收
    ]);
  });

  test('路径行不覆盖已有统计', () => {
    const output = ['diff --git a/x.ts b/x.ts', '@@ -1 +1 @@', '-a', '+b', '+c', 'x.ts'].join('\n');
    expect(parseTaskArtifacts(output).files).toEqual([file('x.ts', 2, 1)]);
  });
});

// ============================================================================
// 降级（识别不出 → 空，不编造）
// ============================================================================

describe('parseTaskArtifacts：解析不出降级', () => {
  test('空串 → EMPTY（files 空数组 + summary 空）', () => {
    expect(parseTaskArtifacts('')).toEqual(EMPTY_TASK_ARTIFACTS);
    expect(parseTaskArtifacts('   \n  ').files).toEqual([]);
  });

  test('纯叙述（无文件信号）→ files 空；尾部关键句可作 summary', () => {
    const result = parseTaskArtifacts('北门无敌情，一切正常。');
    expect(result.files).toEqual([]);
    expect(result.summary).toBe('北门无敌情，一切正常。');
  });

  test('summary 克制：太短 / 太长 / 代码行 / 冒号结尾标签都不取', () => {
    expect(parseTaskArtifacts('好的。').summary).toBe(''); // < 6 码点
    expect(parseTaskArtifacts('长'.repeat(TASK_ARTIFACT_SUMMARY_MAX_LEN + 1)).summary).toBe('');
    expect(parseTaskArtifacts('const x = 1;').summary).toBe('');
    expect(parseTaskArtifacts('改动清单：').summary).toBe('');
  });

  test('尾部窗口内从后向前找第一个合格关键句', () => {
    const tail = ['准备开始', '先分析依赖。', '', '第一步完成。', '全部完成，测试通过。'];
    expect(parseTaskArtifacts(tail.join('\n')).summary).toBe('全部完成，测试通过。');
  });
});

// ============================================================================
// 序列化 / 反序列化
// ============================================================================

describe('serializeTaskArtifacts / parseTaskArtifactsJson：线上形状往返', () => {
  test('空成果物 → 空串（库列缺省形状）', () => {
    expect(serializeTaskArtifacts(EMPTY_TASK_ARTIFACTS)).toBe('');
    expect(serializeTaskArtifacts(artifactsOf([], ''))).toBe('');
  });

  test('summary-only（无文件有结论）也序列化（报告不单独展示，库里留着）', () => {
    const json = serializeTaskArtifacts(artifactsOf([], '全部完成，测试通过。'));
    expect(parseTaskArtifactsJson(json)).toEqual(artifactsOf([], '全部完成，测试通过。'));
  });

  test('正常往返：files + summary', () => {
    const source = artifactsOf([file('src/a.ts', 3, 1), file('b.ts')], '已完成。');
    expect(parseTaskArtifactsJson(serializeTaskArtifacts(source))).toEqual(source);
  });

  test('宽容降级：空串 / undefined / 坏 JSON / 非对象 / files 非数组 → null', () => {
    expect(parseTaskArtifactsJson('')).toBeNull();
    expect(parseTaskArtifactsJson(null)).toBeNull();
    expect(parseTaskArtifactsJson(undefined)).toBeNull();
    expect(parseTaskArtifactsJson('not json')).toBeNull();
    expect(parseTaskArtifactsJson('"just a string"')).toBeNull();
    expect(parseTaskArtifactsJson('{"summary":"x"}')).toBeNull(); // 缺 files
    expect(parseTaskArtifactsJson('{"files":[],"summary":""}')).toBeNull(); // 全空 = 无
  });

  test('坏文件条目丢弃（path 空 / 负数 / 非字符串），好条目保留', () => {
    const json = JSON.stringify({
      files: [{ path: '' }, { path: 'a.ts', added: -1 }, { path: 'b.ts', added: 2 }, 'garbage', 42],
      summary: 'ok',
    });
    expect(parseTaskArtifactsJson(json)).toEqual(artifactsOf([file('b.ts', 2)], 'ok'));
  });

  test('文件条数超 MAX_TASK_ARTIFACT_FILES 截断（存储体积硬顶）', () => {
    const many = Array.from({ length: MAX_TASK_ARTIFACT_FILES + 20 }, (_, i) => file(`f${i}.ts`));
    const round = parseTaskArtifactsJson(serializeTaskArtifacts(artifactsOf(many)));
    expect(round?.files).toHaveLength(MAX_TASK_ARTIFACT_FILES);
  });
});

// ============================================================================
// 渲染模型（报告气泡与任务输出面板共用）
// ============================================================================

describe('formatTaskArtifactsBlock：尾部摘要块文案', () => {
  test('null / files 空 → 空串（报告格式不变的兜底口径）', () => {
    expect(formatTaskArtifactsBlock(null)).toBe('');
    expect(formatTaskArtifactsBlock(undefined)).toBe('');
    expect(formatTaskArtifactsBlock(artifactsOf([], '有摘要没文件'))).toBe('');
  });

  test('有统计：📎 摘要（有才出）+ 📂 N 个文件 · +A/-B 行 + 每行（+a/-r）', () => {
    const block = formatTaskArtifactsBlock(artifactsOf([file('src/a.ts', 30, 2), file('src/b.ts', 12, 6)], '已完成全部修改。'));
    expect(block).toBe(
      [
        '📎 摘要：已完成全部修改。',
        '📂 2 个文件 · +42/-8 行',
        '- src/a.ts（+30/-2）',
        '- src/b.ts（+12/-6）',
      ].join('\n')
    );
  });

  test('全部无统计：标题不带 · +A/-B 行，文件行不带括号', () => {
    const block = formatTaskArtifactsBlock(artifactsOf([file('src/a.ts'), file('b.md')]));
    expect(block).toBe(['📂 2 个文件', '- src/a.ts', '- b.md'].join('\n'));
  });

  test('超过 10 条折叠成「…及 M 个文件」（TASK_REPORT_FILES_LIMIT 契约）', () => {
    const files = Array.from({ length: TASK_REPORT_FILES_LIMIT + 2 }, (_, i) => file(`f${i}.ts`, 1, 0));
    const block = formatTaskArtifactsBlock(artifactsOf(files));
    const lines = block.split('\n');
    expect(lines[0]).toBe(`📂 ${files.length} 个文件 · +${files.length}/-0 行`);
    expect(lines).toHaveLength(TASK_REPORT_FILES_LIMIT + 2); // 标题 + 10 条 + 折叠行
    expect(lines.at(-1)).toBe(`…及 2 个文件`);
  });

  test('单边统计（只删不增）也如实展示', () => {
    const block = formatTaskArtifactsBlock(artifactsOf([file('gone.ts', 0, 5)]));
    expect(block).toContain('📂 1 个文件 · +0/-5 行');
    expect(block).toContain('- gone.ts（+0/-5）');
  });
});
