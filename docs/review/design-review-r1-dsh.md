# dsh 双重兼容性定向评审（task_163b）

> **评审对象**：[DESIGN-workspace.md](../DESIGN-workspace.md)（task_159，下称「159」）与 [DESIGN-project-map.md](../DESIGN-project-map.md)（task_160，下称「160」）
> **评审问题**：159/160 的设计在 dsh 的**双向上**站不站得住？
> **dsh 参照版本**：只读仓库 `/Users/kingj/code/deepseek-harness`，开工前置已执行 `git pull`（结果「已经是最新的」）。
> **所读 commit**：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
> （`Merge pull request #7873 from deepseek-harness/merge/release-dsh-0.2.2-rc.1-to-master`，2026-11-04 16:40 +0800；对应 `@deepseek-ai/dsh-root@0.2.2-rc.1`）
> **与调研报告的 HEAD 关系**：task_158《dsh 集成面测绘》所注 HEAD 同为 `fcc0ad4621` ⇒ 其 §4/§5 结论**无需复核差异**；task_157《插件架构深读》所注 HEAD `ce7073d5` 更早，本评审对涉及 plugin/preset/scope/tools 的结论**一律在 HEAD 上重读源码**，不沿用旧报告的转述。
> **调研报告引用抽查**：`docs/research/dsh-architecture.md` 与 `docs/research/dsh-integration-map.md` 中 **256 条去重 path:line** 全部在 HEAD 上**文件存在且行号在界内**，无硬伤；**但 159/160 对这两份报告的转述有 3 处偏差**（1 处路径不存在 + 2 处行号偏移），见 A7 与 §4。
> **本任务只产出本文档**：未修改任何 `src/` 代码，未修改 159/160 本体，未写入 dsh 仓库。

---

## 0. 结论速览

| 面 | 意见数 | 🔴 | 🟡 | 🟢 | **总评** |
|---|---|---|---|---|---|
| **A 面（兼容：Stratix 用 dsh）** | 7 | 1 | 4 | 2 | **方向对但要补** |
| **B 面（被兼容：Stratix 作为 dsh 插件被嵌入）** | 8 | 3 | 4 | 1 | **架构性返工** |

**一句话总评**：A 面（159/160 用 dsh）**不用返工**——159 §3.1 映射表里的绝大多数断言在 HEAD 上逐条复核成立（cwd 不可变、workspace 唯一性按 realpath、preset 写进 header、`agent-preset/locked`、版本方向性拒绝、marker 回落 cwd、patch 相对路径锚定、凭据链），**但有 1 个 🔴（`--patch` 覆盖层允许 `!!js` 表达式执行，设计自订的「形状受限」静态校验没覆盖它）和 4 个 🟡 必须先补**才敢冻结。B 面（Stratix 当 dsh 插件）**需要架构性返工**，但返工的范围很窄且很明确：**只返工两件事**——① **隔离模型**（159 D11 / 160 D3 的「一进程一活跃实例」必须从进程级降到 dsh 的 scope 级，否则插件化在并发多会话下必然串数据）；② **插件形态**（160 M3 现在只做到「被调用」，缺一整层「npm 包 + Loader 行 + 双面 + Remote 命名空间 + 工具面」的形态定义）。**159/160 建立的 `.stratix` 契约层、project/instance 两层身份、能力组合快照、context 注入协议这些资产，在双向路上都成立，不需要动。**

---

## 1. A 面：兼容（Stratix 用 dsh 生态）

### A1 🔴 —— `--patch` 覆盖层允许 `!!js` 表达式执行，设计的「形状受限 + 宿主裁决」静态校验没覆盖这条

- **指向**：159 §1.3「形态约束」段、§3.3 约束 3「形状受限 + 宿主裁决」
- **问题**：159 明确要求 `.stratix/dsh/*.patch.yml` 只允许声明式 `{insert:[...]}`，并援引 dsh 的 `validateGeneratedBundle` 作为准入规则。但那条规则管的是**生成型 bundle**，不是 `--patch` 覆盖层——两者的 YAML 方言**宽严不同**：
  - 生成型 bundle：`packages/experimental/creation-recommendations/src/generated-bundle.ts:26-28` 用 `parseDocument(..., { schema: 'core', customTags: [] })`，错误信息明写 *"Generated patches must use plain YAML without custom tags or includes."* → **拒绝**一切自定义 tag。
  - `--patch` 覆盖层：`packages/boot/app-boot/src/index.ts:266` `const userPatchesSchema = entryListSchema`，`:576` `yaml.load(content, { schema: userPatchesSchema })` → **允许** `!!js`。
  - `!!js` 的语义：`vendor/loader/src/config/utils.ts:5` `export const evaluate = new Function('ctx', 'expr', ...)`；`:11-14` 注释 *"Recursively replace YAML `!!js` expression nodes with evaluated values."* —— 即 **在 Cordis 宿主进程里执行任意 JS，且 `ctx` 在作用域内**。
- **为什么这是 🔴**：`.stratix/` 是**随 git 传播**的项目契约面（159 D1/§1.1）。只要 Stratix 在 spawn dsh 时把 `.stratix/dsh/bridge.patch.yml` 作为 `--patch` 传进去（159 §1.3 的设计前提），那么「clone 一个仓库 → 打开项目」就等于**执行该仓库里的任意 JS**。159 §1.1 的「agent 只读 / dsh 零写」边界完全不覆盖这条——因为写权限在**项目文件**里，不在 agent 手里。设计的威胁模型里根本没有「仓库不可信」这一项。
- **建议**：
  1. 159 §3.3 约束 3 增补一条硬约束：**`--patch` 路径必须显式拒绝 `!!js` 与一切自定义 tag**（不能只抄 `validateGeneratedBundle` 的形状规则，因为那是另一条加载路径）。
  2. 加载前用 Stratix 自己的严格解析（`yaml.load(text, { schema: 'core', customTags: [] })`）读一遍 patch，**只把 Stratix 认识的字段重新序列化**后交给 dsh，**不要把原文透传**。
  3. 契约文档显式写出威胁模型一行：*「`.stratix/` 随 git 传播 ⇒ 项目目录视为半可信输入；patch 不得承载代码」*。
  4. 顺带修正 §1.3 对 `validateGeneratedBundle` 的援引口径：它约束的是 **bundle 生成**，不能直接当作 `--patch` 的准入依据。

### A2 🟡 —— `bridge.patch.yml` 的示例载荷引用了契约树里不存在的目录，且硬编码了一个与本设计自述矛盾的端口

