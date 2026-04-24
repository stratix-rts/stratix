# UI 美学约束标准（Aesthetic Constraints for UI Code Generation）

> **版本**: v1.0  
> **基于**: Ngo, Teo, Byrne (2000) "Modelling Interface Aesthetics"  
> **用途**: 作为 prompt 约束注入 LLM，无自动化检查，纯靠模型自律

---

## A1 — 间距规律性（Regularity & Rhythm）

间距是一切视觉秩序的基础。

### 规则

1. **使用间距阶梯**：所有 margin、padding、gap 必须来自预定义的间距阶梯（4, 8, 12, 16, 24, 32, 48, 64），禁止使用阶梯外的数值
2. **同层级一致**：同一容器内的同级子元素之间的间距必须完全相同
3. **间距递进**：嵌套层级越深，内间距越小。例如：
   - 页面级容器间距：32-48px
   - 区块间距：24px
   - 组件内部间距：12-16px
   - 元素内间距：4-8px
4. **禁止随意数值**：`margin: 13px`、`padding: 7px 23px`、`gap: 11px` 这类不在阶梯上的数值，说明没有间距系统
5. **间距节奏**：如果使用多个间距值，它们应该形成等差或等比序列（如 4, 8, 12, 16 或 8, 16, 32），不要出现 8, 12, 24, 16 这种无序跳变

### 反面例子

```
❌ margin: 13px; padding: 7px 22px;     // 不在阶梯上
❌ .item { margin-bottom: 20px; }        // 用了 20px
❌ .card { padding: 16px; }
    .card-body { padding: 20px; }        // 内层反而比外层大
```

### 正面例子

```
✅ margin: 16px; padding: 8px 16px;     // 全在阶梯上
✅ 外层 gap: 24px → 内层 gap: 12px      // 层级递减
✅ 间距序列: 8, 16, 24, 32              // 等差节奏
```

---

## A2 — 布局对齐（Balance & Equilibrium）

布局是骨架，对齐是骨骼线。

### 规则

1. **统一布局方案**：整个页面使用 Flexbox 或 Grid，不要混用。整体布局优先用 Grid，组件内部优先用 Flexbox
2. **居中有意识**：页面主内容必须居中（`max-width` + `margin: 0 auto`），不要让内容贴着屏幕左边
3. **对齐属性必须显式声明**：Flex/Grid 容器必须写 `justify-content` 和 `align-items`，不要依赖浏览器默认值
4. **禁止绝对定位做布局**：`position: absolute` 只用于浮层、tooltip、dropdown 等脱离文档流的场景，不用于正常的页面布局
5. **网格对齐**：多列卡片或列表必须使用 Grid，列宽用 `fr` 或 `minmax()`，不要用固定像素宽度

### 反面例子

```
❌ display: flex; （没有 justify-content 和 align-items）
❌ position: absolute; top: 100px; left: 200px;  // 用绝对定位做正常布局
❌ width: 33.33%; float: left;                   // 用 float 做三列
```

### 正面例子

```
✅ max-width: 1200px; margin: 0 auto;           // 内容居中
✅ display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;
✅ display: flex; justify-content: center; align-items: center;
```

---

## A3 — 色彩与风格统一（Unity & Homogeneity）

一个页面应该看起来是一个人设计的，不是五个人拼的。

### 规则

1. **禁止硬编码色值**：所有颜色必须使用 CSS 变量（`var(--color-primary)`）或预定义的语义化 class，不要写 `#3B82F6` 或 `rgb(59, 130, 246)`
2. **同类元素相同样式**：所有按钮用同一套颜色/圆角/阴影，所有卡片用同一套样式，不要每个长得不一样
3. **字号使用排版阶梯**：定义 5-6 个字号等级（如 xs, sm, base, lg, xl, 2xl），所有文字必须使用这些等级，禁止随意字号
4. **装饰属性统一**：圆角用统一的 token（如 `radius-sm`, `radius-md`, `radius-lg`），阴影用统一的层级（如 `shadow-sm`, `shadow-md`），不要每个地方各写各的
5. **色彩不超过 3 种主色**：一个页面最多 1 种主色 + 1 种辅助色 + 1 种强调色（不含灰度色），超过说明色彩失控

