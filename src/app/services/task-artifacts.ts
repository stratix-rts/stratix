/**
 * 文件职责：**任务成果物解析**（task_048）—— CLI 输出全文 → 结构化成果物的纯函数集：
 *   ① 解析 parseTaskArtifacts：从任务 output 提取「文件改动清单（含 +N/-M 行统计）」与
 *     「关键结论句（summary）」，供报告 / 面板做富展示；
 *   ② 序列化 serializeTaskArtifacts / 反序列化 parseTaskArtifactsJson：落库与回调携带的
 *     线上形状（JSON 字符串，'' = 无成果物）；
 *   ③ 渲染模型 formatTaskArtifactsBlock：报告气泡与任务输出面板**共用**的尾部摘要块文案
 *     （📎 摘要 + 📂 N 个文件 · +A/-B 行 + ≤10 条折叠清单）。
 * 输入：task-service 拼接的执行全文（transport message 事件流；claude 有结构化 result 块、
 *   kimi / opencode 以纯文本为主 —— 差异靠正则集合容忍，见下方「各家差异」）。
 * 输出：TaskArtifacts（files + summary）；解析不出就是空（files 空、summary 空），不编造。
 * 禁止事项：
 *   1. 引入新依赖 —— 纯正则 + 标准库，任何环境可跑；
 *   2. 触碰 DOM / IPC / 数据库 —— 纯函数模块，落库归 task-service/DAO，展示归 report/面板；
 *   3. 抛异常 —— 解析器在任务收尾主路径上，内部 try/catch 兜底返回空（宁可没有摘要，
 *     不能把已完成的任务拖进失败分支）；
 *   4. 编造 —— 启发式克制：识别不出就空；文件清单要求「整行是路径引用」这种强信号，
 *     不从散文句子里抠路径。
 *
 * ============ 各家 CLI 输出差异（正则集合与容忍策略）============
 * 三层提取，先到者权威（后续层只补不覆盖统计）：
 *   1. **git diff 块**（最权威，带精确统计）：`diff --git a/x b/x` / `+++ b/x` 文件头 +
 *     `@@` hunk 内的 +/- 行。claude 与 opencode 贴 diff 时都是标准 unified diff；
 *     路径含空格的场景 `\S+` 抓不全 —— 容忍（抓到多少算多少，不猜）；
 *   2. **CLI 摘要句**（英文 / 中文两套）：claude 收尾常吐
 *     「Updated src/a.ts with 12 additions and 3 removals.」；中文模型常吐
 *     「修改了 src/a.ts，新增 8 行、删除 2 行」。同一路径已有 diff 统计时以 diff 为准
 *     （摘要句可能是同一改动的另一种说法，累加会双计）；
 *   3. **路径行规约**（只记存在，无统计）：整行就是一个文件路径（可带 bullet / 动词前缀 /
 *     `:行号(:列号)` 后缀）。「整行是路径」是强信号 —— 散文中嵌路径（「我把 src/a.ts
 *     重构了」）不算，宁可漏不可错。
 * summary 从**尾部**向上找关键句（CLI 结论习惯放最后；kimi/opencode 尤甚），尾部没有
 *   再看头部几行；噪音过滤见 isSummaryCandidate（diff 元数据 / 路径行 / 代码行 / 摘要句
 *   自身都不算）。找不到就空 —— 摘要是锦上添花，不是必须。
 *
 * ============ 渲染口径（报告与面板共用，规格③④「复用同一渲染模型」）============
 * formatTaskArtifactsBlock：**files 为空 → 空串**（报告格式不变，纯文本兜底 —— 摘要不单独
 *   出场：没有文件清单的纯叙述输出，报告正文已经说了全部，再摘一遍是噪音）。files 非空：
 *   「📎 摘要：…」（有才出）+「📂 N 个文件 · +A/-B 行」+ ≤10 条路径清单（超出折叠成
 *   「…及 M 个文件」）。统计缺失（只有路径行）时文件行不带括号、标题不带 · +A/-B。
 *
 * @since v3.24（task_048）。
 */

// ============================================================================
// 形状与常量（导出供单测断言，别在测试里抄一遍数值）
// ============================================================================

/** 一个被改动的文件：path 必有；added/removed 只有解析到统计才有（路径行规约无统计）。 */
export interface TaskArtifactFile {
  readonly path: string;
  /** 新增行数（diff 块 / 摘要句解析得到）。 */
  readonly added?: number;
  /** 删除行数（同上）。 */
  readonly removed?: number;
}

