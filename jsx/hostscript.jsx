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
// 0.5 图层元数据存储引擎 (基于 Document Custom Options)
// 数据持久化在 PSD 文件内部，不产生额外文件，不影响图层名
// ==========================================================
var UILINK_META_KEY = "UILinkLayerMeta"; // Custom Options 命名空间

/**
 * 获取当前文档的所有图层元数据映射表
 * 返回格式: { "layerId": { outputType, compType, width, height, sliceSuffix, isExport, moduleName, baseName, posX, posY }, ... }
 */
function _getDocMetaMap() {
    try {
        var desc = app.getCustomOptions(UILINK_META_KEY);
        var jsonStr = desc.getString(stringIDToTypeID("json"));
        return JSON.parse(jsonStr);
    } catch(e) {
        // 不存在或解析失败，返回空映射
        return {};
    }
}

/**
 * 将完整的元数据映射表写回文档
 */
function _saveDocMetaMap(map) {
    var desc = new ActionDescriptor();
    desc.putString(stringIDToTypeID("json"), JSON.stringify(map));
    app.putCustomOptions(UILINK_META_KEY, desc, true); // true = persistent (随 PSD 保存)
}

/**
 * 读取指定图层的元数据
 * @param {number} layerId - 图层唯一 ID
 * @returns {object|null} 元数据对象，不存在则返回 null
 */
function getLayerMeta(layerId) {
    var map = _getDocMetaMap();
    return map[String(layerId)] || null;
}

/**
 * 写入指定图层的元数据
 * @param {number} layerId - 图层唯一 ID
 * @param {object} meta - 元数据对象 { outputType, compType, width, height, sliceSuffix, isExport, moduleName, baseName, posX, posY }
 */
function setLayerMeta(layerId, meta) {
    var map = _getDocMetaMap();
    map[String(layerId)] = meta;
    _saveDocMetaMap(map);
}

/**
 * 删除指定图层的元数据（图层被删除时调用）
 */
function removeLayerMeta(layerId) {
    var map = _getDocMetaMap();
    delete map[String(layerId)];
    _saveDocMetaMap(map);
}

/**
 * 从图层获取完整的元数据（优先读隐藏属性，兼容旧版从图层名读取）
 * 这是对外的统一接口，自动处理新旧格式兼容
 */
function getLayerMetaWithFallback(layer) {
    // 1. 先尝试从隐藏属性读取
    var meta = getLayerMeta(layer.id);
    if (meta) return meta;

    // 2. 兼容旧格式：从图层名中解析（| 分隔格式）
    var name = layer.name;
    var parts = name.split("|");
    if (parts.length >= 6) {
        var nameParts = parts[0].split("_");
        var moduleName = nameParts[0];
        var baseName = nameParts.slice(1).join("_");
        var outputType = parts[1];
        var compType = parts[2];
        var sizeParts = parts[3].split("x");
        var width = parseInt(sizeParts[0]) || 0;
        var height = parseInt(sizeParts[1]) || 0;
        var sliceSuffix = parts[4];
        var isExport = (parts[5] === "1");

        meta = {
            moduleName: moduleName,
            baseName: baseName,
            outputType: outputType,
            compType: compType,
            width: width,
            height: height,
            sliceSuffix: sliceSuffix,
            isExport: isExport,
            posX: 0,
            posY: 0
        };
        return meta;
    }

    // 3. 完全未标记的图层，返回 null
    return null;
}

/**
 * 根据元数据生成导出文件名（图层显示名）
 * 这个名字将同时作为图层名和导出文件名的基础
 */
