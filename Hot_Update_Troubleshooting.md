# 热更新引擎故障排查与修复记录 (Post-Mortem)

本文档记录了在点击“检测更新”并通过网络检查后，点击横幅进行热更新时，UI 卡死在“初始化更新引擎中...”阶段的完整排查与修复流程。

## 故障现象
点击黄色的更新提示横幅后，横幅文字变为“⏳ 初始化更新引擎中...”，此后没有任何变化。没有系统权限（UAC）弹窗出现，黑色日志框内也没有打印任何进度反馈，等待超过 45 秒后提示更新可能在后台被拦截。

## 排查与修复步骤

### 第一阶段：怀疑 PowerShell 执行策略被拦截
**假设：** 
由于热更机制依赖于调用底层的 PowerShell 脚本来下载、解压和覆盖文件。我们怀疑是 Windows 系统的默认脚本执行策略（ExecutionPolicy）拦截了内联脚本的运行，导致命令未被执行，同时后台报错没有被抛到前台。

**修复尝试：**
1. 在调用命令行时加入了越权参数 `-ExecutionPolicy Bypass`。
2. 对下载解压过程加入了 `try-catch` 保护，发生错误时强行写入含有 `ERROR:` 的状态文件。
3. 强制统一了 `-Encoding UTF8`，防止可能存在的中英文乱码导致的读取假死。

**结果：**
依然卡住，且无任何前台日志抛出。

### 第二阶段：怀疑命令行传参超长导致截断与转义崩溃
**假设：**
由于 `-Command` 后面跟随的 PowerShell 脚本包含了错综复杂的单双引号和长达十多行的复杂逻辑，我们怀疑通过 Windows 底层命令提示符去执行超长字符串时，发生了语法截断或转义错误，导致后台进程闪退（Crash）。

**修复尝试：**
1. 废弃了字符串传参的方法。
2. 改为使用 `window.cep.fs.writeFile`，先将拼接好的脚本内容实体化保存到用户目录的 `uilink_updater.ps1` 物理文件中。
3. 改用 `powershell.exe -File uilink_updater.ps1` 直接执行物理文件，彻底规避转义问题。

**结果：**
依然卡住，无前台日志。

### 第三阶段：引入全链路 Extreme Tracing 日志追踪
**假设：**
由于系统完全“假死”且没有任何提示，无法盲猜断点。必须通过极高密度的日志输出（Tracing）来定位是代码在 JS 层抛错，还是 C++ 层静默失败。

**修复尝试：**
在点击事件的每一步（获取路径、删除文件、写入文件、创建进程、读取回传）都加入了详尽的 `logMsg()`。特别是主动捕获了 `window.cep.process.createProcess()` 底层接口的返回值。

**暴露出的日志：**
```text
[20:36:43.799] !!! 致命错误发生在点击处理期间 !!!
[20:36:43.801] ReferenceError: SystemPath is not defined
```

**定位问题与修复：**
发现精简版 `CSInterface.js` 缺失了 `SystemPath` 枚举对象定义。将 `csInterface.getSystemPath(SystemPath.USER_DATA)` 替换为了直接调用底层宿主 API：
`window.__adobe_cep__.getSystemPath("userData")`。

### 第四阶段：解决底层文件操作与进程拉起的系统级报错
在解决 JS 崩溃后，进程跑通了，但新的底层日志抛出了具体错误：
```text
写入脚本结果: 1 (ERR_UNKNOWN)
进程启动失败！错误码: 3 (ERR_INVALID_PARAMS / ERROR_PATH_NOT_FOUND)
```

**问题 1 分析（写入结果：1）：**
由于直接调用 `window.__adobe_cep__`，返回的系统路径带有了浏览器协议头（如 `file:///C:/Users/...`）。C++ 宿主的 `writeFile` 接口不认识 `file:///`，写入失败。
**修复 1：**
加入正则清洗：剥离 `file:///`，转换所有 `/` 为 `\`，并做 URL 解码，将虚拟路径还原为纯正的 Windows 物理路径。

**问题 2 分析（错误码：3）：**
文件写入成功后，`CreateProcess` 报错 3（找不到路径）。
起初误以为是由于使用 `cmd.exe` 嵌套包装 `powershell` 时传递参数引号错误导致，所以去除了外层包装。但随后确认，`CreateProcess` 这个极底层的 C++ 接口**不会去系统环境变量 `PATH` 中寻找可执行程序**。直接传入 `"powershell.exe"` 等同于让程序在当前插件目录寻找，必然找不到。
**修复 2（终极修复）：**
放弃依赖系统环境变量，将调用路径彻底改为系统绝对物理路径：
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`

