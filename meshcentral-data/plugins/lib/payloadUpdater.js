"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const crypto = require("crypto");

const STATE_FILENAME = ".auto-updater.json";

function createPayloadUpdater(options) {
    if (!options || !options.assetDir) {
        throw new Error("createPayloadUpdater requires an assetDir option.");
    }

    const assetDir = options.assetDir;
    const defaultAssetName = options.defaultAssetName || "bundle.zip";
    const pluginMeta = options.pluginMeta || {};
    const pluginShortName = (options.pluginShortName || pluginMeta.shortName || "plugin").toLowerCase();
    const pluginLabel = "[" + pluginShortName + "]";
    const upperShort = pluginShortName.toUpperCase();
    const statePath = path.join(assetDir, STATE_FILENAME);

    const log = typeof options.log === "function" ? options.log : function (level, message, err) {
        const logger = console[level] || console.log;
        if (err) {
            logger.call(console, pluginLabel + " " + message, err);
        } else {
            logger.call(console, pluginLabel + " " + message);
        }
    };

    let timer = null;
    let running = false;
    let destroyed = false;
    let stateCache = null;
    let stateCacheRaw = null;

    async function ensureAssetDir() {
        try {
            await fs.promises.mkdir(assetDir, { recursive: true });
        } catch (err) {
            log("error", "Unable to ensure asset directory exists", err);
            throw err;
        }
    }

    async function loadState() {
        if (stateCache) { return stateCache; }
        try {
            const raw = await fs.promises.readFile(statePath, "utf8");
            stateCacheRaw = raw;
            stateCache = JSON.parse(raw);
        } catch (err) {
            stateCache = null;
            stateCacheRaw = null;
        }
        return stateCache;
    }

    async function saveState(state) {
        try {
            const raw = JSON.stringify(state, null, 2);
            if (raw === stateCacheRaw) { return; }
            await ensureAssetDir();
            const tmpPath = statePath + ".tmp";
            await fs.promises.writeFile(tmpPath, raw, "utf8");
            await fs.promises.rename(tmpPath, statePath);
            stateCache = state;
            stateCacheRaw = raw;
        } catch (err) {
            log("error", "Failed to persist auto-update state", err);
        }
    }

    function shallowClone(obj) {
        return obj ? { ...obj } : {};
    }

    function getEnv(key) {
        if (!key) { return undefined; }
        const scoped = process.env["MESH_PLUGIN_" + upperShort + "_" + key];
        if (typeof scoped !== "undefined") { return scoped; }
        return process.env["MESH_PLUGIN_" + key];
    }

    function isFalseyToggle(value) {
        if (typeof value === "undefined") { return false; }
        return /^(0|false|no|off)$/i.test(String(value).trim());
    }

    function normalizeAuth(token) {
        if (!token) { return null; }
        const trimmed = token.trim();
        if (/^(token|basic|bearer)\s+/i.test(trimmed)) {
            return trimmed;
        }
        return "token " + trimmed;
    }

    function resolveUrl(base, relative) {
        try {
            return new URL(relative, base).toString();
        } catch (_) {
            return relative;
        }
    }

    function httpRequest(method, urlString, headers, maxRedirects, destStream) {
        return new Promise((resolve, reject) => {
            let completed = false;
            function finish(err, data) {
                if (completed) { return; }
                completed = true;
                if (err) { reject(err); } else { resolve(data); }
            }
            let urlObj;
            try {
                urlObj = new URL(urlString);
            } catch (err) {
                finish(new Error("Invalid URL: " + urlString));
                return;
            }
            const isHttps = urlObj.protocol === "https:";
            const transport = isHttps ? https : http;
            const requestOptions = {
                method: method || "GET",
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + (urlObj.search || ""),
                headers: {
                    "User-Agent": "MeshCentral-PayloadUpdater/1.0",
                    ...headers
                },
                timeout: 30000
            };
            const req = transport.request(requestOptions, (res) => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    if (maxRedirects <= 0) {
                        res.resume();
                        finish(new Error("Too many redirects for " + urlString));
                        return;
                    }
                    const redirectUrl = resolveUrl(urlString, res.headers.location);
                    res.resume();
                    httpRequest(method, redirectUrl, headers, maxRedirects - 1, destStream).then(resolve).catch(reject);
                    return;
                }
                if (status < 200 || status >= 300) {
                    res.resume();
                    finish(new Error("HTTP " + status + " from " + urlString));
                    return;
                }
                if (destStream) {
                    const onError = (err) => {
                        res.removeListener("error", onError);
                        destStream.removeListener("finish", onFinish);
                        finish(err);
                    };
                    const onFinish = () => {
                        res.removeListener("error", onError);
                        destStream.removeListener("error", onError);
                        finish(null, { status, headers: res.headers });
                    };
                    destStream.once("error", onError);
                    destStream.once("finish", onFinish);
                    res.once("error", onError);
                    res.pipe(destStream);
                } else {
                    const chunks = [];
                    res.on("data", (chunk) => chunks.push(chunk));
                    res.on("error", finish);
                    res.on("end", () => finish(null, {
                        status,
                        headers: res.headers,
                        body: Buffer.concat(chunks)
                    }));
                }
            });
            req.on("error", finish);
            req.on("timeout", () => {
                req.destroy(new Error("Request timed out"));
            });
            req.end();
        });
    }

    async function fetchJson(url, headers) {
        const response = await httpRequest("GET", url, headers, 4, null);
        if (!response || !response.body) {
            throw new Error("Empty response from " + url);
        }
        try {
            return JSON.parse(response.body.toString("utf8"));
        } catch (err) {
            throw new Error("Invalid JSON from " + url + ": " + err.message);
        }
    }

    async function downloadToFile(url, headers, destination) {
        await ensureAssetDir();
        const tempPath = destination + ".download";
        const fileStream = fs.createWriteStream(tempPath);
        try {
            await httpRequest("GET", url, headers, 4, fileStream);
            return tempPath;
        } catch (err) {
            fileStream.destroy();
            try { await fs.promises.unlink(tempPath); } catch (_) { }
            throw err;
        }
    }

    async function computeSha256(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash("sha256");
            const stream = fs.createReadStream(filePath);
            stream.on("data", (chunk) => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
            stream.on("error", reject);
        });
    }

    async function removeFileIfExists(filePath) {
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            if (err && err.code !== "ENOENT") {
                log("warn", "Unable to remove " + filePath, err);
            }
        }
    }

    function selectAssetFile(remoteConfig, currentState) {
        if (remoteConfig && typeof remoteConfig.assetFile === "string" && remoteConfig.assetFile.trim().length > 0) {
            return remoteConfig.assetFile.trim();
        }
        if (remoteConfig && typeof remoteConfig.bundleName === "string" && remoteConfig.bundleName.trim().length > 0) {
            return remoteConfig.bundleName.trim();
        }
        if (currentState && typeof currentState.assetFile === "string" && currentState.assetFile.trim().length > 0) {
            return currentState.assetFile;
        }
        return defaultAssetName;
    }

    function extractRemoteVersion(remoteConfig, fallbacks) {
        if (!remoteConfig) { return fallbacks || null; }
        const candidates = [
            remoteConfig.assetVersion,
            remoteConfig.bundleVersion,
            remoteConfig.payloadVersion,
            remoteConfig.version,
            fallbacks
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (typeof candidates[i] === "string" && candidates[i].trim().length > 0) {
                return candidates[i].trim();
            }
        }
        return null;
    }

    function extractRemoteSha(remoteConfig) {
        if (!remoteConfig) { return null; }
        const candidates = [
            remoteConfig.assetSha256,
            remoteConfig.bundleSha256,
            remoteConfig.sha256
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (typeof candidates[i] === "string" && /^[a-f0-9]{64}$/i.test(candidates[i])) {
                return candidates[i].toLowerCase();
            }
        }
        return null;
    }

    async function runOnce() {
        if (running || destroyed) { return; }
        running = true;

        const globalToggle = process.env.MESH_PLUGIN_AUTOUPDATE;
        if (typeof globalToggle !== "undefined" && isFalseyToggle(globalToggle)) {
            log("debug", "Global auto-update disabled via MESH_PLUGIN_AUTOUPDATE=" + globalToggle);
            running = false;
            return;
        }
        const scopedToggle = getEnv("AUTOUPDATE");
        if (isFalseyToggle(scopedToggle)) {
            log("debug", "Auto-update disabled via environment override for plugin");
            running = false;
            return;
        }

        let newState = {};
        let cachedState = null;
        let tempDownloadPath = null;
        let assetUpdatedInfo = null;

        try {
            cachedState = await loadState();
            newState = shallowClone(cachedState);
            newState.lastChecked = new Date().toISOString();

            await ensureAssetDir();

            const configOverride = getEnv("CONFIG_URL");
            const downloadOverride = getEnv("DOWNLOAD_URL");
            const authToken = normalizeAuth(getEnv("TOKEN"));
            const extraHeaderJson = getEnv("HEADERS");

            const baseHeaders = {};
            if (authToken) {
                baseHeaders.Authorization = authToken;
            }
            if (extraHeaderJson) {
                try {
                    const parsedHeaders = JSON.parse(extraHeaderJson);
                    if (parsedHeaders && typeof parsedHeaders === "object") {
                        Object.keys(parsedHeaders).forEach((key) => {
                            baseHeaders[key] = parsedHeaders[key];
                        });
                    }
                } catch (err) {
                    log("warn", "Failed to parse custom headers JSON", err);
                }
            }

            const configUrl = configOverride || pluginMeta.configUrl || null;
            let remoteConfig = null;
            if (configUrl) {
                try {
                    remoteConfig = await fetchJson(configUrl, baseHeaders);
                } catch (err) {
                    log("warn", "Unable to fetch remote config from " + configUrl, err);
                }
            }

            if (remoteConfig && (remoteConfig.autoUpdate === false || remoteConfig.autoUpdateEnabled === false)) {
                log("debug", "Remote configuration disabled auto-updates.");
                return;
            }

            let downloadUrl = downloadOverride ||
                (remoteConfig && remoteConfig.downloadUrl) ||
                pluginMeta.downloadUrl ||
                null;

            if (!downloadUrl) {
                log("debug", "No download URL defined; auto-update idle.");
                return;
            }

            const remoteVersion = extractRemoteVersion(remoteConfig, cachedState && cachedState.version);
            const remoteSha = extractRemoteSha(remoteConfig);
            const assetFileName = selectAssetFile(remoteConfig, cachedState);
            const assetPath = path.join(assetDir, assetFileName);
            const assetExists = fs.existsSync(assetPath);

            let needDownload = !assetExists;
            if (!needDownload && remoteVersion && (!cachedState || cachedState.version !== remoteVersion)) { needDownload = true; }
            if (!needDownload && remoteSha && (!cachedState || cachedState.sha256 !== remoteSha)) { needDownload = true; }
            if (!needDownload && cachedState && cachedState.assetFile && cachedState.assetFile !== assetFileName) { needDownload = true; }
            if (!needDownload && cachedState && cachedState.source && cachedState.source !== downloadUrl) { needDownload = true; }

            let downloadHeaders = { ...baseHeaders };
            if (remoteConfig && remoteConfig.downloadHeaders && typeof remoteConfig.downloadHeaders === "object") {
                downloadHeaders = { ...downloadHeaders, ...remoteConfig.downloadHeaders };
            }

            if (needDownload) {
                log("info", "Downloading payload from " + downloadUrl);
                try {
                    tempDownloadPath = await downloadToFile(downloadUrl, downloadHeaders, assetPath);
                    const sha = await computeSha256(tempDownloadPath);
                    if (remoteSha && sha !== remoteSha) {
                        throw new Error("Checksum mismatch (expected " + remoteSha + " got " + sha + ")");
                    }
                    await removeFileIfExists(assetPath);
                    await fs.promises.rename(tempDownloadPath, assetPath);
                    tempDownloadPath = null;
                    newState.sha256 = sha;
                    newState.downloadedAt = new Date().toISOString();
                    newState.assetFile = assetFileName;
                    newState.source = downloadUrl;
                    if (remoteVersion) { newState.version = remoteVersion; }
                    else if (!newState.version && cachedState && cachedState.version) { newState.version = cachedState.version; }
                    assetUpdatedInfo = {
                        assetFile: assetFileName,
                        version: newState.version || null,
                        sha256: sha,
                        path: assetPath,
                        source: downloadUrl,
                        state: shallowClone(newState)
                    };
                    log("info", "Payload '" + assetFileName + "' updated successfully.");
                } catch (err) {
                    throw err;
                } finally {
                    if (tempDownloadPath) {
                        await removeFileIfExists(tempDownloadPath);
                        tempDownloadPath = null;
                    }
                }
            } else {
                if (remoteVersion) { newState.version = remoteVersion; }
                if (downloadUrl) { newState.source = downloadUrl; }
                if (!newState.assetFile) { newState.assetFile = assetFileName; }
                if (!newState.sha256 && cachedState && cachedState.sha256) { newState.sha256 = cachedState.sha256; }
            }
        } catch (err) {
            log("error", "Failed to refresh payload bundle", err);
        } finally {
            try {
                await saveState(newState);
            } catch (err) {
                log("error", "Unable to write auto-update state", err);
            }
            if (typeof options.onStateUpdated === "function") {
                try {
                    options.onStateUpdated(shallowClone(newState));
                } catch (err) {
                    log("error", "onStateUpdated handler threw an error", err);
                }
            }
            if (assetUpdatedInfo && typeof options.onAssetReady === "function") {
                try {
                    options.onAssetReady(assetUpdatedInfo);
                } catch (err) {
                    log("error", "onAssetReady handler threw an error", err);
                }
            }
            running = false;
        }
    }

    function start() {
        if (destroyed) { return; }
        const intervalMs = typeof options.intervalMs === "number" ? Math.max(60000, options.intervalMs) : (60 * 60 * 1000);
        runOnce();
        timer = setInterval(runOnce, intervalMs);
        if (timer && typeof timer.unref === "function") { timer.unref(); }
    }

    function stop() {
        destroyed = true;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function getState() {
        return shallowClone(stateCache);
    }

    return {
        start,
        stop,
        runOnce,
        getState,
        statePath
    };
}

module.exports = {
    createPayloadUpdater,
    STATE_FILENAME
};
