# UI-Link Photoshop CEP Plugin

UI-Link 是一个面向 UI 美术与客户端协作流程的 Photoshop CEP 插件，主要用于图层参数管理、九宫格切图、增量导出，以及面板内的辅助预览与效率操作。

## 功能概览

### 1. 图层参数管理
- 为图层保存名称、导出类型、前缀、组件类型、尺寸、导出开关等参数
- 参数写入图层元数据，不依赖把长配置串拼进图层名
- 提供名称预览、最近名称下拉、尺寸预设、位置预览与拖拽调整

### 2. 九宫格编辑
- 读取当前选中图层并显示九宫格参考线
- 支持拖拽或输入数值调整上下左右切线
- 支持九宫格参数保存、预览和后续导出联动

### 3. 增量扫描导出
- 扫描当前 PSD 与历史导出数据差异
- 区分新增、修改、不变、关闭导出的图层
- 只导出需要更新的资源，提高切图效率

### 4. AI 辅助能力
- 支持云端 AI 清晰化流程
- 可配置 API URL、API Key、模型与提示词
- 将结果重新导入 Photoshop 图层

### 5. 自动更新
- 面板内检查版本
- 发现新版本后可直接拉取更新包并覆盖本地插件

## 安装方式

### 1. 开启 CEP 调试模式

Photoshop 需要允许加载未签名扩展。

- Windows:
  在注册表 `HKEY_CURRENT_USER\Software\Adobe\CSXS.9`（版本号按实际 Photoshop 调整）下创建字符串值 `PlayerDebugMode=1`
- macOS:
  在终端执行 `defaults write com.adobe.CSXS.9 PlayerDebugMode 1`

### 2. 放入扩展目录

将整个插件目录复制到 CEP 扩展目录中。

- Windows:
  `C:\Users\<用户名>\AppData\Roaming\Adobe\CEP\extensions\cep-plugin`
- macOS:
  `~/Library/Application Support/Adobe/CEP/extensions/cep-plugin`

### 3. 重启 Photoshop

打开 Photoshop 后，在：

`窗口 -> 扩展功能 -> UI-Link`

即可看到插件面板。

## 基本使用流程

### 1. 配置图层参数
- 选中需要处理的图层
- 在“图层属性”页签中设置名称、类型、前缀、组件类型、尺寸等参数
- 如需调整资源在导出画布中的位置，可直接在位置预览中拖拽
- 点击“保存参数”

### 2. 设置九宫格
- 切到“九宫格”页签
- 点击“读取当前选中图层”
- 拖动参考线或输入切线数值
- 点击应用保存九宫格参数

### 3. 扫描并导出
- 切到“扫描导出”页签
- 设置 JSON 输出目录和图片输出目录
- 点击扫描，查看变更列表
- 勾选需要导出的资源
- 点击导出

### 4. 使用 AI 清晰化
- 在 Setting / AI 实验室中配置接口信息
- 在 AI 清晰化页签中设置提示词
- 执行云端 AI 清晰化

## 面板说明

### 图层属性
- 配置名称、类型、尺寸、导出状态
- 预览导出命名与位置

### 九宫格
- 编辑九宫格切线
- 查看切图预览

### 扫描导出
- 扫描差异
- 批量导出资源与结构数据

### Setting
- 查看版本
- 检查更新
- 配置 AI 实验室参数

## 项目结构

- `index.html`
  面板静态结构与样式
- `js/main.js`
  面板交互逻辑、状态管理、更新检测、前后端通信
- `jsx/hostscript.jsx`
  Photoshop ExtendScript 主逻辑，负责图层元数据、导出、九宫格与图像处理
- `CSXS/manifest.xml`
  CEP 插件清单
- `version.json`
  当前插件版本信息
- `instructions.md`
  项目结构与维护说明

## 适用场景

- 游戏 UI 切图
- 客户端资源命名规范管理
- 图层参数持久化
- 九宫格资源生产
- UI 美术与程序协同导出