### 反面例子

```
❌ color: #3B82F6;                    // 硬编码
❌ border-radius: 7px;                 // 不在 token 里
❌ .btn-primary { background: #3B82F6; border-radius: 8px; }
   .btn-secondary { background: #10B981; border-radius: 12px; }  // 圆角不统一
```

### 正面例子

```
✅ color: var(--color-primary);
✅ border-radius: var(--radius-md);
✅ 所有按钮使用 .btn-base + modifier class
```

---

## A4 — 比例与尺寸（Proportion & Cohesion）

好的比例关系让人觉得「舒服」，说不出为什么但就是好看。

### 规则

1. **主要容器使用经典比例**：宽高比应接近以下之一：
   - 黄金比例 1:1.618（最适合内容卡片）
   - √2 比例 1:1.414（最适合文档类布局）
   - 16:9（最适合媒体/视频）
   - 4:3（最适合图片展示）
   - 1:1（最适合头像/图标）
2. **图片和卡片必须声明比例**：使用 `aspect-ratio` 属性，不要让图片/卡片的 高度塌缩或随机
3. **同类元素等尺寸**：所有卡片等宽等高，所有头像等大，所有图标等大。不要同一行里有的宽有的窄
4. **尺寸使用 8px 基准**：元素宽度/高度应该是 8 的倍数（24, 32, 40, 48, 56, 64…），不要出现 37px、53px 这种数值

### 反面例子

```
❌ width: 37px; height: 53px;          // 不在 8px 基准上
❌ .card { width: 200px; } .card { width: 240px; }  // 同类不等宽
❌ <img src="...">                      // 没有 aspect-ratio
```

### 正面例子

```
✅ aspect-ratio: 16 / 9;
✅ width: 100%; max-width: 1200px;     // 响应式 + 经典宽度
✅ .card-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
```

---

## A5 — 视觉层级与阅读流（Sequence & Order）

用户应该在 0.5 秒内知道页面在说什么、该看哪里、该点什么。

### 规则

1. **字号层级不超过 3 层**：大标题 → 小标题/正文 → 辅助文字，三层足矣。不要出现大标题、中标题、小标题、正文、注释、说明文字六种字号
2. **字重配合层级**：层级越高字重越大（700/600 → 400 → 300），不要所有文字都是同一字重
3. **只有一个视觉焦点**：页面上最大字号 + 最强字重的元素只有一个，就是主标题。不要出现两个同等大小的标题抢注意力
4. **阅读流方向**：
   - 最重要的信息放在左上角（用户第一眼看到的地方）
   - 次要信息从左到右、从上到下排列
   - 主要操作按钮（CTA）放在视觉流的末端（通常右下或底部居中）
5. **对比度区分层级**：标题用深色（接近黑），正文用中灰，辅助文字用浅灰。不要所有文字都一样黑

### 反面例子

```
❌ 所有文字 font-weight: 400;            // 没有字重层级
❌ 标题和正文字号差距只有 2px              // 层级不够明显
❌ 页面上有 3 个同等大小的标题              // 焦点不唯一
❌ CTA 按钮在页面最上方，说明文字在下面      // 阅读流倒置
```

### 正面例子

```
✅ 主标题: 32px/700 → 正文: 16px/400 → 辅助: 14px/灰
✅ 一个视觉焦点，其余都弱于它
✅ 信息从左上到右下，CTA 在右下角
```

---

## A6 — 简洁性（Simplicity & Economy）

少即是多。每多一行 CSS，就多一个需要维护的东西。

### 规则

1. **选择器深度 ≤ 3**：`.card .title .icon` 可以，`.page .section .list .item .card .title .icon` 不行
2. **单个选择器属性 ≤ 10 条**：如果一个 class 写了 20 条属性，说明这个组件太复杂了，应该拆分
3. **重复样式必须提取**：如果 3 个以上的选择器有相同的属性组合，必须提取为共享 class 或使用 @apply / mixin
4. **不留无用样式**：写了但没用到等于没写，还增加认知负担
5. **不为未来写样式**：只写当前需要的，不要「以防万一」加一堆备用样式

### 反面例子