function buildExportName(meta) {
    if (!meta) return null;
    var baseName = meta.baseName || "unnamed";

    if (meta.outputType.indexOf("texture") === 0) {
        return "tex_" + baseName;
    } else {
        var prefix = "common";
        if (meta.outputType.indexOf("atlas:") === 0) {
            prefix = meta.outputType.split(":")[1] || "common";
        }
        return prefix + "@" + baseName;
    }
}

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

        // 优先从隐藏属性读取元数据
        var meta = getLayerMetaWithFallback(layer);

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
            isExport: false,
            posX: 0,
            posY: 0,
            hasCustomPosition: false,
            hasMeta: false // 标记是否已有元数据（用于前端判断是否为已配置图层）
        };

        if (meta) {
            info.moduleName = meta.moduleName || docName;
            info.baseName = meta.baseName || name;
            info.outputType = meta.outputType || "atlas";
            info.compType = meta.compType || "image";
            info.width = meta.width || 0;
            info.height = meta.height || 0;
            info.sliceSuffix = meta.sliceSuffix || "0,0,0,0";
            info.isExport = !!meta.isExport;
            info.posX = parseInt(meta.posX, 10) || 0;
            info.posY = parseInt(meta.posY, 10) || 0;
            info.hasCustomPosition = meta.hasOwnProperty("posX") || meta.hasOwnProperty("posY");
            info.hasMeta = true;
        } else {
            // [智能读取规则] 针对无元数据图层的命名推测
            if (name.indexOf("@") !== -1) {
                var atParts = name.split("@");
                info.outputType = "atlas:" + atParts[0];
                info.baseName = atParts[1];
                info.compType = "image";
            } else if (name.indexOf("tex_") === 0) {
                info.outputType = "texture";
                info.baseName = name.substring(4);
                info.compType = "texture";
            } else {
                info.baseName = name;
            }
        }

        // 手动构建 JSON
        return "{" +
            "\"docName\":\"" + info.docName + "\"," +
            "\"fullName\":\"" + info.fullName.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"") + "\"," +
            "\"moduleName\":\"" + info.moduleName + "\"," +
            "\"baseName\":\"" + info.baseName.replace(/\\/g,"\\\\").replace(/\"/g,"\\\"") + "\"," +
            "\"width\":" + info.width + "," +
            "\"height\":" + info.height + "," +
            "\"realWidth\":" + info.realWidth + "," +
            "\"realHeight\":" + info.realHeight + "," +
            "\"posX\":" + info.posX + "," +
            "\"posY\":" + info.posY + "," +
            "\"hasCustomPosition\":" + info.hasCustomPosition + "," +
            "\"sliceSuffix\":\"" + info.sliceSuffix + "\"," +
            "\"outputType\":\"" + info.outputType + "\"," +
            "\"compType\":\"" + info.compType + "\"," +
            "\"isExport\":" + info.isExport + "," +
            "\"hasMeta\":" + info.hasMeta +
        "}";
    } catch(e) { return "ERROR: " + e.toString(); }
}

function applyLayerRename(infoStr) {
    try {
        var info = JSON.parse(infoStr);
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        if (!layer) return "ERROR: 未选中图层";

        // 构建元数据对象
        var meta = {
            moduleName: info.moduleName || "",
            baseName: info.baseName || "",
            outputType: info.outputType || "atlas",
            compType: info.compType || "image",
            width: info.width || 0,
            height: info.height || 0,
            sliceSuffix: info.sliceSuffix || "0,0,0,0",
            isExport: !!info.isExport,
            posX: parseInt(info.posX, 10) || 0,
            posY: parseInt(info.posY, 10) || 0
        };

        // 生成导出文件名（同时作为图层显示名）
        var exportName = buildExportName(meta);
        if (!exportName) return "ERROR: 无法生成导出文件名";

        // 【核心修复】查重校验 —— 使用新系统
        var checkResult = checkDuplicateExportNamesNew(layer.id, exportName, meta.isExport);
        if (checkResult !== "OK") {
            return "ERROR: " + checkResult;
        }

        // 1. 将元数据写入隐藏属性
        setLayerMeta(layer.id, meta);

        // 2. 图层名只设置为干净的导出名
        layer.name = exportName;

        return exportName;
    } catch(e) { return "ERROR: " + e.toString(); }
}

