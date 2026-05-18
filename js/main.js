var csInterface = new CSInterface();
var currentDiffData = null; // 保存扫描结果
var currentSliceData = null; // 九宫格数据

function setStatus(msg, type) {
    var statusEl = document.getElementById("status");
    statusEl.innerText = msg;
    statusEl.className = type || "";
}

function logMsg(msg) {
    var logArea = document.getElementById("logArea");
    if (!logArea) return;
    var d = new Date();
    var timeStr = d.getHours() + ":" + d.getMinutes() + ":" + d.getSeconds() + "." + d.getMilliseconds();
    var div = document.createElement("div");
    div.innerText = "[" + timeStr + "] " + msg;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

// ==========================================
// 加载本地版本号展示 (通过 XHR 稳定读取)
// ==========================================
function loadLocalVersionDisplay() {
    logMsg("开始尝试读取本地版本号...");
    try {
        var xhr = new XMLHttpRequest();
        xhr.overrideMimeType("application/json");
        xhr.open("GET", "version.json", false); // 同步请求，确保第一时间读到
        xhr.send(null);
        if (xhr.status === 200 || xhr.status === 0) {
            var dataStr = xhr.responseText;
            // 过滤隐形 BOM 字符
            if (dataStr.charCodeAt(0) === 0xFEFF) {
                dataStr = dataStr.slice(1);
            }
            var lData = JSON.parse(dataStr);
            var ver = lData.version || "未知版本";

            logMsg("✅ 插件版本: v" + ver);

            // 尝试设置窗口标题
            try {
                if (typeof csInterface.setWindowTitle === 'function') {
                    csInterface.setWindowTitle("UI-Link Exporter v" + ver);
                }
            } catch(e) {}

            var botEl = document.getElementById("verDisplay");
            if (botEl) botEl.innerText = "v" + ver;

            var setEl = document.getElementById("settingVerDisplay");
            if (setEl) setEl.innerText = "v" + ver;

        } else {
            logMsg("⚠️ 读取 version.json 失败，状态码: " + xhr.status);
        }
    } catch(e) {
        logMsg("❌ 读取版本异常: " + e.message);
    }
}

// ==========================================
// Github 热更新逻辑 (防缓存的 CDN 原生请求方案)
// ==========================================
var githubOwner_global = "dreamforgame-win";

function checkAutoUpdate(isManual) {
    var githubOwner = githubOwner_global;
    var repoName = "PS-Tool";
    var branch = "main";

    // Github API 获取 releases 的 latest 信息
    var apiUrl = "https://api.github.com/repos/" + githubOwner + "/" + repoName + "/releases/latest?t=" + new Date().getTime();
    var zipDownloadUrl = "https://github.com/" + githubOwner + "/" + repoName + "/archive/refs/heads/" + branch + ".zip";

    if (isManual) logMsg("开始请求远端 Release 版本号...");

    var xhr = new XMLHttpRequest();
    xhr.overrideMimeType("application/json");
    // 不携带凭证，防止复杂网络环境下的跨域被拒
    xhr.withCredentials = false;
    xhr.open("GET", apiUrl, true);

    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                try {
                    // API 返回的是 release 对象，提取 tag_name (例如 "v1.0.8" 或 "1.0.8")
                    var remoteData = JSON.parse(xhr.responseText);
                    var remoteVer = remoteData.tag_name ? remoteData.tag_name.replace("v", "") : null;

                    if(!remoteVer) throw new Error("无法获取 tag_name");

                    var botEl = document.getElementById("verDisplay");
                    var localVersion = botEl ? botEl.innerText.replace("v", "") : "1.0.0";
                    if (localVersion === "-") localVersion = "1.0.0";

                    if (isManual) logMsg("云端版本: " + remoteVer + " | 本地版本: " + localVersion);

                    var btnForce = document.getElementById("btnForceCheckUpdate");
                    if (remoteVer && remoteVer !== localVersion) {
                        if (btnForce) {
                            btnForce.innerText = "🎉 发现新版本 v" + remoteVer + "！点击顶部横幅更新";
                            btnForce.style.background = "#4CAF50";
                            btnForce.style.color = "#fff";
                        }
                        showUpdateBanner(remoteVer, zipDownloadUrl, repoName, branch);
                        setStatus("发现新版本 v" + remoteVer + "，请点击顶部横幅更新", "");
                    } else {
                        if (isManual) {
                            setStatus("当前已经是最新版本 (" + localVersion + ")，无需更新。", "");
                            logMsg("已经是最新版本，无需更新。");
                        }
                        if (btnForce) {
                            btnForce.disabled = false;
                            btnForce.innerText = "🔄 检查更新 (当前已是最新版)";
                            btnForce.style.background = "#444";
                            btnForce.style.color = "#aaa";
                        }
                    }
                } catch(e) {
                    if (isManual) logMsg("解析远端版本 JSON 失败: " + e.message);
                    resetBtnForce();
                }
            } else {
                if (isManual) logMsg("热更检测失败，状态码: " + xhr.status);
                resetBtnForce();
            }
        }
    };

    xhr.onerror = function() {
        if (isManual) logMsg("热更请求遭遇网络异常 (可能需要开启代理)");
        resetBtnForce();
    };

    try {
        xhr.send(null);
    } catch(e) {
        if (isManual) logMsg("发送请求失败: " + e.message);
        resetBtnForce();
    }

    function resetBtnForce() {
        var btnForce = document.getElementById("btnForceCheckUpdate");
        if (btnForce) {
            btnForce.disabled = false;
            btnForce.innerText = "❌ 检测失败，请检查网络";
            btnForce.style.background = "#F44336";
            btnForce.style.color = "#fff";
        }
        setStatus("检测更新失败，请查看日志", "error");
    }
}