- **指向**：159 §1.2 目录树、§1.3 `dsh/bridge.patch.yml` 示例、§3.3；160 §4.1（world-sync 端口）
- **问题一（契约树不自洽）**：159 §1.2 的树里 `.stratix/dsh/` 只有 `profile.json` / `bridge.patch.yml` / `README.md`，**没有 `plugins/`**；但 §1.3 的示例 patch 写 `name: './plugins/dsh-bridge/dist/index.js'`。而 `packages/boot/app-boot/src/index.ts:547-557` `anchorInsertedPluginNames` 会把这种 `./` 开头的名字**锚定成绝对 `file://` URL**（`base = dirname(resolve(file))`，`pathToFileURL(resolve(base, entry.name))`），Loader 随后直接 `import()` 它（`vendor/loader/src/config/tree.ts:190-198`）——即**执行一个 git 跟踪的 `dist/*.js` 文件**。A1 的静态校验完全管不到这个 JS 文件做了什么。
- **问题二（端口自相矛盾）**：示例里写 `url: 'ws://127.0.0.1:7797/ws/world-sync'`，但 160 §4.1 明确结论是「world-sync 端口是 **7524**（不是 7525）」，依据 `src/stratix-gateway/index.ts:114`（`PORT || '3010'`）、dev `scripts/restart-backend.sh:9`（`PORT=7524`）、客户端缺省 `src/app/services/remote-store/remote-store.ts:152`（`DEFAULT_WORLD_SYNC_PORT = 7524`）。**同一套设计里两个文档给出两个端口**，且 7797 这个值在代码里根本不存在。
- **问题三（机器相关值不能进 git）**：patch 里的 `url`（端口）与将来要注入的 `customSkillDirs`（绝对路径，见 A3）都是**机器相关**的；写在 git 跟踪的契约文件里，换台机器必然错。
- **建议**：
  1. `bridge.patch.yml` 里**只放声明式行**（指向一个**已安装**的 npm bundle 行），**不指向仓库内的 JS 文件**；若确实需要一个本仓库的桥接模块，它必须走 dsh 的 bundle/插件分发机制（见 B3），而不是 `file://` 直插。
  2. 机器相关值（端口、绝对路径）由 Stratix 在 **spawn 时生成一份临时 patch**（写进 `$DSH_HOME` 或临时目录），**不落进 git 跟踪的契约**。
  3. 端口口径统一到 160 §4.1 的结论（7524 为 dev 默认），并删掉 7797。

### A3 🟡 —— `.stratix/skills` 经 `customSkillDirs` 挂载的 rank(300) 低于项目级 `.dsh/skills`(100) 与 `.agents/skills`(200)，同名技能会被自动发现的根抢走

- **指向**：159 §1.3「skills」段、§0 D6、§3.1 映射表（判「✅ 直接对齐 / 新增映射」）
- **证据**：
  - `packages/skill/skill-filesystem/src/index.ts:35-37` `PROJECT_DSH_RANK = 100` / `PROJECT_AGENTS_RANK = 200` / `CUSTOM_RANK = 300`；
  - `:256-257` 项目根 `.dsh/skills` / `.agents/skills` 落 rank 100/200；`:260` `customSkillDirs` 落 `CUSTOM_RANK`；
  - `packages/skill/skill/src/index.ts:78` *"Lower ranks win duplicate skill names before provider registration order is considered."*；`:808` `left.candidate.rank - right.candidate.rank` —— **数字小的赢**。
- **影响**：159 的 D6 结论「`.stratix/skills` 不会被 dsh 自动发现，所以走 `customSkillDirs`」**这一半是对的**（`.stratix` 确实不在 dsh 的自动扫描根里）。但**另一半没写**：一旦挂上，`.stratix/skills` 是**最低优先级**。项目里只要存在 `.agents/skills/<同名>/`（dsh 自动发现）或 `.dsh/skills/<同名>/`，模型拿到的就是那一份，而不是项目契约声明的那份。159 §3.1 把这一行判成「✅ 直接对齐」，无任何优先级说明。
- **建议**：
  1. 契约里给项目技能**独立命名空间**（例如 `.stratix/skills` 下用 `<project-skill-id>` 且与 dsh 约定名不重叠），并在 reconcile 期做**重名校验**（撞名即拒绝加载并报具体原因，与 159 §3.3 约束 3「坏 patch → 拒绝加载并报具体原因」同口径）。
  2. 159 §3.1 该行判语从「✅ 直接对齐」改为「⚠️ 需补优先级约束（rank 300 < 项目根 100/200）」。

### A4 🟡 —— 两套「项目根」会分叉：dsh 的 skill 项目根**硬编码 `.git` 不可配**，agent-instructions 的 marker **可配**；Stratix 的 `.stratix` 对 dsh 的 skill 侧完全不可见

- **指向**：159 §1.2（`AGENTS.md` / `CLAUDE.md` 放项目根）、§2.2 marker walk-up、§3.1 映射表「项目根 AGENTS.md / CLAUDE.md → dsh 自动加载的项目指令 ✅ 直接对齐」、§0 D8
- **证据**：dsh 内部有**两个不同的项目根查找器**：
  - 指令侧：`packages/context/agent-instructions/src/files.ts:232-246` `findProjectRoot(cwd, markers, …)`，marker 列表**可配** —— `packages/context/agent-instructions/src/config.ts:11` `DEFAULT_PROJECT_ROOT_MARKERS = ['.git']`，但 `:20` `projectRootMarkers?: string[]`、`:42` 默认值、`:78/:95/:124` 一路传播，消费点 `packages/context/agent-instructions/src/index.ts:127` 与 `state.ts:273`。
  - 技能侧：`packages/skill/skill-filesystem/src/index.ts:959-968` **自己的一份** `findProjectRoot`，第 962 行**硬编码** `pathExists(join(current, '.git'), fs)`，**没有任何配置口**；消费点 `:254`。
- **影响**：
  1. 159 §2.3 第 2 步明确「不静默 git init：非 git 目录也允许成为项目」。**非 git 的 Stratix 项目里，dsh 的 skill 项目根 = cwd**，而指令侧若不配 marker 则同样是 cwd ⇒ 两边一致；但只要项目里有**嵌套 git 仓库**（monorepo 里嵌一个子仓），skill 侧会命中子仓、指令侧（若配了 `.stratix`）命中项目根 ⇒ **同一个 dsh 进程里两个项目根**。
  2. 159 §1.2 把 `AGENTS.md`/`CLAUDE.md` 放在项目根并断言 dsh「自动加载」——这**只在「cwd 恰好是项目根」且「marker 能命中项目根」时成立**。agent 被派到项目**子目录**时（160 §3.2 允许 agent 在项目内 cd），根上的指令文件不加载。
  3. 159 D8 说「照 dsh `findProjectRoot` 的形状，但 marker 语义换成 Stratix 的」——这只改了 **Stratix 自己的**发现；**没有让 dsh 知道 `.stratix`**，两边各自为政。
- **建议**：
  1. Stratix 侧在生成 patch 时，给 agent-instructions 行显式设 `projectRootMarkers: ['.stratix', '.git']`（`config.ts:42` 的默认可被行 config 覆盖），**这是能对齐的一侧**。
  2. 技能侧不可配 ⇒ **不要依赖 dsh 的项目级技能根**，全部走 `customSkillDirs`（与 D6 一致），并在契约里写明这条限制。
  3. 契约层写死「**agent 的 spawn cwd 必须是项目根，不得是子目录**」，并把它作为 `.stratix` 契约的一个**不变量**（与 160 §3.2 的 cwd 策略一致），否则 dsh 的两个项目根会分叉。

### A5 🟡 —— 凭据链只对 API-key 路由成立；headless profile 忽略 GUI 保存的登录态；空串环境变量会屏蔽 `.env` 回退

