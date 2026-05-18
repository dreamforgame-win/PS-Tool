// ==========================================================
// 0. 全局聚类与 JSON Polyfill (兼容旧版 Photoshop)
// ==========================================================
#target photoshop

if (typeof JSON !== "object") { JSON = {}; }
(function () {
    "use strict";
    var rx_escapable = /[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    function f(n) { return n < 10 ? "0" + n : n; }
    function quote(string) {
        rx_escapable.lastIndex = 0;
        return rx_escapable.test(string) ? '"' + string.replace(rx_escapable, function (a) {
            var c = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' }[a];
            return typeof c === 'string' ? c : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
    }
    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value) {
            var i, k, v, length, partial, type = typeof value;
            if (value === null) return "null";
            if (type === "string") return quote(value);
            if (type === "number") return isFinite(value) ? String(value) : "null";
            if (type === "boolean") return String(value);
            if (type === "object") {
                partial = [];
                if (Object.prototype.toString.apply(value) === "[object Array]") {
                    length = value.length;
                    for (i = 0; i < length; i += 1) { partial[i] = JSON.stringify(value[i]) || "null"; }
                    return "[" + partial.join(",") + "]";
                }
                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = JSON.stringify(value[k]);
                        if (v) partial.push(quote(k) + ":" + v);
                    }
                }
                return "{" + partial.join(",") + "}";
            }
            return "";
        };
    }
    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text) { return eval("(" + text + ")"); };
    }
}());

var cachedDocData = null; 
var outputFolder = null;
var imagesFolder = null;
var exportedImagesCount = 0;
var totalLayersCount = 0;
var currentOptions = { includeHidden: false, refWidth: 1920, refHeight: 1080 };

// ==========================================================
// 1. 图层信息获取与重命名逻辑 (模块化)
// ==========================================================
function getActiveLayerInfo() {
    try {
        if (app.documents.length === 0) return "ERROR: 没有打开的文档";
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        if (!layer) return "ERROR: 未选中图层";

        // 记录原始单位并切换到像素，确保尺寸获取准确
        var oldUnit = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        var docName = doc.name.split(".")[0];
        var name = layer.name;
        
        var realW = 0, realH = 0;
        try {
            var bounds = layer.bounds;
            realW = Math.round(bounds[2].value - bounds[0].value);
            realH = Math.round(bounds[3].value - bounds[1].value);
        } catch(e) {}

        // 恢复原始单位
        app.preferences.rulerUnits = oldUnit;

        // 解析命名规则
        var info = {
            docName: docName,
            fullName: name,
            moduleName: docName,
            baseName: name,
            width: 0,
            height: 0,
            realWidth: realW,
            realHeight: realH,
            sliceSuffix: "0,0,0,0",
            outputType: "atlas",
            compType: "image",
            isExport: false
        };

        var parts = name.split("|");
        if (parts.length >= 6) {
            var nameParts = parts[0].split("_");
            info.moduleName = nameParts[0];
            info.baseName = nameParts.slice(1).join("_");
            info.outputType = parts[1];
            info.compType = parts[2];
            var sizeParts = parts[3].split("x");
            if (sizeParts.length === 2) {
                info.width = parseInt(sizeParts[0]) || 0;
                info.height = parseInt(sizeParts[1]) || 0;
            }
            info.sliceSuffix = parts[4];
            info.isExport = (parts[5] === "1");
        } else {
            // [智能读取规则] 针对非元数据图层的解析
            if (name.indexOf("@") !== -1) {
                // 图集模式: prefix@basename
                var atParts = name.split("@");
                info.outputType = "atlas:" + atParts[0];
                info.baseName = atParts[1];
                info.compType = "image";
            } else if (name.indexOf("tex_") === 0) {
                // 大图模式: tex_basename
                info.outputType = "texture";
                info.baseName = name.substring(4);
                info.compType = "texture";
            } else {
                info.baseName = name;
            }
        }

        // 手动构建简单的 JSON，规避 Polyfill 风险
        return "{" + 
            "\"docName\":\"" + info.docName + "\"," +
            "\"fullName\":\"" + info.fullName.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"") + "\"," +
            "\"moduleName\":\"" + info.moduleName + "\"," +
            "\"baseName\":\"" + info.baseName.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"") + "\"," +
            "\"width\":" + info.width + "," +
            "\"height\":" + info.height + "," +
            "\"realWidth\":" + info.realWidth + "," +
            "\"realHeight\":" + info.realHeight + "," +
            "\"sliceSuffix\":\"" + info.sliceSuffix + "\"," +
            "\"outputType\":\"" + info.outputType + "\"," +
            "\"compType\":\"" + info.compType + "\"," +
            "\"isExport\":" + info.isExport + 
        "}";
    } catch(e) { return "ERROR: " + e.toString(); }
}

function applyLayerRename(infoStr) {
    try {
        var info = JSON.parse(infoStr);
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        if (!layer) return "ERROR: 未选中图层";

        // 拼接新命名
        var rootBase = info.moduleName + "_" + info.baseName;
        var sizeStr = (info.width || 0) + "x" + (info.height || 0);
        var sliceStr = info.sliceSuffix || "0,0,0,0";
        var exportStr = info.isExport ? "1" : "0";
        var newName = rootBase + "|" + info.outputType + "|" + info.compType + "|" + sizeStr + "|" + sliceStr + "|" + exportStr;
        
        // 【核心修复】查重校验
        var checkResult = checkDuplicateExportNames(layer.id, newName);
        if (checkResult !== "OK") {
            return "ERROR: " + checkResult;
        }

        layer.name = newName;
        return newName;
    } catch(e) { return "ERROR: " + e.toString(); }
}