function showUpdateBanner(newVersion, zipUrl, repoName, branch) {
    var banner = document.getElementById("updateBanner");
    if (!banner) return;

    banner.style.display = "block";
    document.getElementById("newVersionText").innerText = newVersion;

    banner.onclick = function() {
        banner.innerText = "⏳ 初始化更新引擎中...";
        banner.style.pointerEvents = "none";
        banner.style.background = "#FFC107";

        var localExtPath = csInterface.getSystemPath(SystemPath.EXTENSION);
        var userDataPath = csInterface.getSystemPath(SystemPath.USER_DATA);

        // 状态文件存放在用户目录，以解决 Program Files 无写入权限的问题
        var statusFile = userDataPath + "/uilink_update_status.txt";
        var tmpZip = "$env:TEMP\\uilink_update.zip";
        var tmpDir = "$env:TEMP\\uilink_update_dir";

        // 构建带有详细进度输出的 PowerShell 脚本
        // 注意：将多行合并，并处理好双引号和单引号的转义，确保 PowerShell 引擎能够顺畅执行
        var psScript =
            "$statusFile = '" + statusFile + "'; " +
            "Set-Content -Path $statusFile -Value '【1/3】正在飞速下载更新包...'; " +
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
            "$ProgressPreference = 'SilentlyContinue'; " +
            "Invoke-WebRequest -Uri '" + zipUrl + "' -OutFile '" + tmpZip + "'; " +
            "Set-Content -Path $statusFile -Value '【2/3】正在解压文件...'; " +
            "if(Test-Path '" + tmpDir + "') { Remove-Item -Recurse -Force '" + tmpDir + "' }; " +
            "Expand-Archive -Path '" + tmpZip + "' -DestinationPath '" + tmpDir + "' -Force; " +
            "Set-Content -Path $statusFile -Value '【3/3】准备覆盖文件(如弹出权限框请点“是”)...'; " +
            "$src = Join-Path '" + tmpDir + "' '" + repoName + "-" + branch + "\\*'; " +
            "$dest = '" + localExtPath + "\\'; " +
            // 因为 Start-Process 带有 -Verb RunAs 是以独立窗口拉起的管理员进程，
            // 加上 -Wait 会导致主 PowerShell 脚本一直挂起死锁，所以要去掉 -Wait
            "$argList = '/c \"xcopy \"\"' + $src + '\"\" \"\"' + $dest + '\"\" /s /e /y /c /h & echo SUCCESS > \"\"' + $statusFile + '\"\"\"'; " +
            "Start-Process cmd.exe -ArgumentList $argList -Verb RunAs -WindowStyle Hidden;";

        if (window.cep && window.cep.process && typeof window.cep.process.createProcess === 'function') {
            logMsg("启动 PowerShell 并开启进度监听...");
            // 修改这里：增加 -NoProfile 参数，加快启动速度，并且只执行一次
            window.cep.process.createProcess("powershell.exe", "-NoProfile", "-Command", psScript);

            var checkCount = 0;
            var lastProgressTxt = "";
            // 每 1000ms 读取一次 statusFile 来刷新界面进度
            var checkInterval = setInterval(function() {
                checkCount++;
                var result = window.cep.fs.readFile(statusFile);
                if (result.err === window.cep.fs.NO_ERROR) {
                    var txt = result.data.trim();
                    if (txt.indexOf("SUCCESS") !== -1) {
                        clearInterval(checkInterval);
                        banner.innerText = "✅ 更新完成！正在重载面板...";
                        banner.style.background = "#4CAF50";

                        // 清理状态文件 (防止卡死)
                        window.cep.fs.deleteFile(statusFile);

                        setTimeout(function() { window.location.reload(true); }, 1500);
                    } else if (txt && txt !== lastProgressTxt) {
                        banner.innerText = "⏳ " + txt;
                        logMsg("进度: " + txt);
                        lastProgressTxt = txt;
                    }
                } else {
                    if (checkCount % 2 === 0) { // 每2秒打一次日志防刷屏
                        logMsg("等待状态文件生成中...");
                    }
                }
            }, 1000);

            // 超时保底机制 (45秒)
            setTimeout(function() {
                clearInterval(checkInterval);
                if (banner.innerText.indexOf("✅") === -1) {
                    banner.innerText = "⚠️ 更新可能还在后台进行或被 UAC 拦截，请稍后手动重启 PS";
                    banner.style.background = "#FF9800";
                    banner.style.pointerEvents = "auto";
                }
            }, 45000);

        } else {
            // 兜底方案：使用 XMLHttpRequest 下载 zip
            logMsg("尝试使用 XMLHttpRequest 下载...");
            var xhr = new XMLHttpRequest();
            xhr.open("GET", zipUrl, true);
            xhr.responseType = "arraybuffer"; // 使用 arraybuffer 处理二进制文件
            xhr.onload = function() {
                if (xhr.status === 200) {
                    banner.innerText = "⏳ 正在解压并覆盖文件...";
                    logMsg("下载完成，写入文件...");

                    var result = window.cep.fs.writeFile(tmpZip, xhr.response);
                    if (result === window.cep.fs.NO_ERROR) {
                        // 依然需要 PowerShell 来解压，但只需简单的解压命令
                        var psExtract = "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
                                        "Expand-Archive -Path '" + tmpZip + "' -DestinationPath '" + tmpDir + "' -Force; " +
                                        "$src = Join-Path '" + tmpDir + "' '" + repoName + "-" + branch + "\\*'; " +
                                        "$dest = '" + localExtPath + "\\'; " +
                                        "$argList = '/c \"xcopy \"\"' + $src + '\"\" \"\"' + $dest + '\"\" /s /e /y /c /h & echo SUCCESS > \"\"' + statusFile + '\"\"\"'; " +
                                        "Start-Process cmd.exe -ArgumentList $argList -Verb RunAs -WindowStyle Hidden;";
                        window.cep.process.createProcess("powershell.exe", "-NoProfile", "-Command", psExtract);

                        // 开始同样的轮询
                        startStatusPolling(banner, statusFile, checkInterval, checkCount, lastProgressTxt);
                    } else {
                        logMsg("写入临时压缩包失败：" + result);
                        showManualDownload(banner);
                    }
                } else {
                     logMsg("XHR 下载失败：" + xhr.status);
                     showManualDownload(banner);
                }
            };
            xhr.onerror = function() {
                logMsg("XHR 下载发生网络错误。");
                showManualDownload(banner);
            }
            xhr.send();
        }
    };
}

function startStatusPolling(banner, statusFile, checkInterval, checkCount, lastProgressTxt) {
    checkInterval = setInterval(function() {
        checkCount++;
        var result = window.cep.fs.readFile(statusFile);
        if (result.err === window.cep.fs.NO_ERROR) {
            var txt = result.data.trim();
            if (txt.indexOf("SUCCESS") !== -1) {
                clearInterval(checkInterval);
                banner.innerText = "✅ 更新完成！正在重载面板...";
                banner.style.background = "#4CAF50";

                // 清理状态文件 (防止卡死)
                window.cep.fs.deleteFile(statusFile);

                setTimeout(function() { window.location.reload(true); }, 1500);
            } else if (txt && txt !== lastProgressTxt) {
                banner.innerText = "⏳ " + txt;
                logMsg("进度: " + txt);
                lastProgressTxt = txt;
            }
        } else {
            if (checkCount % 2 === 0) { // 每2秒打一次日志防刷屏
                logMsg("等待状态文件生成中...");
            }
        }
    }, 1000);

    // 超时保底机制 (45秒)
    setTimeout(function() {
        clearInterval(checkInterval);
        if (banner.innerText.indexOf("✅") === -1) {
            banner.innerText = "⚠️ 更新可能还在后台进行或被 UAC 拦截，请稍后手动重启 PS";
            banner.style.background = "#FF9800";
            banner.style.pointerEvents = "auto";
        }
    }, 45000);
}

function showManualDownload(banner) {
     banner.innerText = "❌ 你的 PS 环境不支持静默更新，请手动下载！";
     banner.style.background = "#F44336";
     setTimeout(function() {
         window.cep.util.openURLInDefaultBrowser("https://github.com/" + githubOwner_global + "/PS-Tool/releases");
     }, 1500);
}