- **指向**：159 §1.2（`.env` 放项目根）、§3.3 约束 1、§3.5
- **证据**：`packages/bundle/headless/README.md:56` 原文：*"The shipped headless profile disables the managed credential store and its authorization and DeepSeek account consumers. **API-key routes** use the launch environment, then `<invocation cwd>/.env`, then `$DSH_HOME/.env`. **Keys and sign-ins saved by the GUI are ignored** without changing their file. Providers that require a saved sign-in **fail unless stored authentication is restored**…"*（恢复方式见同 README 后文：在 `$DSH_HOME/profiles/headless/cordis.patch.yml` 里放 `credentials` / `authorization` / `deepseek-account` 三行）。
- **影响**：
  1. 159 §3.3 约束 1 把凭据链写成无条件的「启动环境 → `<cwd>/.env` → `$DSH_HOME/.env`」。**只对 API-key provider 成立**；走 OAuth/账号态的 provider 在 headless 下直接失败，而 159 的契约里没有任何「恢复 stored authentication」的说明。
  2. 原文写的是 **`<invocation cwd>`**（**调用进程**的 cwd），不是 session 的 `header.cwd`。两者只有在 Stratix 用 `SpawnOptions.cwd` 设了 spawn cwd 时才相等——这恰好是 159 D12/S6 提供的接线点，**但这条依赖关系必须写进契约**，否则将来任何绕过 transport 的调用方式都会让凭据落到错误的 `.env`。
  3. 同一 README 紧接的一句：*"Unset an empty launch variable to allow its `.env` fallback; **an exported empty value shadows that fallback**."* 159 §3.5 说「`adapters/dsh.ts` 的 `prepare` 只合并 env」——**合并逻辑若把某个 key 写成空串，就会屏蔽掉 `.env` 回退**，这是一个不报错的静默失败。
- **建议**：
  1. 159 §3.3 约束 1 补一句限定：*「本链只覆盖 API-key provider；需要登录态的 provider 必须由用户在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 恢复 `credentials` / `authorization` / `deepseek-account` 行，**项目契约不承载账号态**」*。
  2. 契约里把「凭据链的 cwd 是 **invocation cwd**」写明，并声明它与 `SpawnOptions.cwd` 的一致性是**不变量**。
  3. adapter 合并 env 时**禁止写入空串值**（未设置就完全不写该键），作为一条实现期铁律写进 159 §3.3。

### A6 🟢 —— D5 借的版本机制：方向性读与 `ignorable` 语义在 HEAD 上**成立**，但有两处与 dsh 实际实现不同（链无下限 / 目录是编译期静态的）

- **指向**：159 §1.4 全节（八条教训 L1–L8）、§0 D5
- **复核结论（成立的部分）**：
  - 方向性拒绝 ✓：`packages/session/session-format/src/catalog.ts:52-59` 读到 `storedVersion > chain.currentVersion` → `status: 'unsupported'`，reason *"stored Session uses newer format v…; this build writes v…"*（`:57`）；`packages/session/session-format/src/chain.ts:83` 同款。
  - 「内存里跑链、源文件不动」在库层 ✓：`packages/session/session-format/README.md` *"A restore transfers caller-owned parsed values through stateful stages without intermediate artifact copies or freezing… **only the caller decides whether and how to publish that result**."* —— 159 §1.4.3「只有读-改-写场景才发布新世代」的区分**与 dsh 实际一致**。
  - `ignorable` 语义 ✓：`packages/core/session/src/types.ts:82-83` *"The per-event `SessionEvent.ignorable` marker governs unknown event types, not arbitrary nested payload changes."*；`packages/core/session/src/known-event-types.ts:12-20` 同款口径。
  - 单调整数 + writer/发布记录分离 ✓：`packages/core/session/src/types.ts:90` `export const SESSION_FORMAT_VERSION = 4`；`docs/session-format-status.md` 的 finalization/release 记录分离（`latestFinalizedVersion: 4` / `latestReleasedVersion: 4` / `evidenceTag: dsh-v0.2.0-rc.2`）与 159 §1.4.5 的三行结构同构。
  - **「版本号住在哪一层」也一致**：dsh 的 `validateSessionHeader` 在 **Session 抽象层做严格等值校验**（`packages/core/session/src/index.ts:103-105`：`if (record.version !== SESSION_FORMAT_VERSION) throw ...`），旧版本 header 的翻译发生在**物理层 codec**（`packages/session/session-format/src/catalog.ts` 的 readHeader / migration chain），**不在 core 类型里塞多版本字段**。159 §1.4 把「契约版本」放在**文件/契约层**而非 core 类型层，与 dsh 分层同构 —— 这条设计判断是对的，可直接引用为依据。
- **两处不同（🟢 级，因为不影响正确性，只影响「别照抄过头」）**：
  1. **dsh 的链没有下限**：`packages/session/session-format/src/catalog.ts:37-39` `for (let version = 0; version <= chain.currentVersion; version += 1) { if (!codecs.has(version)) throw new SessionFormatError(...) }` ⇒ **v0..vN 每个整数版本都必须有 codec**（`docs/persistence-changes/historical-formats/README.md` 也写明「document every integer from zero through the checkout writer」）。159 §1.4.4 的 `format-catalog.json` 允许 `minVersion` 且只要求 `steps.length == current - minVersion`，**比 dsh 宽松**。
  2. **dsh 的迁移目录是编译期静态的**：`packages/session/session-format/src/catalog.ts:25` *"Compile a **build-static** physical codec and adjacent migration catalog."*，且 `docs/session-format-status.md` 记录 *"[The catalog generator](../scripts/gen-session-format-catalog.ts) derives codec ordering and checks that adjacent migrations reach it."* ⇒ 迁移步骤是**代码 + 构建期校验**的。159 把迁移链放进**运行时 JSON 文件**，等于把「代码里审过的迁移」降级成「数据里声明的迁移」，与 dsh 的选择相反。
- **建议**：
  1. 159 §1.4.4 补一句：*「`minVersion` 只是本地优化；**正确性判据与 dsh 一致 —— 从 0 到 current 每个版本都必须有对应形态**」*。
  2. 迁移步骤以**代码**为准（每个版本一个函数 + 单测），`.stratix/format-catalog.json` 降级为**记录/审计用**的伴随文件，与 dsh 的 build-static 目录对称。

### A7 🟢 —— 引用精度：3 处 path:line 偏差（不影响结论，影响可复核性）

- **指向**：159 §1.3 skills 段、§2.2 第 3 点、160 §3.5 / §3.6 #2
- **逐条**：
  1. 159 §1.3 写 *"两级注入…（架构报告 §5.3：`packages/skill/skill-filesystem/src/tool-skill/src/index.ts:36`）"* —— **该路径在 HEAD 不存在**（`packages/skill/skill-filesystem/src/tool-skill/` 无此目录）。真实路径是 `packages/skill/tool-skill/src/index.ts`（451 行，研究报告引的就是这个）；两级注入的「目录 → 全文」行为由 `packages/skill/skill-filesystem/src/index.ts:251-269`（根收集）与 `packages/skill/skill/src/index.ts`（目录形态）共同承担。
  2. 159 §2.2 第 3 点写 *"照 dsh 原文（`files.ts:246`：*"or `cwd` when no marker exists"*）"* —— 该原文在 **`files.ts:229`**（JSDoc `@returns` 行）；`:246` 是函数收尾，**回落行为的代码**在 `:344` `if (parent === current) return resolve(cwd)`。
  3. 160 §3.5 / §3.6 #2 写 *"preset 写进 session header（`packages/core/session/src/types.ts:133-135`）"* 并引 *"a resume that restored a different composition…"* 原文 —— 原文实际在 **`types.ts:131-133`**（该 JSDoc 块），字段声明 `readonly agentPreset?: string` 在 **`:135`**。引用区间整体偏移 1–2 行。
- **建议**：159/160 冻结前把这 3 处行号改到 HEAD 实际值（159/160 本体本次未改，留给作者处理）。

---

