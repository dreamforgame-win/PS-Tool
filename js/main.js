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

    // 终极降级方案：完全放弃对 Github API 和 Raw 的依赖！
    // 因为这两种方式极易被运营商墙掉或者被 Github 返回 403 频率限制。
    // 我们改为轮询多个 CDN 源，防止某个 CDN 被墙导致无法更新
    // 注意：jsDelivr 对 Github 分支文件有极强的 12~24 小时强制缓存，且无视 ?t= 查询参数。
    // 因此我们将直连和原生代理镜像放在最前面，jsDelivr 作为最后兜底。
    var cdns = [
        "https://raw.gitmirror.com/" + githubOwner + "/" + repoName + "/" + branch + "/version.json?t=",
        "https://ghp.ci/https://raw.githubusercontent.com/" + githubOwner + "/" + repoName + "/" + branch + "/version.json?t=",
        "https://raw.githubusercontent.com/" + githubOwner + "/" + repoName + "/" + branch + "/version.json?t=",
        "https://cdn.jsdelivr.net/gh/" + githubOwner + "/" + repoName + "@" + branch + "/version.json?t=",
        "https://fastly.jsdelivr.net/gh/" + githubOwner + "/" + repoName + "@" + branch + "/version.json?t="
    ];

    var currentCdnIndex = 0;
    var zipDownloadUrl = "https://github.com/" + githubOwner + "/" + repoName + "/archive/refs/heads/" + branch + ".zip";

    if (isManual) logMsg("开始请求远端版本号...");

    function tryNextCdn() {
        if (currentCdnIndex >= cdns.length) {
            if (isManual) logMsg("所有更新源均无法访问，检测失败。");
            resetBtnForce();
            return;
        }

        var cdnUrl = cdns[currentCdnIndex] + new Date().getTime() + Math.random();
        if (isManual) logMsg("正在尝试源 " + (currentCdnIndex + 1) + ": " + cdns[currentCdnIndex].split('/')[2]);

        var xhr = new XMLHttpRequest();
        xhr.overrideMimeType("application/json");
        // 不携带凭证，防止复杂网络环境下的跨域被拒
        xhr.withCredentials = false;
        xhr.timeout = 5000; // 5秒超时
        xhr.open("GET", cdnUrl, true);

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    try {
                        // 解析 version.json
                        var responseText = xhr.responseText.trim();
                        var remoteData;
                        if (responseText.startsWith("{")) {
                            remoteData = JSON.parse(responseText);
                        } else {
                            remoteData = eval("(" + responseText + ")");
                        }

                        var remoteVer = remoteData.version ? remoteData.version.replace("v", "") : null;
                        if(!remoteVer) throw new Error("无法获取 version 字段");

                        var botEl = document.getElementById("verDisplay");
                        var localVersion = botEl ? botEl.innerText.replace("v", "") : "1.0.0";
                        if (localVersion === "-") localVersion = "1.0.0";

                        if (isManual) logMsg("云端版本: " + remoteVer + " | 本地版本: " + localVersion);

                        var btnForce = document.getElementById("btnForceCheckUpdate");

                        // 比较版本号：只有当远端版本大于本地版本时才判定为新版本
                        var isNewer = false;
                        if (remoteVer && localVersion) {
                            var v1 = remoteVer.split('.');
                            var v2 = localVersion.split('.');
                            var len = Math.max(v1.length, v2.length);
                            for (var i = 0; i < len; i++) {
                                var num1 = parseInt(v1[i]) || 0;
                                var num2 = parseInt(v2[i]) || 0;
                                if (num1 > num2) { isNewer = true; break; }
                                if (num1 < num2) { isNewer = false; break; }
                            }
                        }

                        if (isNewer) {
                            if (btnForce) {
                                btnForce.innerText = "🎉 发现新版本 v" + remoteVer + "！点击顶部横幅更新";
                                btnForce.style.background = "#4CAF50";
                                btnForce.style.color = "#fff";
                            }
                            showUpdateBannerV2(remoteVer, zipDownloadUrl, repoName, branch);
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
                        currentCdnIndex++;
                        tryNextCdn();
                    }
                } else {
                    if (isManual) logMsg("状态码异常: " + xhr.status);
                    currentCdnIndex++;
                    tryNextCdn();
                }
            }
        };

        xhr.onerror = function() {
            if (isManual) logMsg("请求出错(网络异常)");
            currentCdnIndex++;
            tryNextCdn();
        };

        xhr.ontimeout = function() {
            if (isManual) logMsg("请求超时");
            currentCdnIndex++;
            tryNextCdn();
        };

        try {
            xhr.send(null);
        } catch(e) {
            if (isManual) logMsg("发送请求失败: " + e.message);
            currentCdnIndex++;
            tryNextCdn();
        }
    }

    // 开始请求
    tryNextCdn();

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

