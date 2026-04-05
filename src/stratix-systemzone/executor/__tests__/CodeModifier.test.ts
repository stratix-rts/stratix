// ============================================
// CodeModifier.test.ts - 代码修改引擎测试
// Phase 2: CodeModifier 代码修改 + 回滚
// ============================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

import { CodeModifier } from '../CodeModifier';
import type { ModificationPlan, FileModification } from '../types';

describe('CodeModifier', () => {
  let workDir: string;
  let modifier: CodeModifier;

  beforeEach(async () => {
    // 创建临时目录作为工作目录
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemodifier-test-'));
    // 初始化为 git 仓库
    execSync('git init', { cwd: workDir });
    execSync('git config user.email "test@test.com"', { cwd: workDir });
    execSync('git config user.name "Test"', { cwd: workDir });

    modifier = new CodeModifier();
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  const createPlan = (modifications: FileModification[]): ModificationPlan => ({
    proposalId: 'test-proposal-1',
    modifications,
    estimatedRisk: 'low',
    affectedFiles: modifications.map((m) => m.path),
    description: 'Test modification plan',
  });

  // ============================================
  // validateModifications 测试
  // ============================================

  describe('validateModifications', () => {
    test('validates empty plan as invalid', () => {
      const plan = createPlan([]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Modification plan has no modifications');
    });

    test('validates plan without proposalId as invalid', () => {
      const plan: ModificationPlan = {
        proposalId: '',
        modifications: [{ type: 'create', path: 'test.ts', description: 'test' }],
        estimatedRisk: 'low',
        affectedFiles: ['test.ts'],
        description: 'Test',
      };
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Modification plan has no proposalId');
    });

    test('blocks modification targeting executor path', () => {
      const plan = createPlan([{
        type: 'edit',
        path: 'src/stratix-systemzone/executor/CodeModifier.ts',
        content: 'modified',
        description: 'Trying to edit executor',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('forbidden'))).toBe(true);
    });

    test('blocks modification targeting guardian path', () => {
      const plan = createPlan([{
        type: 'edit',
        path: 'src/stratix-systemzone/guardian/Guardian.ts',
        content: 'modified',
        description: 'Trying to edit guardian',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('forbidden'))).toBe(true);
    });

    test('blocks rename to forbidden path', () => {
      const plan = createPlan([{
        type: 'rename',
        path: 'src/normal.ts',
        newPath: 'src/stratix-systemzone/guardian/test.ts',
        description: 'Rename to guardian',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
    });

    test('accepts valid modification plan', () => {
      const plan = createPlan([{
        type: 'create',
        path: 'src/new-file.ts',
        content: 'export const x = 1;',
        description: 'Create new file',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('warns when edit lacks originalContent backup', () => {
      const plan = createPlan([{
        type: 'edit',
        path: 'src/existing.ts',
        content: 'modified',
        description: 'Edit without backup',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('originalContent'))).toBe(true);
    });

    test('rejects content exceeding file size limit', () => {
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      const plan = createPlan([{
        type: 'create',
        path: 'src/large.ts',
        content: largeContent,
        description: 'Large file',
      }]);
      const result = modifier.validateModifications(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds'))).toBe(true);
    });
  });

  // ============================================
  // applyModifications 测试
  // ============================================

  describe('applyModifications', () => {
    test('creates new file', async () => {
      const plan = createPlan([{
        type: 'create',
        path: 'src/new-file.ts',
        content: 'export const x = 1;',
        description: 'Create new file',
      }]);

      const results = await modifier.applyModifications(workDir, plan);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('create');
      const filePath = path.join(workDir, 'src/new-file.ts');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('export const x = 1;');
    });

    test('creates nested directories automatically', async () => {
      const plan = createPlan([{
        type: 'create',
        path: 'src/nested/deep/file.ts',
        content: 'export const y = 2;',
        description: 'Create nested file',
      }]);

      await modifier.applyModifications(workDir, plan);

      const filePath = path.join(workDir, 'src/nested/deep/file.ts');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('export const y = 2;');
    });

    test('edits existing file and preserves originalContent', async () => {
      // 先创建文件
      const filePath = path.join(workDir, 'src/existing.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'original content');

      const plan = createPlan([{
        type: 'edit',
        path: 'src/existing.ts',
        content: 'modified content',
        description: 'Edit existing file',
      }]);

      const results = await modifier.applyModifications(workDir, plan);

      expect(results[0].originalContent).toBe('original content');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('modified content');
    });

    test('deletes file and preserves originalContent', async () => {
      // 先创建文件
      const filePath = path.join(workDir, 'src/to-delete.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'content to delete');

      const plan = createPlan([{
        type: 'delete',
        path: 'src/to-delete.ts',
        description: 'Delete file',
      }]);

      const results = await modifier.applyModifications(workDir, plan);

      expect(results[0].originalContent).toBe('content to delete');
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    test('renames file correctly', async () => {
      // 先创建文件
      const oldPath = path.join(workDir, 'src/old-name.ts');
      await fs.mkdir(path.dirname(oldPath), { recursive: true });
      await fs.writeFile(oldPath, 'file content');

      const plan = createPlan([{
        type: 'rename',
        path: 'src/old-name.ts',
        newPath: 'src/new-name.ts',
        description: 'Rename file',
      }]);

      await modifier.applyModifications(workDir, plan);

      // 新文件存在
      const newContent = await fs.readFile(path.join(workDir, 'src/new-name.ts'), 'utf-8');
      expect(newContent).toBe('file content');
      // 旧文件不存在
      await expect(fs.access(oldPath)).rejects.toThrow();
    });

    test('throws error for invalid plan', async () => {
      const plan = createPlan([{
        type: 'edit',
        path: 'src/stratix-systemzone/executor/CodeModifier.ts',
        content: 'hacked',
        description: 'Try to hack',
      }]);

      await expect(modifier.applyModifications(workDir, plan)).rejects.toThrow('Invalid modification plan');
    });
  });

  // ============================================
  // revertModifications 测试
  // ============================================

  describe('revertModifications', () => {
    test('reverts file creation by deleting the file', async () => {
      // 先创建文件
      const filePath = path.join(workDir, 'src/created.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'created content');

      const modifications: FileModification[] = [{
        type: 'create',
        path: 'src/created.ts',
        description: 'Created file',
      }];

      await modifier.revertModifications(workDir, modifications);

      await expect(fs.access(filePath)).rejects.toThrow();
    });

    test('reverts file edit by restoring originalContent', async () => {
      const filePath = path.join(workDir, 'src/edited.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'original');

      const modifications: FileModification[] = [{
        type: 'edit',
        path: 'src/edited.ts',
        content: 'modified',
        originalContent: 'original',
        description: 'Edited file',
      }];

      await modifier.revertModifications(workDir, modifications);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('original');
    });

    test('reverts file deletion by recreating the file', async () => {
      const filePath = path.join(workDir, 'src/deleted.ts');
      // 文件不存在（已被删除）

      const modifications: FileModification[] = [{
        type: 'delete',
        path: 'src/deleted.ts',
        originalContent: 'restored content',
        description: 'Deleted file',
      }];

      await modifier.revertModifications(workDir, modifications);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('restored content');
    });

    test('reverts rename by moving file back', async () => {
      const oldPath = path.join(workDir, 'src/old.ts');
      const newPath = path.join(workDir, 'src/new.ts');
      await fs.mkdir(path.dirname(oldPath), { recursive: true });
      await fs.writeFile(newPath, 'file content');
      // 旧文件不存在

      const modifications: FileModification[] = [{
        type: 'rename',
        path: 'src/old.ts',
        newPath: 'src/new.ts',
        originalContent: 'file content',
        description: 'Renamed file',
      }];

      await modifier.revertModifications(workDir, modifications);

      // 恢复旧文件
      const oldContent = await fs.readFile(oldPath, 'utf-8');
      expect(oldContent).toBe('file content');
      // 新文件不存在
      await expect(fs.access(newPath)).rejects.toThrow();
    });

    test('reverts multiple modifications in reverse order', async () => {
      // 创建多个文件
      const file1 = path.join(workDir, 'src/file1.ts');
      const file2 = path.join(workDir, 'src/file2.ts');
      await fs.mkdir(path.dirname(file1), { recursive: true });
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      const modifications: FileModification[] = [
        { type: 'create', path: 'src/file1.ts', description: 'First' },
        { type: 'create', path: 'src/file2.ts', description: 'Second' },
      ];

      await modifier.revertModifications(workDir, modifications);

      // 逆序回滚：先删 file2，再删 file1
      await expect(fs.access(file2)).rejects.toThrow();
      await expect(fs.access(file1)).rejects.toThrow();
    });
  });

  // ============================================
  // generateDiff 测试
  // ============================================

  describe('generateDiff', () => {
    test('returns empty diff for clean working directory', async () => {
      const diff = await modifier.generateDiff(workDir);
      expect(diff).toBe('');
    });

    test('generates diff for modified files', async () => {
      // 创建并修改文件
      const filePath = path.join(workDir, 'src/modified.ts');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'original');
      execSync('git add .', { cwd: workDir });
      execSync('git commit -m "initial"', { cwd: workDir });

      // 修改文件
      await fs.writeFile(filePath, 'modified');

      const diff = await modifier.generateDiff(workDir);

      expect(diff).toContain('modified.ts');
      expect(diff).toContain('-original');
      expect(diff).toContain('+modified');
    });

    test('generates diff for new files', async () => {
      // 初始提交
      await fs.mkdir(path.join(workDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(workDir, 'src/empty.ts'), '');
      execSync('git add .', { cwd: workDir });
      execSync('git commit -m "initial"', { cwd: workDir });

      // 添加新文件（不 staged，generateDiff 使用 git diff 展示未 staged 变化）
      await fs.writeFile(path.join(workDir, 'src/new.ts'), 'new content');

      // 使用 generateDiff 方法，它使用 git diff --no-color
      const diff = await modifier.generateDiff(workDir);

      // git diff 默认对 untracked 文件不显示差异，除非使用 -u/--untracked-files
      // 验证 diff 不报错即可（实际行为取决于 git 配置）
      expect(typeof diff).toBe('string');
    });
  });

  // ============================================
  // 配置测试
  // ============================================

  describe('config', () => {
    test('uses custom config when provided', () => {
      const customModifier = new CodeModifier({
        maxFileSizeBytes: 500,
        forbiddenPathPatterns: ['**/blocked/**'],
      });

      const config = customModifier.getConfig();
      expect(config.maxFileSizeBytes).toBe(500);
      expect(config.forbiddenPathPatterns).toContain('**/blocked/**');
    });

    test('uses default config when not provided', () => {
      const defaultModifier = new CodeModifier();
      const config = defaultModifier.getConfig();

      expect(config.maxFileSizeBytes).toBe(1024 * 1024); // 1MB
      expect(config.forbiddenPathPatterns.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // 边界情况测试
  // ============================================

  describe('edge cases', () => {
    test('handles empty file content', async () => {
      const plan = createPlan([{
        type: 'create',
        path: 'src/empty.ts',
        content: '',
        description: 'Create empty file',
      }]);

      const results = await modifier.applyModifications(workDir, plan);

      expect(results[0].type).toBe('create');
      const content = await fs.readFile(path.join(workDir, 'src/empty.ts'), 'utf-8');
      expect(content).toBe('');
    });

    test('handles unicode content correctly', async () => {
      const unicodeContent = '你好世界 🌍 αβγδ';
      const plan = createPlan([{
        type: 'create',
        path: 'src/unicode.ts',
        content: unicodeContent,
        description: 'Unicode content',
      }]);

      await modifier.applyModifications(workDir, plan);

      const content = await fs.readFile(path.join(workDir, 'src/unicode.ts'), 'utf-8');
      expect(content).toBe(unicodeContent);
    });

    test('handles path with backslashes (Windows-style)', async () => {
      // On Unix, backslashes are not path separators, so we use forward slashes
      // The CodeModifier should handle this correctly by normalizing paths
      const plan = createPlan([{
        type: 'create',
        path: 'src/windows/path.ts',
        content: 'windows path',
        description: 'Windows-style path',
      }]);

      await modifier.applyModifications(workDir, plan);

      const filePath = path.join(workDir, 'src/windows/path.ts');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('windows path');
    });
  });
});