## 2. B 面：被兼容（Stratix 作为 dsh 插件被嵌入）

> 本面先厘清一件事实：**160 的 M3 是「被调用」不是「被嵌入」**。160 §5.3 的 M3 全部内容 = cwd 落到 headless + preset 快照 + skill 挂载 + patch 锚定 + 斜杠转义 + 沙箱边界 —— 全部是「Stratix 调 dsh」。真正的「被嵌入」意味着 **dsh 宿主加载 Stratix 的代码**，Stratix 的能力通过 dsh 的插件面暴露出去。下面 B3 先把 dsh 的插件形态钉死，B1/B2/B5 再指出设计里埋的雷。

### B1 🔴 —— D11「一进程只激活一个项目实例」与 dsh 宿主的并发多会话模型正面冲突（插件化在当前隔离模型下不成立）

- **指向**：159 §0 **D11**、§4.1.1、§5.3 Q8；160 §0 **D3**、§1.1 不变量 3、§6.2 Q1
- **证据**：
  - dsh 侧：一个宿主进程里**并发跑多个 session**。`packages/core/agent/src/index.ts:250` `private store = new Map<SessionId, AgentEntry>()` —— 每个 session 一个 Agent，全部存活在同一个进程；`packages/boot/plugin-manager/README.md` *"Changes affect every session using the profile."*
  - Stratix 侧：159 D11 / 160 D3 明确「运行期同一时刻只有一个 instance 处于 active」，`worldStore`（`src/core/store.ts:311`）/ `coreRuntime`（`src/core/runtime.ts:803`）/ 总线（`src/core/bus.ts:32`）三处**进程级单例且无项目维度**。
- **冲突的本质**：**两边的隔离单位不一样**。
  - dsh 的隔离单位 = **session**（每个 session 一个 scoped context，见 B5）；
  - Stratix 的隔离单位 = **进程**（整个进程一份 worldStore，跑哪张地图是全局变量 `activeInstanceId`）。
  - ⇒ 同一个 dsh 宿主进程里的 N 个并发 session，会**共享同一份 Stratix 世界态与同一个 activeInstanceId**。这恰好是 160 §3.4 R3（「chat / 互聊会话不得跨副本续发」）和 D5（「副本间单位互不可见」）要禁止的事情 —— 在独立进程模式下由「一进程一实例」兜住，在插件模式下这个兜底**直接消失**。
- **建议**：
  1. **在 159 D11 / 160 D3 的适用域上写死一句**：*「D11 只在 Stratix 独立进程模式下成立」*，并把「宿主并发多会话」列进 §5.3 / §6.2 的开放问题（现在 Q8/Q1 只问了「是否接受 D11」，没问「D11 的适用域是什么」）。
  2. 插件化路线的正解是**把隔离单位降到 dsh 的 scope**（见 B5 的 `createScope` 机制）—— 即 `activeInstanceId` 从进程级降到 scope 级。这**不是**「同时看两个战场」，而是「同一进程里每个 session 各有一份世界态」，与 160 §6.2 Q1 的「不做同时看两个战场」**不冲突**，应当单独立项做。
  3. 若坚持 D11 不动，则 B 面总评只能是「不可插件化，只能被调用」——这个取舍必须显式写进设计，而不是留白。

### B2 🔴 —— world-sync 的固定端口在嵌入形态下必然冲突，而 dsh 宿主自己就有「端口 0 = OS 分配」的成熟做法

- **指向**：160 §4.1（world-sync 协议）、§5.2（M2 升协议版本）、§2.5 破除点 #6/#18（全局键分区）
- **证据**：
  - Stratix 侧：`src/stratix-gateway/index.ts:114` `PORT || '3010'`（dev `scripts/restart-backend.sh:9` = 7524），客户端缺省 `src/app/services/remote-store/remote-store.ts:152` `DEFAULT_WORLD_SYNC_PORT = 7524` —— **固定端口**。
  - dsh 侧：`packages/host/webserver/src/index.ts:108-109` *"Listen port; **zero requests an OS-assigned port**."* —— 宿主 webserver 支持端口 0。
- **影响**：插件形态下，一个 dsh 宿主进程可能同时存在：dsh 自己的 webserver、**多个 Stratix 实例**（每个实例一份 gateway）、以及用户手动起的 Stratix dev 实例。固定 7524 必撞；撞了之后 dsh 的 webserver 已经在用「端口 0」，Stratix 没有等价能力。
- **建议**：
  1. world-sync 端点支持 `port: 0`，并把**实际端口**作为「能力面」的一部分公布（见 B4）—— 这也正好和 dsh 的 `port: !!js ctx.webStartup.port ?? 3080`（`packages/boot/cmdline/src/index.ts:16`）同构：**配置项解析出来的实际值**才是权威。
  2. 160 §4.1 的适配点表补一行：world-sync 的**端口解析**是嵌入形态的独立适配点（不属于协议版本升级，但属于「同一宿主多实例」问题）。
  3. 顺带把 160 §2.5 #6/#18 的 `stratix:unit-position-seed` 全局键问题按同一条线归口：**所有「宿主进程级全局键」在嵌入形态下都要按 session/scope 分区**。

### B3 🔴 —— 真正的「dsh 插件」有明确的四层形态，设计的 B 面**一层都没有**（M3 只到「被调用」）

- **指向**：160 §0 **D14**（M3 = dsh 桥接）、§5.3（M3 改动面）、§6.1（不做 dsh profile / bundle 映射）；159 §3.2（profile / bundle / patch 三者裁决）
- **证据（dsh 的插件形态，逐层）**：
  1. **宿主侧插件 = 一个 Cordis Service**。`packages/api/workspace-controller/src/index.ts:55-56`：`export class WorkspaceController extends TypertRemoteService { static inject = ['remoteAccess','typert','workspaceRegistry'] … }` + `declare module '@deepseek-ai/cordis' { interface Context { workspaceController: WorkspaceController } }` —— 通过 `ctx.<serviceName>` 暴露，加 `static Config`（schemastery）拿配置。
  2. **模型可见工具 = `ctx.tools.register(defineTool({…}))`**。`packages/experimental/tool-session-query/src/index.ts:16-19,57-115` 是范本：模块级 `export const name` / `export const inject` / `export const Config`，`apply(ctx, config)` 里 `ctx.systemPrompt.section({…})` 写提示词 + `ctx.tools.register(defineTool({ name, description, parameters, output, timeoutMs, execute, presentCall, isConcurrencySafe }))`。`packages/core/tools/src/index.ts:98-108` 的 `ToolsService` 用 `ScopedLayers` —— **工具注册表本身是 scope 感知的**。
  3. **控制面 = API Gateway 的 Remote 命名空间**。`docs/api-gateway.md`：`@Remote` / `@RemoteScope` 装饰的方法生成 `ctx.remote.<namespace>`；`@Remote({mode:'stream'})` 生成 `RemoteStreamHandle`（服务端 → 客户端 + 客户端 → 服务端双向流）；**权限走 `remoteAccess` 资源模型**（`packages/api/workspace-controller/README.md`：注册 `workspace` 资源 kind、`workspace/follow` 不读资源 ⇒ 落到 `global` 资源；非 owner 的 Peer 只能 follow 被准入的 id 集合）。
  4. **浏览器侧插件 = 双面包**。`packages/client/ui-goal/package.json`：`exports: { ".": …, "./client": … }` + `dsh.client: { inject: [...], platform: "web" }`；`packages/client/ui-goal/src/index.ts:1-10` 的 node 半边是 `export function apply(): void {}`（空实现，只为进 Loader），浏览器半边经 `exports["./client"]` 发现；`packages/client/modules/src/index.ts:1-30` 描述 node 半边如何扫描 Loader 行里声明了 `dsh.client` 的包并组装 `window.__DSH_BOOT__` 入口图。
  5. **分发单元 = npm 包**。`packages/boot/plugin-manager/README.md`：bundle 靠 `package.json` 的 `dsh.profile.bundles` 有序列表 + `dsh.bundle.patch`；**兼容声明用 `engines.dsh`**（"their `engines.dsh` or DSH peers reject the running DSH"）；安装走 pnpm，**"installed Host code executes in-process outside the workspace sandbox"**；"Without HMR, the running composition remains until restart"。