function showUpdateBanner_DEPRECATED(newVersion, zipUrl, repoName, branch) {
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
                                        "Start-Process cmd.exe -ArgumentList $argList -WindowStyle Hidden;";
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

function startStatusPolling_DEPRECATED(banner, statusFile, checkInterval, checkCount, lastProgressTxt) {
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

function showUpdateBannerV2(newVersion, zipUrl, repoName, branch) {
    var banner = document.getElementById("updateBanner");
    if (!banner) return;

    function cleanSystemPath(rawPath) {
        var normalized = String(rawPath || "");
        normalized = decodeURIComponent(normalized);
        normalized = normalized.replace(/^file:\/*/i, "");
        if (/^[A-Za-z]:/.test(normalized)) return normalized.replace(/\//g, "\\");
        return normalized.replace(/^\/+/, "").replace(/\//g, "\\");
    }

    function getSystemPathSafe(name, fallbackConst) {
        try {
            if (csInterface && typeof csInterface.getSystemPath === "function" && typeof fallbackConst !== "undefined") {
                return cleanSystemPath(csInterface.getSystemPath(fallbackConst));
            }
        } catch (e) {}
        try {
            if (window.__adobe_cep__ && typeof window.__adobe_cep__.getSystemPath === "function") {
                return cleanSystemPath(window.__adobe_cep__.getSystemPath(name));
            }
        } catch (e2) {}
        return "";
    }

    function arrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var chunkSize = 0x8000;
        var binary = "";
        for (var i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    banner.style.display = "block";
    document.getElementById("newVersionText").innerText = newVersion;

    banner.onclick = function() {
        banner.innerText = "Preparing updater...";
        banner.style.pointerEvents = "none";
        banner.style.background = "#FFC107";

        var localExtPath = getSystemPathSafe("extension", (typeof SystemPath !== "undefined" ? SystemPath.EXTENSION : undefined));
        var userDataPath = getSystemPathSafe("userData", (typeof SystemPath !== "undefined" ? SystemPath.USER_DATA : undefined));
        var psExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

        if (!localExtPath || !userDataPath) {
            logMsg("Hot update init failed: cannot resolve system paths.");
            showManualDownload(banner);
            return;
        }

        var statusFile = userDataPath + "\\uilink_update_status.txt";
        var tmpZip = userDataPath + "\\uilink_update.zip";
        var tmpDir = userDataPath + "\\uilink_update_dir";
        var scriptFile = userDataPath + "\\uilink_updater.ps1";

        try { window.cep.fs.deleteFile(statusFile); } catch (cleanupErr) {}
        try { window.cep.fs.deleteFile(scriptFile); } catch (cleanupErr2) {}

        logMsg("Downloading update package via XHR...");

        var xhr = new XMLHttpRequest();
        xhr.open("GET", zipUrl, true);
        xhr.responseType = "arraybuffer";
        xhr.timeout = 60000;

        xhr.onload = function() {
            if (xhr.status !== 200 || !xhr.response) {
                logMsg("XHR download failed: HTTP " + xhr.status);
                showManualDownload(banner);
                return;
            }

            logMsg("Download complete, writing zip to disk...");

            var zipBase64 = "";
            try {
                zipBase64 = arrayBufferToBase64(xhr.response);
            } catch (b64Err) {
                logMsg("Base64 conversion failed: " + b64Err.message);
                showManualDownload(banner);
                return;
            }

            var zipWriteRes = window.cep.fs.writeFile(tmpZip, zipBase64, window.cep.encoding.Base64);
            if (!zipWriteRes || zipWriteRes.err !== window.cep.fs.NO_ERROR) {
                logMsg("Writing temp zip failed: " + (zipWriteRes ? zipWriteRes.err : "UNKNOWN"));
                showManualDownload(banner);
                return;
            }

            var psScript = [
                "$ErrorActionPreference = 'Stop'",
                "$statusFile = '" + statusFile.replace(/'/g, "''") + "'",
                "$tmpZip = '" + tmpZip.replace(/'/g, "''") + "'",
                "$tmpDir = '" + tmpDir.replace(/'/g, "''") + "'",
                "$src = Join-Path $tmpDir '" + (repoName + "-" + branch + "\\*").replace(/'/g, "''") + "'",
                "$dest = '" + (localExtPath + "\\").replace(/'/g, "''") + "'",
                "try {",
                "  Set-Content -Path $statusFile -Value '[1/3] Extracting update package...' -Encoding UTF8",
                "  if (Test-Path $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force }",
                "  Expand-Archive -LiteralPath $tmpZip -DestinationPath $tmpDir -Force",
                "  Set-Content -Path $statusFile -Value '[2/3] Preparing elevated copy...' -Encoding UTF8",
                "  $argList = '/c \"xcopy \"\"' + $src + '\"\" \"\"' + $dest + '\"\" /s /e /y /c /h & echo SUCCESS > \"\"' + $statusFile + '\"\"\"'",
                "  Set-Content -Path $statusFile -Value '[3/3] Waiting for UAC / file copy...' -Encoding UTF8",
                "  Start-Process cmd.exe -ArgumentList $argList -Verb RunAs -WindowStyle Hidden",
                "} catch {",
                "  Set-Content -Path $statusFile -Value ('ERROR: ' + $_.Exception.Message) -Encoding UTF8",
                "}"
            ].join("\r\n");

            var scriptWriteRes = window.cep.fs.writeFile(scriptFile, psScript);
            if (!scriptWriteRes || scriptWriteRes.err !== window.cep.fs.NO_ERROR) {
                logMsg("Writing updater script failed: " + (scriptWriteRes ? scriptWriteRes.err : "UNKNOWN"));
                showManualDownload(banner);
                return;
            }

            if (!window.cep || !window.cep.process || typeof window.cep.process.createProcess !== "function") {
                logMsg("CEP process API unavailable.");
                showManualDownload(banner);
                return;
            }

            logMsg("Launching PowerShell updater: " + psExe);
            var procResult = window.cep.process.createProcess(
                psExe,
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File", scriptFile
            );

            if (!procResult || procResult.err !== 0) {
                logMsg("PowerShell launch failed: " + (procResult ? procResult.err : "UNKNOWN"));
                showManualDownload(banner);
                return;
            }

            startStatusPollingV2(banner, statusFile);
        };

        xhr.onerror = function() {
            logMsg("XHR download network error.");
            showManualDownload(banner);
        };

        xhr.ontimeout = function() {
            logMsg("XHR download timed out.");
            showManualDownload(banner);
        };

        xhr.send();
    };
}

function startStatusPollingV2(banner, statusFile) {
    var checkCount = 0;
    var lastProgressTxt = "";
    var checkInterval = setInterval(function() {
        checkCount++;
        var result = window.cep.fs.readFile(statusFile);
        if (result.err === window.cep.fs.NO_ERROR) {
            var txt = String(result.data || "").trim();
            if (txt.indexOf("SUCCESS") !== -1) {
                clearInterval(checkInterval);
                banner.innerText = "Update complete, reloading...";
                banner.style.background = "#4CAF50";
                try { window.cep.fs.deleteFile(statusFile); } catch (cleanupErr) {}
                setTimeout(function() { window.location.reload(true); }, 1500);
            } else if (txt.indexOf("ERROR:") === 0) {
                clearInterval(checkInterval);
                banner.innerText = "Update failed, please download manually.";
                banner.style.background = "#F44336";
                banner.style.pointerEvents = "auto";
                setStatus(txt, "error");
                logMsg(txt);
            } else if (txt && txt !== lastProgressTxt) {
                banner.innerText = "... " + txt;
                logMsg("Update progress: " + txt);
                lastProgressTxt = txt;
            }
        } else if (checkCount % 2 === 0) {
            logMsg("Waiting for status file...");
        }
    }, 1000);

    setTimeout(function() {
        clearInterval(checkInterval);
        if (banner.innerText.indexOf("Update complete") === -1 && banner.innerText.indexOf("Update failed") === -1) {
            banner.innerText = "Update may still be running in background or blocked by UAC. Please restart PS manually later.";
            banner.style.background = "#FF9800";
            banner.style.pointerEvents = "auto";
        }
    }, 90000);
}

document.addEventListener("DOMContentLoaded", function() {

    function ensureEnhancedPanels() {
        if (!document.getElementById("dynamic-ai-panel-style")) {
            var styleEl = document.createElement("style");
            styleEl.id = "dynamic-ai-panel-style";
            styleEl.textContent = [
                ".sub-tabs { display:flex; background:#1e1e1e; margin-bottom:12px; border-radius:4px; overflow:hidden; border:1px solid #444; }",
                ".sub-tab-btn { flex:1; padding:6px 0; text-align:center; cursor:pointer; color:#888; font-size:11px; }",
                ".sub-tab-btn:hover { background:#2a2a2a; }",
                ".sub-tab-btn.active { background:#4fc3f7; color:#000; font-weight:bold; }",
                ".sub-tab-content { display:none; }",
                ".sub-tab-content.active { display:block; }",
                "#sub-ailab .name-group { display:grid; grid-template-columns:72px minmax(0, 1fr); gap:8px; align-items:start !important; }",
                "#sub-ailab .name-group > span { width:auto !important; line-height:32px; margin-top:0 !important; }",
                "#sub-ailab .name-group > input, #sub-ailab .name-group > div { min-width:0; }",
                "#sub-ailab .name-group > div[style*='flex: 1'] > div[style*='display: flex'] { display:grid !important; grid-template-columns:minmax(0, 1fr); gap:6px !important; }",
                "#sub-ailab #aiModelSelect, #sub-ailab #aiModel { width:100%; min-width:0; box-sizing:border-box; flex:none !important; }",
                "#sub-ailab #btnFetchModels { justify-self:end; min-width:72px; }"
            ].join("\n");
            document.head.appendChild(styleEl);
        }

        var namingTabBtn = document.querySelector('.tab-btn[data-target="tab-naming"]');
        if (namingTabBtn) namingTabBtn.textContent = "\u56fe\u5c42\u5c5e\u6027";
        var sliceTabBtn = document.querySelector('.tab-btn[data-target="tab-slice"]');
        if (sliceTabBtn) sliceTabBtn.textContent = "\u4e5d\u5bab\u683c";
        var exportTabBtn = document.querySelector('.tab-btn[data-target="tab-export"]');
        if (exportTabBtn) exportTabBtn.textContent = "\u626b\u63cf\u5bfc\u51fa";
        var toolsTabBtn = document.querySelector('.tab-btn[data-target="tab-tools"]');
        if (toolsTabBtn && toolsTabBtn.parentNode) toolsTabBtn.parentNode.removeChild(toolsTabBtn);

        function buildSubtabRoot(tabEl, defs) {
            if (!tabEl || tabEl.querySelector(".sub-tabs")) return;
            var existingNodes = Array.prototype.slice.call(tabEl.childNodes);
            tabEl.innerHTML = "";

            var subTabs = document.createElement("div");
            subTabs.className = "sub-tabs";
            defs.forEach(function(def, index) {
                var btn = document.createElement("div");
                btn.className = "sub-tab-btn" + (index === 0 ? " active" : "");
                btn.setAttribute("data-target", def.id);
                btn.textContent = def.label;
                subTabs.appendChild(btn);
            });
            tabEl.appendChild(subTabs);

            defs.forEach(function(def, index) {
                var pane = document.createElement("div");
                pane.id = def.id;
                pane.className = "sub-tab-content" + (index === 0 ? " active" : "");
                if (index === 0) {
                    existingNodes.forEach(function(node) { pane.appendChild(node); });
                } else if (typeof def.render === "function") {
                    def.render(pane);
                }
                tabEl.appendChild(pane);
            });
        }

        buildSubtabRoot(document.getElementById("tab-naming"), [
            { id: "sub-naming-props", label: "\u5c5e\u6027" },
            {
                id: "sub-naming-clear",
                label: "AI\u6e05\u6670",
                render: function(pane) {
                    pane.innerHTML = [
                        '<div class="title" style="margin-top: 5px;">AI \u63d0\u793a\u8bcd (Prompt)</div>',
                        '<div style="font-size: 10px; color: #888; margin-bottom: 6px; line-height: 1.4;">\u4f60\u53ef\u4ee5\u6839\u636e\u4e0d\u540c\u56fe\u6807\u98ce\u683c\u8c03\u6574\u63d0\u793a\u8bcd\u3002\u9ed8\u8ba4\u63d0\u793a\u8bcd\u4f1a\u5c3d\u91cf\u4fdd\u6301\u539f\u56fe\u7ed3\u6784\uff0c\u53ea\u505a\u9ad8\u6e05\u5316\u3002</div>',
                        '<textarea id="aiPromptInput" class="name-input" style="width: 100%; height: 160px; resize: vertical; margin-bottom: 15px; box-sizing: border-box; font-family: monospace; font-size: 11px;"></textarea>',
                        '<div class="title">\u6267\u884c\u9ad8\u6e05\u589e\u5f3a</div>',
                        '<div style="display: flex; gap: 8px; flex-direction: column;">',
                        '<button id="btnMakeClear" style="background: #332a00; color: #ffca28; border: 1px solid #ffca28; padding: 10px; font-size: 12px; font-weight: bold; border-radius: 3px;">\u2728 \u4f7f\u7528\u4e91\u7aef AI \u6e05\u6670\u5316</button>',
                        '</div>'
                    ].join("");
                }
            }
        ]);

        var toolsTab = document.getElementById("tab-tools");
        buildSubtabRoot(document.getElementById("tab-slice"), [
            { id: "sub-slice-crop", label: "\u5207\u56fe" },
            {
                id: "sub-slice-scale",
                label: "\u6269\u56fe",
                render: function(pane) {
                    if (toolsTab) {
                        while (toolsTab.firstChild) pane.appendChild(toolsTab.firstChild);
                    }
                }
            }
        ]);
        if (toolsTab && toolsTab.parentNode) toolsTab.parentNode.removeChild(toolsTab);

        buildSubtabRoot(document.getElementById("tab-setting"), [
            { id: "sub-update", label: "\u68c0\u67e5\u66f4\u65b0" },
            {
                id: "sub-ailab",
                label: "AI\u5b9e\u9a8c\u5ba4",
                render: function(pane) {
                    pane.innerHTML = [
                        '<div style="background: #222; border: 1px solid #444; border-radius: 4px; padding: 12px; margin-bottom: 12px;">',
                        '<div class="name-group"><span style="color:#aaa; width:65px;">API URL:</span><input type="text" id="aiApiUrl" class="name-input" placeholder="\u4f8b\u5982: https://api.openai.com/v1/chat/completions"></div>',
                        '<div class="name-group"><span style="color:#aaa; width:65px;">API Key:</span><input type="password" id="aiApiKey" class="name-input" placeholder="Bearer Token / \u7f51\u5173\u5bc6\u94a5"></div>',
                        '<div class="name-group" style="align-items: flex-start; margin-top: 10px;"><span style="color:#aaa; width:65px; margin-top: 6px;">\u6a21\u578b\u9009\u62e9:</span><div style="flex: 1;"><div style="display: flex; gap: 4px;"><select id="aiModelSelect" class="name-input" style="appearance: auto; cursor: pointer; flex: 1; display: none;"></select><input type="text" id="aiModel" class="name-input" placeholder="\u4f8b\u5982: gemini/gemini-3.1-flash-image-preview" style="flex: 1;"><button id="btnFetchModels" class="btn-primary" style="padding: 0 8px; font-size: 11px;">\u83b7\u53d6</button></div><div style="font-size: 10px; color: #888; margin-top: 4px;">\u652f\u6301 Gemini \u539f\u751f\u63a5\u53e3\u6216\u7b2c\u4e09\u65b9 OpenAI \u517c\u5bb9\u7f51\u5173\u3002\u70b9\u51fb\u201c\u83b7\u53d6\u201d\u62c9\u53d6\u53ef\u7528\u6a21\u578b\u5217\u8868\u3002</div></div></div>',
                        '</div>'
                    ].join("");
                }
            }
        ]);
    }

    ensureEnhancedPanels();

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

    var subTabBtns = document.querySelectorAll('.sub-tab-btn');
    subTabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var subTabsRoot = btn.parentElement;
            if (!subTabsRoot) return;

            var tabContentRoot = subTabsRoot.parentElement;
            if (!tabContentRoot) return;

            subTabsRoot.querySelectorAll('.sub-tab-btn').forEach(function(b) {
                b.classList.remove('active');
            });
            Array.prototype.forEach.call(tabContentRoot.children, function(child) {
                if (child.classList && child.classList.contains('sub-tab-content')) {
                    child.classList.remove('active');
                }
            });

            btn.classList.add('active');
            var targetId = btn.getAttribute('data-target');
            var targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.add('active');
            }
        });
    });

    if (false && uiNaming.btnResetPosition) {
        uiNaming.btnResetPosition.addEventListener("click", function() {
            if (!currentPositionData.imgW || !currentPositionData.imgH) return;
            centerPositionPreview();
            setStatus("位置已重置为居中，点击保存参数后生效。", "");
        });
    }

    if (false && uiNaming.positionImage) {
        uiNaming.positionImage.addEventListener("mousedown", function(e) {
            if (!currentPositionData.hasImage) return;
            isDraggingPosition = true;
            positionDragState.startX = e.clientX;
            positionDragState.startY = e.clientY;
            positionDragState.startPosX = currentPositionData.posX;
            positionDragState.startPosY = currentPositionData.posY;
            positionDragState.scale = parseFloat(uiNaming.positionFrame.getAttribute("data-scale") || "1") || 1;
            uiNaming.positionImage.classList.add("dragging");
            e.preventDefault();
        });
    }

    document.addEventListener("mousemove", function(e) {
        if (!isDraggingPosition) return;
        var scale = positionDragState.scale || 1;
        currentPositionData.posX = positionDragState.startPosX + (e.clientX - positionDragState.startX) / scale;
        currentPositionData.posY = positionDragState.startPosY + (e.clientY - positionDragState.startY) / scale;
        clampPositionData();
        renderPositionPreview();
        e.preventDefault();
    });

    document.addEventListener("mouseup", function() {
        if (!isDraggingPosition) return;
        isDraggingPosition = false;
        if (uiNaming.positionImage) uiNaming.positionImage.classList.remove("dragging");
        setStatus("位置已更新，点击保存参数后生效。", "");
    });

    window.addEventListener("resize", function() {
        renderPositionPreview();
    });

    // ==========================================
    // 1. 属性命名模块逻辑 (模块化重构版)
    // ==========================================
    var lastLayerNameForSync = "";
    var currentLayerInfo = null;

    var uiNaming = {
        root: document.getElementById("moduleRootName"),
        base: document.getElementById("moduleBaseName"),
        baseHistory: document.getElementById("moduleBaseHistory"),
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
        btnAddPrefix: document.getElementById("btnAddPrefix"),
        positionStage: document.getElementById("positionPreviewStage"),
        positionFrame: document.getElementById("positionPreviewFrame"),
        positionImage: document.getElementById("positionPreviewImage"),
        positionEmpty: document.getElementById("positionPreviewEmpty"),
        positionInfo: document.getElementById("positionPreviewInfo"),
        btnResetPosition: document.getElementById("btnResetPosition"),
        positionGuideX: document.getElementById("positionGuideX"),
        positionGuideY: document.getElementById("positionGuideY")
    };
    var recentBaseNames = JSON.parse(localStorage.getItem("UILink_RecentBaseNames") || "[]");
    var currentPositionData = {
        imgW: 0,
        imgH: 0,
        frameW: 0,
        frameH: 0,
        posX: 0,
        posY: 0,
        previewPath: "",
        hasImage: false,
        snapX: false,
        snapY: false
    };
    var isDraggingPosition = false;
    var positionDragState = { startX: 0, startY: 0, startPosX: 0, startPosY: 0 };

    if (uiNaming.btnResetPosition) {
        uiNaming.btnResetPosition.addEventListener("click", function() {
            if (!currentPositionData.imgW || !currentPositionData.imgH) return;
            centerPositionPreview();
            setStatus("位置已重置为居中，点击保存参数后生效。", "");
        });
    }

    if (uiNaming.positionImage) {
        uiNaming.positionImage.addEventListener("mousedown", function(e) {
            if (!currentPositionData.hasImage) return;
            isDraggingPosition = true;
            positionDragState.startX = e.clientX;
            positionDragState.startY = e.clientY;
            positionDragState.startPosX = currentPositionData.posX;
            positionDragState.startPosY = currentPositionData.posY;
            positionDragState.scale = parseFloat(uiNaming.positionFrame.getAttribute("data-scale") || "1") || 1;
            uiNaming.positionImage.classList.add("dragging");
            e.preventDefault();
        });
    }

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
                currentPositionData.previewPath = "";
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
                loadPositionPreview(true);

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
            updateSaveButtonState();
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

        // 3. PS 图层显示名 (新系统下，直接等于导出基础名)
        uiNaming.prevProject.innerText = expName;
        updateSaveButtonState();
    }

    function buildRenameApplyInfo() {
        var finalOutputType = uiNaming.output.value;
        if (finalOutputType === "atlas") {
            finalOutputType = "atlas:" + (uiNaming.atlasPrefix.value || "common");
        }

        return {
            moduleName: uiNaming.root.value.trim(),
            baseName: uiNaming.base.value.trim(),
            width: parseInt(uiNaming.w.value, 10) || currentLayerInfo.realWidth,
            height: parseInt(uiNaming.h.value, 10) || currentLayerInfo.realHeight,
            outputType: finalOutputType,
            compType: uiNaming.comp.value,
            isExport: uiNaming.exportChk.checked,
            sliceSuffix: currentLayerInfo.sliceSuffix || "0,0,0,0",
            posX: Math.round(currentPositionData.posX || 0),
            posY: Math.round(currentPositionData.posY || 0)
        };
    }

    function buildToggleApplyInfo(isExportEnabled) {
        if (!currentLayerInfo) return null;

        return {
            moduleName: currentLayerInfo.moduleName || currentLayerInfo.docName || "",
            baseName: currentLayerInfo.baseName || currentLayerInfo.fullName || "",
            width: parseInt(currentLayerInfo.width, 10) || parseInt(currentLayerInfo.realWidth, 10) || 0,
            height: parseInt(currentLayerInfo.height, 10) || parseInt(currentLayerInfo.realHeight, 10) || 0,
            outputType: currentLayerInfo.outputType || "atlas",
            compType: currentLayerInfo.compType || "image",
            isExport: !!isExportEnabled,
            sliceSuffix: currentLayerInfo.sliceSuffix || "0,0,0,0",
            posX: parseInt(currentLayerInfo.posX, 10) || 0,
            posY: parseInt(currentLayerInfo.posY, 10) || 0
        };
    }

    function getSavedFrameSize() {
        return {
            width: parseInt((currentLayerInfo && currentLayerInfo.width), 10) || parseInt((currentLayerInfo && currentLayerInfo.realWidth), 10) || 0,
            height: parseInt((currentLayerInfo && currentLayerInfo.height), 10) || parseInt((currentLayerInfo && currentLayerInfo.realHeight), 10) || 0
        };
    }

    function getSavedPosition() {
        if (!currentLayerInfo) return { x: 0, y: 0 };
        var savedFrame = getSavedFrameSize();
        var imgW = parseInt(currentLayerInfo.realWidth, 10) || 0;
        var imgH = parseInt(currentLayerInfo.realHeight, 10) || 0;
        if (!currentLayerInfo.hasCustomPosition) {
            return {
                x: Math.round((savedFrame.width - imgW) / 2),
                y: Math.round((savedFrame.height - imgH) / 2)
            };
        }
        return {
            x: parseInt(currentLayerInfo.posX, 10) || 0,
            y: parseInt(currentLayerInfo.posY, 10) || 0
        };
    }

    function getCurrentDraftState() {
        if (!currentLayerInfo) return null;
        var outputType = uiNaming.output.value === "atlas" ? ("atlas:" + (uiNaming.atlasPrefix.value || "common")) : uiNaming.output.value;
        return {
            moduleName: uiNaming.root.value.trim(),
            baseName: uiNaming.base.value.trim(),
            outputType: outputType,
            compType: uiNaming.comp.value,
            width: parseInt(uiNaming.w.value, 10) || currentLayerInfo.realWidth,
            height: parseInt(uiNaming.h.value, 10) || currentLayerInfo.realHeight,
            posX: Math.round(currentPositionData.posX || 0),
            posY: Math.round(currentPositionData.posY || 0)
        };
    }

    function getSavedDraftState() {
        if (!currentLayerInfo) return null;
        var savedPos = getSavedPosition();
        var savedFrame = getSavedFrameSize();
        return {
            moduleName: currentLayerInfo.moduleName || currentLayerInfo.docName || "",
            baseName: currentLayerInfo.baseName || "",
            outputType: currentLayerInfo.outputType || "atlas",
            compType: currentLayerInfo.compType || "image",
            width: savedFrame.width,
            height: savedFrame.height,
            posX: savedPos.x,
            posY: savedPos.y
        };
    }

    function isDraftDirty() {
        var currentState = getCurrentDraftState();
        var savedState = getSavedDraftState();
        if (!currentState || !savedState) return false;
        return JSON.stringify(currentState) !== JSON.stringify(savedState);
    }

    function updateSaveButtonState(forceSaving) {
        if (!uiNaming.apply) return;
        uiNaming.apply.classList.remove("is-clean", "is-dirty", "is-saving");

        if (forceSaving) {
            uiNaming.apply.classList.add("is-saving");
            uiNaming.apply.disabled = true;
            return;
        }

        if (isDraftDirty()) {
            uiNaming.apply.classList.add("is-dirty");
            uiNaming.apply.disabled = false;
        } else {
            uiNaming.apply.classList.add("is-clean");
            uiNaming.apply.disabled = true;
        }
    }

    function renderRecentBaseNames() {
        if (!uiNaming.baseHistory) return;
        uiNaming.baseHistory.innerHTML = '<option value="">最近名称</option>';
        recentBaseNames.forEach(function(name) {
            var option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            uiNaming.baseHistory.appendChild(option);
        });
    }

    function pushRecentBaseName(name) {
        var normalized = String(name || "").trim();
        if (!normalized) return;
        recentBaseNames = recentBaseNames.filter(function(item) {
            return item !== normalized;
        });
        recentBaseNames.unshift(normalized);
        recentBaseNames = recentBaseNames.slice(0, 10);
        localStorage.setItem("UILink_RecentBaseNames", JSON.stringify(recentBaseNames));
        renderRecentBaseNames();
    }

    function getEffectiveFrameSize() {
        var frameW = parseInt(uiNaming.w.value, 10) || (currentLayerInfo && currentLayerInfo.realWidth) || currentPositionData.imgW || 0;
        var frameH = parseInt(uiNaming.h.value, 10) || (currentLayerInfo && currentLayerInfo.realHeight) || currentPositionData.imgH || 0;
        return {
            w: Math.max(1, frameW),
            h: Math.max(1, frameH)
        };
    }

    function clampPositionData() {
        var frame = getEffectiveFrameSize();
        currentPositionData.frameW = frame.w;
        currentPositionData.frameH = frame.h;

        var minX = Math.min(0, frame.w - currentPositionData.imgW);
        var maxX = Math.max(0, frame.w - currentPositionData.imgW);
        var minY = Math.min(0, frame.h - currentPositionData.imgH);
        var maxY = Math.max(0, frame.h - currentPositionData.imgH);

        currentPositionData.posX = Math.max(minX, Math.min(maxX, Math.round(currentPositionData.posX || 0)));
        currentPositionData.posY = Math.max(minY, Math.min(maxY, Math.round(currentPositionData.posY || 0)));
    }

    function applyCenterSnap() {
        var centerX = Math.round((currentPositionData.frameW - currentPositionData.imgW) / 2);
        var centerY = Math.round((currentPositionData.frameH - currentPositionData.imgH) / 2);
        var snapThreshold = 6;
        currentPositionData.snapX = false;
        currentPositionData.snapY = false;

        if (Math.abs(currentPositionData.posX - centerX) <= snapThreshold) {
            currentPositionData.posX = centerX;
            currentPositionData.snapX = true;
        }
        if (Math.abs(currentPositionData.posY - centerY) <= snapThreshold) {
            currentPositionData.posY = centerY;
            currentPositionData.snapY = true;
        }
    }

    function updatePositionPreviewInfo() {
        if (!uiNaming.positionInfo) return;
        uiNaming.positionInfo.innerText = "位置: (" + Math.round(currentPositionData.posX || 0) + ", " + Math.round(currentPositionData.posY || 0) + ")";
    }

    function renderPositionPreview() {
        if (!uiNaming.positionStage || !uiNaming.positionFrame || !uiNaming.positionImage || !uiNaming.positionEmpty) return;

        var frame = getEffectiveFrameSize();
        currentPositionData.frameW = frame.w;
        currentPositionData.frameH = frame.h;

        if (!currentPositionData.hasImage || !currentPositionData.imgW || !currentPositionData.imgH) {
            uiNaming.positionFrame.style.display = "none";
            uiNaming.positionEmpty.style.display = "flex";
            if (uiNaming.positionGuideX) uiNaming.positionGuideX.classList.remove("active");
            if (uiNaming.positionGuideY) uiNaming.positionGuideY.classList.remove("active");
            updatePositionPreviewInfo();
            updateSaveButtonState();
            return;
        }

        clampPositionData();
        applyCenterSnap();

        var stageRect = uiNaming.positionStage.getBoundingClientRect();
        var stageW = Math.max(80, Math.round(stageRect.width) - 16);
        var stageH = Math.max(80, Math.round(stageRect.height) - 16);
        var scale = Math.min(stageW / frame.w, stageH / frame.h);
        if (!isFinite(scale) || scale <= 0) scale = 1;

        var displayFrameW = Math.max(1, Math.round(frame.w * scale));
        var displayFrameH = Math.max(1, Math.round(frame.h * scale));
        var displayImgW = Math.max(1, Math.round(currentPositionData.imgW * scale));
        var displayImgH = Math.max(1, Math.round(currentPositionData.imgH * scale));

        uiNaming.positionFrame.style.display = "block";
        uiNaming.positionEmpty.style.display = "none";
        uiNaming.positionFrame.style.width = displayFrameW + "px";
        uiNaming.positionFrame.style.height = displayFrameH + "px";
        uiNaming.positionFrame.setAttribute("data-scale", String(scale));

        uiNaming.positionImage.style.width = displayImgW + "px";
        uiNaming.positionImage.style.height = displayImgH + "px";
        uiNaming.positionImage.style.left = Math.round(currentPositionData.posX * scale) + "px";
        uiNaming.positionImage.style.top = Math.round(currentPositionData.posY * scale) + "px";
        if (uiNaming.positionGuideX) uiNaming.positionGuideX.classList.toggle("active", !!currentPositionData.snapX);
        if (uiNaming.positionGuideY) uiNaming.positionGuideY.classList.toggle("active", !!currentPositionData.snapY);

        updatePositionPreviewInfo();
        updateSaveButtonState();
    }

    function centerPositionPreview() {
        var frame = getEffectiveFrameSize();
        currentPositionData.frameW = frame.w;
        currentPositionData.frameH = frame.h;
        currentPositionData.posX = Math.round((frame.w - currentPositionData.imgW) / 2);
        currentPositionData.posY = Math.round((frame.h - currentPositionData.imgH) / 2);
        clampPositionData();
        renderPositionPreview();
    }

    function refreshPositionAfterSizeEdit() {
        var wasCenteredX = currentPositionData.posX === Math.round((currentPositionData.frameW - currentPositionData.imgW) / 2);
        var wasCenteredY = currentPositionData.posY === Math.round((currentPositionData.frameH - currentPositionData.imgH) / 2);
        if ((currentLayerInfo && !currentLayerInfo.hasCustomPosition && wasCenteredX && wasCenteredY) || (wasCenteredX && wasCenteredY && !isDraggingPosition)) {
            centerPositionPreview();
        } else {
            renderPositionPreview();
        }
    }

    function loadPositionPreview(forceReload) {
        if (!currentLayerInfo || !uiNaming.positionImage) {
            currentPositionData.hasImage = false;
            renderPositionPreview();
            return;
        }

        currentPositionData.imgW = parseInt(currentLayerInfo.realWidth, 10) || 0;
        currentPositionData.imgH = parseInt(currentLayerInfo.realHeight, 10) || 0;
        currentPositionData.posX = parseInt(currentLayerInfo.posX, 10) || 0;
        currentPositionData.posY = parseInt(currentLayerInfo.posY, 10) || 0;
        if (!currentLayerInfo.hasCustomPosition) {
            currentPositionData.posX = Math.round((getEffectiveFrameSize().w - currentPositionData.imgW) / 2);
            currentPositionData.posY = Math.round((getEffectiveFrameSize().h - currentPositionData.imgH) / 2);
        }
        currentPositionData.hasImage = false;
        renderPositionPreview();

        if (!forceReload && currentPositionData.previewPath) {
            currentPositionData.hasImage = true;
            renderPositionPreview();
            return;
        }

        csInterface.evalScript("getActiveLayerPreview()", function(result) {
            if (!result || result.indexOf("ERROR") === 0) {
                currentPositionData.hasImage = false;
                renderPositionPreview();
                return;
            }

            try {
                var data = JSON.parse(result);
                currentPositionData.previewPath = data.path || "";
                currentPositionData.imgW = parseInt(data.width, 10) || currentPositionData.imgW;
                currentPositionData.imgH = parseInt(data.height, 10) || currentPositionData.imgH;
                currentPositionData.hasImage = !!currentPositionData.previewPath;

                if (currentPositionData.previewPath) {
                    var safePath = currentPositionData.previewPath.replace(/\\/g, "/");
                    uiNaming.positionImage.onload = function() {
                        renderPositionPreview();
                    };
                    uiNaming.positionImage.src = "file:///" + safePath + "?t=" + new Date().getTime();
                } else {
                    renderPositionPreview();
                }
            } catch (e) {
                currentPositionData.hasImage = false;
                renderPositionPreview();
            }
        });
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
    renderRecentBaseNames();

    if (uiNaming.baseHistory) {
        uiNaming.baseHistory.addEventListener("change", function() {
            if (!this.value) return;
            uiNaming.base.value = this.value;
            updatePreview();
        });
    }

    [uiNaming.root, uiNaming.base, uiNaming.output, uiNaming.comp, uiNaming.exportChk, uiNaming.w, uiNaming.h, uiNaming.atlasPrefix].forEach(function(el) {
        if (!el) return;
        el.addEventListener("input", function() {
            updatePreview();
            if (el === uiNaming.w || el === uiNaming.h) {
                if (typeof window.refreshCanvasDimensions === "function") {
                    window.refreshCanvasDimensions();
                }
                refreshPositionAfterSizeEdit();
            }
        });
        el.addEventListener("change", function() {
            if (el === uiNaming.output) {
                uiNaming.groupPrefix.style.display = (this.value === "atlas") ? "flex" : "none";
            }
            updatePreview();
            if (el === uiNaming.w || el === uiNaming.h) {
                if (typeof window.refreshCanvasDimensions === "function") {
                    window.refreshCanvasDimensions();
                }
                refreshPositionAfterSizeEdit();
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
            applyInfo = buildRenameApplyInfo();

            if (!applyInfo.baseName) {
                setStatus("基础名称不能为空！", "error");
                return;
            }

            setStatus("正在应用命名规则...", "warning");
            updateSaveButtonState(true);
            var jsonStr = JSON.stringify(applyInfo);
            // 对 JSON 字符串进行简单的转义，防止单引号破坏 evalScript
            var escapedJson = jsonStr.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            
            csInterface.evalScript("applyLayerRename('" + escapedJson + "')", function(res) {
                if (res.indexOf("ERROR") === 0) {
                    setStatus(res, "error");
                    updateSaveButtonState();
                    logMsg("重命名失败: " + res);
                } else {
                    setStatus("重命名成功！", "");
                    // 重命名成功后自动记忆当前的模块名
                    localStorage.setItem("UILink_LastModuleName", applyInfo.moduleName);
                    pushRecentBaseName(applyInfo.baseName);
                    if (currentLayerInfo) {
                        currentLayerInfo.moduleName = applyInfo.moduleName;
                        currentLayerInfo.baseName = applyInfo.baseName;
                        currentLayerInfo.width = applyInfo.width;
                        currentLayerInfo.height = applyInfo.height;
                        currentLayerInfo.outputType = applyInfo.outputType;
                        currentLayerInfo.compType = applyInfo.compType;
                        currentLayerInfo.isExport = applyInfo.isExport;
                        currentLayerInfo.posX = applyInfo.posX;
                        currentLayerInfo.posY = applyInfo.posY;
                        currentLayerInfo.hasCustomPosition = true;
                        currentLayerInfo.hasMeta = true;
                    }
                    lastLayerNameForSync = res;
                    updatePreview();
                    renderPositionPreview();
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
    var cropPreviewContainer = document.getElementById("cropPreviewContainer");
    var previewResizer = document.getElementById("previewResizer");

    // 缩放与平移变量
    var currentZoom = 1;
    var panX = 0, panY = 0;
    var isPanning = false;
    var startPanX = 0, startPanY = 0;
    var isResizingHeight = false;
    var startResizeY = 0;
    var startHeight = 0;

    var isResizingPreview = false;
    var startPreviewResizeY = 0;
    var startPreviewHeight = 0;

    // 从本地存储恢复高度
    var savedHeight = localStorage.getItem("UILink_SliceCanvasHeight") || "300";
    if (canvasWrapper) canvasWrapper.style.height = savedHeight + "px";

    var savedPreviewHeight = localStorage.getItem("UILink_PreviewCanvasHeight") || "120";
    if (cropPreviewContainer) cropPreviewContainer.style.height = savedPreviewHeight + "px";

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

    if (canvasResizer) {
        canvasResizer.addEventListener("mousedown", function(e) {
            isResizingHeight = true;
            startResizeY = e.clientY;
            startHeight = canvasWrapper.offsetHeight;
            document.body.style.cursor = "ns-resize";
            e.preventDefault();
        });
    }

    if (previewResizer) {
        previewResizer.addEventListener("mousedown", function(e) {
            isResizingPreview = true;
            startPreviewResizeY = e.clientY;
            startPreviewHeight = cropPreviewContainer.offsetHeight;
            document.body.style.cursor = "ns-resize";
            e.preventDefault();
        });
    }

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

                // 核心性能优化：直接使用本地硬盘路径加载图片，避开耗时的 Base64 编解码
                // 加上时间戳防止缓存
                var safePath = data.path.replace(/\\/g, "/");
                previewImage.src = "file:///" + safePath + "?t=" + new Date().getTime();

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
        if (isResizingPreview) {
            var deltaPreview = e.clientY - startPreviewResizeY;
            var newPreviewHeight = Math.max(80, Math.min(800, startPreviewHeight + deltaPreview));
            if (cropPreviewContainer) cropPreviewContainer.style.height = newPreviewHeight + "px";
            localStorage.setItem("UILink_PreviewCanvasHeight", newPreviewHeight);
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
        if (isResizingPreview) {
            isResizingPreview = false;
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

        // 计算预览图的总宽高 (物理像素尺寸)
        var finalW = (l + r > 0) ? (l + r) : w;
        var finalH = (t + b > 0) ? (t + b) : h;

        // --- 核心改动：自适应缩放以适配容器 ---
        var containerW = cropPreviewContainer.clientWidth - 40; // 减去 padding
        var containerH = cropPreviewContainer.clientHeight - 40;

        var scale = 1;
        if (finalW > containerW || finalH > containerH) {
            scale = Math.min(containerW / finalW, containerH / finalH);
        }

        // 应用缩放 (transform)
        resContainer.style.width = finalW + "px";
        resContainer.style.height = finalH + "px";
        resContainer.style.transform = "scale(" + scale + ")";
        resContainer.style.transformOrigin = "center center";
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
        var checkbox = this;
        var nextState = checkbox.checked;
        var previousState = !nextState;
        var toggleInfo = buildToggleApplyInfo(nextState);

        updatePreview();

        if (!toggleInfo || !toggleInfo.baseName) {
            checkbox.checked = previousState;
            updatePreview();
            setStatus("请先在 PS 中选中一个有效图层", "error");
            return;
        }

        setStatus(nextState ? "正在开启导出..." : "正在关闭导出...", "warning");
        var jsonStr = JSON.stringify(toggleInfo);
        var escapedJson = jsonStr.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

        csInterface.evalScript("setActiveLayerExportFlag('" + escapedJson + "')", function(res) {
            if (res.indexOf("ERROR") === 0) {
                checkbox.checked = previousState;
                updatePreview();
                setStatus(res, "error");
                logMsg("导出状态更新失败: " + res);
                return;
            }

            if (currentLayerInfo) {
                currentLayerInfo.isExport = nextState;
                currentLayerInfo.hasMeta = true;
            }
            lastLayerNameForSync = "";
            setStatus(nextState ? "已开启导出，立即生效，无需保存。" : "已关闭导出，立即生效，无需保存。", "");
            logMsg(nextState ? "导出已开启（即时生效）" : "导出已关闭（即时生效）");
        });
    });

    // 尺寸重置功能
    document.getElementById("btnResetSize").addEventListener("click", function() {
        if (!currentLayerInfo) return;
        uiNaming.w.value = currentLayerInfo.realWidth;
        uiNaming.h.value = currentLayerInfo.realHeight;
        updatePreview();
        refreshPositionAfterSizeEdit();
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
                updatePreview();
                refreshPositionAfterSizeEdit();
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
    var aiApiUrlInput = document.getElementById("aiApiUrl");
    var aiApiKeyInput = document.getElementById("aiApiKey");
    var aiModelInput = document.getElementById("aiModel");
    var aiPromptInput = document.getElementById("aiPromptInput");
    var btnMakeClear = document.getElementById("btnMakeClear");
    var btnFetchModels = document.getElementById("btnFetchModels");
    var defaultAiPrompt = "Enhance this exact UI icon into a higher-resolution version. Preserve the original composition, silhouette, proportions, spacing, color layout, and semantic identity. Do not redesign, restyle, invent new details, add new objects, or change the icon. Keep the result as the same icon, only cleaner, sharper, and higher resolution. Return a single edited image.";

    function loadAiSettings() {
        if (aiApiUrlInput) aiApiUrlInput.value = localStorage.getItem("UILink_AI_ApiUrl") || "";
        if (aiApiKeyInput) aiApiKeyInput.value = localStorage.getItem("UILink_AI_ApiKey") || "";
        if (aiModelInput) aiModelInput.value = localStorage.getItem("UILink_AI_Model") || "";
        if (aiPromptInput) aiPromptInput.value = localStorage.getItem("UILink_AI_Prompt") || defaultAiPrompt;
    }

    function bindAiSettingPersistence(inputEl, storageKey) {
        if (!inputEl) return;
        inputEl.addEventListener("input", function() {
            localStorage.setItem(storageKey, inputEl.value || "");
        });
        inputEl.addEventListener("change", function() {
            localStorage.setItem(storageKey, inputEl.value || "");
        });
    }

    function normalizeAiApiUrl(url) {
        var normalized = String(url || "").trim();
        if (!normalized) return "";
        if (/generativelanguage\.googleapis\.com/i.test(normalized)) return normalized.replace(/\/$/, "");
        if (/\/chat\/completions\/?$/i.test(normalized)) return normalized;
        if (/\/v1\/?$/i.test(normalized)) return normalized.replace(/\/?$/i, "/chat/completions");
        return normalized.replace(/\/?$/i, "/chat/completions");
    }

    function buildAuthHeader(apiKey) {
        var key = String(apiKey || "").trim();
        if (!key) return "";
        return /^Bearer\s+/i.test(key) ? key : ("Bearer " + key);
    }

    function isGeminiNativeApiUrl(apiUrl) {
        return /generativelanguage\.googleapis\.com/i.test(apiUrl || "") && !/\/chat\/completions\/?$/i.test(apiUrl || "");
    }

    function buildGeminiNativeUrl(apiUrl, model) {
        var normalized = String(apiUrl || "").replace(/\/$/, "");
        if (/\/models\/[^\/]+:generateContent$/i.test(normalized)) return normalized;
        if (/\/models\/[^\/]+$/i.test(normalized)) return normalized + ":generateContent";
        return normalized + "/models/" + encodeURIComponent(model) + ":generateContent";
    }

    function buildGeminiApiKey(apiKey) {
        return String(apiKey || "").trim().replace(/^Bearer\s+/i, "");
    }

    function normalizeBase64Payload(base64Text) {
        var normalized = String(base64Text || "").replace(/\s+/g, "");
        var mod = normalized.length % 4;
        if (mod === 2) normalized += "==";
        else if (mod === 3) normalized += "=";
        else if (mod === 1) normalized = normalized.slice(0, normalized.length - 1);
        return normalized;
    }

    function buildModelListRequest(apiUrl, apiKey) {
        var normalized = String(apiUrl || "").trim();
        if (!normalized) return null;

        if (isGeminiNativeApiUrl(normalized)) {
            return {
                mode: "gemini-native",
                url: normalized.replace(/\/$/, "") + "/models?pageSize=1000",
                headers: {
                    "x-goog-api-key": buildGeminiApiKey(apiKey)
                }
            };
        }

        var baseUrl = normalized;
        if (/\/chat\/completions\/?$/i.test(baseUrl)) {
            baseUrl = baseUrl.replace(/\/chat\/completions\/?$/i, "");
        }
        if (/\/responses\/?$/i.test(baseUrl)) {
            baseUrl = baseUrl.replace(/\/responses\/?$/i, "");
        }
        if (/\/completions\/?$/i.test(baseUrl)) {
            baseUrl = baseUrl.replace(/\/completions\/?$/i, "");
        }

        return {
            mode: "openai-compatible",
            url: baseUrl.replace(/\/$/, "") + "/models",
            headers: {
                "Authorization": buildAuthHeader(apiKey)
            }
        };
    }

    function normalizeGeminiModelName(modelName) {
        return String(modelName || "").replace(/^models\//i, "");
    }

    function scoreGeminiModel(modelName) {
        var name = normalizeGeminiModelName(modelName).toLowerCase();
        var score = 0;
        if (name.indexOf("image") !== -1) score += 100;
        if (name.indexOf("imagen") !== -1) score += 80;
        if (name.indexOf("preview") !== -1) score += 10;
        if (name.indexOf("flash") !== -1) score += 5;
        if (name.indexOf("exp") !== -1) score -= 5;
        return score;
    }

    function setAiModelOptions(modelNames) {
        var selectEl = document.getElementById("aiModelSelect");
        if (!selectEl) return;

        selectEl.innerHTML = "";
        if (!modelNames || !modelNames.length) {
            selectEl.style.display = "none";
            return;
        }

        modelNames.forEach(function(name) {
            var option = document.createElement("option");
            option.value = normalizeGeminiModelName(name);
            option.textContent = normalizeGeminiModelName(name);
            selectEl.appendChild(option);
        });

        if (aiModelInput) {
            var current = normalizeGeminiModelName(aiModelInput.value || "");
            var matched = modelNames.some(function(name) {
                return normalizeGeminiModelName(name) === current;
            });
            if (matched) {
                selectEl.value = current;
            } else {
                selectEl.selectedIndex = 0;
                aiModelInput.value = selectEl.value;
                localStorage.setItem("UILink_AI_Model", aiModelInput.value || "");
            }
        }

        selectEl.style.display = "block";
    }

    function parseModelListResponse(responseJson, mode) {
        var modelNames = [];

        if (mode === "gemini-native") {
            var geminiModels = Array.isArray(responseJson.models) ? responseJson.models : [];
            modelNames = geminiModels.filter(function(modelInfo) {
                var methods = modelInfo.supportedGenerationMethods || [];
                return methods.indexOf("generateContent") !== -1;
            }).map(function(modelInfo) {
                return normalizeGeminiModelName(modelInfo.name || modelInfo.baseModelId || "");
            }).filter(function(name) {
                return !!name;
            });
        } else {
            var openaiModels = Array.isArray(responseJson.data) ? responseJson.data : [];
            modelNames = openaiModels.map(function(modelInfo) {
                return String(modelInfo.id || modelInfo.name || "").trim();
            }).filter(function(name) {
                return !!name;
            });
        }

        modelNames.sort(function(a, b) {
            var diff = scoreGeminiModel(b) - scoreGeminiModel(a);
            if (diff !== 0) return diff;
            return a.localeCompare(b);
        });

        return modelNames;
    }

    function extractImageResult(responseJson) {
        function fromValue(value) {
            if (!value) return null;

            if (typeof value === "string") {
                if (/^data:image\//i.test(value)) return value;
                if (/^https?:\/\//i.test(value)) return value;
                if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 128) {
                    return "data:image/png;base64," + value.replace(/\s+/g, "");
                }
                return null;
            }

            if (Array.isArray(value)) {
                for (var i = 0; i < value.length; i++) {
                    var nested = fromValue(value[i]);
                    if (nested) return nested;
                }
                return null;
            }

            if (typeof value === "object") {
                if (value.inline_data) return fromValue(value.inline_data);
                if (value.inlineData) return fromValue(value.inlineData);
                if (value.url) return fromValue(value.url);
                if (value.image_url && value.image_url.url) return fromValue(value.image_url.url);
                if (value.b64_json) return fromValue(value.b64_json);
                if (value.base64) return fromValue(value.base64);
                if (value.image_base64) return fromValue(value.image_base64);
                if (value.image) return fromValue(value.image);
                if (value.output) return fromValue(value.output);
                if (value.images) return fromValue(value.images);
                if (value.data) return fromValue(value.data);
                if (value.content) return fromValue(value.content);
                if (value.message) return fromValue(value.message);
                if (value.choices) return fromValue(value.choices);
                if (value.candidates) return fromValue(value.candidates);
                if (value.parts) return fromValue(value.parts);
            }

            return null;
        }

        return fromValue(responseJson);
    }

    function importAiResultToPhotoshop(imageUrlOrData) {
        function getExtensionFromMimeType(mimeType) {
            var mime = String(mimeType || "").toLowerCase();
            if (mime.indexOf("png") !== -1) return "png";
            if (mime.indexOf("jpeg") !== -1 || mime.indexOf("jpg") !== -1) return "jpg";
            if (mime.indexOf("webp") !== -1) return "webp";
            return "png";
        }

        function getMimeTypeFromDataUrl(dataUrl) {
            var match = String(dataUrl || "").match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
            return match ? match[1] : "image/png";
        }

        function getExtensionFromBytes(bytes) {
            if (!bytes || bytes.length < 12) return "png";
            if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
            if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "jpg";
            if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
            return "png";
        }

        function saveBase64AndImport(dataUrl, forcedExtension) {
            var base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            var ext = forcedExtension || getExtensionFromMimeType(getMimeTypeFromDataUrl(dataUrl));
            var outPath = csInterface.getSystemPath(SystemPath.USER_DATA) + "\\uilink_ai_result_" + Date.now() + "." + ext;
            var writeRes = window.cep.fs.writeFile(outPath, base64Data, window.cep.encoding.Base64);
            if (writeRes.err !== window.cep.fs.NO_ERROR) {
                setStatus("Saving AI result failed.", "error");
                logMsg("[AI Clear] failed to write result PNG: " + writeRes.err);
                if (btnMakeClear) btnMakeClear.disabled = false;
                return;
            }

            var safePath = outPath.replace(/\\/g, "/").replace(/'/g, "\\'");
            csInterface.evalScript("replaceCurrentLayerWithFile('" + safePath + "')", function(res) {
                if (btnMakeClear) btnMakeClear.disabled = false;
                res = String(res || "").replace(/\r|\n/g, "").trim();
                if (res.indexOf("ERROR") === 0) {
                    setStatus(res, "error");
                    logMsg("[AI Clear] Photoshop import failed: " + res);
                    return;
                }

                setStatus("AI clear finished successfully.", "");
                logMsg("[AI Clear] done");
            });
        }

        if (/^data:image\//i.test(imageUrlOrData)) {
            saveBase64AndImport(imageUrlOrData);
            return;
        }

        var xhr = new XMLHttpRequest();
        xhr.open("GET", imageUrlOrData, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = function() {
            if (xhr.status !== 200) {
                setStatus("Downloading AI result failed.", "error");
                logMsg("[AI Clear] result download failed: HTTP " + xhr.status);
                if (btnMakeClear) btnMakeClear.disabled = false;
                return;
            }

            var bytes = new Uint8Array(xhr.response);
            var binary = "";
            var chunk = 0x8000;
            for (var i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
            }
            var contentType = xhr.getResponseHeader("Content-Type") || "";
            var inferredExt = getExtensionFromMimeType(contentType);
            if (!contentType) {
                inferredExt = getExtensionFromBytes(bytes);
            }
            saveBase64AndImport("data:image/" + inferredExt + ";base64," + btoa(binary), inferredExt);
        };
        xhr.onerror = function() {
            setStatus("Downloading AI result failed.", "error");
            logMsg("[AI Clear] result download network error");
            if (btnMakeClear) btnMakeClear.disabled = false;
        };
        xhr.send();
    }

    loadAiSettings();
    bindAiSettingPersistence(aiApiUrlInput, "UILink_AI_ApiUrl");
    bindAiSettingPersistence(aiApiKeyInput, "UILink_AI_ApiKey");
    bindAiSettingPersistence(aiModelInput, "UILink_AI_Model");
    bindAiSettingPersistence(aiPromptInput, "UILink_AI_Prompt");

    var aiModelSelect = document.getElementById("aiModelSelect");
    if (aiModelSelect && aiModelInput) {
        aiModelSelect.addEventListener("change", function() {
            aiModelInput.value = aiModelSelect.value || "";
            localStorage.setItem("UILink_AI_Model", aiModelInput.value || "");
        });
    }

    if (btnFetchModels) {
        btnFetchModels.addEventListener("click", function() {
            var apiUrl = normalizeAiApiUrl(aiApiUrlInput ? aiApiUrlInput.value : "");
            var apiKey = aiApiKeyInput ? aiApiKeyInput.value : "";

            if (!apiUrl || !apiKey) {
                setStatus("Please fill API URL and API Key first.", "error");
                logMsg("[AI Clear] model fetch missing API URL or API Key");
                return;
            }

            var requestInfo = buildModelListRequest(apiUrl, apiKey);
            if (!requestInfo) {
                setStatus("Building model list request failed.", "error");
                logMsg("[AI Clear] failed to build model list request");
                return;
            }

            var listUrl = requestInfo.url;
            var xhr = new XMLHttpRequest();
            xhr.open("GET", listUrl, true);
            Object.keys(requestInfo.headers).forEach(function(headerName) {
                xhr.setRequestHeader(headerName, requestInfo.headers[headerName]);
            });
            xhr.timeout = 30000;

            btnFetchModels.disabled = true;
            setStatus("Fetching model list...", "warning");
            logMsg("[AI Clear] fetching models from " + listUrl + " (" + requestInfo.mode + ")");

            xhr.onload = function() {
                btnFetchModels.disabled = false;

                if (xhr.status < 200 || xhr.status >= 300) {
                    setStatus("Model fetch failed: HTTP " + xhr.status, "error");
                    logMsg("[AI Clear] model fetch failed: HTTP " + xhr.status + " | " + xhr.responseText);
                    return;
                }

                var responseJson;
                try {
                    responseJson = JSON.parse(xhr.responseText);
                } catch (e) {
                    setStatus("Parsing model list failed.", "error");
                    logMsg("[AI Clear] model list JSON parse failed: " + e.message);
                    return;
                }

                var filtered = parseModelListResponse(responseJson, requestInfo.mode);

                setAiModelOptions(filtered);

                if (!filtered.length) {
                    setStatus("No usable models returned.", "warning");
                    logMsg("[AI Clear] model list returned 0 usable models");
                    return;
                }

                setStatus("Models fetched: " + filtered.length, "");
                logMsg("[AI Clear] model list fetched: " + filtered.slice(0, 10).join(", "));
            };

            xhr.onerror = function() {
                btnFetchModels.disabled = false;
                setStatus("Model fetch network error.", "error");
                logMsg("[AI Clear] model fetch network error");
            };

            xhr.ontimeout = function() {
                btnFetchModels.disabled = false;
                setStatus("Model fetch timed out.", "error");
                logMsg("[AI Clear] model fetch timeout");
            };

            xhr.send();
        });
    }

    if (btnMakeClear) {
        btnMakeClear.addEventListener("click", function() {
            if (btnMakeClear.disabled) return;

            var apiUrl = normalizeAiApiUrl(aiApiUrlInput ? aiApiUrlInput.value : "");
            var apiKey = aiApiKeyInput ? aiApiKeyInput.value : "";
            var model = aiModelInput ? aiModelInput.value.trim() : "";
            var promptText = aiPromptInput ? aiPromptInput.value.trim() : defaultAiPrompt;
            var isGeminiNative = isGeminiNativeApiUrl(apiUrl);

            if (!apiUrl || !apiKey || !model) {
                setStatus("Please fill API URL, API Key, and Model first.", "error");
                logMsg("[AI Clear] missing API configuration");
                return;
            }

            if (isGeminiNative && !/(image|imagen|nano)/i.test(model)) {
                setStatus("Selected Gemini model may not support image output. Use an image-capable Gemini model.", "warning");
                logMsg("[AI Clear] warning: model may not be image-capable: " + model);
            }

            btnMakeClear.disabled = true;
            setStatus("Step 1: exporting active layer for AI...", "warning");
            logMsg("[AI Clear] button clicked");

            csInterface.evalScript("getActiveLayerExportForAI()", function(result) {
                result = String(result || "").trim();
                if (!result || result.indexOf("ERROR") === 0) {
                    btnMakeClear.disabled = false;
                    setStatus("Export active layer failed.", "error");
                    logMsg("[AI Clear] export failed: " + result);
                    return;
                }

                var exportInfo;
                try {
                    exportInfo = JSON.parse(result);
                } catch (e) {
                    btnMakeClear.disabled = false;
                    setStatus("Parsing export info failed.", "error");
                    logMsg("[AI Clear] export JSON parse failed: " + e.message);
                    return;
                }

                var readRes = window.cep.fs.readFile(exportInfo.path, window.cep.encoding.Base64);
                if (readRes.err !== window.cep.fs.NO_ERROR || !readRes.data) {
                    btnMakeClear.disabled = false;
                    setStatus("Reading exported PNG failed.", "error");
                    logMsg("[AI Clear] read exported PNG failed: " + readRes.err);
                    return;
                }

                var normalizedImageBase64 = normalizeBase64Payload(readRes.data);
                if (!normalizedImageBase64) {
                    btnMakeClear.disabled = false;
                    setStatus("Normalizing exported PNG failed.", "error");
                    logMsg("[AI Clear] normalized base64 is empty");
                    return;
                }

                var xhr = new XMLHttpRequest();
                var requestUrl = apiUrl;
                var payload;

                if (isGeminiNative) {
                    requestUrl = buildGeminiNativeUrl(apiUrl, model);
                    payload = {
                        contents: [{
                            parts: [
                                { text: promptText || defaultAiPrompt },
                                {
                                    inline_data: {
                                        mime_type: "image/png",
                                        data: normalizedImageBase64
                                    }
                                }
                            ]
                        }],
                        generationConfig: {
                            responseModalities: ["TEXT", "IMAGE"]
                        }
                    };
                } else {
                    payload = {
                        model: model,
                        messages: [{
                            role: "user",
                            content: [
                                { type: "text", text: promptText || defaultAiPrompt },
                                { type: "image_url", image_url: { url: "data:image/png;base64," + normalizedImageBase64 } }
                            ]
                        }],
                        temperature: 0.2
                    };
                }

                xhr.open("POST", requestUrl, true);
                xhr.setRequestHeader("Content-Type", "application/json");
                if (isGeminiNative) {
                    xhr.setRequestHeader("x-goog-api-key", buildGeminiApiKey(apiKey));
                } else {
                    xhr.setRequestHeader("Authorization", buildAuthHeader(apiKey));
                }
                xhr.timeout = 120000;

                setStatus("Step 2: requesting AI upscale...", "warning");
                logMsg("[AI Clear] requesting " + requestUrl);
                logMsg("[AI Clear] mode: " + (isGeminiNative ? "Gemini native generateContent" : "OpenAI-compatible chat/completions"));

                xhr.onload = function() {
                    if (xhr.status < 200 || xhr.status >= 300) {
                        btnMakeClear.disabled = false;
                        setStatus("AI request failed: HTTP " + xhr.status, "error");
                        logMsg("[AI Clear] request failed: HTTP " + xhr.status + " | " + xhr.responseText);
                        return;
                    }

                    var responseJson;
                    try {
                        responseJson = JSON.parse(xhr.responseText);
                    } catch (e) {
                        btnMakeClear.disabled = false;
                        setStatus("Parsing AI response failed.", "error");
                        logMsg("[AI Clear] response JSON parse failed: " + e.message);
                        return;
                    }

                    var imageResult = extractImageResult(responseJson);
                    if (!imageResult) {
                        btnMakeClear.disabled = false;
                        setStatus("No image found in AI response.", "error");
                        logMsg("[AI Clear] no image payload found in response");
                        return;
                    }

                    setStatus("Step 3: importing AI result back to Photoshop...", "warning");
                    logMsg("[AI Clear] image payload received");
                    importAiResultToPhotoshop(imageResult);
                };

                xhr.onerror = function() {
                    btnMakeClear.disabled = false;
                    setStatus("AI request network error.", "error");
                    logMsg("[AI Clear] network error");
                };

                xhr.ontimeout = function() {
                    btnMakeClear.disabled = false;
                    setStatus("AI request timed out.", "error");
                    logMsg("[AI Clear] request timeout");
                };

                try {
                    xhr.send(JSON.stringify(payload));
                } catch (e) {
                    btnMakeClear.disabled = false;
                    setStatus("Sending AI request failed.", "error");
                    logMsg("[AI Clear] send failed: " + e.message);
                }
            });
        });
    }

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