/** 任务成果物：文件改动清单 + 关键结论句。两者都可空（解析不出的克制面）。 */
export interface TaskArtifacts {
  readonly files: readonly TaskArtifactFile[];
  /** 关键结论句（输出尾部 / 头部提炼）；识别不出为 ''（不编造）。 */
  readonly summary: string;
}

/** 空成果物（解析不出的统一落点；冻结防共享可变）。 */
export const EMPTY_TASK_ARTIFACTS: Readonly<TaskArtifacts> = Object.freeze({ files: [], summary: '' });

/**
 * 落库 / 回调携带的文件数上限：成果物 JSON 与 output 同量级有界（output 上限 200k），
 * 但防御性给个硬顶 —— 病态输出（贴了超大 diff 的构建日志）不至于把 JSON 撑爆。
 * 展示侧另有限制（TASK_REPORT_FILES_LIMIT=10），这里的上限只管存储体积。
 */
export const MAX_TASK_ARTIFACT_FILES = 200;

/** summary 候选行的长度窗口（码点）：太短是碎片、太长不是「一句」关键结论。 */
export const TASK_ARTIFACT_SUMMARY_MIN_LEN = 6;
export const TASK_ARTIFACT_SUMMARY_MAX_LEN = 120;

/** 报告 / 面板尾部摘要块的文件清单条数上限（超出折叠成「…及 M 个文件」）。 */
export const TASK_REPORT_FILES_LIMIT = 10;

// ============================================================================
// 正则集合（各家差异容忍；常量 + 注释，改规则先读注释）
// ============================================================================

/**
 * 【层 1：git diff 块】文件头。`diff --git a/x b/x`：取 b 侧（改动后的路径）。
 * `\S+` 抓不到含空格的路径 —— 容忍（见文件头「各家差异」）。
 */
const DIFF_HEADER_RE = /^diff --git a\/(\S+) b\/(\S+)$/;

/**
 * 【层 1】`+++ b/x` 头（没有 `diff --git` 行的裸 patch 用它认文件）。`\t时间戳` 尾巴剥掉。
 * `--- a/x` 不认（a 侧是旧路径，重命名场景会与 b 侧不一致，统一以 b 侧为准）。
 */
const DIFF_PLUS_FILE_RE = /^\+\+\+ (?:b\/)?(\S+?)(?:\t.*)?$/;

/** 【层 1】hunk 头（前缀匹配：`@@ -a,b +c,d @@ 可选上下文`）。见到它才开始数 +/- 行。 */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * 【层 2：CLI 摘要句 · 英文】claude 收尾格式：「Updated/Educated… src/a.ts with
 * 12 additions and 3 removals.」路径取无空格 token，additions/removals 可单复数。
 */
const EDIT_REPORT_RE_EN =
  /\b(?:updated|edited|modified|created|wrote|changed)\s+`?([A-Za-z0-9_@./-]+\.[A-Za-z][A-Za-z0-9]{0,4})`?\s+with\s+(\d+)\s+additions?\s+and\s+(\d+)\s+removals?/gi;

/**
 * 【层 2：CLI 摘要句 · 中文】中文模型收尾格式：「修改了 src/a.ts，新增 8 行、删除 2 行」。
 */
const EDIT_REPORT_RE_ZH =
  /(?:修改|编辑|更新|重写)了\s*`?([A-Za-z0-9_@./-]+\.[A-Za-z][A-Za-z0-9]{0,4})`?\s*[，,]?\s*新增\s*(\d+)\s*行(?:[、,，]\s*删除\s*(\d+)\s*行)?/g;

/**
 * 【层 2：diffstat 表】git diff --stat / CLI 摘要表：「 src/a.ts | 12 +++++---」。
 * 竖杠前的数字是总变动行，**不是**增删各自的数 —— 增删只从 +/- 字符数取（每字符一行，
 * 截断的「+++…」会少数 —— 容忍，diffstat 本来就是近似视图）。
 */
const DIFFSTAT_LINE_RE = /^\s+([A-Za-z0-9_@./-]+\.[A-Za-z][A-Za-z0-9]{0,4})\s+\|\s+\d+\s*(\+*)(-*)\s*$/;

/**
 * 【层 3：路径行规约】整行（剥掉行首 bullet / 序号 / 动词前缀、两侧引号反引号）恰好是一个
 * 文件路径，可带 `:行号(:列号)` 后缀。这是**强信号**口径 —— 散文中嵌路径不匹配（锚定 ^…$）。
 * 路径 token：`段/段/…/名字.扩展名`（扩展名 1-5 位字母开头；版本号串如 v3.24 不带字母开头
 * 扩展名，天然被排除）。绝对路径（行首 / ）不在此层（少见且歧义大，diff 头那层自会覆盖）。
 */