function setActiveLayerExportFlag(infoStr) {
    try {
        if (app.documents.length === 0) return "ERROR: 没有打开的文档";
        var info = JSON.parse(infoStr || "{}");
        var doc = app.activeDocument;
        var layer = doc.activeLayer;
        if (!layer) return "ERROR: 未选中图层";

        var existingMeta = getLayerMetaWithFallback(layer) || {};
        var resolvedPosX = info.hasOwnProperty("posX") ? (parseInt(info.posX, 10) || 0) : (parseInt(existingMeta.posX, 10) || 0);
        var resolvedPosY = info.hasOwnProperty("posY") ? (parseInt(info.posY, 10) || 0) : (parseInt(existingMeta.posY, 10) || 0);
        var meta = {
            moduleName: info.moduleName || existingMeta.moduleName || doc.name.split(".")[0],
            baseName: info.baseName || existingMeta.baseName || layer.name,
            outputType: info.outputType || existingMeta.outputType || "atlas",
            compType: info.compType || existingMeta.compType || "image",
            width: info.width || existingMeta.width || 0,
            height: info.height || existingMeta.height || 0,
            sliceSuffix: info.sliceSuffix || existingMeta.sliceSuffix || "0,0,0,0",
            isExport: !!info.isExport,
            posX: resolvedPosX,
            posY: resolvedPosY
        };

        var exportName = buildExportName(meta);
        if (!exportName) return "ERROR: 无法生成导出文件名";

        var checkResult = checkDuplicateExportNamesNew(layer.id, exportName, meta.isExport);
        if (checkResult !== "OK") {
            return "ERROR: " + checkResult;
        }

        setLayerMeta(layer.id, meta);
        return meta.isExport ? "EXPORT_ON" : "EXPORT_OFF";
    } catch(e) { return "ERROR: " + e.toString(); }
}