// ==========================================
// 辅助：查重子逻辑
// ==========================================
function getExportFileName(layerName) {
    var parts = layerName.split("|");
    if (parts.length < 6) return null;
    if (parts[5] === "0") return null; 

    var outputTypeStr = parts[1];
    var baseParts = parts[0].split("_");
    if (baseParts.length < 2) return null;
    var baseName = baseParts.slice(1).join("_");
    
    if (outputTypeStr.indexOf("texture") === 0) {
        return "tex_" + baseName + ".png";
    } else {
        // 解析图集前缀 atlas:prefix
        var prefix = "common";
        if (outputTypeStr.indexOf("atlas:") === 0) {
            prefix = outputTypeStr.split(":")[1] || "common";
        }
        return prefix + "@" + baseName + ".png";
    }
}

function checkDuplicateExportNames(activeLayerId, proposedName) {
    var doc = app.activeDocument;
    var nameMap = {};
    var layers = [];
    
    function getAllLayers(parent) {
        for (var i = 0; i < parent.layers.length; i++) {
            var l = parent.layers[i];
            if (l.typename === "LayerSet") getAllLayers(l);
            else layers.push(l);
        }
    }
    getAllLayers(doc);

    for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        var lName = (l.id === activeLayerId) ? proposedName : l.name;
        var exportName = getExportFileName(lName);
        
        if (exportName) {
            if (nameMap[exportName]) {
                return "导出文件名 [" + exportName + "] 冲突！冲突图层: [" + nameMap[exportName] + "]";
            }
            nameMap[exportName] = l.name;
        }
    }
    return "OK";
}