```
❌ .page .content .main .section .card .header .title { }   // 7 层
❌ .btn { color: red; font-size: 14px; font-weight: 600; padding: 8px 16px; 
         border-radius: 6px; background: white; border: 1px solid #ddd; 
         cursor: pointer; transition: all 0.2s; display: inline-flex; 
         align-items: center; gap: 8px; text-decoration: none; 
         line-height: 1.5; letter-spacing: 0.02em; }       // 14 条属性
❌ .card-1 { padding: 16px; border-radius: 8px; background: white; }
   .card-2 { padding: 16px; border-radius: 8px; background: white; }  // 重复
```

### 正面例子

```
✅ .card-title { }                    // 2 层选择器
✅ .card { /* 6 条属性 */ }           // 精简
✅ .card-base { padding: 16px; border-radius: 8px; }
   .card-featured extends .card-base  // 复用
```

---

## A7 — 信息密度（Density）

密不等于信息多，空不等于优雅。

### 规则

1. **留白占总面积 30-50%**：内容区域里，文字/图片占 50-70%，空白占 30-50%。全是字叫文档，全是空白叫浪费
2. **一个视觉区域 ≤ 3 种信息类型**：比如「标题 + 正文 + 按钮」可以，「标题 + 标签 + 评分 + 价格 + 库存 + 按钮」太多了
3. **行间距 ≥ 字号的 1.5 倍**：16px 的字，行高至少 24px。行距太密阅读困难
4. **分组用间距区分**：不同信息组之间用更大的间距分隔（24px+），同组内用较小间距（8-12px）。如果所有元素间距一样，说明没有分组意识
5. **单屏不超过 25 行正文**（桌面端）。超过说明这个区域该拆分或折叠

### 反面例子

```
❌ 紧凑表格 + 10 列 + 无分组边距        // 信息过载
❌ 所有元素 margin: 8px                // 无分组
❌ line-height: 1.0                    // 行距太密
❌ 全屏留白只放一个按钮                  // 浪费空间
```

### 正面例子

```
✅ 信息组 A（间距 8px）─── 组间距 32px ─── 信息组 B（间距 8px）
✅ line-height: 1.6 或 1.75
✅ 每屏 15-20 行正文，留白充足但不空洞
```

---

## A8 — 对称与结构（Symmetry & Structure）

对称是默认选项，非对称需要理由。

### 规则

1. **表单标签统一方向**：要么全部标签在输入框上方，要么全部在左侧，不要混用
2. **网格等宽等高**：卡片网格的每个卡片应该等宽。如果内容量不同导致高度不一致，用 `grid-auto-rows` 或统一 min-height 解决
3. **页面内容居中**：主要内容区域在屏幕上居中显示，不要偏左或偏右
4. **非对称必须有理由**：如果使用不对称布局（如侧边栏 + 主内容），必须是因为功能需要（导航/筛选等），不是装饰性非对称
5. **页头页脚对齐**：页头内容、主体内容、页脚内容应该共享同一套左右边距

### 反面例子

```
❌ 第一个表单标签在左，第二个标签在上      // 混用
❌ 卡片网格中有的宽 200px 有的宽 280px     // 不等宽
❌ 内容偏左，右边大块空白                   // 无意识的非对称
❌ header 内边距 16px，main 内边距 32px    // 边距不统一
```

### 正面例子

```
✅ 所有表单统一 label-on-top 或 label-on-left
✅ grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));  // 等宽
✅ max-width: 1200px; margin: 0 auto; padding: 0 24px;           // 统一边距
```

---

## 总结：一句话记忆版

| 维度 | 一句话 |
|------|--------|
| A1 间距 | 间距用阶梯，同层要一致，外大内小 |
| A2 对齐 | flex/grid 做布局，对齐必须显式写 |
| A3 色彩 | 颜色用变量，同类要统一，主色不超 3 种 |
| A4 比例 | 用经典比例，同类等尺寸，8px 基准 |
| A5 层级 | 3 层字号，1 个焦点，左上到右下 |
| A6 简洁 | 选择器 ≤ 3 层，属性 ≤ 10 条，不重复 |
| A7 密度 | 留白 30-50%，分组明显，不超 25 行 |
| A8 对称 | 对称是默认，非对称要理由，边距统一 |