const PATH_TOKEN = '[A-Za-z0-9_@.-]+(?:/[A-Za-z0-9_@.-]+)*\\.[A-Za-z][A-Za-z0-9]{0,4}';
const PATH_LINE_RE = new RegExp(
  '^(?:[-*•●▪]|\\d+[.)]|(?:modified|edited|created|updated|deleted|renamed)\\s*:\\s*)?\\s*[`"\']?' +
    '(' + PATH_TOKEN + ')' +
    '(?::\\d+(?::\\d+)?)?[`"\']?\\s*$',
  'i'
);

/** 路径长度上限（防御病态 token；正常源码路径远短于此）。 */
const MAX_PATH_LEN = 300;

/** summary 候选的噪音过滤：diff 元数据 / diffstat 汇总行 / 代码围栏 / 代码行首 token。 */
const SUMMARY_NOISE_RE =
  /^(?:diff --git|index |@@ |new file|deleted file|rename |similarity |copy from|copy to|\\ No newline|Binary files|\d+ files? changed|```)/;
const SUMMARY_CODE_TOKEN_RE = /^(?:const|let|var|import|export|function|return|if|for|while|class|def|package)\b/;

// ============================================================================
// 内部工具
// ============================================================================

/** 路径规约：剥 `./` 前缀与空白；URL（含 ://）、/dev/null（diff 的删除文件残渣）与超长 token 直接弃（返回 null）。 */
function normalizePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PATH_LEN) return null;
  const stripped = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  if (stripped.includes('://')) return null; // https://… 不是仓库文件
  if (stripped === '/dev/null' || stripped === 'dev/null') return null; // diff 删除文件侧的 `+++/--- /dev/null`
  return stripped;
}

/**
 * 文件收集器：path → {added, removed, counted}。
 * counted = 该路径已有行数统计（diff / 摘要句 / diffstat 任一层给的）；后续层的「存在性」
 * 不覆盖统计，后续层的统计也不叠加（同一改动多种说法，叠加会双计 —— 见文件头「各家差异」）。
 */
interface FileStats {
  added: number;
  removed: number;
  counted: boolean;
}

class FileCollector {
  private readonly entries = new Map<string, FileStats>();

  /** 记一个路径存在（无统计或带初始统计）。 */
  touch(path: string, stats?: { added: number; removed: number }): void {
    const existing = this.entries.get(path);
    if (existing) {
      if (stats && !existing.counted) {
        existing.added = stats.added;
        existing.removed = stats.removed;
        existing.counted = true;
      }
      return;
    }
    this.entries.set(path, {
      added: stats?.added ?? 0,
      removed: stats?.removed ?? 0,
      counted: stats !== undefined,
    });
  }

  /** 叠加行数统计（同一文件的多个 hunk / 多个 diff 块：真·多次改动，累加是正确语义）。 */
  accumulate(path: string, added: number, removed: number): void {
    const existing = this.entries.get(path);
    if (existing) {
      existing.added += added;
      existing.removed += removed;
      existing.counted = true;
      return;
    }
    this.entries.set(path, { added, removed, counted: true });
  }

  /** 输出（保插入序 = 改动叙事顺序；超上限截断）。 */
  toFiles(): TaskArtifactFile[] {
    const files: TaskArtifactFile[] = [];
    for (const [path, stats] of this.entries) {
      if (files.length >= MAX_TASK_ARTIFACT_FILES) break;
      files.push(stats.counted ? { path, added: stats.added, removed: stats.removed } : { path });
    }
    return files;
  }
}

/** 层 1：git diff（unified diff）块解析 —— 文件头 + hunk 内 +/- 行计数。 */
function parseDiffBlocks(lines: readonly string[], collector: FileCollector): void {
  let current: string | null = null;
  let inHunk = false;

  for (const line of lines) {
    const header = DIFF_HEADER_RE.exec(line);
    if (header) {
      // b/ 前缀剥掉（改动后的路径不带它；绝对路径场景没有 b/ 前缀，保持原样）。
      const rawPath = header[2] ?? '';
      const path = normalizePath(rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath);
      if (path) {
        current = path;
        collector.touch(path);
      }
      inHunk = false;
      continue;
    }
    if (!current) {
      // 裸 patch（没有 diff --git 行）：+++ b/x 也能认文件。
      const plus = DIFF_PLUS_FILE_RE.exec(line);
      if (plus && !inHunk) {
        const path = normalizePath(plus[1]);
        if (path) {
          current = path;
          collector.touch(path);
        }
        continue;
      }
    }
    if (HUNK_HEADER_RE.test(line)) {
      inHunk = true;
      continue;
    }
    if (current && inHunk) {
      // +++/--- 是文件头不是内容；其余 +/- 开头是真实增删行。
      if (line.startsWith('+') && !line.startsWith('+++')) {
        collector.accumulate(current, 1, 0);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        collector.accumulate(current, 0, 1);
      }
    }
  }
}

/** 层 2：CLI 摘要句 / diffstat 表 —— 同路径已有统计（counted）时不覆盖（见收集器注释）。 */
function parseEditReports(output: string, collector: FileCollector): void {
  for (const re of [EDIT_REPORT_RE_EN, EDIT_REPORT_RE_ZH]) {
    re.lastIndex = 0; // 全局正则复用防状态泄漏
    for (let match = re.exec(output); match !== null; match = re.exec(output)) {
      const path = normalizePath(match[1]);
      if (!path) continue;
      const added = Number(match[2]);
      // 中文句式的「删除 N 行」段可缺省（只说新增），缺省按 0 —— 数值缺失不猜。
      const removedRaw = match[3];
      const removed = removedRaw === undefined ? 0 : Number(removedRaw);
      collector.touch(path, { added, removed });
    }
  }
  for (const line of output.split('\n')) {
    const stat = DIFFSTAT_LINE_RE.exec(line);
    if (!stat) continue;
    const path = normalizePath(stat[1]);
    if (!path) continue;
    const added = (stat[2] ?? '').length;
    const removed = (stat[3] ?? '').length;
    collector.touch(path, { added, removed });
  }
}

/** 层 3：路径行规约 —— 整行是路径引用才算（存在性补录，无统计）。 */
function parsePathLines(lines: readonly string[], collector: FileCollector): void {
  for (const line of lines) {
    const match = PATH_LINE_RE.exec(line.trim());
    if (!match) continue;
    const path = normalizePath(match[1]);
    if (path) collector.touch(path);
  }
}

/** summary 候选判定：长度窗口 + 噪音过滤（diff 元数据 / 路径行 / 代码行 / 摘要句自身）。 */
function isSummaryCandidate(line: string): boolean {
  if (line.length < TASK_ARTIFACT_SUMMARY_MIN_LEN || line.length > TASK_ARTIFACT_SUMMARY_MAX_LEN) {
    return false;
  }
  if (SUMMARY_NOISE_RE.test(line)) return false;
  if (PATH_LINE_RE.test(line)) return false; // 纯路径行不是结论
  if (SUMMARY_CODE_TOKEN_RE.test(line)) return false; // 代码行首 token 不是结论
  if (/^[+#>*|`-]|[:：]$/.test(line)) return false; // markdown / diff（含 - 行）/ 冒号结尾的标签行
  if (/[;{}]$/.test(line)) return false; // 代码语句结尾（diff 上下文行 trim 后的样子）
  // 摘要句自身（英文 / 中文）与 diffstat 竖杠行是改动明细，不是结论句。
  EDIT_REPORT_RE_EN.lastIndex = 0;
  EDIT_REPORT_RE_ZH.lastIndex = 0;
  if (EDIT_REPORT_RE_EN.test(line)) return false;
  if (EDIT_REPORT_RE_ZH.test(line)) return false;
  if (line.includes('|')) return false;
  return true;
}

