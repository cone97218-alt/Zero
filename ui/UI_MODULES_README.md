# Zero Preset Manager UI Modules (预设管理器界面模块)

此文件夹 (`ui/`) 包含构成“Zero 预设管理器”界面的所有核心前端逻辑代码。我们将原本庞大的单体文件 `ext-ui.js` 拆分为了多个职责单一的子模块，并将原有的 `ext-checker.js` 重命名并整合至此，共同构成一个易于维护、功能强大的界面系统。

## 架构概览

整个 UI 系统被划分为以下几个部分：

### 1. `ext-ui.js` (核心入口与路由)
作为 UI 的主控中心，此文件负责：
- 渲染并挂载主界面的基本 HTML 骨架（Tabs导航与各个面板的内容区）。
- 在 SillyTavern 原生的插件菜单中注入“预设管理”按钮。
- 管理四个主标签页（对照、缝合、自查、管理）的切换，并在切换时动态调用各子模块的方法刷新界面。
- 集中注册与分发 DOM 的交互事件。

### 2. `ui-utils.js` (通用工具库)
包含被其他 UI 模块频繁调用的共享方法集：
- `getPresetPrompts`: 异步读取指定名称预设的详情内容。
- `escapeHtml`: 防止 XSS 与渲染错误的字符转义工具。
- `syncTheme`: 根据 SillyTavern 的内置主题动态更新 UI 配色变量。
- `refreshNativePresetManager`: 在我们修改、删除、导入预设后，通知 SillyTavern 原生管理器强制重载下拉菜单与状态。

### 3. `ui-contrast.js` (对照分析面板)
专门处理预设 A 与预设 B 之间的数据对比功能：
- **`performAutoMatch`**: 自动识别两端预设中重名/内容相似的条目，并归类为“匹配项”、“仅A有”或“仅B有”。
- **`showComparisonDetail`**: 提供一个弹出式的对照视图，高亮展示双端文本变更差异 (Diff)。支持在两端之间直接双向覆盖与翻译。
- **手动匹配体系**: 支持无名称关联的条目手动互相绑定 (`showManualLinksManager`)。

### 4. `ui-stitch.js` (预设缝合/编辑面板)
专门负责管理预设内的条目排布与转移操作：
- **批量/单条缝合 (`performStitch`)**: 允许将预设 A 的单个或多个条目克隆到预设 B，并支持自定义插入位置（顶部、底部或特定项目之后）。
- **批量删除与克隆 (`performBatchDelete` / `performSingleClone`)**: 支持对目标预设进行快捷的内容复制与清理。
- **大图预览 (`showStitchPreview`)**: 点击条目时全屏展现内容详情。

### 5. `ui-manage.js` (全局预设管理)
处理对预设文件的宏观操作：
- 渲染当前的预设大表单 (`renderManageTab`)。
- **批量导入 (`handleBatchImport`)**: 允许一次性拖入或选择多个 `.json` 预设文件并注入系统。
- **批量删除 (`handleBatchDelete`)**: 处理一键清理废弃预设的请求。

### 6. `ui-editor.js` (快捷代码编辑器)
独立出基于“所见即所得”思想设计的代码编辑界面：
- **`openQuickEditor`**: 提供一个类似 IDE 的浮动弹窗，包含独立的深色背景文本域与多功能侧边栏。
- **Quick Phrases 机制**: 实现一键插入常用正则表达式、变量占位符等代码片段。

### 7. `ui-checker.js` (原 `ext-checker.js`，合规自查模块)
实现预设运行前的校验：
- 内置一套规则（如 Token 超限、无效宏等），当选中预设时扫描并给出合规建议与报错警告。

---

## 模块协作模式 (Workflow)
1. 插件启动时，外层的 `index.js` 会调用 `ui/ext-ui.js` 内的 `init()` 将扩展按钮植入主界面。
2. 当用户点击打开面板时，`ext-ui.js` 激活最后一次访问的标签页，渲染相应的 UI。
3. 当用户在“对照”或“缝合”页面修改预设时，相关的子模块 (如 `ui-contrast.js`) 会直接调用原生 API (`SillyTavern.getContext().getPresetManager()`) 将更改落盘。
4. 在数据变更后，子模块会向上级/外部进行通知，`ext-ui.js` 则统一调度 DOM 进行视图的重绘以保持前后端数据同步。
