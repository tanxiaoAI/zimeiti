# 前端设计规范与架构重构指南 (基于 shadcn-ui MCP)

## 1. Design Token 体系 (Design Tokens)

我们基于 `shadcn-ui` 默认的 CSS Variables 定义了完整的 Token 系统，集中在 `src/ui/styles.css` 和 `tailwind.config.js` 中。

- **颜色 (Colors)**:
  - `--background`: 应用背景 (浅灰色 `#F6F8FB`)
  - `--foreground`: 主文本颜色 (深灰色 `#1F2937`)
  - `--primary`: 主色调 (`#2F6BFF`)，用于主要按钮、激活状态等。
  - `--muted`: 辅助文本/背景，用于次要信息。
  - `--accent`: 强调色 (`#ff4d4f`)，用于错误、警告或特俗标注。
  - `--border`: 边框色 (`#E5E7EB`)。
- **间距 (Spacing)**: 使用 Tailwind 默认间距 (如 `p-4`, `m-2`, `gap-4`)，基础单位为 `0.25rem` (4px)。
- **圆角 (Radius)**:
  - 默认圆角 `--radius` 设为 `0.5rem` (8px)。
  - 卡片、弹窗等统一使用 `rounded-lg` (8px)。
- **阴影 (Shadows)**: 
  - `shadow-sm`: 按钮/输入框浮雕
  - `shadow-md`: 悬浮卡片/下拉菜单

## 2. 字体层级系统 (Typography)

我们统一使用 Tailwind 的 Typography 类名控制排版，避免手写字号。

- **H1 (页面标题)**: `text-2xl font-bold tracking-tight` (24px)
- **H2 (模块标题)**: `text-xl font-semibold tracking-tight` (20px)
- **H3 (卡片标题)**: `text-lg font-semibold` (18px)
- **正文 (Body)**: `text-sm leading-7` (14px)
- **辅助/次要文本 (Muted)**: `text-xs text-muted-foreground` (12px)

## 3. 列表与交互行为 (Lists & Interactions)

- **无序列表 (Unordered List)**: 使用 `<ul className="my-6 ml-6 list-disc [&>li]:mt-2">`
- **有序列表 (Ordered List)**: 使用 `<ol className="my-6 ml-6 list-decimal [&>li]:mt-2">`
- **悬停状态 (Hover)**: 可点击元素必须有明显的悬停反馈（如按钮 `hover:bg-primary/90`，卡片 `hover:bg-muted/50`）。

## 4. 图标使用规范 (Icons)

统一使用 `lucide-react`。
- **默认尺寸**: 按钮内部图标 `size={16}`，侧边栏图标 `size={18}`，页面级大图标 `size={24}` 或 `size={32}`。
- **颜色**: 图标默认继承当前文本颜色 (`currentColor`)，不可点击的图标使用 `text-muted-foreground`。

## 5. 组件迁移指南 (Migration Guide)

我们将现有组件逐步迁移到 `@/components/ui/` 目录下。

1. **Button**: 替换原有的 `<button className="btn-primary">` 为 `<Button variant="default">`。
2. **Input/Textarea**: 替换原有的 `<input className="input-field">` 为 `<Input>` / `<Textarea>`。
3. **Table**: 替换原生 `<table>` 为 `<Table>`、`<TableHeader>`、`<TableRow>`、`<TableCell>` 等。
4. **Dialog**: 替换手写的 Modal 为 `<Dialog>` / `<Sheet>` 组件。

---

> 本规范将随着产品的迭代进行动态更新。所有新增代码需严格通过 ESLint 和 TypeScript 类型检查。