function exportLayerImage(layer, fileName) {
    var doc = app.activeDocument;
    // 显隐逻辑已移至 exportSelectedLayers 批量处理
    var success = false;
    var tempDoc = null;
    try {
        // 1. 解析命名元数据
        var nameParts = layer.name.split("|");
        var forceW = 0, forceH = 0;
        var outputType = "atlas";
        var baseName = layer.name.split("@")[0];

        if (nameParts.length >= 6) {
            outputType = nameParts[1];
            var sizeParts = nameParts[3].split("x");
            forceW = parseInt(sizeParts[0]) || 0;
            forceH = parseInt(sizeParts[1]) || 0;
            var rootParts = nameParts[0].split("_");
            baseName = rootParts.slice(1).join("_");
        }

        // 2. 确定最终文件名
        var finalFileName = "";
        if (outputType.indexOf("texture") === 0) {
            finalFileName = "tex_" + baseName + ".png";
        } else {
            var prefix = "common";
            if (outputType.indexOf("atlas:") === 0) {
                prefix = outputType.split(":")[1] || "common";
            }
            finalFileName = prefix + "@" + baseName + ".png";
        }

        // 3. 复制并处理
        tempDoc = doc.duplicate("temp_export_doc");
        app.activeDocument = tempDoc;
        
        // 【关键修复】在副本中重新定位并激活目标图层
        var targetLayerInTemp = findLayerById(tempDoc, layer.id);
        if (targetLayerInTemp) {
            tempDoc.activeLayer = targetLayerInTemp;
        }

        // 强制设置单位为像素
        var oldRulerUnits = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        var res = doc.resolution;

        // 【核心修复】1. 先修剪掉透明区域，使得图片紧贴并在这个临时画布中绝对居中
        tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
        
        // 【核心修复】2. 如果指定了强制尺寸，基于中心调整画布，保证四周增加等量的透明占位
        if (forceW > 0 && forceH > 0) {
            tempDoc.resizeCanvas(UnitValue(forceW, "px"), UnitValue(forceH, "px"), AnchorPosition.MIDDLECENTER);
        }

        var isNineSliceExport = false;
        
        var w = tempDoc.width.as("px");
        var h = tempDoc.height.as("px");

        // 4. 九宫格挤压裁剪
        var sliceParts = (nameParts.length >= 6) ? nameParts[4].split(",") : [];
        if (sliceParts.length === 4) {
            var st = parseInt(sliceParts[0]) || 0;
            var sb = parseInt(sliceParts[1]) || 0;
            var sl = parseInt(sliceParts[2]) || 0;
            var sr = parseInt(sliceParts[3]) || 0;
            // 规范化：如果单边为0，同轴的另一边也强制归零
            if (st === 0 || sb === 0) { st = 0; sb = 0; }
            if (sl === 0 || sr === 0) { sl = 0; sr = 0; }

            if ((sl + sr > 0 && sl + sr < w) || (st + sb > 0 && st + sb < h)) {
                // 判断切分模式
                var isHorizontal3Slice = (st + sb === 0 && sl + sr > 0);
                var isVertical3Slice = (sl + sr === 0 && st + sb > 0);
                var is4Corner = (!isHorizontal3Slice && !isVertical3Slice);

                // 动态计算最终画布大小
                var finalW = (sl + sr > 0) ? (sl + sr) : w;
                var finalH = (st + sb > 0) ? (st + sb) : h;
                
                var processCorner = function(srcDoc, sx, sy, sw, sh, anchor) {
                    if (sw <= 0 || sh <= 0) return null;
                    try {
                        app.activeDocument = srcDoc;
                        var partDoc = srcDoc.duplicate();
                        partDoc.crop([sx, sy, sx + sw, sy + sh]);
                        partDoc.resizeCanvas(UnitValue(finalW, "px"), UnitValue(finalH, "px"), anchor);
                        return partDoc;
                    } catch(e) {
                        return null;
                    }
                };

                var docsToMerge = [];

                if (is4Corner) {
                    docsToMerge.push(processCorner(tempDoc, 0, 0, sl, st, AnchorPosition.TOPLEFT));
                    docsToMerge.push(processCorner(tempDoc, w - sr, 0, sr, st, AnchorPosition.TOPRIGHT));
                    docsToMerge.push(processCorner(tempDoc, 0, h - sb, sl, sb, AnchorPosition.BOTTOMLEFT));
                    docsToMerge.push(processCorner(tempDoc, w - sr, h - sb, sr, sb, AnchorPosition.BOTTOMRIGHT));
                } else if (isHorizontal3Slice) {
                    // 水平 3 宫格：保留左右，保持全高
                    docsToMerge.push(processCorner(tempDoc, 0, 0, sl, h, AnchorPosition.TOPLEFT));
                    docsToMerge.push(processCorner(tempDoc, w - sr, 0, sr, h, AnchorPosition.TOPRIGHT));
                } else if (isVertical3Slice) {
                    // 垂直 3 宫格：保留上下，保持全宽
                    docsToMerge.push(processCorner(tempDoc, 0, 0, w, st, AnchorPosition.TOPLEFT));
                    docsToMerge.push(processCorner(tempDoc, 0, h - sb, w, sb, AnchorPosition.BOTTOMLEFT));
                }

                // 以第一个有效文档为基准
                var finalDoc = null;
                for (var i = 0; i < docsToMerge.length; i++) {
                    if (docsToMerge[i]) {
                        finalDoc = docsToMerge[i];
                        break;
                    }
                }
                
                if (finalDoc) {
                    app.activeDocument = finalDoc;
                    
                    var mergeIn = function(partDoc) {
                        if (partDoc && partDoc !== finalDoc) {
                            app.activeDocument = partDoc;
                            partDoc.activeLayer.duplicate(finalDoc);
                            partDoc.close(SaveOptions.DONOTSAVECHANGES);
                        }
                    };

                    for (var j = 0; j < docsToMerge.length; j++) {
                        mergeIn(docsToMerge[j]);
                    }

                    app.activeDocument = finalDoc;
                    finalDoc.mergeVisibleLayers();
                    
                    tempDoc.close(SaveOptions.DONOTSAVECHANGES);
                    tempDoc = finalDoc;
                    isNineSliceExport = true;
                }
            }
        }

        // 恢复单位
        app.preferences.rulerUnits = oldRulerUnits;

        // 终极减重：只有九宫格（切去了中间部分）才需要在拼合后进行最终减重裁剪
        // 如果是非九宫格且带有强制宽高参数，绝不能再做二次 trim，否则会破坏预期的透明占位！
        if (isNineSliceExport) {
            tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
        }

        var saveFile = new File(imagesFolder.fsName + "/" + finalFileName);
        var opts = new PNGSaveOptions();
        opts.compression = 6;
        tempDoc.saveAs(saveFile, opts, true, Extension.LOWERCASE);
        success = true;
    } catch (e) {
        // 记录错误但不中断循环
    } finally {
        if (tempDoc) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    }

    // 注意：显隐还原移到了外层的批量导出函数中
    app.activeDocument = doc;
    return success;
}

// ==========================================================
// 2. 快捷命名功能
// ==========================================================
function renameActiveLayer(prefix, suffix) {
    try {
        if (app.documents.length === 0) return "ERROR: 没有打开的文档";
        var layer = app.activeDocument.activeLayer;

        var rawName = layer.name;
        // 清理旧前缀
        rawName = rawName.replace(/^btn_|^bg_|^icon_|^p_|^txt_/, "");
        rawName = rawName.replace(/^[^_]+_[^_]+_/, ""); 
        // 清理旧后缀
        rawName = rawName.replace(/_atlas(?:@[0-9x,]+)?$|_raw(?:@[0-9x,]+)?$|_img(?:@[0-9x,]+)?$|_9(?:@[0-9x,]+)?$/, "");

        var newName = prefix + rawName + suffix;
        layer.name = newName;
        return newName;
    } catch(e) {
        return "ERROR:" + e.toString();
    }
}

// ==========================================================
// 3. 扫描变动层 (Diff)
// ==========================================================
function selectOutputFolderDialog() {
    app.bringToFront();
    var folder = Folder.selectDialog("请选择 UI-Link 导出文件夹");
    return folder ? folder.fsName : "CANCELLED";
}