- **缺口**：160 §5.3 的 M3 **没有一条**描述「Stratix 作为 dsh 侧代码被加载」；159 §3.2 明确把「项目要分发一个 dsh 插件」推给「另一件事」（集成报告 C10 / S5），但**那件另一件事至今没有任何设计**。⇒ B 面目前是**空白**，不是「差一点」。
- **建议**（B 面需要一个独立小节，最少定义 5 件事）：
  1. **包形态**：Stratix 作为 dsh plugin/bundle 时，包名、`dsh.bundle.patch` 的行形态、`exports["./client"]` 半边（若要 UI）、**`engines.dsh` 兼容声明**（不是 `engines.stratix`——后者是**项目契约**字段，两者是不同维度，别混）。
  2. **入口与生命周期**：遵循 dsh 插件约定 `export const name` / `export const inject` / `export const Config` / `export function apply(ctx, config)`；卸载随 Loader fiber 逆序回收（159 §1.1 引的「一切注册都是 effect」在 dsh 侧是 `ctx.effect` / disposer，见 `packages/experimental/forge/src/index.ts` 的 `register` 返回 async disposer）。
  3. **能力面**（见 B4）。
  4. **权限与沙箱**：被嵌入后 Stratix 的代码在 dsh 宿主进程内、**在 workspace sandbox 之外**执行（plugin-manager README 明写）；Stratix 自己的 `PermissionPolicy 默认 deny` 基线与 dsh 的 `danger-full-access` / approval 模型要划清边界。
  5. **不能做的**：`.stratix/` **仍然不能**进 dsh 的部署面（159 D1/D7 的裁决在 B 面**依然成立**——项目级契约 vs 部署级插件是正交的）。

### B4 🟡 —— 能力面没有定义：Stratix 现有的 `stratix_world_snapshot` 是 **MCP 工具**，不是 dsh 的原生工具 / Remote

- **指向**：160 §0 D14（M3 能力对齐）、§5.3（preset 对齐）、附录 B（`src/stratix-gateway/mcp/tools/world.ts:31,248-308`）
- **问题**：160 附录 B 自己承认 Stratix 侧的世界快照是 **MCP 工具**（`src/stratix-gateway/mcp/tools/world.ts`）。但 dsh 的**原生**模型可见面是 `ctx.tools.register(defineTool(...))`（B3-2），**控制面**是 `@Remote` 命名空间（B3-3）。MCP 在 dsh 侧是**可选的外来协议**（`packages/mcp/mcp-client/README.md`：*"Configure one server per entry… No server is enabled by default"*，工具名形如 `mcp__github__create_issue`）。
- **也就是说**：当 Stratix 是**独立进程**（A 面）时，走 MCP 没问题（dsh 通过 `mcp-client` 行接一个 stdio server，工具名会带 `mcp__` 前缀，`.stratix/dsh/profile.json` 的 `mcpServers` 字段正是为 S5 准备的）；但当 Stratix 是**被嵌入**（B 面）时，MCP 是**绕远路**（自己起一个子进程、通过 stdio 讲协议、再被 dsh 接回来），而且 **`.stratix/dsh/profile.json` 里的 `mcpServers` 形状不是 dsh 的形状** —— dsh 侧是「**一个 server 一个 entry**」（`packages/mcp/mcp-client/src/index.ts:5` *"load multiple instances in `cordis.yml` for multiple servers"*），配置是 `StdioConfig | StreamableHttpConfig`（`:161-190`），**不是** `{name, transport, command}` 数组。
- **建议**：把 Stratix 对 dsh 暴露的能力面显式分三层，并声明每层在两种形态下用哪种协议：

  | 层 | 内容 | 独立进程（A 面） | 被嵌入（B 面） |
  |---|---|---|---|
  | **① 模型可见工具** | 世界快照 / 角色档案 / 任务回报 | MCP stdio server（`mcp__stratix__*`） | **原生** `ctx.tools.register(defineTool(...))`（名字不带前缀，直接 `stratix_world_snapshot`） |
  | **② 宿主可见控制面** | 进入/离开副本、派单、订阅状态 | HTTP/WS + 本地 API | **原生** `@Remote` 命名空间（`ctx.remote.stratix.*`），带 `remoteAccess` 资源准入 |
  | **③ 事件订阅** | `project.changed` 类状态变更 | world-sync WS | **原生** `@Remote({mode:'stream'})` 的 follow 流（baseline + increments，reconnect 换 baseline） |

  同时把 `.stratix/dsh/profile.json` 的 `mcpServers` 字段定义为 **Stratix 私有形状**，并写明它到 dsh 行的**翻译规则**（一个 server 一个 `- insert:` 行，`config` 用 dsh 的 `StdioConfig`/`StreamableHttpConfig`）。

### B5 🟡 —— core 单例 vs 嵌入：dsh 已经给出了「进程内按会话隔离」的标准解法（scope），而设计的对策是「不做」

- **指向**：159 §0 **D11**、§4.1.1、§5.1；160 §0 **D3**、§2.3、§6.1（「不做同时看两个项目的战场」）、§6.2 Q1
- **证据（dsh 的 scope 机制）**：
  - `packages/core/scope/README.md:8-9` *"lets plugin authors give each **agent or group** an isolated contribution set with a shared lifetime. Child scopes inherit ancestor contributions… Disposing a scope removes everything owned by it."*
  - `packages/core/scope/src/index.ts:131-146` `createScope(ctx, key, options)` — *"The scoped context inherits the minting plugin's dependency API and **owns every registration made through it**."*
  - `packages/core/agent-loop/src/agent.ts:147` `this.scope = createScope(loopCtx, this)` —— **每个 agent 一个 scope**。
  - `packages/core/tools/src/index.ts:106-108` `ToolsService` 用 `ScopedLayers` ⇒ **工具注册表是 scope 感知的**。
  - `packages/api/gateway/src/`（`@RemoteScope`）—— dsh 的 Remote 也有「按 session 解析 scoped context」的一等概念（见 `docs/api-gateway.md` 的 `@RemoteScope(key, option?)`）。