/**
 * summary 提取：尾部向上找（CLI 结论习惯放最后），尾部没有再看头部 3 行（kimi 偶尔开头
 * 一句总起）。找不到就 ''（克制：识别不出不编造）。
 */
function extractSummary(lines: readonly string[]): string {
  const nonEmpty = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  const tail = nonEmpty.slice(-30);
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    if (isSummaryCandidate(tail[i] ?? '')) return tail[i] ?? '';
  }
  for (const line of nonEmpty.slice(0, 3)) {
    if (isSummaryCandidate(line)) return line;
  }
  return '';
}

// ============================================================================
// 解析入口（纯函数、永不抛）
// ============================================================================

/**
 * 解析任务输出全文 → 成果物。三层提取（diff 块 → 摘要句 → 路径行）+ 尾部优先的 summary。
 * 任何内部异常兜底返回 EMPTY（解析器在收尾主路径上，绝不拖垮任务执行）。
 */
export function parseTaskArtifacts(output: string): TaskArtifacts {
  if (typeof output !== 'string' || output.length === 0) return EMPTY_TASK_ARTIFACTS;
  try {
    const lines = output.split('\n');
    const collector = new FileCollector();
    parseDiffBlocks(lines, collector);
    parseEditReports(output, collector);
    parsePathLines(lines, collector);
    const summary = extractSummary(lines);
    const files = collector.toFiles();
    if (files.length === 0 && summary.length === 0) return EMPTY_TASK_ARTIFACTS;
    return { files, summary };
  } catch {
    return EMPTY_TASK_ARTIFACTS; // 防御：正则引擎理论不抛，真抛了也要给任务一个体面收尾
  }
}