function scanChanges(payloadStr) {
    try {
        if (app.documents.length === 0) return "ERROR: 请先打开 PSD 文档";
        
        var payload = JSON.parse(payloadStr);
        var jsonFolder = payload.jsonFolder;
        if (!jsonFolder || jsonFolder === "undefined") return "ERROR: 未指定 JSON 目录";

        var doc = app.activeDocument;
        var docName = doc.name.replace(/\.[^\.]+$/, ""); // 获取无后缀的 PSD 文档名
        var oldLayersMap = {};
        var isFirstTime = true;

        var jsonFile = new File(jsonFolder + "/" + docName + ".json");
        if (jsonFile.exists) {
            jsonFile.encoding = "UTF-8";
            jsonFile.open("r");
            var content = jsonFile.read();
            jsonFile.close();
            try {
                var oldData = JSON.parse(content);
                flattenLayersToMap(oldData.layers, oldLayersMap);
                isFirstTime = false;
            } catch(e) { } 
        }

        totalLayersCount = 0;
        var rootParsedLayers = [];
        for (var i = 0; i < doc.layers.length; i++) {
            var parsed = parseLayerRecursive(doc.layers[i], null, doc);
            if (parsed != null) rootParsedLayers.push(parsed);
        }

        var newLayersMap = {};
        flattenLayersToMap(rootParsedLayers, newLayersMap);

        var diffItems = [];
        for (var id in newLayersMap) {
            if (!newLayersMap.hasOwnProperty(id)) continue;
            var nl = newLayersMap[id];
            if (!shouldExportImage(nl.type)) continue;

            var status = "new";
            var ol = oldLayersMap[id];

            // 检查导出标志位 (元数据的第 6 位)
            var nameParts = nl.fullName ? nl.fullName.split("|") : [];
            
            // [新增判断] 如果命名规则不符合预设的 6 段式元数据，说明没有经过属性面板标准化，直接跳过（默认为不导出）
            if (nameParts.length < 6) continue;

            var exportFlag = nameParts[5];

            if (exportFlag === "0") {
                status = "disabled"; // 用户主动关闭导出
            } else if (ol) {
                // 精确对比：图层名、边界尺寸
                var nameMatch = (ol.fullName === nl.fullName);
                var boundsMatch = (Math.abs(ol.bounds.width - nl.bounds.width) < 1 && 
                                  Math.abs(ol.bounds.height - nl.bounds.height) < 1 &&
                                  Math.abs(ol.bounds.left - nl.bounds.left) < 1 &&
                                  Math.abs(ol.bounds.top - nl.bounds.top) < 1);
                
                if (nameMatch && boundsMatch) {
                    status = "same";
                } else {
                    status = "mod";
                }
            }

            diffItems.push({ id: nl.id, name: nl.fullName || nl.name, status: status });
        }

        cachedDocData = {
            version: "1.0.0",
            document: { name: doc.name, width: doc.width.as("px"), height: doc.height.as("px"), resolution: doc.resolution },
            settings: { referenceResolution: { width: 1920, height: 1080 }, pixelsPerUnit: 100, textComponent: "Auto", fontMapping: {} },
            layers: rootParsedLayers
        };

        return JSON.stringify({ isFirstTime: isFirstTime, items: diffItems });

    } catch(e) { return "ERROR:" + e.toString(); }
}

function flattenLayersToMap(layersArr, map) {
    if (!layersArr) return;
    for (var i=0; i<layersArr.length; i++) {
        map[layersArr[i].id] = layersArr[i];
        if (layersArr[i].children) flattenLayersToMap(layersArr[i].children, map);
    }
}

// ==========================================================
// 4. 增量导出面板接口
// ==========================================================
function exportSelectedLayers(payloadStr) {
    var doc = app.activeDocument;
    var originalVisibility = storeVisibility(doc);
    var tempDocsToClose = [];

    try {
        var payload = JSON.parse(payloadStr);
        var selectedIds = payload.selectedIds || [];
        if (!cachedDocData || selectedIds.length === 0) return "ERROR: 数据丢失或未选图层";

        imagesFolder = new Folder(payload.imageFolder);
        if (!imagesFolder.exists) {
            if (!imagesFolder.create()) return "ERROR: 无法创建图片目录";
        }

        // 批量导出开始：隐藏所有图层
        hideAllLayers(doc);
        var count = 0;
        var skipCount = 0;
        var errorMsgs = [];

        for (var i = 0; i < selectedIds.length; i++) {
            var targetId = parseInt(selectedIds[i], 10);
            var realLayer = findLayerById(doc, targetId);
            if (realLayer) {
                // 二次校验导出标志位
                var nameParts = realLayer.name.split("|");
                var exportFlag = (nameParts.length >= 6) ? nameParts[5] : "1";
                
                if (exportFlag === "1") {
                    realLayer.visible = true;
                    showParentGroups(realLayer);

                    try {
                        if (exportLayerImage(realLayer, realLayer.name)) {
                            count++;
                        } else {
                            errorMsgs.push(realLayer.name + ": 导出函数返回失败");
                        }
                    } catch(layerErr) {
                        errorMsgs.push(realLayer.name + ": " + layerErr.toString());
                    }
                    realLayer.visible = false;
                } else {
                    skipCount++;
                }
            }
        }

        // 【关键修复】按当前文档名保存 JSON 数据，防止数据相互覆盖或越积越多
        var docName = doc.name.replace(/\.[^\.]+$/, "");
        var jsonFile = new File(payload.jsonFolder + "/" + docName + ".json");
        jsonFile.encoding = "UTF-8";
        jsonFile.open("w");
        jsonFile.write(JSON.stringify(cachedDocData));
        jsonFile.close();

        var msg = "成功导出 " + count + " 张图片。";
        if (skipCount > 0) msg += " 跳过 " + skipCount + " 个关闭导出的项。";
        if (errorMsgs.length > 0) msg += " 错误: " + errorMsgs.join("; ");
        
        return "SUCCESS: " + msg;
    } catch(e) { 
        return "ERROR: " + e.toString(); 
    } finally {
        // 100% 还原显隐状态
        restoreVisibility(originalVisibility);
        // 再次确保没有任何残留文档
        while (app.documents.length > 1 && app.activeDocument.name.indexOf("temp_") !== -1) {
            app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
        }
        app.activeDocument = doc;
    }
}

