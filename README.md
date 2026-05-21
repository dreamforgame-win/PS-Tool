# 🎨 UI-Link 工具箱 (Photoshop CEP 插件)

![Version](https://img.shields.io/badge/version-v1.0.8-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)
![Photoshop](https://img.shields.io/badge/Photoshop-CC%202015+-31a8ff.svg)

UI-Link 是一个专为游戏开发和软件研发团队打造的 **Photoshop 自动化 UI 切图与协作插件**。它致力于抹平 UI 美术与客户端程序之间的沟通鸿沟，提供极速增量切图、可视化九宫格编辑、以及无痕图层元数据管理。

---

## ✨ 核心特性 (Features)

### 1. 纯净图层命名 & 无痕数据存储 (v1.0.8+ 全新架构)
告别为了传参而把图层名写得像乱码一样的时代（如 `btn_close|atlas|button|120x120...`）。
UI-Link 使用 Photoshop 底层的 `Action Descriptor` 将组件类型、输出类别（大图/图集）、尺寸和九宫格信息**隐式存储**在图层内部。
- 🎨 **美术视角**：图层名极度纯净，只显示最终导出名（如 `common@btnClose`）。
- 💻 **程序视角**：完整的配置参数随 PSD 跨设备无损传递，不产生任何额外配置文件。

### 2. 🚀 极速增量导出 (Incremental Export)
还在每次修改一个小图标就苦等几分钟全量切图吗？
- UI-Link 拥有智能 Diff 算法，一键扫描当前文档与历史导出的 JSON 数据差异。
- 自动标记出 **[新增]**、**[修改]**、**[不变]** 的图层，仅对变动项进行极速切图导出。

### 3. 🔲 可视化九宫格编辑器 (9-Slice Editor)
在 Photoshop 内部直接提供九宫格切线调整 UI：
- **拖拽参考线**或精准输入数值。
- **无损拉伸扩图**：一键将带九宫格参数的图层转化为“智能对象”，在 PS 中随意 `Ctrl+T` 缩放，边缘永不模糊。
- **完美还原**：即使拉伸变形，一键即可根据九宫格规则重绘还原完美的边角。

### 4. 🔄 团队级无感热更新 (Auto Update)
插件内置 CDN 轮询检测，发现新版本时在面板顶部展示提示，一键静默拉取并覆盖更新，确保全团队工具链永远保持一致。

---

## 📦 安装指南 (Installation)

### 1. 允许加载未签名的扩展 (开发者模式)
为了让 Photoshop 加载本地插件，你需要开启 `PlayerDebugMode`：
- **Windows**: 
  打开注册表 (`regedit`)，进入 `HKEY_CURRENT_USER\Software\Adobe\CSXS.9` (数字对应你的 PS 版本)，新建字符串值 `PlayerDebugMode`，设为 `1`。
- **macOS**:
  打开终端执行：`defaults write com.adobe.CSXS.9 PlayerDebugMode 1`

### 2. 放入扩展目录
将本项目的文件夹完整复制到以下对应系统的 CEP 扩展目录中：
- **Windows**: `C:\Users\<你的用户名>\AppData\Roaming\Adobe\CEP\extensions\cep-plugin`
- **macOS**: `~/Library/Application Support/Adobe/CEP/extensions/cep-plugin`

### 3. 重启 Photoshop
在 Photoshop 的顶部菜单栏中，点击 **窗口 (Window) -> 扩展功能 (Extensions) -> UI-Link 工具箱** 即可打开面板。

---

## 🛠 使用流转 (Workflow)

1. **配置图层**：选中需要导出的图层/组，在【属性命名】Tab 中选择它是图集还是独立大图，设置组件类型（按钮、滑条等）。
2. **设置九宫格 (可选)**：如果需要拉伸，进入【九宫格】Tab 拖拽绿色的参考线。
3. **确认应用**：点击底部应用，图层名称瞬间变为干净的导出名。
4. **一键切图**：进入【扫描导出】Tab，设置输出路径，点击扫描，一键导出修改过的切图和结构 JSON。

---

## 👨‍💻 技术栈说明 (Tech Stack)

- **前端层 (Frontend)**：Vanilla HTML / CSS / JS，无复杂框架，极致轻量响应快。
- **宿主环境层 (Host)**：Photoshop ExtendScript (JSX)，深入调用底层 ActionManager API。
- **桥接层 (Bridge)**：Adobe CEP `CSInterface.js` 实现面板与宿主引擎的数据透传。

## 📝 更新日志 (Changelog)

**v1.0.8**
- [架构] 重构元数据存储方案，全面启用图层自定义隐藏属性 (`app.putCustomOptions`)。
- [优化] 图层名称回归纯净导出名，彻底解决与其他工具（如图层重命名脚本）的冲突问题。
- [兼容] 内置旧版 `|` 分隔符图层名平滑读取兼容机制，操作旧图层自动向新架构洗白。

---
*Designed for better Game UI Workflows.*