// ==========================================
// 辅助：查重子逻辑（新版，基于隐藏属性）
// ==========================================
function getExportFileName(layerName) {
    // 兼容旧版命名格式的查重
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

function buildLayerMetaSignature(meta) {
    if (!meta) return "";
    return [
        meta.outputType || "",
        meta.compType || "",
        parseInt(meta.width, 10) || 0,
        parseInt(meta.height, 10) || 0,
        meta.sliceSuffix || "0,0,0,0",
        meta.isExport ? 1 : 0,
        meta.moduleName || "",
        meta.baseName || "",
        parseInt(meta.posX, 10) || 0,
        parseInt(meta.posY, 10) || 0
    ].join("|");
}

/**
 * 新版查重：基于元数据系统检查导出文件名是否冲突
 */
function checkDuplicateExportNamesNew(activeLayerId, proposedExportName, isExport) {
    if (!isExport) return "OK"; // 不导出则不需要查重

    var doc = app.activeDocument;
    var metaMap = _getDocMetaMap();
    var nameMap = {};

    // 检查所有已有元数据的图层
    for (var id in metaMap) {
        if (!metaMap.hasOwnProperty(id)) continue;
        if (parseInt(id) === activeLayerId) continue; // 跳过当前图层

        var m = metaMap[id];
        if (!m.isExport) continue;

        var eName = buildExportName(m);
        if (eName) {
            var fullName = eName + ".png";
            if (nameMap[fullName]) {
                // 已有冲突，但这不是当前操作导致的
            }
            nameMap[fullName] = "ID:" + id;
        }
    }

    // 同时兼容旧格式图层的查重
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
        if (l.id === activeLayerId) continue;
        // 只检查没有新元数据但有旧格式命名的图层
        if (metaMap[String(l.id)]) continue; // 已在上面检查过
        var oldExportName = getExportFileName(l.name);
        if (oldExportName) {
            nameMap[oldExportName] = l.name;
        }
    }

    // 检查当前提议的名字是否冲突
    var proposedFull = proposedExportName + ".png";
    if (nameMap[proposedFull]) {
        return "导出文件名 [" + proposedFull + "] 冲突！冲突图层: [" + nameMap[proposedFull] + "]";
    }
    return "OK";
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
        // 1. 从隐藏属性读取元数据（兼容旧格式）
        var meta = getLayerMetaWithFallback(layer);
        var forceW = 0, forceH = 0;
        var posX = 0, posY = 0;
        var outputType = "atlas";
        var baseName = layer.name;

        if (meta) {
            outputType = meta.outputType || "atlas";
            forceW = meta.width || 0;
            forceH = meta.height || 0;
            posX = parseInt(meta.posX, 10) || 0;
            posY = parseInt(meta.posY, 10) || 0;
            baseName = meta.baseName || layer.name;
        } else {
            // 最终兜底：从图层名推测
            if (layer.name.indexOf("@") !== -1) {
                baseName = layer.name.split("@")[1] || layer.name;
                outputType = "atlas:" + layer.name.split("@")[0];
            } else if (layer.name.indexOf("tex_") === 0) {
                baseName = layer.name.substring(4);
                outputType = "texture";
            }
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
        
        // 如果指定了强制尺寸，则按照保存的位置参数导出
        if (forceW > 0 && forceH > 0) {
            var contentW = tempDoc.width.as("px");
            var contentH = tempDoc.height.as("px");
            var minPosX = Math.min(0, forceW - contentW);
            var maxPosX = Math.max(0, forceW - contentW);
            var minPosY = Math.min(0, forceH - contentH);
            var maxPosY = Math.max(0, forceH - contentH);
            var defaultPosX = Math.round((forceW - contentW) / 2);
            var defaultPosY = Math.round((forceH - contentH) / 2);
            var targetPosX = (meta && meta.hasOwnProperty("posX")) ? posX : defaultPosX;
            var targetPosY = (meta && meta.hasOwnProperty("posY")) ? posY : defaultPosY;

            targetPosX = Math.max(minPosX, Math.min(maxPosX, targetPosX));
            targetPosY = Math.max(minPosY, Math.min(maxPosY, targetPosY));

            var workW = Math.max(forceW, contentW);
            var workH = Math.max(forceH, contentH);
            tempDoc.resizeCanvas(UnitValue(workW, "px"), UnitValue(workH, "px"), AnchorPosition.TOPLEFT);

            var positionedLayer = tempDoc.activeLayer;
            if (positionedLayer) {
                var curBounds = positionedLayer.bounds;
                var curLeft = curBounds[0].as("px");
                var curTop = curBounds[1].as("px");
                positionedLayer.translate(UnitValue(targetPosX - curLeft, "px"), UnitValue(targetPosY - curTop, "px"));
            }

            if (workW !== forceW || workH !== forceH) {
                tempDoc.resizeCanvas(UnitValue(forceW, "px"), UnitValue(forceH, "px"), AnchorPosition.TOPLEFT);
            }
        }

        var isNineSliceExport = false;
        
        var w = tempDoc.width.as("px");
        var h = tempDoc.height.as("px");

        // 4. 九宫格挤压裁剪（从元数据读取）
        var sliceStr = meta ? (meta.sliceSuffix || "0,0,0,0") : "0,0,0,0";
        var sliceParts = sliceStr.split(",");
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

            // 从隐藏属性检查导出标志位（兼容旧格式）
            var layerMeta = getLayerMeta(parseInt(id));
            var hasOldFormat = nl.fullName ? (nl.fullName.split("|").length >= 6) : false;

            // 判断是否有元数据（新系统或旧命名格式均可）
            if (!layerMeta && !hasOldFormat) continue; // 无元数据，跳过

            var isExportEnabled = false;
            if (layerMeta) {
                isExportEnabled = !!layerMeta.isExport;
            } else if (hasOldFormat) {
                isExportEnabled = (nl.fullName.split("|")[5] === "1");
            }

            if (!isExportEnabled) {
                status = "disabled"; // 用户主动关闭导出
            } else if (ol) {
                // 精确对比：图层名、边界尺寸
                var nameMatch = (ol.fullName === nl.fullName);
                var boundsMatch = (Math.abs(ol.bounds.width - nl.bounds.width) < 1 && 
                                  Math.abs(ol.bounds.height - nl.bounds.height) < 1 &&
                                  Math.abs(ol.bounds.left - nl.bounds.left) < 1 &&
                                  Math.abs(ol.bounds.top - nl.bounds.top) < 1);
                var metaMatch = ((ol.metaSignature || "") === (nl.metaSignature || ""));

                if (nameMatch && boundsMatch && metaMatch) {
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
                // 二次校验导出标志位（优先从隐藏属性读取）
                var layerMeta = getLayerMetaWithFallback(realLayer);
                var exportFlag = "0";
                if (layerMeta) {
                    exportFlag = layerMeta.isExport ? "1" : "0";
                } else {
                    var nameParts = realLayer.name.split("|");
                    exportFlag = (nameParts.length >= 6) ? nameParts[5] : "1";
                }
                
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

        // 从隐藏属性读取九宫格参数（兼容旧格式）
        var meta = getLayerMetaWithFallback(layer);
        var sliceParams = "";
        if (meta) {
            sliceParams = meta.sliceSuffix || "";
        } else {
            var nameParts = layer.name.split("|");
            sliceParams = (nameParts.length >= 6) ? nameParts[4] : "";
        }
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

            try {
                // 核心修复：使用 "通过拷贝的图层" 原位创建切片，彻底杜绝 Paste 带来的位移
                var idcopyToLayer = stringIDToTypeID( "copyToLayer" );
                executeAction( idcopyToLayer, undefined, DialogModes.NO );

                var newL = innerDoc.activeLayer;
                newL.name = s.name;
            } catch(copyErr) {
                // 忽略“选区是空的”导致的拷贝失败。比如中空边框，中间完全是透明像素。
                // 还原方法 (restoreScaled9Slice) 能完美兼容确实切片的缺失。
            }
            originalLayer.visible = false;
        }

        originalLayer.remove();
        app.preferences.rulerUnits = oldRulerUnits;

        innerDoc.save();
        innerDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 恢复原有图层名称（不再追加 SMART 标签）
        doc.activeLayer.name = originalName;

        return "SUCCESS";
    } catch(e) { return "ERROR: " + e.toString() + " (line " + e.line + ")"; }
}

function restoreScaled9Slice() {
    try {
        var doc = app.activeDocument;
        var layer = doc.activeLayer;

        // 从隐藏属性读取九宫格参数（兼容旧格式）
        var meta = getLayerMetaWithFallback(layer);
        var sliceParams = "";
        if (meta) {
            sliceParams = meta.sliceSuffix || "";
        } else {
            var nameParts = layer.name.split("|");
            sliceParams = (nameParts.length >= 6) ? nameParts[4] : "";
        }
        var parts = sliceParams.split(",");
        var t = parseInt(parts[0], 10) || 0;
        var b = parseInt(parts[1], 10) || 0;
        var l = parseInt(parts[2], 10) || 0;
        var r = parseInt(parts[3], 10) || 0;

        if (t === 0 && b === 0 && l === 0 && r === 0) {
            return "ERROR: 未检测到有效的九宫格参数（不能全为 0）。请先在属性面板中设置九宫格参数。";
        }

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

        // 保存原图尺寸 (也就是原先转化成九宫格时分配的容器尺寸)
        var origW = innerDoc.width.as("px");
        var origH = innerDoc.height.as("px");

        innerDoc.resizeCanvas(UnitValue(targetW, "px"), UnitValue(targetH, "px"), AnchorPosition.TOPLEFT);

        var getL = function(n) { try { return innerDoc.layers.getByName(n); } catch(e){ return null; } };
        var tl = getL("TL"), tc = getL("TC"), tr = getL("TR");
        var ml = getL("ML"), mc = getL("MC"), mr = getL("MR");
        var bl = getL("BL"), bc = getL("BC"), br = getL("BR");

        // 核心修复：完全抛弃原来生硬对齐 bounds 的做法
        // 因为当区域内存在大面积透明时，bounds.left 根本不是切片容器的 left，这会导致对齐严重偏移。
        // 正确做法：直接计算“缩放补偿”和“逻辑位移”

        var scaleX_C = (origW - l - r) > 0 ? (targetW - l - r) / (origW - l - r) : 1;
        var scaleY_M = (origH - t - b) > 0 ? (targetH - t - b) / (origH - t - b) : 1;

        var processSlice = function(targetLayer, origSliceX, origSliceY, targetSliceX, targetSliceY, sX, sY) {
            if (!targetLayer) return;
            var X0 = targetLayer.bounds[0].as("px");
            var Y0 = targetLayer.bounds[1].as("px");
            var curW = targetLayer.bounds[2].as("px") - X0;
            var curH = targetLayer.bounds[3].as("px") - Y0;
            if (curW <= 0 || curH <= 0) return;

            // 1. 原地缩放 (锚点固定在自己当前边界的左上角)
            if (Math.abs(sX - 1) > 0.001 || Math.abs(sY - 1) > 0.001) {
                targetLayer.resize(sX * 100, sY * 100, AnchorPosition.TOPLEFT);
            }

            // 2. 计算当前实际不透明像素相对于逻辑切片容器的间隙 (Gap)
            var gapX = X0 - origSliceX;
            var gapY = Y0 - origSliceY;

            // 3. 计算在目标切片容器中，按同样比例放大的间隙，得出应该放置的新坐标
            var newX = targetSliceX + gapX * sX;
            var newY = targetSliceY + gapY * sY;

            // 4. 计算需要平移的差值
            var dx = newX - X0;
            var dy = newY - Y0;

            if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                targetLayer.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
            }
        };

        processSlice(tl, 0, 0, 0, 0, 1, 1);
        processSlice(tc, l, 0, l, 0, scaleX_C, 1);
        processSlice(tr, origW - r, 0, targetW - r, 0, 1, 1);

        processSlice(ml, 0, t, 0, t, 1, scaleY_M);
        processSlice(mc, l, t, l, t, scaleX_C, scaleY_M);
        processSlice(mr, origW - r, t, targetW - r, t, 1, scaleY_M);

        processSlice(bl, 0, origH - b, 0, targetH - b, 1, 1);
        processSlice(bc, l, origH - b, l, targetH - b, scaleX_C, 1);
        processSlice(br, origW - r, origH - b, targetW - r, targetH - b, 1, 1);

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
        // 核心性能优化：将压缩率从 9 降至 0 以实现毫秒级生成。
        opts.compression = 0;
        tempDoc.saveAs(tmpFile, opts, true, Extension.LOWERCASE);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 【终极性能优化】放弃耗时极大的 JS 层面 base64 逐字编码！
        // 直接向前端返回图片的物理绝对路径，让 Chromium 原生引擎去加载硬盘图片。
        app.preferences.rulerUnits = oldUnit;
        return JSON.stringify({
            path: tmpFile.fsName,
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
        var sliceStr = top + "," + bottom + "," + left + "," + right;

        // 优先更新隐藏属性中的九宫格参数
        var meta = getLayerMeta(layer.id);
        if (meta) {
            meta.sliceSuffix = sliceStr;
            setLayerMeta(layer.id, meta);
            return layer.name; // 图层名不变，返回当前名称
        }

        // 兼容旧格式：如果还没迁移到新系统
        var name = layer.name;
        var parts = name.split("|");

        if (parts.length >= 6) {
            // 旧格式，只替换九宫格部分 (索引为 4)
            parts[4] = sliceStr;
            var newNameStr = parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3] + "|" + parts[4] + "|" + parts[5];
            layer.name = newNameStr;
            return newNameStr;
        } else {
            // 如果是全新图层且无元数据，创建一个初始元数据
            var oldUnit = app.preferences.rulerUnits;
            app.preferences.rulerUnits = Units.PIXELS;
            var bounds = layer.bounds;
            var w = Math.round(bounds[2].value - bounds[0].value);
            var h = Math.round(bounds[3].value - bounds[1].value);
            app.preferences.rulerUnits = oldUnit;

            var docName = doc.name.split(".")[0];
            var baseName = name.indexOf("@") !== -1 ? name.split("@")[1] : name;

            var newMeta = {
                moduleName: docName,
                baseName: baseName,
                outputType: "atlas",
                compType: "image",
                width: w,
                height: h,
                sliceSuffix: sliceStr,
                isExport: true,
                posX: 0,
                posY: 0
            };
            setLayerMeta(layer.id, newMeta);

            // 更新图层名为导出名
            var exportName = buildExportName(newMeta);
            if (exportName) layer.name = exportName;
            return layer.name;
        }
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
    var layerMeta = getLayerMetaWithFallback(layer);

    var parsed = {
        id: layer.id,
        name: sanitizeName(layer.name),
        fullName: layer.name, // 记录完整名用于对比
        type: type,
        visible: layer.visible,
        opacity: layer.opacity,
        bounds: bounds,
        metaSignature: buildLayerMetaSignature(layerMeta),
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

// ==========================================================
// 6. AI 变清晰辅助逻辑
// ==========================================================
function getActiveLayerExportForAI() {
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

        var tempDoc = app.documents.add(new UnitValue(w, "px"), new UnitValue(h, "px"), res, "temp_preview", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

        app.activeDocument = doc;
        layer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);

        app.activeDocument = tempDoc;

        var tmpFile = new File(Folder.temp.fsName + "/uilink_ai_source.png");
        var opts = new PNGSaveOptions();
        opts.compression = 0;
        tempDoc.saveAs(tmpFile, opts, true, Extension.LOWERCASE);
        tempDoc.close(SaveOptions.DONOTSAVECHANGES);

        app.preferences.rulerUnits = oldUnit;
        return JSON.stringify({
            path: tmpFile.fsName,
            width: w,
            height: h
        });
    } catch(e) {
        return "ERROR: " + e.toString();
    }
}

function replaceCurrentLayerWithFile(filePath) {
    try {
        if (app.documents.length === 0) return "ERROR: 没有打开的文档";
        var doc = app.activeDocument;
        var oldLayer = doc.activeLayer;

        var oldName = oldLayer.name;
        var meta = getLayerMetaWithFallback(oldLayer);

        var oldUnit = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        // 获取旧图层的中心坐标和绝对尺寸
        var oldBounds = oldLayer.bounds;
        var oldW = oldBounds[2].value - oldBounds[0].value;
        var oldH = oldBounds[3].value - oldBounds[1].value;
        var oldCenterX = oldBounds[0].value + oldW / 2;
        var oldCenterY = oldBounds[1].value + oldH / 2;

        // 尝试用系统原生打开方式将图片作为一个新文档打开
        var file = new File(filePath);
        if (!file.exists) return "ERROR: AI 生成的图片文件不存在于路径: " + filePath;

        // 1. 打开图片文件
        var tempImgDoc = app.open(file);

        // 2. 解锁背景图层，允许透明度
        if (tempImgDoc.activeLayer.isBackgroundLayer) {
            tempImgDoc.activeLayer.isBackgroundLayer = false;
        }

        // 3. 将 AI 生成的图片直接缩放回原图层的精确尺寸
        if (oldW > 0 && oldH > 0) {
            tempImgDoc.resizeImage(UnitValue(oldW, "px"), UnitValue(oldH, "px"), null, ResampleMethod.BICUBIC);
        }

        // 4. 全自动抠图：去除纯黑背景
        var w = tempImgDoc.width.as("px");
        var h = tempImgDoc.height.as("px");

        function clickAndClear(x, y) {
            try {
                // 使用魔棒工具点击
                var desc = new ActionDescriptor();
                var ref = new ActionReference();
                ref.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
                desc.putReference(charIDToTypeID("null"), ref);
                var posDesc = new ActionDescriptor();
                posDesc.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), x);
                posDesc.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), y);
                desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Pnt "), posDesc);
                desc.putInteger(charIDToTypeID("Tlrn"), 10); // 容差设为10，扩大消除边缘残留黑色像素的能力
                desc.putBoolean(charIDToTypeID("Cntg"), true); // 连续的颜色（非常重要，防止内部黑色被删）
                executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);

                // 删除选区
                tempImgDoc.selection.clear();
                tempImgDoc.selection.deselect();
            } catch(e) {}
        }

        // 点四个角删除背景
        clickAndClear(1, 1);
        clickAndClear(w - 2, 1);
        clickAndClear(1, h - 2);
        clickAndClear(w - 2, h - 2);

        // 5. 消除黑边 (Layer -> Matting -> Remove Black Matte)
        // 这一步能完美去除边缘反锯齿残留的黑色光晕
        try {
            executeAction(charIDToTypeID("RmvB"), undefined, DialogModes.NO);
        } catch(e) {}

        // 6. 复制到目标文档
        var imgLayer = tempImgDoc.activeLayer;
        imgLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);

        // 关闭临时图片文档
        tempImgDoc.close(SaveOptions.DONOTSAVECHANGES);

        // 切换回主文档
        app.activeDocument = doc;
        var newLayer = doc.activeLayer; // 刚刚复制过来的图层会自动成为激活图层

        // 修改新图层的名称，增加 _AI_Enhanced 后缀
        newLayer.name = oldName + "_AI_Enhanced";
        if (meta) {
            setLayerMeta(newLayer.id, meta);
        }

        // 如果旧图层有父组（例如在某个文件夹里），需要把新图层移进去
        try {
            newLayer.move(oldLayer, ElementPlacement.PLACEBEFORE);
        } catch (moveErr) {
            // 移动失败不中断，继续后续对齐逻辑
        }

        // 对齐新图层到旧图层的位置
        var newBounds = newLayer.bounds;
        var newCenterX = newBounds[0].value + (newBounds[2].value - newBounds[0].value) / 2;
        var newCenterY = newBounds[1].value + (newBounds[3].value - newBounds[1].value) / 2;

        var dx = oldCenterX - newCenterX;
        var dy = oldCenterY - newCenterY;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            newLayer.translate(new UnitValue(dx, "px"), new UnitValue(dy, "px"));
        }

        // 隐藏原来的图层，不删除
        oldLayer.visible = false;

        app.preferences.rulerUnits = oldUnit;
        return "SUCCESS";
    } catch(e) {
        return "ERROR: PS 原生错误 - " + e.toString() + " (Line: " + e.line + ")";
    }
}