// ==========================================================
// 4. Tools-Box：九宫格转换与无损还原
// ==========================================================

function convertToScalable9Slice() {
    try {
        var doc = app.activeDocument;
        var layer = doc.activeLayer;

        var nameParts = layer.name.split("|");
        var sliceParams = (nameParts.length >= 6) ? nameParts[4] : "";
        if (!sliceParams || sliceParams === "0,0,0,0") {
            return "ERROR: 图层必须先设置并应用九宫格参数（非 0,0,0,0）";
        }

        var parts = sliceParams.split(",");
        var t = parseInt(parts[0], 10);
        var b = parseInt(parts[1], 10);
        var l = parseInt(parts[2], 10);
        var r = parseInt(parts[3], 10);

        if (t===0 && b===0 && l===0 && r===0) return "ERROR: 九宫格参数全为0，无需转换";

        // 先把名字缓存下来，防止图层转智能对象后引用失效
        var originalName = layer.name;

        // 将当前图层转换为智能对象
        var idnewPlacedLayer = stringIDToTypeID( "newPlacedLayer" );
        executeAction( idnewPlacedLayer, undefined, DialogModes.NO );

        // 进入智能对象内部
        var idplacedLayerEditContents = stringIDToTypeID( "placedLayerEditContents" );
        executeAction( idplacedLayerEditContents, new ActionDescriptor(), DialogModes.NO );

        var innerDoc = app.activeDocument;
        var originalLayer = innerDoc.activeLayer;

        var oldRulerUnits = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        var w = innerDoc.width.as("px");
        var h = innerDoc.height.as("px");

        originalLayer.visible = false;

        var slices = [
            { name: "TL", bounds: [0, 0, l, t] },
            { name: "TC", bounds: [l, 0, w - r, t] },
            { name: "TR", bounds: [w - r, 0, w, t] },
            { name: "ML", bounds: [0, t, l, h - b] },
            { name: "MC", bounds: [l, t, w - r, h - b] },
            { name: "MR", bounds: [w - r, t, w, h - b] },
            { name: "BL", bounds: [0, h - b, l, h] },
            { name: "BC", bounds: [l, h - b, w - r, h] },
            { name: "BR", bounds: [w - r, h - b, w, h] }
        ];

        for (var i = 0; i < slices.length; i++) {
            var s = slices[i];
            if (s.bounds[2] - s.bounds[0] < 1 || s.bounds[3] - s.bounds[1] < 1) continue;

            innerDoc.activeLayer = originalLayer;
            originalLayer.visible = true;

            var selBounds = [
                [s.bounds[0], s.bounds[1]],
                [s.bounds[2], s.bounds[1]],
                [s.bounds[2], s.bounds[3]],
                [s.bounds[0], s.bounds[3]]
            ];
            innerDoc.selection.select(selBounds);

            // 核心修复：使用 "通过拷贝的图层" 原位创建切片，彻底杜绝 Paste 带来的位移
            var idcopyToLayer = stringIDToTypeID( "copyToLayer" );
            executeAction( idcopyToLayer, undefined, DialogModes.NO );

            var newL = innerDoc.activeLayer;
            newL.name = s.name;
            originalLayer.visible = false;
        }

        originalLayer.remove();
        app.preferences.rulerUnits = oldRulerUnits;

        innerDoc.save();
        innerDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 修改图层名字打个 SMART 标记
        // 此时 app.activeDocument 已经回到原来的文档，且选中了新生成的智能对象
        doc.activeLayer.name = originalName + "|SMART";

        return "SUCCESS";
    } catch(e) { return "ERROR: " + e.toString() + " (line " + e.line + ")"; }
}