- **对照**：Stratix 的对策是「**不做**多实例」（159 D11 / 160 D3 / §6.1），理由是 core 三处进程级单例无项目维度、多实例化撞三条铁律。这在独立进程模式下**成立**；但在插件模式下，dsh 已经把「同进程多份隔离状态」的标准解法准备好了（scope），Stratix 的「不做」就变成了「不跟宿主的能力对齐」。
- **建议**：
  1. 把「core 多实例化」这个任务从「另一个任务」升级为**插件化的前置条件**，并按 dsh 的 scope 语义重述目标：不是「一个进程多份 worldStore」，而是「**每个 session scope 一份 worldStore**」——这与 160 §6.1「不做同时看两个项目的战场」**不冲突**（那是**一个 session 内**的 UI 需求；scope 隔离是**跨 session**的）。
  2. 插件形态下，Stratix 暴露给宿主的应是「**以 session/scope 为 scope 的 façade**」（`ctx.remote.stratix.*` 里每个方法自己解析调用方的 scope），**不要**把 core store 直接挂进 dsh 的 root context。
  3. 159 §4.1.1 的「进程级单例」清单在 B 面语境下要加一列「**在 dsh 宿主里对应什么**」：`worldStore` → scope-owned store；`coreRuntime` → scope-scoped runtime（dsh 的 `createScope` 正好提供「scoped context owns every registration」）；总线 → dsh 的 scoped 事件（`packages/core/scope/src/index.ts:160-168` *"events flow up the chain, never down"*）。

### B6 🟡 —— 双向定义冲突：Stratix 的 instance 是**执行隔离单元**，dsh 的 Workspace 是**导航分组单元**；两者语义不等价

- **指向**：159 §2.4（注册表规则表）、§3.1 映射表「项目身份 + 实例注册 → ctx.workspaceRegistry ✅ 直接对齐」；160 §2.4（「大厅 = workspace 总览」）、§3.5
- **证据**：
  - dsh 的 Workspace 是什么：`packages/workspace/workspace/README.md:8-9` *"keep an ordered, persistent list of **project directories and the sessions run in each directory**… it is **invisible to models** and adds no prompt or request-context cost"* ⇒ **一个目录 ↔ N 个 session**；它是**分组/导航**单元，**不是**执行隔离单元。
  - 挂载校验：`packages/workspace/workspace/src/entity.ts:110-141` —— 会话挂到 workspace 时，`realpath(header.cwd)` **必须等于** `workspace.path`，否则抛 `cannot attach session '…' to workspace '…'`；`header.cwd === undefined` 也直接抛（`:118-121`）。
  - 默认 workspace 目录：`<Documents>/deepseek-harness`（`packages/api/workspace-controller/README.md` 的 First-use Workspace 段），与 Stratix 的「项目 = 文件夹」不是一回事。
- **冲突点**：
  1. **159 §3.1 把 instance 直接映射到 `ctx.workspaceRegistry` 并判「✅ 直接对齐（唯一性按 realpath 判等）」** —— 唯一性判据确实一致（`packages/workspace/workspace/src/index.ts:503-513` `resolveByPath` / `createCanonical` 都用 realpath 归一），但**语义维度不同**：dsh 的 workspace **允许一个目录挂 N 个并发 session**，Stratix 的 instance **同时只允许一个活跃**。把两者当同一个东西，会在插件形态下把 N 个并发 session 挂到同一个（唯一活跃的）Stratix instance 上 —— 与 B1 同源。
  2. **挂载校验的方向性**：Stratix 允许 agent 在项目内 cd（160 §3.2），这与 dsh 兼容 —— dsh 的 `working-directory` 改**有效** cwd 但不改 `header.cwd`（`packages/session/working-directory/src/index.ts:86-87` `init: header => header.cwd ?? null`），所以挂载关系不破。但**反过来**：若 Stratix 把 session 派到项目的**子目录**（cwd = 子目录），dsh 的 workspace 挂载会直接失败。⇒ 「agent 的 cwd 必须是项目根」这条不变量（见 A4）在 B 面同样是硬约束。
  3. **两套注册表**：159 §2.4 的 `workspaces.json` 在 Electron `userData` 下；dsh 的 workspace 注册表在 `$DSH_HOME/storages`（159 §2.3 自己引了 `packages/workspace/workspace/src/spec.ts`）。两者同名不同物，160 §2.4「大厅 = workspace 总览」的措辞容易被读成「= dsh 的 workspace」。
- **建议**：
  1. 159 §3.1 该行的判断语从「✅ 直接对齐」改为「⚠️ **形状对齐、语义不等价**：唯一性判据同（realpath），但 dsh 的 Workspace 是**导航分组**（一目录 N 会话），Stratix 的 instance 是**执行隔离**（同时一个活跃）」。
  2. 160 §2.4 明确写：*「大厅 = **Stratix 自己的** `workspaces.json` 注册表的可视化；它与 dsh 的 `ctx.workspaceRegistry` 是**两套独立注册表**，不合并、不互相同步」*。
  3. 在 B 面方案里明确「若 Stratix 被嵌入，**不向 dsh 注册 workspace**」——Stratix 的副本概念与 dsh 的分组概念不重叠；否则会引入 B1 的并发问题。

### B7 🟡 —— `--patch` 与 profile 都是**进程级**的：项目级桥接件在「同进程多实例」下无处安放

- **指向**：159 §0 D1/D7、§1.3、§5.3；160 §5.3（patch 锚定）
- **证据**：
  - `--patch` 覆盖层是**进程级**的启动参数：`apps/cli/src/args.ts:170` `.option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)`；`packages/boot/app-boot/src/index.ts:266` 覆盖层 schema 与 loader 同源。
  - profile 也是进程级：`packages/boot/plugin-manager/README.md` *"Changes affect every session using the profile."* / *"Without HMR, the running composition remains until restart."*
  - 而 159 §1.3 的 `bridge.patch.yml` 是**项目级**的（随 git 走，每个项目一份）。
- **冲突**：同一进程内跑两个 Stratix 实例（两个项目）时，**一个进程的 `--patch` 集合只有一份**。项目 A 的 patch 与项目 B 的 patch 无法共存于同一 dsh 宿主；dsh 也**没有** per-session 的 patch / per-session 的 profile 概念。
- **这其实支持 159 的裁决，但结论要写明**：159 D1/D7「`.stratix` 不映射 profile / patch（部署面 vs 项目面）」在 B 面**更加成立** —— 不是「正交」，而是「**部署面根本表达不了 per-project 的差异**」。
- **建议**：
  1. 159 §3.2 结论句补一句：*「因此项目级 patch 只在**一进程一项目**（Stratix 独立进程模式）下可生效；被嵌入形态下，项目级差异必须走 **per-session 数据**（`.stratix` 读取 + 工具/Remote 参数），不得走 patch」*。
  2. 160 §5.3 的「patch 锚定」一行加限定：**M3 的 patch 桥接仅在独立进程模式成立**。
  3. 顺带记录 dsh headless 的一个相关限制：`packages/bundle/headless/src/index.ts:350-355` —— `--add-dir` 触发的额外可写根**必须**由 sandbox-policy 行声明 `headlessStartup.additionalWritableRoots`，否则启动即抛；即「per-invocation 的目录需求**也**要靠 profile 行 ⇒ 又是进程级」。

### B8 🟢 —— 可借用的现成 seam：dsh 已有 `ctx.forge`（代码宿主变更请求），与 Stratix 的「派单给角色 → agent 干活 → 回报」形状高度同构

- **指向**：160 §5.3（preset 对齐）、§3.4 R4（任务回报链）；159 §3.1（能力组合）
- **证据**：
  - `packages/experimental/forge/src/index.ts:16-30` —— `ctx.forge` 服务 + `forge/providers-changed` 事件；README 原文：*"A provider maps remote and change request URLs to provider-neutral references… `ctx.forge.register(provider)` is an effect… Results arriving after cancellation are discarded."*
  - 能力接缝图（`docs/capability-seams.md`）里三条同族接缝：`ctx.forge`（Code host change requests）、`ctx.forgeSession`（Session change request bindings）、`ctx.forgePanel`（Forge panel Remote）。
