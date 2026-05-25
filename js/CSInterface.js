/**
 * CSInterface - v6.1.0 (Patched with SystemPath & Path Sanitization)
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function(script, callback) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, callback);
    }
};

CSInterface.prototype.getHostEnvironment = function() {
    if (window.__adobe_cep__) {
        return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    }
    return {};
};

CSInterface.prototype.getSystemPath = function(pathType) {
    if (window.__adobe_cep__) {
        var path = window.__adobe_cep__.getSystemPath(pathType);
        if (path) {
            // Clean up CEP paths which might have browser protocol prefix
            if (path.indexOf("file:///") === 0) {
                path = path.slice(8);
            }
            path = path.replace(/\//g, "\\");
            path = decodeURIComponent(path);
        }
        return path;
    }
    return "";
};

// Add missing SystemPath global object
var SystemPath = {
    USER_DATA: "userData",
    EXTENSION: "extension",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    HOST_APPLICATION: "hostApplication"
};