function restoreScaled9Slice() {
    try {
        var doc = app.activeDocument;
        var layer = doc.activeLayer;

        if (layer.name.indexOf("|SMART") === -1) {
            return "ERROR: 图层必须是由 Tools-Box 生成的可拉伸九宫格对象（带有 SMART 标记）";
        }

        var nameParts = layer.name.split("|");
        var sliceParams = (nameParts.length >= 6) ? nameParts[4] : "";
        var parts = sliceParams.split(",");
        var t = parseInt(parts[0], 10) || 0;
        var b = parseInt(parts[1], 10) || 0;
        var l = parseInt(parts[2], 10) || 0;
        var r = parseInt(parts[3], 10) || 0;

        var oldRulerUnits = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        var outerBounds = layer.bounds;
        var targetW = outerBounds[2].as("px") - outerBounds[0].as("px");
        var targetH = outerBounds[3].as("px") - outerBounds[1].as("px");

        // 尝试通过 Action 进入智能对象
        var idplacedLayerEditContents = stringIDToTypeID( "placedLayerEditContents" );
        executeAction( idplacedLayerEditContents, new ActionDescriptor(), DialogModes.NO );

        var innerDoc = app.activeDocument;
        if (innerDoc === doc) {
             throw new Error("无法进入智能对象内部进行编辑！");
        }

        innerDoc.resizeCanvas(UnitValue(targetW, "px"), UnitValue(targetH, "px"), AnchorPosition.TOPLEFT);

        var getL = function(n) { try { return innerDoc.layers.getByName(n); } catch(e){ return null; } };
        var tl = getL("TL"), tc = getL("TC"), tr = getL("TR");
        var ml = getL("ML"), mc = getL("MC"), mr = getL("MR");
        var bl = getL("BL"), bc = getL("BC"), br = getL("BR");

        if (tr) tr.translate(UnitValue(targetW - r - tr.bounds[0].as("px"), "px"), 0);
        if (bl) bl.translate(0, UnitValue(targetH - b - bl.bounds[1].as("px"), "px"));
        if (br) br.translate(UnitValue(targetW - r - br.bounds[0].as("px"), "px"), UnitValue(targetH - b - br.bounds[1].as("px"), "px"));

        var resizeLayer = function(targetLayer, w, h) {
            if (!targetLayer) return;
            var curW = targetLayer.bounds[2].as("px") - targetLayer.bounds[0].as("px");
            var curH = targetLayer.bounds[3].as("px") - targetLayer.bounds[1].as("px");
            if (curW <= 0 || curH <= 0) return;
            var scaleX = (w / curW) * 100;
            var scaleY = (h / curH) * 100;
            targetLayer.resize(scaleX, scaleY, AnchorPosition.TOPLEFT);
        };

        if (tc) {
            resizeLayer(tc, targetW - l - r, t);
            tc.translate(UnitValue(l - tc.bounds[0].as("px"), "px"), 0);
        }
        if (bc) {
            resizeLayer(bc, targetW - l - r, b);
            bc.translate(UnitValue(l - bc.bounds[0].as("px"), "px"), UnitValue(targetH - b - bc.bounds[1].as("px"), "px"));
        }
        if (ml) {
            resizeLayer(ml, l, targetH - t - b);
            ml.translate(0, UnitValue(t - ml.bounds[1].as("px"), "px"));
        }
        if (mr) {
            resizeLayer(mr, r, targetH - t - b);
            mr.translate(UnitValue(targetW - r - mr.bounds[0].as("px"), "px"), UnitValue(t - mr.bounds[1].as("px"), "px"));
        }

        if (mc) {
            resizeLayer(mc, targetW - l - r, targetH - t - b);
            mc.translate(UnitValue(l - mc.bounds[0].as("px"), "px"), UnitValue(t - mc.bounds[1].as("px"), "px"));
        }

        innerDoc.save();
        innerDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 重置最外层智能对象的缩放比例，使其回到 100% (不发生二次放大)
        var curOuterW = layer.bounds[2].as("px") - layer.bounds[0].as("px");
        var curOuterH = layer.bounds[3].as("px") - layer.bounds[1].as("px");

        if (curOuterW > 0 && curOuterH > 0 && targetW > 0 && targetH > 0) {
            var restoreScaleX = (targetW / curOuterW) * 100;
            var restoreScaleY = (targetH / curOuterH) * 100;
            // 只有当偏差超过 1% 时，才执行外层矩阵重置，防止浮点数精度反复震荡
            if (Math.abs(restoreScaleX - 100) > 1 || Math.abs(restoreScaleY - 100) > 1) {
                layer.resize(restoreScaleX, restoreScaleY, AnchorPosition.MIDDLECENTER);
            }
        }

        app.preferences.rulerUnits = oldRulerUnits;

        return "SUCCESS";
    } catch(e) { return "ERROR: " + e.toString() + " (line " + e.line + ")"; }
}

// ==========================================================
// 5. 九宫格辅助
// ==========================================================
function getActiveLayerPreview() {
    try {
        if (app.documents.length === 0) return "ERROR: 没有打开的文档";
        var doc = app.activeDocument;
        var layer = doc.activeLayer;

        var oldUnit = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        var w, h, res;
        try {
            w = layer.bounds[2].value - layer.bounds[0].value;
            h = layer.bounds[3].value - layer.bounds[1].value;
            res = doc.resolution;
        } catch (e) { 
            app.preferences.rulerUnits = oldUnit;
            return "ERROR: 无法获取图层尺寸"; 
        }

        // 核心优化：创建一个匹配图层大小的新文档，而不是复制整个大文档
        var tempDoc = app.documents.add(new UnitValue(w, "px"), new UnitValue(h, "px"), res, "temp_preview", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        
        // 切回原文档，执行图层复制
        app.activeDocument = doc;
        layer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
        
        // 切到新文档处理预览
        app.activeDocument = tempDoc;
        
        // 缩放逻辑 (针对特大图层进行预览压缩)
        var maxPreviewSize = 600;
        var curW = tempDoc.width.as("px");
        var curH = tempDoc.height.as("px");
        
        if (curW > maxPreviewSize || curH > maxPreviewSize) {
            var ratio = Math.min(maxPreviewSize / curW, maxPreviewSize / curH);
            tempDoc.resizeImage(new UnitValue(curW * ratio, "px"), new UnitValue(curH * ratio, "px"), null, ResampleMethod.BICUBIC);
        }

        var tmpFile = new File(Folder.temp.fsName + "/uilink_preview.png");
        var opts = new PNGSaveOptions();
        opts.compression = 9;
        tempDoc.saveAs(tmpFile, opts, true, Extension.LOWERCASE);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);

        tmpFile.encoding = "BINARY";
        tmpFile.open("r");
        var binaryString = tmpFile.read();
        tmpFile.close();
        tmpFile.remove();

        app.preferences.rulerUnits = oldUnit;
        return JSON.stringify({ 
            b64: encodeBase64(binaryString), 
            width: w, 
            height: h
        });
    } catch(e) { 
        return "ERROR: " + e.toString(); 
    }
}