- **含义**：dsh 已经有「**宿主 App ⇄ 变更请求 ⇄ 会话**」的三角，且是 **provider-neutral 引用 + 状态轮询 + 面板**的形状。Stratix 的「派单给角色 → agent 干活 → 产出回报 → 任务结算」在语义上属于**同一类**（对某个目标发起一项可跟踪的工作请求）。
- **建议**：B 面方案里先回答一个问题：*「Stratix 的派单是否可以直接映射到 `ctx.forge` 的形状（provider-neutral ref / 状态 / panel）？」* 若能，则 B4 的能力面可以少造一套；若不能（因为 Stratix 派单的对象是**本地 agent**而不是代码宿主），要在文档里写明**为什么**不映射 —— 否则会造出第二套「工作请求」语义。

---

## 3. 双面总评

### A 面（兼容：Stratix 用 dsh）—— **方向对但要补**

**理由**：159 §3.1 的映射表逐条在 HEAD 上复核，**核心断言全部成立**：

| 断言 | 复核 |
|---|---|
| `SessionHeader.cwd` 不可变绝对路径 | ✓ `packages/core/session/src/types.ts:106` `readonly cwd?: string` |
| workspace 唯一性按 realpath 判等 | ✓ `packages/workspace/workspace/src/index.ts:503-513`（`resolveByPath` / `createCanonical`） |
| 路径规范化经 `fs.realpath` | ✓ 同上 `:237`（`create` 内 `realpathNormalize`） |
| 会话归属按 `header.cwd` 判定 | ✓ `packages/workspace/workspace/src/entity.ts:110-141` |
| marker 只有 `.git`、找不到回落 cwd | ✓ `packages/context/agent-instructions/src/config.ts:11`、`files.ts:232-246`（回落代码 `:344`） |
| dsh 自动看 `.dsh/skills` / `.agents/skills` | ✓ `packages/skill/skill-filesystem/src/index.ts:256-257` |
| `customSkillDirs` 是挂载口 | ✓ 同文件 `:58` / `:80` / `:168` |
| preset 写进 session header | ✓ `packages/core/session/src/types.ts:131-135` |
| 会话开始后不许换 preset | ✓ `packages/preset/agent-preset-registry/src/index.ts:364-368` |
| patch 相对路径按 patch 文件目录锚定 | ✓ `packages/boot/app-boot/src/index.ts:547-557` |
| patch 整段替换 config 不合并 | ✓ `packages/bundle/base/cordis.patch.yml:6-8` |
| 凭据链：环境 → `<invocation cwd>/.env` → `$DSH_HOME/.env` | ✓ `packages/bundle/headless/README.md:56`（但见 A5 的限定） |
| 版本单调整数 + 方向性拒绝 + `ignorable` | ✓ `packages/core/session/src/types.ts:90`、`packages/session/session-format/src/catalog.ts:54-59`、`chain.ts:83` |
| 生成型 bundle 拒绝自定义 tag | ✓ `packages/experimental/creation-recommendations/src/generated-bundle.ts:26-28`（但见 A1：**不是** `--patch` 的规则） |
| dsh headless 无 `--cwd` | ✓ `apps/cli/src/args.ts` 无 cwd 选项 |
| `session/query` 自带斜杠路由 | ✓ `packages/sdk/server/README.md:40`（路由实现 `packages/sdk/server/src/query-input.ts:14-27`，命令表 `packages/interaction/commands/src/builtin.ts:17-20`），159 §3.4 的规避策略成立 |

**要补的**：A1（🔴，`--patch` 的 `!!js` 执行面 + 威胁模型）、A2（🟡，patch 载荷与端口）、A3（🟡，skill rank）、A4（🟡，两套项目根）、A5（🟡，凭据链限定）。

**冻结前必须做的最小集合**：**A1 + A4**。A1 是安全项（不改就等于允许仓库执行任意 JS）；A4 是正确性项（不改就会有两套「项目根」，而 159 的 `AGENTS.md` 放置策略依赖 dsh 认得 `.stratix`）。A2/A3/A5 可以以「实现期铁律」的形式挂在 159 §5.4 S7 前置里。

### B 面（被兼容：Stratix 作为 dsh 插件被嵌入）—— **架构性返工**

**理由**：不是「差一点」，是**两处底层的错位**：

1. **隔离模型错位**（B1 / B5）：dsh 的隔离单位是 **session/scope**（`packages/core/scope/README.md:8-9`、`packages/core/agent-loop/src/agent.ts:147`、`packages/core/tools/src/index.ts:106-108`），Stratix 的隔离单位是**进程**（159 D11 / 160 D3）。这不是参数问题，是**契约层的问题**——`activeInstanceId` 挂在 `WorldState`（进程级）而不是挂在 session 上。**要动的是 core 契约的最底层**（与 159/160 反复引用的三条铁律正面相撞），所以是架构性返工。

2. **插件形态整体缺位**（B3 / B4）：160 M3 只做到「被调用」。真正的「被嵌入」在 dsh 侧有明确的四层形态（宿主 Service / `ctx.tools` 工具面 / `@Remote` 控制面 / 双面包客户端半边）+ npm 分发单元（`engines.dsh` + `dsh.bundle.patch`）。**这一整层在 159/160 里一个字都没有**。

**但返工的范围是可控的**：
- **不用返工的部分**：`.stratix` 契约层、project/instance 两层身份、能力组合快照、context 注入协议、marker walk-up —— 全部与 dsh 兼容，且在 B 面仍然成立（A 面已证）。
- **要返工的部分**：① 把 `activeInstanceId` / worldStore 从进程级降到 **scope 级**（对应 dsh 的 `createScope`），并把「独立进程模式 / 嵌入模式」分成两条明确的实现路线；② 新写一节「Stratix 作为 dsh bundle/plugin 的形态」，把 B3 的五件事（包形态 / 入口与生命周期 / 能力面 / 权限沙箱 / 不做的事）定义出来；③ 把 D11 的**适用域**写死，别让读者以为它在两种形态下都成立。
- **顺带的**：B2（端口）、B6（两套注册表）、B7（进程级 patch）都是**文档级**的澄清，不需要动代码。

**建议的冻结顺序**：先把 B 面拆成**独立任务**（不要塞进 159/160 的修订），再让 159/160 各加一段「与 B 面任务的对齐说明」。理由：B1 的返工会改 core 契约与铁律解释，属于 159/160 的前置依赖；混在同一份文档里改会同时动两份设计 + 一份 core 契约，违反「最小变更」。

---

## 4. 对两份调研报告（task_157 / task_158）的引用复核

| 报告 | 所注 HEAD | 复核结论 |
|---|---|---|
| task_158《dsh 集成面测绘》 | `fcc0ad4621` | **与本次开工 HEAD 完全一致** ⇒ §4/§5 结论可直接引用 |
| task_157《插件架构深读》 | `ce7073d5`（更早） | **有漂移**。159 §3.0 已声明「所引用的 task_157 结论均不落在改动面上」——本次在 HEAD 上重读，**该判断基本成立**（preset 写进 header、`agent-preset/locked`、skill 两级注入、session 事件流与 `SESSION_FORMAT_VERSION` 均一致），但有一处需要作者留意：159 §1.3 引的 `packages/skill/skill-filesystem/src/tool-skill/src/index.ts:36` **在 HEAD 不存在**，研究报告引的是 `packages/skill/tool-skill/src/index.ts:36`（见 A7-1）——即 159 的转述把路径写错了，不是报告本身错。 |