// ============================================================================
// 序列化 / 反序列化（落库与回调的线上形状）
// ============================================================================

/** 有没有可携带的成果物（文件与摘要全空 = 无）。 */
function hasArtifacts(artifacts: TaskArtifacts): boolean {
  return artifacts.files.length > 0 || artifacts.summary.length > 0;
}

/**
 * 序列化：'' = 无成果物（库列缺省形状 / 老记录），否则紧凑 JSON。
 * 注意 summary-only（无文件但有结论句）也序列化 —— 报告不单独展示它（渲染口径），
 * 但库里留着，未来消费方（面板富化 / 审计）可用。
 */
export function serializeTaskArtifacts(artifacts: TaskArtifacts): string {
  if (!hasArtifacts(artifacts)) return '';
  return JSON.stringify({ files: artifacts.files, summary: artifacts.summary });
}

/** 行数据形状校验（JSON.parse 之后）：坏形状返回 null —— 降级纯文本，不抛不修。 */
function isArtifactFileLike(value: unknown): value is TaskArtifactFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as { path?: unknown; added?: unknown; removed?: unknown };
  if (typeof file.path !== 'string' || file.path.length === 0 || file.path.length > MAX_PATH_LEN) {
    return false;
  }
  for (const count of [file.added, file.removed]) {
    if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count) || count < 0)) {
      return false;
    }
  }
  return true;
}

/**
 * 反序列化（宽容）：'' / undefined / 坏 JSON / 坏形状 → null（调用方按「无成果物」处理，
 * 展示路径回落纯文本 —— 与「解析不出降级」同一口径）。多余字段忽略，未知文件条目丢弃。
 */
export function parseTaskArtifactsJson(text: string | null | undefined): TaskArtifacts | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as { files?: unknown; summary?: unknown };
    if (!Array.isArray(obj.files)) return null;
    const files = obj.files.filter(isArtifactFileLike).slice(0, MAX_TASK_ARTIFACT_FILES);
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    if (files.length === 0 && summary.length === 0) return null;
    return { files, summary };
  } catch {
    return null;
  }
}

// ============================================================================
// 渲染模型（报告气泡与任务输出面板共用，规格③④）
// ============================================================================

/**
 * 尾部摘要块文案（多行，'\n' 连接；**files 为空 → ''** —— 报告格式不变的兜底口径）：
 *
 *   📎 摘要：已完成全部修改，测试通过。
 *   📂 3 个文件 · +42/-8 行
 *   - src/core/types.ts（+30/-2）
 *   - src/app/foo.ts（+12/-6）
 *   - src/hud/bar.ts
 *   …及 2 个文件
 *
 * 统计来自 files 的累加（解析层的近似值）；任一文件无统计 → 该行不带括号；全部无统计 →
 * 标题不带「· +A/-B 行」。
 */
export function formatTaskArtifactsBlock(artifacts: TaskArtifacts | null | undefined): string {
  if (!artifacts || artifacts.files.length === 0) return '';
  const lines: string[] = [];

  const summary = artifacts.summary.trim();
  if (summary.length > 0) lines.push(`📎 摘要：${summary}`);

  let totalAdded = 0;
  let totalRemoved = 0;
  for (const file of artifacts.files) {
    totalAdded += file.added ?? 0;
    totalRemoved += file.removed ?? 0;
  }
  const statsLabel =
    totalAdded > 0 || totalRemoved > 0 ? ` · +${totalAdded}/-${totalRemoved} 行` : '';
  lines.push(`📂 ${artifacts.files.length} 个文件${statsLabel}`);

  for (const file of artifacts.files.slice(0, TASK_REPORT_FILES_LIMIT)) {
    const hasStats = file.added !== undefined || file.removed !== undefined;
    const label = hasStats ? `（+${file.added ?? 0}/-${file.removed ?? 0}）` : '';
    lines.push(`- ${file.path}${label}`);
  }
  const rest = artifacts.files.length - TASK_REPORT_FILES_LIMIT;
  if (rest > 0) lines.push(`…及 ${rest} 个文件`);

  return lines.join('\n');
}