function applyNineSliceCrop(top, bottom, left, right) {
    try {
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        var name = layer.name;
        var parts = name.split("|");
        var sliceStr = top + "," + bottom + "," + left + "," + right;

        if (parts.length >= 6) {
            // 如果已经是新格式，只替换九宫格部分 (索引为 4)
            parts[4] = sliceStr;
            layer.name = parts.join("|");
        } else {
            // 如果是旧格式，尝试转换为新格式的基础结构
            var docName = doc.name.split(".")[0];
            var baseName = name.split("@")[0];
            // 默认：模块名_基础名|图集|图片|尺寸|九宫格|导出
            var bounds = layer.bounds;
            var w = Math.round(bounds[2].value - bounds[0].value);
            var h = Math.round(bounds[3].value - bounds[1].value);
            
            layer.name = docName + "_" + baseName + "|atlas|image|" + w + "x" + h + "|" + sliceStr + "|1";
        }
        return layer.name; // 返回新名称供前端同步
    } catch(e) { return "ERROR:" + e.toString(); }
}

// ==========================================================
// 工具函数集
// ==========================================================
function parseLayerRecursive(layer, parentBounds, doc) {
    if (!currentOptions.includeHidden && !layer.visible) return null;

    var type = detectLayerType(layer);
    var bounds = getBounds(layer);
    var unityPosition = computeUnityPosition(bounds, parentBounds, doc);

    var parsed = {
        id: layer.id,
        name: sanitizeName(layer.name),
        fullName: layer.name, // 记录完整名用于对比
        type: type,
        visible: layer.visible,
        opacity: layer.opacity,
        bounds: bounds,
        unityPosition: unityPosition,
        children: [],
        imageData: null
    };

    if (shouldExportImage(type)) {
        parsed.imageData = { fileName: parsed.name + ".png", relativePath: "images/" + parsed.name + ".png" };
    }

    if (layer.typename === "LayerSet") {
        for (var i = 0; i < layer.layers.length; i++) {
            var childParsed = parseLayerRecursive(layer.layers[i], bounds, doc);
            if (childParsed != null) parsed.children.push(childParsed);
        }
    }
    return parsed;
}

function detectLayerType(layer) {
    var name = layer.name;
    if (/^btn_/i.test(name)) return "button";
    if (/_9$/i.test(name)) return "slice9";
    if (layer.kind === LayerKind.TEXT) return "text";
    return "image";
}

function shouldExportImage(type) { return type === "image" || type === "button" || type === "slice9"; }