**引用体检（机器核对，非人工抽样）**：把两份调研报告里所有 `packages/…` / `docs/…` 形式的 path:line 抽出去重，得 **256 条**；逐条在 HEAD 上核对「文件是否存在 + 引用行号是否在文件行数以内」——**0 条越界、0 条文件缺失**（唯一「缺失」的是研究报告中指向 **Stratix 自己**的 `docs/DEMO-PLAN.md` / `docs/WORLD-SYNC.md` / `docs/MCP-SPEC.md` 等，它们不在 dsh 仓库，属正常）。

> ⇒ **调研报告本身在 HEAD 上没有硬伤，可以继续当作事实底座引用。** 真正的偏差全部出在 **159/160 对报告的转述**上（A7 的 3 条：1 处路径写错 + 2 处行号偏移）。

**其余抽样**（30+ 条 path:line）逐条核对结果：`packages/core/session/src/types.ts:90`（`SESSION_FORMAT_VERSION = 4`）✓、`packages/core/session/src/index.ts:103-105`（header 严格等值校验）✓、`packages/core/session/src/index.ts:1403`（`fork`）✓、`packages/preset/agent-preset-registry/src/index.ts:364`（`agent-preset/locked`）✓、`packages/bundle/base/cordis.patch.yml:6`（整段替换语义）✓、`packages/experimental/creation-recommendations/src/generated-bundle.ts:16`（`validateGeneratedBundle`）✓、`packages/core/tools/src/index.ts:99`（`ToolsService`）✓、`packages/core/scope/src/index.ts:137/:169`（`createScope` / `scopeTarget`）✓、`packages/preset/agent-preset-registry/src/definition.ts:5`（preset = Loader entry 行列表）✓ —— **均与 HEAD 一致**。

**§7 #25 / #26 专项复核**（159 §3.4 派活文案坑直接依赖这两条，**结论成立、行号全对**）：

| 调研报告所注 | HEAD 实测 | 结论 |
|---|---|---|
| `packages/sdk/server/README.md:40`（`session/query` 自带斜杠路由） | `:40` 逐字命中：*"`session/query` is the wire entry used by high-level SDK `run()`… The full SDK recognizes bare `/compact`, `/permission <preset>` with a non-blank preset, `/plan [off\|message]`, and `/goal [objective\|clear\|edit objective\|pause\|resume]`… `session/prompt` remains the low-level queued-input entry without native slash-command routing."* | ✓ |
| `packages/sdk/server/src/server.ts:505-513`（`session/query` 分派） | `:505` = `case 'session/query': {`，`:506-508` 参数校验，`:509-511` → `this.query({...})` | ✓ |
| `packages/sdk/server/src/query-input.ts:14-27`（识别函数） | `:14` = `export function queryCommand(text, commands)`，`:16-17` 前缀 `/` 判定，`:19` `resolveCommand`，`:22-24` 三条形态约束 | ✓ |
| `packages/interaction/commands/src/builtin.ts:17-20`（中英别名表） | `:17` = `export const builtinCommandTokens = {`，`:18` en（goal/plan/feedback/compact/permission/export），`:19` zh（目标/计划/反馈/压缩/权限/导出） | ✓ |
| `packages/sdk/protocol/src/types.ts:213`（协议声明） | `:213` = `'session/query': { params: SessionQueryParams; result: SessionQueryResult }` | ✓ |
| `packages/sdk/server/src/server.ts:544-552` / `:594`（懒创建 + cwd 落点） | `:544` = `private async getOrCreateSession(...)`；`:594` = `meta: { cwd: this.cwd }` | ✓ |

> ⚠️ 一处**易混淆点**（不是报告错，但会误导读者）：`packages/session-query/` 确实存在，但它是**另一套东西**（session 日志的冷读/查询工具族：`cold-read.ts` / `corpus.ts` / `extraction.ts`），**与 `session/query` 线缆入口无关**。159 §3.4 的正确证据是 `packages/sdk/server/` 侧，本报告 A/总表均已按后者标注。

---

## 5. 自检

| 验收项 | 结果 |
|---|---|
| A/B 两面各 ≥4 条实质意见 | A 面 7 条、B 面 8 条 ✓ |
| 全部带 dsh HEAD path:line 证据 | ✓ 全部意见均引用 `fcc0ad46` 上的 `path:line`（含 A7 的引用偏差本身也带行号） |
| dsh 结论基于 pull 后的 HEAD | ✓ 报告头注明 commit；`git pull` 结果「已经是最新的」 |
| 不修改设计文档本体 | ✓ 159 / 160 / 两份 research 文档均未改动 |
| 不写 dsh 仓库 | ✓ 只读（`git pull` / `sed` / `grep` / `wc`） |
| 不改 `src/` | ✓ |
| A/B 面各给三选一总评 | ✓ A = 方向对但要补；B = 架构性返工 |

**意见索引**

| 编号 | 严重度 | 指向 | 一句话 |
|---|---|---|---|
| A1 | 🔴 | 159 §1.3 / §3.3 | `--patch` 允许 `!!js` 执行，设计自订的静态校验没覆盖 |
| A2 | 🟡 | 159 §1.2 / §1.3；160 §4.1 | patch 载荷引用不存在的目录 + 端口与 160 自述矛盾（7797 vs 7524） |
| A3 | 🟡 | 159 D6 / §3.1 | `.stratix/skills` rank 300，低于 `.dsh/skills`(100) / `.agents/skills`(200) |
| A4 | 🟡 | 159 §1.2 / §2.2 / §3.1 | 两套项目根：skill 侧硬编码 `.git` 不可配，指令侧可配但没人配 |
| A5 | 🟡 | 159 §1.2 / §3.3 / §3.5 | 凭据链只对 API-key 成立；空串 env 会屏蔽 `.env` 回退 |
| A6 | 🟢 | 159 §1.4 | 版本机制方向性 ✓，但 dsh 链无下限且目录是编译期静态的 |
| A7 | 🟢 | 159 §1.3 / §2.2；160 §3.5 | 3 处 path:line 偏差 |
| B1 | 🔴 | 159 D11；160 D3 | 一进程一实例 vs dsh 宿主并发多会话 |
| B2 | 🔴 | 160 §4.1 / §2.5 | world-sync 固定端口 vs dsh 的「端口 0 = OS 分配」 |
| B3 | 🔴 | 160 D14 / §5.3；159 §3.2 | 真正的插件形态四层全缺（M3 只是「被调用」） |
| B4 | 🟡 | 160 §5.3 / 附录 B | 能力面未定义；`stratix_world_snapshot` 是 MCP 而非 dsh 原生工具 |
| B5 | 🟡 | 159 D11 / §4.1.1；160 D3 / §6.1 | core 单例 vs dsh scope（标准解法已存在） |
| B6 | 🟡 | 159 §2.4 / §3.1；160 §2.4 | instance（执行隔离）vs dsh Workspace（导航分组）语义不等价 |
| B7 | 🟡 | 159 D1/D7 / §1.3；160 §5.3 | `--patch` / profile 是进程级 ⇒ 项目级 patch 无法 per-project |
| B8 | 🟢 | 160 §5.3 / §3.4 | 可复用 seam：`ctx.forge` / `forgeSession` / `forgePanel` |
