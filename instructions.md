# UI-Link Photoshop CEP Plugin

## 1. 项目简介 (Project Overview)
这是一个用于 Photoshop 的 CEP 扩展插件，主要服务于 UI 美术与程序之间的工作流协同。
核心功能包括：
- **图层元数据管理**：管理 UI 元素的输出类型、组件类型、尺寸和九宫格信息。
- **自动化增量切图**：扫描 PSD 图层变动，跳过未修改的部分，高效导出切图。
- **九宫格处理**：提供九宫格可视化编辑、智能对象无损拉伸转换与原位还原。

**【核心架构特性】（v1.0.8+ 重构）**
摒弃了将冗长元数据写在图层名称上的做法，改为使用 Photoshop 的底层 `Action Descriptor` (`app.putCustomOptions`) 将 JSON 格式的元数据作为隐藏属性（命名空间 `UILinkLayerMeta`）存储在文档中。
**结果**：图层名称保持极度纯净（仅显示如 `common@btn_close` 的导出名），跨设备/跨图层复制时不丢失数据，对美术极其友好。

## 2. 技术架构 (Architecture)
基于标准的 Adobe CEP 架构，分为前端面板界面和后端宿主脚本。前后端通过 `CSInterface.evalScript` 相互通信。

## 3. 文件索引与标签 (File Index)

### 📌 核心逻辑层 (Backend)
- **`jsx/hostscript.jsx`**
  - **标签**：`[核心脚本]` `[DOM操作]` `[元数据存取]`
  - **说明**：运行在 PS 引擎中的 ExtendScript。包含图层遍历、`Action Descriptor` 隐藏属性读写 (`setLayerMeta`, `getLayerMetaWithFallback`)、导出查重校验、生成导出名、图片切割裁剪及增量导出的具体执行算法。

### 📌 面板表示层 (Frontend)
- **`index.html`**
  - **标签**：`[UI视图]` `[DOM结构]`
  - **说明**：扩展面板的 HTML 结构，分为五个核心 Tab（属性命名、九宫格、扫描导出、PS扩图、Setting）。
- **`js/main.js`**
  - **标签**：`[前端交互]` `[状态维护]`
  - **说明**：负责面板的事件监听、预览字符串生成、通过 `CSInterface` 调用后端 JSX 函数、以及 GitHub/CDN 无感热更新检测轮询逻辑。

### 📌 系统与配置 (Config)
- **`CSXS/manifest.xml`**
  - **标签**：`[插件配置]` `[入口点]`
  - **说明**：CEP 规范文件，定义插件的 Bundle ID、版本号、面板尺寸及宿主 PS 的兼容版本。
- **`version.json`**
  - **标签**：`[版本控制]`
  - **说明**：纯 JSON 文件，记录当前本地版本，由热更新逻辑拉取对比。
- **`js/CSInterface.js`**
  - **标签**：`[系统库]`
  - **说明**：Adobe 官方通讯库，**无需改动**。

## 4. 开发约定 (Conventions)
1. **元数据读写**：所有对图层配置的读写，必须经过 `hostscript.jsx` 中的 `getLayerMetaWithFallback` 或 `setLayerMeta` 函数。严禁再把配置数据强行拼接到 `layer.name` 上。
2. **图层命名**：代码修改图层名称时，仅允许修改为导出的文件名（即 `exportName`）。
3. **查重校验**：保存图层属性时，必须经过 `checkDuplicateExportNamesNew` 函数以避免导出同名覆盖。