function sanitizeName(name) {
    return name ? name.toString().replace(/[\/\\:\*\?"<>\|]/g, "_").replace(/\s+/g, "_") : "Layer";
}

function getBounds(layer) {
    try {
        var b = layer.bounds;
        return { left: b[0].as("px"), top: b[1].as("px"), width: b[2].as("px") - b[0].as("px"), height: b[3].as("px") - b[1].as("px") };
    } catch (e) { return { left: 0, top: 0, width: 0, height: 0 }; }
}

function computeUnityPosition(bounds, parentBounds, doc) {
    var docW = currentOptions.refWidth || doc.width.as("px");
    var docH = currentOptions.refHeight || doc.height.as("px");
    if (parentBounds) {
        return { x: bounds.left + bounds.width / 2 - (parentBounds.left + parentBounds.width / 2), y: (parentBounds.top + parentBounds.height / 2) - (bounds.top + bounds.height / 2) };
    }
    return { x: bounds.left + bounds.width / 2 - docW / 2, y: docH / 2 - bounds.top - bounds.height / 2 };
}

function findLayerById(parent, id) {
    for (var i = 0; i < parent.layers.length; i++) {
        var l = parent.layers[i];
        if (l.id === id) return l;
        if (l.typename === "LayerSet") {
            var found = findLayerById(l, id);
            if (found) return found;
        }
    }
    return null;
}

function storeVisibility(doc) {
    var states = [];
    for (var i = 0; i < doc.layers.length; i++) {
        states.push({ layer: doc.layers[i], visible: doc.layers[i].visible });
        if (doc.layers[i].typename === "LayerSet") states = states.concat(storeVisibilityGroups(doc.layers[i]));
    }
    return states;
}
function storeVisibilityGroups(group) {
    var states = [];
    for (var i = 0; i < group.layers.length; i++) {
        states.push({ layer: group.layers[i], visible: group.layers[i].visible });
        if (group.layers[i].typename === "LayerSet") states = states.concat(storeVisibilityGroups(group.layers[i]));
    }
    return states;
}
function hideAllLayers(doc) {
    for (var i = 0; i < doc.layers.length; i++) {
        doc.layers[i].visible = false;
        if (doc.layers[i].typename === "LayerSet") hideAllLayersGroups(doc.layers[i]);
    }
}
function hideAllLayersGroups(group) {
    for (var i = 0; i < group.layers.length; i++) {
        group.layers[i].visible = false;
        if (group.layers[i].typename === "LayerSet") hideAllLayersGroups(group.layers[i]);
    }
}
function showParentGroups(layer) {
    var parent = layer.parent;
    while (parent && parent.typename === "LayerSet") {
        parent.visible = true;
        parent = parent.parent;
    }
}
function restoreVisibility(states) {
    for (var i = 0; i < states.length; i++) {
        try { states[i].layer.visible = states[i].visible; } catch (e) {}
    }
}
function encodeBase64(input) {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
    var i = 0;
    while (i < input.length) {
        chr1 = input.charCodeAt(i++) & 0xff;
        chr2 = input.charCodeAt(i++) & 0xff;
        chr3 = input.charCodeAt(i++) & 0xff;
        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;
        if (isNaN(chr2)) { enc3 = enc4 = 64; }
        else if (isNaN(chr3)) { enc4 = 64; }
        output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) + keyStr.charAt(enc3) + keyStr.charAt(enc4);
    }
    return output;
}

function placeFile(filePath) {
    try {
        var file = new File(filePath);
        if (!file.exists) return "ERROR: 文件不存在";

        // 如果没有打开的文档，则直接打开
        if (app.documents.length === 0) {
            app.open(file);
            return "OPENED";
        }

        // 否则执行“置入” (Place)
        var desc = new ActionDescriptor();
        desc.putPath(charIDToTypeID("null"), file);
        desc.putEnumerated(charIDToTypeID("FTbc"), charIDToTypeID("FTbl"), charIDToTypeID("FTbt"));
        
        var offsetDesc = new ActionDescriptor();
        offsetDesc.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), 0.000000);
        offsetDesc.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), 0.000000);
        desc.putObject(charIDToTypeID("Ofst"), charIDToTypeID("Ofst"), offsetDesc);
        
        executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);
        return "PLACED";
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

function getFolderContent(pathStr) {
    try {
        var folder = new Folder(pathStr);
        if (!folder.exists) return "ERROR: 目录不存在";
        
        var files = folder.getFiles();
        var result = { folders: [], files: [] };

        for (var i = 0; i < files.length; i++) {
            var item = files[i];
            var name = decodeURI(item.name);
            if (item instanceof Folder) {
                result.folders.push({ name: name, fullPath: item.fsName });
            } else {
                var ext = name.split('.').pop().toLowerCase();
                var supported = ["psd", "psb", "png", "jpg", "jpeg", "tga", "tiff", "tif", "bmp"];
                var isSupported = false;
                for (var j = 0; j < supported.length; j++) {
                    if (ext === supported[j]) { isSupported = true; break; }
                }
                if (isSupported) {
                    result.files.push({ name: name, fullPath: item.fsName, ext: ext });
                }
            }
        }
        return JSON.stringify(result);
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

function searchFiles(rootPath, keyword) {
    var results = [];
    var searchRoot = new Folder(rootPath);
    if (!searchRoot.exists) return "[]";

    keyword = keyword.toLowerCase();

    function walk(dir) {
        var files = dir.getFiles();
        for (var i = 0; i < files.length; i++) {
            var item = files[i];
            var name = decodeURI(item.name);
            if (item instanceof Folder) {
                walk(item);
            } else {
                if (name.toLowerCase().indexOf(keyword) !== -1) {
                    var ext = name.split('.').pop().toLowerCase();
                    results.push({ name: name, fullPath: item.fsName, ext: ext });
                }
            }
            if (results.length > 500) return; // 搜索上限 500
        }
    }
    walk(searchRoot);
    return JSON.stringify({ files: results });
}



function getFilePreview(pathStr) {
    try {
        var f = new File(pathStr);
        if (!f.exists) return "";
        
        // 如果文件太大（超过5MB）且不是图片，直接跳过全量读取
        if (f.length > 5 * 1024 * 1024) {
            // 这里可以尝试使用 XMP 读取，如果不支持则返回空
            // 加载 XMP 库
            if (ExternalObject.AdobeXMPScript == undefined) {
                ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
            }
            var xmpFile = new XMPFile(f.fsName, XMPConst.FILE_UNKNOWN, XMPConst.OPEN_FOR_READ);
            var xmp = xmpFile.getXMP();
            xmpFile.closeFile(XMPConst.CLOSE_UPDATE_SAFELY);
            
            // 尝试获取缩略图
            var thumb = xmp.getProperty(XMPConst.NS_XMP_G_IMG, "thumbnail");
            if (thumb) return thumb.value; 
            
            return "LARGE_FILE"; // 标识文件太大且无缩略图
        }

        // 小文件依然可以使用旧的读取方式作为兜底
        f.encoding = "BINARY";
        f.open("r");
        var data = f.read();
        f.close();
        return encodeBase64(data);
    } catch (e) { 
        return ""; 
    }
}