document.addEventListener("DOMContentLoaded", function() {

    // 首先清空一次 log，防止重叠
    var logArea = document.getElementById("logArea");
    if(logArea) logArea.innerHTML = "";

    // 立即执行本地版本显示
    try { loadLocalVersionDisplay(); } catch(e) { logMsg("调用版本显示失败：" + e); }

    // 初始化时检测热更
    try { setTimeout(checkAutoUpdate, 1500); } catch(e) { logMsg("调用热更检测失败：" + e); }

    // ==========================================
    // 0. Tab 切换逻辑
    // ==========================================
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            // 移除所有 active
            tabBtns.forEach(function(b) { b.classList.remove('active'); });
            tabContents.forEach(function(c) { c.classList.remove('active'); });
            // 添加 active
            btn.classList.add('active');
            var targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');

            // 切换到九宫格面板时，如果已有图层信息，自动触发加载
            if (targetId === "tab-slice" && currentLayerInfo) {
                document.getElementById("btnFetchSlice").click();
            }
        });
    });

    // ==========================================
    // 1. 属性命名模块逻辑 (模块化重构版)
    // ==========================================
    var lastLayerNameForSync = "";
    var currentLayerInfo = null;

    var uiNaming = {
        root: document.getElementById("moduleRootName"),
        base: document.getElementById("moduleBaseName"),
        output: document.getElementById("moduleOutputType"),
        comp: document.getElementById("moduleCompType"),
        w: document.getElementById("moduleSizeW"),
        h: document.getElementById("moduleSizeH"),
        real: document.getElementById("lblRealSize"),
        slice: document.getElementById("moduleSliceDisplay"),
        exportChk: document.getElementById("chkExportEnable"),
        prevExport: document.getElementById("previewExport"),
        prevProject: document.getElementById("previewProject"),
        prevUnity: document.getElementById("previewUnity"),
        btnSaveModule: document.getElementById("btnSaveModule"),
        apply: document.getElementById("btnApplyModularName"),
        
        // 增量：图集前缀
        groupPrefix: document.getElementById("groupAtlasPrefix"),
        atlasPrefix: document.getElementById("moduleAtlasPrefix"),
        btnManagePrefix: document.getElementById("btnManagePrefix"),
        prefixMenu: document.getElementById("prefixMenu"),
        prefixList: document.getElementById("prefixList"),
        btnAddPrefix: document.getElementById("btnAddPrefix")
    };

    // 轮询同步逻辑
    setInterval(function() {
        var isNamingActive = document.getElementById("tab-naming").classList.contains("active");
        var isSliceActive = document.getElementById("tab-slice").classList.contains("active");
        if (!isNamingActive && !isSliceActive) return;

        csInterface.evalScript("getActiveLayerInfo()", function(result) {
            if (result.indexOf("ERROR") === 0) return;
            try {
                var info = JSON.parse(result);
                if (info.fullName === lastLayerNameForSync) return;

                lastLayerNameForSync = info.fullName;
                currentLayerInfo = info;
                console.log("Synced Info:", info);

                // 无论在哪一个页签，只要图层发生切换，都必须优先同步图层自身的数据到输入框！
                if (info.isExport) {
                    uiNaming.root.value = info.moduleName;
                    localStorage.setItem("UILink_LastModuleName", info.moduleName);
                    uiNaming.base.value = info.baseName;
                    
                    // 解析输出类型和图集前缀
                    var outParts = info.outputType.split(":");
                    uiNaming.output.value = outParts[0];
                    if (outParts[0] === "atlas") {
                        var pfx = outParts.length > 1 ? outParts[1] : "common";
                        // 如果下拉列表里没有这个前缀，临时加进去
                        ensurePrefixExists(pfx);
                        uiNaming.atlasPrefix.value = pfx;
                    }

                    uiNaming.comp.value = info.compType;
                    uiNaming.exportChk.checked = true;
                } else {
                    // 如果是未命名图层，尝试读取记忆，否则使用文件名
                    var lastModule = localStorage.getItem("UILink_LastModuleName");
                    uiNaming.root.value = lastModule || info.docName;
                    uiNaming.base.value = info.baseName;
                    uiNaming.exportChk.checked = false;
                }
                
                // 根据输出类型控制显隐
                uiNaming.groupPrefix.style.display = (uiNaming.output.value === "atlas") ? "flex" : "none";

                uiNaming.w.value = info.width || info.realWidth;
                uiNaming.h.value = info.height || info.realHeight;
                uiNaming.real.innerText = "(" + info.realWidth + "x" + info.realHeight + ")";
                uiNaming.slice.innerText = info.sliceSuffix || "无";

                updatePreview();

                if (isSliceActive) {
                    // 如果当前在九宫格页面，自动触发读取（此时读取到的 w 和 h 就是最新鲜的啦！）
                    document.getElementById("btnFetchSlice").click();
                }
            } catch(e) {}
        });
    }, 1000);

    // 实时预览更新
    function updatePreview() {
        var root = uiNaming.root.value.trim();
        var base = uiNaming.base.value.trim();
        var output = uiNaming.output.value;
        var comp = uiNaming.comp.value;
        var isExp = uiNaming.exportChk.checked;

        if (!base) {
            uiNaming.prevExport.innerText = "-";
            uiNaming.prevProject.innerText = "-";
            return;
        }

        // 1. 导出文件命名 (PNG 文件名)
        var expName = "";
        var finalOutStr = output;
        if (output === "atlas") {
            var pfx = uiNaming.atlasPrefix.value || "common";
            expName = pfx + "@" + base;
            finalOutStr = "atlas:" + pfx;
        }
        else expName = "tex_" + base;
        uiNaming.prevExport.innerText = expName + ".png";

        // 2. 工程命名 (Unity Prefab/Asset 使用)
        var prefix = "";
        switch(comp) {
            case "image": prefix = "sp_"; break;
            case "button": prefix = "btn_"; break;
            case "texture": prefix = "tex_"; break;
            case "slider": prefix = "sli_"; break;
            case "dropdown": prefix = "drop_"; break;
            case "toggle": prefix = "tog_"; break;
        }
        var unityName = prefix + root + "_" + base;
        uiNaming.prevUnity.innerText = unityName;

        // 3. PS 图层命名 (PS 内部存储全量元数据的格式)
        var w = parseInt(uiNaming.w.value) || (currentLayerInfo ? currentLayerInfo.realWidth : 0);
        var h = parseInt(uiNaming.h.value) || (currentLayerInfo ? currentLayerInfo.realHeight : 0);
        var slice = (currentLayerInfo && currentLayerInfo.sliceSuffix) ? currentLayerInfo.sliceSuffix : "0,0,0,0";
        var exportFlag = isExp ? "1" : "0";

        var projName = root + "_" + base + "|" + finalOutStr + "|" + comp + "|" + w + "x" + h + "|" + slice + "|" + exportFlag;
        uiNaming.prevProject.innerText = projName;
    }

    // 手动保存/锁定模块名
    uiNaming.btnSaveModule.addEventListener("click", function() {
        var currentRoot = uiNaming.root.value.trim();
        if (currentRoot) {
            localStorage.setItem("UILink_LastModuleName", currentRoot);
            setStatus("模块名已锁定: " + currentRoot, "");
        }
    });

    // 监听输入变化
    [uiNaming.root, uiNaming.base, uiNaming.output, uiNaming.comp, uiNaming.exportChk, uiNaming.w, uiNaming.h, uiNaming.atlasPrefix].forEach(function(el) {
        if (!el) return;
        el.addEventListener("input", function() {
            updatePreview();
            if ((el === uiNaming.w || el === uiNaming.h) && typeof window.refreshCanvasDimensions === "function") {
                window.refreshCanvasDimensions();
            }
        });
        el.addEventListener("change", function() {
            if (el === uiNaming.output) {
                uiNaming.groupPrefix.style.display = (this.value === "atlas") ? "flex" : "none";
            }
            updatePreview();
            if ((el === uiNaming.w || el === uiNaming.h) && typeof window.refreshCanvasDimensions === "function") {
                window.refreshCanvasDimensions();
            }
        });
    });

    // 输出类型与组件类型的联动
    uiNaming.output.addEventListener("change", function() {
        if (this.value === "texture") {
            uiNaming.comp.value = "texture";
        } else if (uiNaming.comp.value === "texture") {
            uiNaming.comp.value = "image";
        }
        updatePreview();
    });
    uiNaming.apply.addEventListener("click", function() {
        if (!currentLayerInfo) {
            // 如果轮询还没拿到信息，尝试手动触发一次
            setStatus("正在尝试连接图层...", "warning");
            csInterface.evalScript("getActiveLayerInfo()", function(result) {
                console.log("Manual Sync Result:", result);
                if (result.indexOf("ERROR") === 0) {
                    setStatus("请先在 PS 中选中一个图层", "error");
                } else {
                    try {
                        currentLayerInfo = JSON.parse(result);
                        executeRename();
                    } catch(e) { 
                        setStatus("解析数据失败", "error"); 
                        console.error("Parse Error:", e, "Raw Result:", result);
                    }
                }
            });
        } else {
            executeRename();
        }

        function executeRename() {
            var finalOutputType = uiNaming.output.value;
            if (finalOutputType === "atlas") {
                finalOutputType = "atlas:" + (uiNaming.atlasPrefix.value || "common");
            }
            
            var applyInfo = {
                moduleName: uiNaming.root.value.trim(),
                baseName: uiNaming.base.value.trim(),
                // 如果用户没填，则取真实宽高
                width: parseInt(uiNaming.w.value) || currentLayerInfo.realWidth,
                height: parseInt(uiNaming.h.value) || currentLayerInfo.realHeight,
                outputType: finalOutputType,
                compType: uiNaming.comp.value,
                isExport: uiNaming.exportChk.checked,
                sliceSuffix: currentLayerInfo.sliceSuffix || "0,0,0,0"
            };

            if (!applyInfo.baseName) {
                setStatus("基础名称不能为空！", "error");
                return;
            }

            setStatus("正在应用命名规则...", "warning");
            var jsonStr = JSON.stringify(applyInfo);
            // 对 JSON 字符串进行简单的转义，防止单引号破坏 evalScript
            var escapedJson = jsonStr.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            
            csInterface.evalScript("applyLayerRename('" + escapedJson + "')", function(res) {
                if (res.indexOf("ERROR") === 0) {
                    setStatus(res, "error");
                    logMsg("重命名失败: " + res);
                } else {
                    setStatus("重命名成功！", "");
                    // 重命名成功后自动记忆当前的模块名
                    localStorage.setItem("UILink_LastModuleName", applyInfo.moduleName);
                    lastLayerNameForSync = res;
                    updatePreview();
                    logMsg("已重命名为: " + res);
                }
            });
        }
    });

    // ==========================================
    // 2. 九宫格编辑器逻辑
    // ==========================================
    var btnFetchSlice = document.getElementById("btnFetchSlice");
    var sliceEditorArea = document.getElementById("sliceEditorArea");
    var canvasWrapper = document.getElementById("canvasWrapper");
    var canvasBox = document.getElementById("canvasBox");
    var previewImage = document.getElementById("previewImage");
    var canvasResizer = document.getElementById("canvasResizer");

    // 缩放与平移变量
    var currentZoom = 1;
    var panX = 0, panY = 0;
    var isPanning = false;
    var startPanX = 0, startPanY = 0;
    var isResizingHeight = false;
    var startResizeY = 0;
    var startHeight = 0;

    // 从本地存储恢复高度
    var savedHeight = localStorage.getItem("UILink_SliceCanvasHeight") || "300";
    canvasWrapper.style.height = savedHeight + "px";

    var guides = {
        left: document.getElementById("gLeft"),
        right: document.getElementById("gRight"),
        top: document.getElementById("gTop"),
        bottom: document.getElementById("gBottom")
    };
    var inputs = {
        left: document.getElementById("valLeft"),
        right: document.getElementById("valRight"),
        top: document.getElementById("valTop"),
        bottom: document.getElementById("valBottom")
    };

    canvasResizer.addEventListener("mousedown", function(e) {
        isResizingHeight = true;
        startResizeY = e.clientY;
        startHeight = canvasWrapper.offsetHeight;
        document.body.style.cursor = "ns-resize";
        e.preventDefault();
    });

    btnFetchSlice.addEventListener("click", function() {
        setStatus("正在获取图层预览...", "warning");
        logMsg("获取图层预览...");
        csInterface.evalScript("getActiveLayerPreview()", function(result) {
            if (result.indexOf("ERROR:") === 0) {
                setStatus(result, "error");
                return;
            }
            try {
                var data = JSON.parse(result);
                previewImage.onload = function() {
                    sliceEditorArea.style.display = "block";
                    currentSliceData = {
                        realW: (currentLayerInfo && currentLayerInfo.width) || data.width,
                        realH: (currentLayerInfo && currentLayerInfo.height) || data.height,
                        imgW: data.width,  // 逻辑宽 (Bounds)
                        imgH: data.height, // 逻辑高 (Bounds)
                        boxW: 0, 
                        boxH: 0
                    };

                    window.refreshCanvasDimensions = function() {
                        if (!currentSliceData) return;
                        var newW = parseInt(uiNaming.w.value) || currentSliceData.imgW;
                        var newH = parseInt(uiNaming.h.value) || currentSliceData.imgH;
                        
                        currentSliceData.realW = newW;
                        currentSliceData.realH = newH;
                        
                        // 智能边界自适应 (Auto-Fit)
                        var wrapperW = canvasWrapper.clientWidth || 500;
                        var wrapperH = canvasWrapper.clientHeight || 300;
                        
                        var maxW = Math.max(currentSliceData.imgW, newW);
                        var maxH = Math.max(currentSliceData.imgH, newH);
                        
                        var fitScale = Math.min((wrapperW * 0.9) / maxW, (wrapperH * 0.9) / maxH);
                        
                        // 设定显示尺寸 (此时 imgW/imgH 与图片实际比例已对齐)
                        var boxW = currentSliceData.imgW * fitScale;
                        var boxH = currentSliceData.imgH * fitScale;
                        currentSliceData.boxW = boxW;
                        currentSliceData.boxH = boxH;
                        
                        canvasBox.style.width = boxW + "px";
                        canvasBox.style.height = boxH + "px";

                        previewImage.style.display = "block";
                        previewImage.style.width = "100%";
                        previewImage.style.height = "100%";
                        previewImage.style.position = "static";
                        previewImage.style.transform = "none";
                        previewImage.style.objectFit = "fill"; // 强制填满容器，容器比例已经是正确的了
                        
                        var stdBounds = document.getElementById("standardBounds");
                        var scaleX = fitScale;
                        var scaleY = fitScale;
                        
                        if (uiNaming.w.value || uiNaming.h.value) {
                            stdBounds.style.display = "block";
                            stdBounds.style.width = (newW * scaleX) + "px";
                            stdBounds.style.height = (newH * scaleY) + "px";
                            stdBounds.style.left = "50%";
                            stdBounds.style.top = "50%";
                            stdBounds.style.transform = "translate(-50%, -50%)";
                        } else {
                            stdBounds.style.display = "none";
                        }
                        
                        // 自动整体居中
                        panX = (wrapperW - boxW) / 2;
                        panY = (wrapperH - boxH) / 2;
                        if (typeof updateTransform === "function") updateTransform();
                        
                        if (typeof updateGuidesFromInputs === "function") updateGuidesFromInputs();
                        if (typeof updateCropPreview === "function") updateCropPreview();
                    };

                    window.refreshCanvasDimensions();
                    document.getElementById("zoomSlider").value = 1;
                    document.getElementById("zoomLabel").innerText = "100%";
                    initGuides();
                    updateCropPreview(); // 初始化显示裁剪预览
                    setStatus("请拖动参考线设置切图区域", "");
                };
                previewImage.src = "data:image/png;base64," + data.b64;
            } catch(e) {
                setStatus("解析预览失败: " + e, "error");
            }
        });
    });

    function updateTransform() {
        canvasBox.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + currentZoom + ")";
        var invScale = 1 / currentZoom;
        guides.left.style.transform = "scaleX(" + invScale + ")";
        guides.right.style.transform = "scaleX(" + invScale + ")";
        guides.top.style.transform = "scaleY(" + invScale + ")";
        guides.bottom.style.transform = "scaleY(" + invScale + ")";
    }

    function setZoom(z) {
        currentZoom = Math.max(0.2, Math.min(5, z));
        document.getElementById("zoomSlider").value = currentZoom;
        document.getElementById("zoomLabel").innerText = Math.round(currentZoom * 100) + "%";
        updateTransform();
    }

    document.getElementById("zoomSlider").addEventListener("input", function() { setZoom(parseFloat(this.value)); });
    document.getElementById("btnZoomIn").addEventListener("click", function() { setZoom(currentZoom + 0.2); });
    document.getElementById("btnZoomOut").addEventListener("click", function() { setZoom(currentZoom - 0.2); });

    document.getElementById("btnRecenter").addEventListener("click", function() {
        if (!currentSliceData) return;
        panX = 0; panY = 0;
        var fitZoomW = canvasWrapper.clientWidth / currentSliceData.boxW;
        var fitZoomH = canvasWrapper.clientHeight / currentSliceData.boxH;
        var bestZoom = Math.min(fitZoomW, fitZoomH) * 0.9;
        setZoom(bestZoom > 0 ? bestZoom : 1);
    });

    document.getElementById("btnResetGuides").addEventListener("click", function() {
        if (!currentSliceData) return;
        inputs.left.value = 0; inputs.right.value = 0;
        inputs.top.value = 0; inputs.bottom.value = 0;
        updateGuidesFromInputs();
    });

    canvasWrapper.addEventListener("wheel", function(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(currentZoom + delta);
    });

    canvasWrapper.addEventListener("mousedown", function(e) {
        if (e.target.id === "previewImage" || e.target.id === "canvasWrapper" || e.target.id === "canvasBox") {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
        }
    });

    // =================拖拽参考线逻辑 (重新补回)=================
    var isDragging = false;
    var activeGuide = null;

    Object.values(guides).forEach(function(g) {
        if (!g) return;
        g.addEventListener('mousedown', function(e) {
            isDragging = true;
            activeGuide = g;
            g.classList.add('dragging');
            e.stopPropagation(); // 阻止平移触发
        });
    });

    document.addEventListener("mousemove", function(e) {
        if (isResizingHeight) {
            var delta = e.clientY - startResizeY;
            var newHeight = Math.max(150, Math.min(800, startHeight + delta));
            canvasWrapper.style.height = newHeight + "px";
            localStorage.setItem("UILink_SliceCanvasHeight", newHeight);
            return;
        }
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            updateTransform();
            return;
        }

        if (!isDragging || !activeGuide || !currentSliceData) return;

        var rect = canvasBox.getBoundingClientRect();
        var scaleX = currentSliceData.boxW / currentSliceData.imgW;
        var scaleY = currentSliceData.boxH / currentSliceData.imgH;

        // 获取鼠标相对于容器左上角的坐标（缩放后）
        var x = (e.clientX - rect.left) / currentZoom;
        var y = (e.clientY - rect.top) / currentZoom;

        // 蓝框相对于容器左上角的偏移量
        var offsetX = (currentSliceData.boxW - currentSliceData.realW * scaleX) / 2;
        var offsetY = (currentSliceData.boxH - currentSliceData.realH * scaleY) / 2;

        if (activeGuide.id === 'gLeft' || activeGuide.id === 'gRight') {
            // 限制在蓝框范围内
            x = Math.max(offsetX, Math.min(x, offsetX + currentSliceData.realW * scaleX));
            activeGuide.style.left = x + 'px';

            var xL = parseFloat(guides.left.style.left) || offsetX;
            var xR = parseFloat(guides.right.style.left) || (offsetX + currentSliceData.realW * scaleX);

            var valL = (Math.min(xL, xR) - offsetX) / scaleX;
            var valR = (Math.max(xL, xR) - offsetX) / scaleX;

            inputs.left.value = Math.round(valL);
            inputs.right.value = Math.round(currentSliceData.realW - valR);
        } else {
            // 限制在蓝框范围内
            y = Math.max(offsetY, Math.min(y, offsetY + currentSliceData.realH * scaleY));
            activeGuide.style.top = y + 'px';

            var yT = parseFloat(guides.top.style.top) || offsetY;
            var yB = parseFloat(guides.bottom.style.top) || (offsetY + currentSliceData.realH * scaleY);

            var valT = (Math.min(yT, yB) - offsetY) / scaleY;
            var valB = (Math.max(yT, yB) - offsetY) / scaleY;

            inputs.top.value = Math.round(valT);
            inputs.bottom.value = Math.round(currentSliceData.realH - valB);
        }

        updateCropPreview();
    });

    document.addEventListener('mouseup', function(e) {
        if (isResizingHeight) {
            isResizingHeight = false;
            document.body.style.cursor = "default";
        }
        if (isPanning) {
            isPanning = false;
        }
        if (isDragging && activeGuide) {
            activeGuide.classList.remove('dragging');
            isDragging = false;
            activeGuide = null;
        }
    });

    function initGuides() {
        logMsg("正在初始化参考线位置...");
        if (!currentSliceData) return;
        var w = currentSliceData.realW;
        var h = currentSliceData.realH;
        
        // 尝试从当前图层信息中读取已保存的九宫格数据
        var savedSlice = (currentLayerInfo && currentLayerInfo.sliceSuffix) ? currentLayerInfo.sliceSuffix : "0,0,0,0";
        var parts = savedSlice.split(",");
        
        // 严格遵循已保存数据，如果没有或为 0，则参考线也归零
        if (parts.length === 4) {
            inputs.top.value = parseInt(parts[0]) || 0;
            inputs.bottom.value = parseInt(parts[1]) || 0;
            inputs.left.value = parseInt(parts[2]) || 0;
            inputs.right.value = parseInt(parts[3]) || 0;
            logMsg("已初始化九宫格数据: " + savedSlice);
        } else {
            inputs.left.value = 0;
            inputs.right.value = 0;
            inputs.top.value = 0;
            inputs.bottom.value = 0;
            logMsg("未找到数据，参考线归零。");
        }
        
        updateGuidesFromInputs();
        updateCropPreview();
    }

    function updateCropPreview() {
        var resContainer = document.getElementById("cropPreviewResult");
        if (!currentSliceData || !previewImage.src) {
            logMsg("等待图片数据以生成预览...", "warning");
            return;
        }

        var t = Math.max(0, parseInt(inputs.top.value) || 0);
        var b = Math.max(0, parseInt(inputs.bottom.value) || 0);
        var l = Math.max(0, parseInt(inputs.left.value) || 0);
        var r = Math.max(0, parseInt(inputs.right.value) || 0);

        // 规范化：如果单边为0，同轴的另一边也强制归零
        if (t === 0 || b === 0) { t = 0; b = 0; }
        if (l === 0 || r === 0) { l = 0; r = 0; }

        var w = currentSliceData.realW;
        var h = currentSliceData.realH;

        // 计算预览图的总宽高
        var finalW = (l + r > 0) ? (l + r) : w;
        var finalH = (t + b > 0) ? (t + b) : h;

        resContainer.style.width = finalW + "px";
        resContainer.style.height = finalH + "px";
        resContainer.innerHTML = ""; // 清空旧切片

        var src = previewImage.src;
        
        // 计算实体预览图在标准蓝框中的相对偏移（假设居中对齐）
        var imgX = (w - currentSliceData.imgW) / 2;
        var imgY = (h - currentSliceData.imgH) / 2;

        // 辅助函数：创建切片 (bx, by 是切片在标准蓝框中的绝对起始坐标)
        function createPart(px, py, pw, ph, bx, by) {
            if (pw <= 0 || ph <= 0) return;
            var div = document.createElement("div");
            div.style.position = "absolute";
            div.style.left = px + "px";
            div.style.top = py + "px";
            div.style.width = pw + "px";
            div.style.height = ph + "px";
            div.style.backgroundImage = "url(" + src + ")";
            // 严格按预览图原本的物理尺寸渲染
            div.style.backgroundSize = currentSliceData.imgW + "px " + currentSliceData.imgH + "px";
            div.style.backgroundRepeat = "no-repeat"; // 禁止平铺，露出透明占位
            // 核心补偿：将实体图偏移量叠加到切片的相对位置上
            div.style.backgroundPosition = (imgX - bx) + "px " + (imgY - by) + "px";
            resContainer.appendChild(div);
        }

        if (l + r > 0 && t + b > 0) {
            // 情况 A：四角合一预览 (9宫格)
            createPart(0, 0, l, t, 0, 0); // 左上
            createPart(l, 0, r, t, w - r, 0); // 右上
            createPart(0, t, l, b, 0, h - b); // 左下
            createPart(l, t, r, b, w - r, h - b); // 右下
        } else if (l + r > 0) {
            // 情况 B：水平三宫格 (保留左右)
            createPart(0, 0, l, h, 0, 0); // 左侧全高
            createPart(l, 0, r, h, w - r, 0); // 右侧全高
        } else if (t + b > 0) {
            // 情况 C：垂直三宫格 (保留上下)
            createPart(0, 0, w, t, 0, 0); // 顶部全宽
            createPart(0, t, w, b, 0, h - b); // 底部全宽
        } else {
            // 情况 D：原图不裁剪
            createPart(0, 0, w, h, 0, 0);
        }
    }

    function updateGuidesFromInputs() {
        if (!currentSliceData) return;

        // 获取并清洗输入值（确保是正整数 >= 0）
        var l = Math.max(0, parseInt(inputs.left.value) || 0);
        var r = Math.max(0, parseInt(inputs.right.value) || 0);
        var t = Math.max(0, parseInt(inputs.top.value) || 0);
        var b = Math.max(0, parseInt(inputs.bottom.value) || 0);

        // 防御性处理：左右或上下相加不能超过真实尺寸
        if (l + r > currentSliceData.realW) {
            r = Math.max(0, currentSliceData.realW - l);
            inputs.right.value = r;
        }
        if (t + b > currentSliceData.realH) {
            b = Math.max(0, currentSliceData.realH - t);
            inputs.bottom.value = b;
        }

        inputs.left.value = l;
        inputs.right.value = r;
        inputs.top.value = t;
        inputs.bottom.value = b;

        var scaleX = currentSliceData.boxW / currentSliceData.imgW;
        var scaleY = currentSliceData.boxH / currentSliceData.imgH;

        var offsetX = (currentSliceData.boxW - currentSliceData.realW * scaleX) / 2;
        var offsetY = (currentSliceData.boxH - currentSliceData.realH * scaleY) / 2;
 
        guides.left.style.left = (offsetX + l * scaleX) + "px";
        guides.right.style.left = (offsetX + (currentSliceData.realW - r) * scaleX) + "px";
        guides.top.style.top = (offsetY + t * scaleY) + "px";
        guides.bottom.style.top = (offsetY + (currentSliceData.realH - b) * scaleY) + "px";

        updateCropPreview();
    }

    var btnApplySlice = document.getElementById("btnApplySlice");
    btnApplySlice.addEventListener("click", function() {
        var t = Math.max(0, parseInt(inputs.top.value) || 0);
        var b = Math.max(0, parseInt(inputs.bottom.value) || 0);
        var l = Math.max(0, parseInt(inputs.left.value) || 0);
        var r = Math.max(0, parseInt(inputs.right.value) || 0);

        setStatus("正在应用...", "warning");
        var script = "applyNineSliceCrop(" + t + "," + b + "," + l + "," + r + ")";
        csInterface.evalScript(script, function(res) {
            if (res.indexOf("ERROR") === 0) setStatus(res, "error");
            else {
                setStatus("九宫格数据已写入图层并更新命名！", "");
                // 立即触发一次同步，更新属性命名页签的显示
                lastLayerNameForSync = res; // 阻止 setInterval 重置 UI，因为我们已经拿到最新的了
                csInterface.evalScript("getActiveLayerInfo()", function(newInfo) {
                    try {
                        currentLayerInfo = JSON.parse(newInfo);
                        // 同步更新属性命名页签中的九宫格显示文字
                        if (uiNaming && uiNaming.slice) {
                            uiNaming.slice.innerText = currentLayerInfo.sliceSuffix || "0,0,0,0";
                        }
                        if (typeof updatePreview === "function") updatePreview();
                    } catch(e) {}
                });
            }
        });
    });

    // ==========================================
    // 3. 扫描与增量导出功能 (双目录版)
    // ==========================================
    var btnSetJsonFolder = document.getElementById("btnSetJsonFolder");
    var txtJsonPath = document.getElementById("txtJsonPath");
    var btnSetImageFolder = document.getElementById("btnSetImageFolder");
    var txtImagePath = document.getElementById("txtImagePath");
    
    var btnScan = document.getElementById("btnScan");
    var btnExport = document.getElementById("btnExport");
    var diffList = document.getElementById("diffList");
    var chkSelectAll = document.getElementById("chkSelectAll");
    var diffSummary = document.getElementById("diffSummary");

    // 初始化读取本地配置的路径
    var savedJsonPath = localStorage.getItem("UILink_JsonPath") || "";
    if (savedJsonPath) {
        savedJsonPath = savedJsonPath.replace(/\\/g, "/");
        txtJsonPath.innerText = savedJsonPath;
    }

    var savedImagePath = localStorage.getItem("UILink_ImagePath") || "";
    if (savedImagePath) {
        savedImagePath = savedImagePath.replace(/\\/g, "/");
        txtImagePath.innerText = savedImagePath;
    }

    function checkFoldersAndAlert() {
        diffList.innerHTML = '<div style="text-align:center; padding:30px; color:#666; font-size:11px;">目录已更改，请重新扫描</div>';
        btnExport.disabled = true;
    }

    // 点击设置 JSON 目录
    btnSetJsonFolder.addEventListener("click", function() {
        csInterface.evalScript("selectOutputFolderDialog()", function(result) {
            if (result !== "CANCELLED" && result.indexOf("ERROR") === -1) {
                savedJsonPath = result.replace(/\\/g, "/");
                localStorage.setItem("UILink_JsonPath", savedJsonPath);
                txtJsonPath.innerText = savedJsonPath;
                setStatus("已更新 JSON 存放目录！", "");
                checkFoldersAndAlert();
            }
        });
    });

    // 点击设置 图片 目录
    btnSetImageFolder.addEventListener("click", function() {
        csInterface.evalScript("selectOutputFolderDialog()", function(result) {
            if (result !== "CANCELLED" && result.indexOf("ERROR") === -1) {
                savedImagePath = result.replace(/\\/g, "/");
                localStorage.setItem("UILink_ImagePath", savedImagePath);
                txtImagePath.innerText = savedImagePath;
                setStatus("已更新图片存放目录！", "");
                checkFoldersAndAlert();
            }
        });
    });

    btnScan.addEventListener("click", function() {
        if (!savedJsonPath || !savedImagePath) {
            setStatus("请先点击上方按钮配置好【JSON】和【图片】目录", "error");
            return;
        }

        setStatus("正在扫描文档对比变动，请稍候...", "warning");
        btnScan.disabled = true;

        var payload = JSON.stringify({
            jsonFolder: savedJsonPath,
            imageFolder: savedImagePath
        });

        setTimeout(function() {
            // 将前端保存的路径以 payload 传给后台
            csInterface.evalScript("scanChanges('" + payload + "')", function(result) {
                btnScan.disabled = false;
                if (result.indexOf("ERROR:") === 0) {
                    setStatus(result, "error");
                    return;
                }

                try {
                    currentDiffData = JSON.parse(result);
                    renderDiffList(currentDiffData);
                    btnExport.disabled = currentDiffData.items.length === 0;

                    if (currentDiffData.isFirstTime) {
                        setStatus("首次导出：由于目录中不存在旧数据，所有图层均标记为[新增]。", "warning");
                    } else {
                        setStatus("扫描完成！找到 " + currentDiffData.items.length + " 个可导出项。", "");
                    }
                } catch(e) {
                    setStatus("解析扫描结果失败: " + e, "error");
                }
            });
        }, 100);
    });

    function renderDiffList(data) {
        diffList.innerHTML = "";
        var total = data.items.length;
        if (total === 0) {
            diffList.innerHTML = '<div style="text-align:center; padding:20px; color:#666; font-size:11px;">无导出项</div>';
            diffSummary.innerText = "共 0 个变动";
            return;
        }

        // 排序逻辑：新增 > 修改 > 不变 > 不导出
        var weight = { 'new': 0, 'mod': 1, 'same': 2, 'disabled': 3 };
        data.items.sort(function(a, b) {
            return (weight[a.status] || 99) - (weight[b.status] || 99);
        });

        var html = "";
        var mods = 0;
        data.items.forEach(function(item) {
            // 只有新增和修改的默认勾选，不变和不导出的默认不勾
            var checked = (item.status === "new" || item.status === "mod") ? "checked" : "";
            var badge = "";
            
            if (item.status === "new") { 
                badge = '<span class="badge new">新增</span>'; 
                mods++; 
            } else if (item.status === "mod") { 
                badge = '<span class="badge mod">修改</span>'; 
                mods++; 
            } else if (item.status === "disabled") {
                badge = '<span class="badge disabled">不导出</span>';
            } else { 
                badge = '<span class="badge same">不变</span>'; 
            }

            html += '<div class="diff-item">' +
                        '<input type="checkbox" class="chk-item" data-id="'+item.id+'" '+checked+'>' +
                        badge +
                        '<span class="layer-name" title="'+item.name+'">'+item.name+'</span>' +
                    '</div>';
        });

        diffList.innerHTML = html;
        var summaryPrefix = data.isFirstTime ? "首次扫描: " : "找到 " + total + " 个图层: ";
        diffSummary.innerText = summaryPrefix + mods + " 个需更新";

        var checkboxes = document.querySelectorAll(".chk-item");
        chkSelectAll.addEventListener("change", function() {
            checkboxes.forEach(function(cb) { cb.checked = chkSelectAll.checked; });
        });
    }

    btnExport.addEventListener("click", function() {
        if (!currentDiffData || !savedJsonPath || !savedImagePath) return;

        var selectedIds = [];
        document.querySelectorAll(".chk-item:checked").forEach(function(cb) {
            selectedIds.push(cb.getAttribute("data-id"));
        });

        if (selectedIds.length === 0) {
            setStatus("请至少勾选一个图层进行导出！", "warning");
            return;
        }

        btnExport.disabled = true;
        setStatus("正在执行增量切图与数据写入，请勿操作PS...", "warning");

        var payload = JSON.stringify({
            jsonFolder: savedJsonPath,
            imageFolder: savedImagePath,
            selectedIds: selectedIds
        });

        setTimeout(function() {
            logMsg("发送导出指令，选中ID数: " + selectedIds.length);

            csInterface.evalScript("exportSelectedLayers('" + payload + "')", function(result) {
                btnExport.disabled = false;
                logMsg("导出返回结果: " + result);

                if (result.indexOf("ERROR:") === 0) {
                    setStatus(result, "error");
                } else {
                    setStatus("增量导出成功！已更新至目录。", "");
                    // 重新静默扫描以刷新列表状态，全都变成"未变"
                    btnScan.click();
                }
            });
        }, 100);
    });

    // --- 页面初始化与全局逻辑 ---
    
    // 监听导出控制开关，变更即更新命名预览
    document.getElementById("chkExportEnable").addEventListener("change", function() {
        updateNamingPreview();
    });

    // 尺寸重置功能
    document.getElementById("btnResetSize").addEventListener("click", function() {
        if (!currentLayerInfo) return;
        uiNaming.w.value = currentLayerInfo.realWidth;
        uiNaming.h.value = currentLayerInfo.realHeight;
        updateNamingPreview();
    });

    // --- 预设尺寸管理逻辑 ---
    var presetMenu = document.getElementById("presetMenu");
    var presetList = document.getElementById("presetList");
    var presets = JSON.parse(localStorage.getItem("ui_size_presets") || "[]");

    function renderPresets() {
        presetList.innerHTML = "";
        presets.forEach(function(p, index) {
            var item = document.createElement("div");
            item.style.display = "flex";
            item.style.justifyContent = "space-between";
            item.style.alignItems = "center";
            item.style.padding = "4px 0";
            item.style.borderBottom = "1px solid #333";
            
            var label = document.createElement("span");
            label.innerText = p.w + " x " + p.h;
            label.style.fontSize = "11px";
            label.style.cursor = "pointer";
            label.style.color = "#ccc";
            label.onclick = function() {
                uiNaming.w.value = p.w;
                uiNaming.h.value = p.h;
                updateNamingPreview();
                presetMenu.style.display = "none";
            };

            var delBtn = document.createElement("span");
            delBtn.innerText = "×";
            delBtn.style.color = "#F44336";
            delBtn.style.cursor = "pointer";
            delBtn.style.padding = "0 4px";
            delBtn.onclick = function(e) {
                e.stopPropagation();
                presets.splice(index, 1);
                savePresets();
                renderPresets();
            };

            item.appendChild(label);
            item.appendChild(delBtn);
            presetList.appendChild(item);
        });
    }

    function savePresets() {
        localStorage.setItem("ui_size_presets", JSON.stringify(presets));
    }

    document.getElementById("btnOpenPreset").addEventListener("click", function(e) {
        e.stopPropagation();
        presetMenu.style.display = presetMenu.style.display === "none" ? "block" : "none";
        renderPresets();
    });

    document.getElementById("btnAddCurrentPreset").addEventListener("click", function() {
        var w = uiNaming.w.value;
        var h = uiNaming.h.value;
        if (w && h) {
            presets.push({ w: w, h: h });
            savePresets();
            renderPresets();
        }
    });

    // 点击外部关闭菜单
    document.addEventListener("click", function() {
        if (presetMenu) presetMenu.style.display = "none";
        if (uiNaming.prefixMenu) uiNaming.prefixMenu.style.display = "none";
    });
    if (presetMenu) {
        presetMenu.addEventListener("click", function(e) {
            e.stopPropagation();
        });
    }

    // 初始化预设列表
    renderPresets();

    // --- 图集前缀管理逻辑 ---
    var atlasPrefixes = JSON.parse(localStorage.getItem("UILink_AtlasPrefixes") || "[\"common\"]");
    
    function renderAtlasPrefixes() {
        // 更新下拉框
        var currentVal = uiNaming.atlasPrefix.value;
        uiNaming.atlasPrefix.innerHTML = "";
        atlasPrefixes.forEach(function(p) {
            var opt = document.createElement("option");
            opt.value = p;
            opt.innerText = p;
            uiNaming.atlasPrefix.appendChild(opt);
        });
        if (atlasPrefixes.indexOf(currentVal) !== -1) {
            uiNaming.atlasPrefix.value = currentVal;
        }

        // 更新管理菜单
        if (!uiNaming.prefixList) return;
        uiNaming.prefixList.innerHTML = "";
        atlasPrefixes.forEach(function(p, index) {
            var item = document.createElement("div");
            item.style.display = "flex";
            item.style.justifyContent = "space-between";
            item.style.alignItems = "center";
            item.style.padding = "4px 0";
            item.style.borderBottom = "1px solid #333";
            
            var label = document.createElement("span");
            label.innerText = p;
            label.style.fontSize = "11px";
            label.style.color = "#ccc";

            var delBtn = document.createElement("span");
            delBtn.innerText = "×";
            delBtn.style.color = "#F44336";
            delBtn.style.cursor = "pointer";
            delBtn.style.padding = "0 4px";
            delBtn.onclick = function(e) {
                e.stopPropagation();
                if (p === "common") {
                    alert("common 为系统默认前缀，无法删除！");
                    return;
                }
                atlasPrefixes.splice(index, 1);
                localStorage.setItem("UILink_AtlasPrefixes", JSON.stringify(atlasPrefixes));
                renderAtlasPrefixes();
                updatePreview();
            };

            item.appendChild(label);
            item.appendChild(delBtn);
            uiNaming.prefixList.appendChild(item);
        });
    }

    function ensurePrefixExists(pfx) {
        if (atlasPrefixes.indexOf(pfx) === -1) {
            atlasPrefixes.push(pfx);
            localStorage.setItem("UILink_AtlasPrefixes", JSON.stringify(atlasPrefixes));
            renderAtlasPrefixes();
        }
    }

    if (uiNaming.btnManagePrefix) {
        uiNaming.btnManagePrefix.addEventListener("click", function(e) {
            e.stopPropagation();
            uiNaming.prefixMenu.style.display = uiNaming.prefixMenu.style.display === "none" ? "block" : "none";
            renderAtlasPrefixes();
        });
    }

    if (uiNaming.btnAddPrefix) {
        uiNaming.btnAddPrefix.addEventListener("click", function(e) {
            e.stopPropagation();
            var newPfx = prompt("请输入新的图集前缀（仅字母数字下划线）：", "");
            if (newPfx) {
                newPfx = newPfx.replace(/[^a-zA-Z0-9_]/g, "");
                if (newPfx && atlasPrefixes.indexOf(newPfx) === -1) {
                    atlasPrefixes.push(newPfx);
                    localStorage.setItem("UILink_AtlasPrefixes", JSON.stringify(atlasPrefixes));
                    renderAtlasPrefixes();
                    uiNaming.atlasPrefix.value = newPfx;
                    updatePreview();
                }
            }
        });
    }

    if (uiNaming.prefixMenu) {
        uiNaming.prefixMenu.addEventListener("click", function(e) {
            e.stopPropagation();
        });
    }

    renderAtlasPrefixes();

    // ==========================================
    // 4. Tools-Box: 九宫格无损拉伸功能
    // ==========================================
    var btnMakeScalable = document.getElementById("btnMakeScalable");
    var btnRestoreScale = document.getElementById("btnRestoreScale");

    if (btnMakeScalable) {
        btnMakeScalable.addEventListener("click", function() {
            logMsg("==== 开始执行: 转换为智能对象 ====");
            setStatus("正在拆分图层并生成智能对象，请勿操作...", "warning");
            btnMakeScalable.disabled = true;

            setTimeout(function() {
                csInterface.evalScript("convertToScalable9Slice()", function(result) {
                    btnMakeScalable.disabled = false;
                    logMsg("转换返回结果: " + result);
                    if (result && result.indexOf("ERROR:") === 0) setStatus(result, "error");
                    else setStatus("转换成功！现在可以在PS中按 Ctrl+T 随意拉伸它了。", "");
                });
            }, 100);
        });
    }

    if (btnRestoreScale) {
        btnRestoreScale.addEventListener("click", function() {
            logMsg("==== 开始执行: 九宫格重绘还原 ====");
            setStatus("正在计算拉伸补偿并重绘图层，请勿操作...", "warning");
            btnRestoreScale.disabled = true;

            setTimeout(function() {
                csInterface.evalScript("restoreScaled9Slice()", function(result) {
                    btnRestoreScale.disabled = false;
                    logMsg("还原返回结果: " + result);
                    if (result && result.indexOf("ERROR:") === 0) setStatus(result, "error");
                    else setStatus("还原成功！边缘已完美重建。", "");
                });
            }, 100);
        });
    }

    // ==========================================
    // 5. Setting 页签: 强制检查更新
    // ==========================================
    var btnForceCheckUpdate = document.getElementById("btnForceCheckUpdate");
    if (btnForceCheckUpdate) {
        btnForceCheckUpdate.addEventListener("click", function() {
            logMsg("==== 开始手动检测更新 ====");
            setStatus("正在连接 Github 检测最新版本...", "warning");
            btnForceCheckUpdate.disabled = true;
            btnForceCheckUpdate.innerText = "⏳ 正在检测...";

            // 手动调用热更新函数
            try {
                checkAutoUpdate(true);
            } catch (e) {
                logMsg("手动检测更新异常: " + e.message);
                btnForceCheckUpdate.disabled = false;
                btnForceCheckUpdate.innerText = "🔄 检查更新 (检测 Github 最新版本)";
            }
        });
    }

});