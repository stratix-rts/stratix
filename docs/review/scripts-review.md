# scripts 模块评审

## 概览

**模块用途**: 构建、生成、修复工具脚本集

**文件统计**: 5 脚本
- `fix-electron-require.js` - 修复 Electron require 路径
- `bundle-electron.js` - 打包 Electron 主进程
- `generate-metadata.ts` - 生成 LPC 精灵元数据 JSON
- `import-agency-agents.ts` - 导入 agency-agents 模板
- `generate-agency-agents-json.ts` - 解析 markdown 生成 JSON 索引

---

## 代码质量

### 优点

1. **单一职责**: 每个脚本功能明确
2. **有注释**: 头部有使用说明
3. **错误处理**: `generate-metadata.ts` 使用 try-catch，错误时退出
4. **路径安全**: 使用 `path.join()` 而非字符串拼接

### 问题

**问题 1: `fixFile()` 函数参数未声明类型**
- Line 25: `function fixFile(filePath)` - 缺少类型注解
- 虽然是 JS 文件，但增加 JSDoc 可提升可维护性

**问题 2: `walk()` 函数参数未声明类型**
- Line 11: `function walk(dir)` - 缺少类型注解

**问题 3: `generate-metadata.ts` 的 `process.exit(1)` 无 cleanup**
- Line 270: 遇到错误直接退出，不做任何资源清理
- 对于 Node.js 脚本可接受，但不够优雅

---

## 安全问题

### 中风险: `import-agency-agents.ts` 的 git clone

**位置**: `import-agency-agents.ts` (line 119)
```typescript
execSync(`git clone ${AGENCY_AGENTS_REPO} ${targetDir}`, {
  stdio: 'inherit',
});
```

**问题**:
- 命令行参数直接拼接，无用户输入验证
- 如果 `targetDir` 包含特殊字符可能导致问题
- `stdio: 'inherit'` 在 CI/CD 环境中可能表现不符合预期

**建议**:
```typescript
execSync(`git clone ${AGENCY_AGENTS_REPO} ${targetDir}`, {
  stdio: 'pipe',  // 改为 pipe 以便更好的错误处理
});
```

---

### 低风险: 路径遍历

**位置**: `generate-metadata.ts` (line 293-295)
```typescript
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
```

**问题**: 虽然创建目录是安全的，但 `SHEETS_DIR` 和 `OUTPUT_FILE` 是硬编码路径

---

## 性能问题

### 中风险: `generate-agency-agents-json.ts` 同步读取

**位置**: `generate-agency-agents-json.ts` (line 154, 229)
```typescript
const content = fs.readFileSync(filePath, 'utf-8');
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
```

**问题**:
- 同步 I/O 会阻塞事件循环
- 对于大量文件会有性能问题
- 建议改为 `fs.promises` 或 stream

---

### 低风险: `generate-metadata.ts` 递归目录遍历

**位置**: `generate-metadata.ts` (line 273-276)
```typescript
const files = fs.readdirSync(SHEETS_DIR, {
  recursive: true,
  withFileTypes: true
});
```

**问题**:
- `recursive: true` 在深层目录可能产生大量文件描述符
- 对于大目录可能超时

---

## 架构问题

### 硬编码路径

所有脚本都使用 `__dirname` 或绝对路径：
- `generate-metadata.ts:11-14` - 硬编码 `temp/`, `assets/`, `public/` 路径
- `import-agency-agents.ts:20-21` - 硬编码 `temp/`, `stratix-data/` 路径

**建议**: 改用环境变量或配置文件：
```bash
LPC_ROOT=./temp npx ts-node scripts/generate-metadata.ts
```

---

## 横向联动

**被依赖**:
- CI/CD 流程 (package.json scripts)
- 开发者手动调用

**依赖**:
- `fs-extra`, `path`, `child_process` (Node.js 内置)
- `js-yaml` (for `generate-agency-agents-json.ts`)
- `esbuild` (for `bundle-electron.js`)

---

## 改进建议

### P1 - 应修复

1. **添加类型注解** (fix-electron-require.js)
   - 为 `walk(dir)` 和 `fixFile(filePath)` 添加 JSDoc 类型

2. **改进 git clone 错误处理** (import-agency-agents.ts)
   - 改 `stdio: 'inherit'` 为 `stdio: 'pipe'`
   - 添加超时处理

3. **环境变量配置化** (所有脚本)
   - 将硬编码路径改为可选的环境变量

### P2 - 可改进

4. **异步 I/O** (generate-agency-agents-json.ts)
   - 将 `fs.readFileSync` 改为 `fs.promises.readFile`

5. **进度显示** (generate-metadata.ts)
   - 大目录处理时添加进度条

6. **CI 友好退出码** (所有脚本)
   - 成功返回 0，失败返回非零
   - 目前 OK，但可显式化

---

## 总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | A | 覆盖构建、生成、修复全流程 |
| 代码质量 | B | 清晰简洁，小问题 |
| 安全性 | B | 基本安全，有改进空间 |
| 性能 | B | 小文件场景 OK，大文件需优化 |
| 可维护性 | B | 独立脚本易维护，但路径硬编码 |
| 测试覆盖 | N/A | 脚本一般无测试 |