---

## 续篇：深入排查与架构重构 (二次故障排查)

在经历上述修复后，实机测试中更新流程依旧卡在了不同的节点，通过追加更加极致的日志后，发现了隐藏更深的连环坑，最终促使我们放弃了纯 PowerShell 下载方案，转为 `XHR + PowerShell` 混合模式。

### 第五阶段：日志输出 `[object Object]` 与 API 返回值陷阱
**现象：**
日志输出 `写入脚本结果: 失败码 [object Object]`，且脚本跳过了后续流程。
**分析：**
Adobe CEP 的 `window.cep.fs.writeFile` 和 `deleteFile` 返回的并不是一个普通的数字（Number），而是一个对象 `{ err: 0 }`。代码中直接使用 `if (res === window.cep.fs.NO_ERROR)` 等同于判断 `if ({err:0} === 0)`，永远返回 false，从而导致流程误判为失败。
**修复：**
严格将所有 CEP 文件 IO API 的判断修改为 `if (res.err === window.cep.fs.NO_ERROR)`。

### 第六阶段：PowerShell 中文乱码导致的截断假死
**现象：**
进程成功拉起后，UI 状态卡在“正在解压文件...”，此时捕捉到的日志中出现了大段类似 `X...I...$env...` 的菱形乱码，最终报错并退出。
**分析：**
JS 写入 `.ps1` 文件时默认采用 UTF-8 编码。但由于使用 `powershell.exe -NoProfile` 以最底层方式运行时，其控制台默认代码页往往是 GBK (936)。当脚本运行到包含中文字符（如 `[2/3] 正在解压文件`）的地方时，乱码引发了**词法截断**。这不仅导致后续命令被破坏失效，而且让进程在后台彻底挂起（假死）。此外，脚本中直接拼接的 `$env:TEMP` 在受限环境下未能正常解析也是崩溃原因之一。
**修复：**
1. **纯英文隔离**：将生成的 PowerShell 脚本中所有进度提示的中文字符替换为纯英文（`[1/3] Downloading...`），从根本上免疫代码页乱码导致的词法崩溃。
2. **剔除环境变量**：弃用 `$env:TEMP`，将所有临时文件（`zip`, `dir`）放到通过 CEP 获取的绝对物理路径（`userDataPath`）下。
3. **加入异常拦截**：使用 `try-catch` 包裹整个 PS 脚本逻辑，遇到异常时不再挂起，而是将 `$_.Exception.Message` 强行写回状态文件，以便前端截获并显示红色 ERROR。

### 第七阶段：XHR 替代方案与二进制写入失败 (ERR 2)
**现象：**
既然 PowerShell 的网络和环境十分脆弱，我们将下载任务改回 JavaScript 的 `XMLHttpRequest` 兜底方案。但 XHR 下载完成后，报错 `写入临时压缩包失败，错误码：2`（ERR_INVALID_PARAMS）。
**分析：**
通过 XHR 请求拿到的 zip 是原生的二进制数组（`ArrayBuffer`）。然而，CEP 的 `window.cep.fs.writeFile` 底层是 C++ 接口，它**无法直接接收 JS 的 ArrayBuffer 对象**，传入无法识别的对象会直接报“参数无效（Err 2）”并退出。
**修复（终极方案）：**
1. 在 JS 端编写 `arrayBufferToBase64` 转换器，将下载的 `xhr.response` 转换为 Base64 字符串。
2. 调用 `window.cep.fs.writeFile(path, base64Data, window.cep.encoding.Base64)`，显式声明以 Base64 编码方式落盘。
3. **职责分离**：让 XHR 负责 100% 稳定的网络下载，让 PowerShell 仅负责它擅长的文件解压（`Expand-Archive`）与强制覆盖。

## 最终结论
更新功能的成功，需要完美避开 **路径协议污染**、**API返回对象陷阱**、**PowerShell运行期乱码截断**、以及 **C++与JS的二进制边界** 这四座大山。目前的 `XHR 引擎下载 + Base64 落盘 + 纯英文 PS 脚本解压覆盖` 已被验证为兼容性最高、容错率最强的热更新最终解。