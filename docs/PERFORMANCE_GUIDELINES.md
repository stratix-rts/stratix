# Stratix Performance Guidelines

> 诞生于一次惨痛教训：测试脚本把 M1 Ultra 20 核 64GB 的 Mac Studio 吃到死机。
> 性能不是事后优化的选项，是开发时的硬约束。

---

## 核心原则

**性能预算制**：每个功能在设计和实现阶段就必须定义资源消耗上限，而不是事后测量。

---

## 一、开发工具链性能（测试、lint、构建）

### Jest
- `maxWorkers`: 本地开发固定 2，CI 用 `50%`
- 禁止 `--detectOpenHandles` 等重诊断选项出现在默认命令中
- 单个测试用例超时不超过 30s，超过的要标记 `@slow` 并在 CI 单独跑
- `testTimeout: 15000` 已设置，新测试不要随便改大

### ESLint
- `--concurrency 2` 限制并行数
- `--max-old-space-size=4096` 限制内存
- 禁止 `eslint src/**/*.ts` 全量扫描作为 pre-commit hook（只 lint 改动的文件）
- 考虑用 `eslint --cache` 缓存未变更文件的结果

### 构建与打包
- Vite 构建要监控 bundle size，单个 chunk 不超过 500KB（gzip 前）
- 禁止全量引入大型库（lodash → lodash-es，moment → dayjs，等）
- Tree-shaking 失效的库要用手动 import（`import { get } from 'lodash-es'`）

### Pre-commit / CI Hooks
- lint 和 test 都必须限制资源，不能"能用多少用多少"
-husky/lint-staged 只处理 staged 文件，不跑全量

---

## 二、运行时性能（功能代码）

### CPU
- 任何循环处理超过 1000 条数据的，必须使用分片/分批处理
- 计算密集型操作（加密、大数组处理、图像处理）必须放到 Web Worker 或子进程
- React/Vue 组件：禁止在 render 中创建新对象/数组/函数（用 useMemo/computed）
- 动画和实时渲染（Phaser/Canvas）：帧率低于 30fps 时必须有降级策略
- 防抖/节流：scroll、resize、input、mousemove 等高频事件必须加

### 内存
- 大数据列表必须虚拟滚动（VirtualList），禁止一次性渲染 100+ DOM 节点
- WebSocket/SSE 消息队列必须有背压机制，不能无限堆积
- 长生命周期的对象（store、cache）必须有淘汰策略（LRU、TTL）
- 定时器、事件监听器在组件销毁时必须清理（onUnmounted / useEffect cleanup）
- 图片/资源懒加载，不在首屏加载不可见内容

### 网络
- API 请求必须有超时设置（默认 10s，最长 30s）
- 分页：禁止一次加载全量数据，默认 page size 不超过 50
- 重复请求去重（debounce 或 AbortController）
- 静态资源 CDN + 缓存头
- 图片用 WebP/AVIF，不用原始 PNG/JPG

### 数据库
- 查询必须有索引覆盖，WHERE/JOIN 的字段必须有索引
- 单次查询结果集不超过 1000 行（用 LIMIT）
- N+1 查询是 bug，不是优化项
- 批量操作用 batch insert/update，禁止循环单条

---

## 三、设计阶段 Checklist

每个新功能/模块在设计评审时必须回答：

- [ ] **CPU 预算**：预期最大 CPU 占用？是否有计算密集操作？
- [ ] **内存预算**：预期最大内存占用？是否有大数组/缓存堆积风险？
- [ ] **数据规模**：支持的最大数据量？超限时的行为？
- [ ] **降级策略**：资源不足时的 fallback 方案？
- [ ] **清理机制**：资源（定时器、监听器、连接）的生命周期管理？

---

## 四、Code Review 性能检查项

PR 审查时必须检查：

1. 有没有无限增长的数据结构（没有上限的数组/Map/Set）
2. 有没有缺失的 cleanup（事件监听、定时器、订阅）
3. 有没有同步阻塞主线程的操作（大循环、同步 I/O）
4. 有没有缺失的分页/虚拟化
5. 有没有不必要的全量重渲染
6. 工具链配置有没有资源限制（worker 数、内存上限）

---

## 五、监控与告警

### 开发时
- 前端：Vue devtools 性能面板，注意组件渲染时间
- 后端：API 响应时间日志，超过 1s 的要打 warn
- 数据库：慢查询日志（>100ms）

### CI
- 测试套件执行时间超过 5 分钟要告警
- 构建 bundle size 超过阈值要失败
- 内存使用峰值超过限制要失败

---

## 六、反模式黑名单

以下模式在本项目中**禁止使用**，发现即视为 bug：

```typescript
// ❌ 无限增长的数组
const allMessages = [];
ws.onMessage(msg => allMessages.push(msg)); // 内存泄漏

// ❌ 循环中的异步单条操作
for (const item of items) {
  await db.insert(item); // N+1 性能杀手
}

// ❌ 缺失 cleanup 的定时器
setInterval(() => poll(), 1000); // 组件销毁后仍在跑

// ❌ 未限制并行的 Promise.all
await Promise.all(hugeArray.map(item => fetch(item))); // 全部并发，炸

// ❌ 全量渲染大列表
data.map(item => <Row key={item.id} {...item} />); // 10000 个 DOM 节点
```

对应的正确做法：

```typescript
// ✅ 有上限 + 淘汰策略
const messages = new LRUCache<string, Message>({ max: 500 });

// ✅ 批量操作
await db.batchInsert(items);

// ✅ cleanup
const id = setInterval(() => poll(), 1000);
onUnmounted(() => clearInterval(id));

// ✅ 限制并发
import pLimit from 'p-limit';
const limit = pLimit(4);
await Promise.all(items.map(item => limit(() => fetch(item))));

// ✅ 虚拟滚动
<VirtualList data={data} rowHeight={40} renderItem={Row} />
```

---

*最后更新：2026-04-05*
*维护者：每次 PR 都应检查是否符合本指南*
