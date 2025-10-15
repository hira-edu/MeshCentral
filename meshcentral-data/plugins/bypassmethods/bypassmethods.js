"use strict";

module.exports.bypassmethods = function (parent) {
    const obj = {};
    const path = require("path");
    const fs = require("fs");
    const crypto = require("crypto");
    const { createPayloadUpdater, STATE_FILENAME } = require("../lib/payloadUpdater");

    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.path = path;
    obj.fs = fs;
    obj.crypto = crypto;

    const defaultSettings = {
        assetFile: "bypassmethods-bundle.zip",
        deployDir: "C:\\ProgramData\\BypassMethods",
        runAsUser: 0,
        cleanupOnUndeploy: true,
        skipPrerequisites: true,
        skipTests: true,
        launchGui: false
    };

    obj.settingsPath = path.join(__dirname, "settings.json");
    obj.assetDir = path.join(__dirname, "assets");
    obj.assetRoute = "/plugins/bypassmethods/assets";
    obj.httpRegistered = false;
    obj.activeJobs = Object.create(null);
    obj.assetMetadata = null;
    obj.assetWatcher = null;
    obj.jobTimeoutMs = 10 * 60 * 1000;
    obj.retryDelayMs = 4 * 1000;
    obj.maxRunCommandRetries = 3;
    obj.viewsPath = path.join(__dirname, "views");
    obj.autoStatePath = path.join(obj.assetDir, STATE_FILENAME);
    obj.autoState = null;
    const BUSY_MESSAGE_REGEX = /already busy/i;
    obj.pendingQueues = Object.create(null);

    obj.enqueueRunCommand = function (jobData) {
        const nodeid = jobData.nodeid;
        let queue = obj.pendingQueues[nodeid];
        if (!queue) {
            queue = [];
            obj.pendingQueues[nodeid] = queue;
        }
        queue.push(jobData);
        if (queue.length === 1) {
            obj.dispatchRunCommand(jobData.nodeid, jobData.script, jobData.runAsUser, jobData.userid, jobData.action, jobData);
        } else {
            obj.sendPluginEvent("jobUpdate", jobData.userid, {
                nodeid: jobData.nodeid,
                nodeName: jobData.nodeName || null,
                status: "Queued " + jobData.action + " (waiting for previous job)",
                level: "info",
                action: jobData.action
            });
        }
    };

    obj._finishQueuedJob = function (nodeid) {
        const queue = obj.pendingQueues[nodeid];
        if (!queue) { return; }
        queue.shift();
        if (queue.length > 0) {
            const next = queue[0];
            obj.dispatchRunCommand(next.nodeid, next.script, next.runAsUser, next.userid, next.action, next);
        } else {
            delete obj.pendingQueues[nodeid];
        }
    };

    const pluginMeta = (function loadPluginMetadata() {
        try {
            const raw = fs.readFileSync(path.join(__dirname, "config.json"), "utf8");
            const meta = JSON.parse(raw);
            if (meta && typeof meta === "object") { meta.hasAdminPanel = true; }
            return meta || {};
        } catch (err) {
            console.error("[bypassmethods] Unable to read config.json for metadata.", err);
            return {};
        }
    })();

    function loadSettings() {
        let settings = { ...defaultSettings };
        try {
            if (fs.existsSync(obj.settingsPath)) {
                const overrides = JSON.parse(fs.readFileSync(obj.settingsPath, "utf8"));
                settings = { ...settings, ...overrides };
            }
        } catch (err) {
            console.error("[bypassmethods] Unable to parse settings.json. Falling back to defaults.", err);
        }
        return settings;
    }

    function readAutoUpdateState() {
        try {
            if (!fs.existsSync(obj.autoStatePath)) { return null; }
            const raw = fs.readFileSync(obj.autoStatePath, "utf8");
            return JSON.parse(raw);
        } catch (err) {
            console.warn("[bypassmethods] Unable to read auto-update state.", err);
            return null;
        }
    }

    function escapeForJavascript(str) {
        return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    obj.settings = loadSettings();
    obj.autoState = readAutoUpdateState();
    if (obj.autoState && obj.autoState.assetFile) {
        obj.settings.assetFile = obj.autoState.assetFile;
    }
    if (obj.autoState && obj.autoState.version) {
        pluginMeta.version = obj.autoState.version;
    }

    function resolveAsset() {
        let assetName = obj.settings.assetFile || defaultSettings.assetFile;
        let assetPath = path.join(obj.assetDir, assetName);
        if (!fs.existsSync(assetPath)) {
            try {
                const candidates = fs.readdirSync(obj.assetDir).filter((file) => file.toLowerCase().endsWith(".zip"));
                if (candidates.length > 0) {
                    assetName = candidates[0];
                    assetPath = path.join(obj.assetDir, assetName);
                    obj.settings.assetFile = assetName;
                } else {
                    return null;
                }
            } catch (err) {
                console.error("[bypassmethods] Unable to enumerate asset directory.", err);
                return null;
            }
        }
        return { name: assetName, path: assetPath };
    }

    function computeAssetMetadata(force) {
        const resolved = resolveAsset();
        if (!resolved) {
            obj.assetMetadata = null;
            return null;
        }
        try {
            const stats = fs.statSync(resolved.path);
            if (!force && obj.assetMetadata &&
                obj.assetMetadata.name === resolved.name &&
                obj.assetMetadata.size === stats.size &&
                obj.assetMetadata.mtimeMs === stats.mtimeMs) {
                return obj.assetMetadata;
            }
            const fileBuffer = fs.readFileSync(resolved.path);
            const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
            obj.assetMetadata = {
                available: true,
                name: resolved.name,
                size: stats.size,
                mtime: stats.mtime,
                mtimeMs: stats.mtimeMs,
                sha256: hash
            };
            const autoState = obj.autoState || readAutoUpdateState();
            if (autoState) {
                if (!obj.autoState) { obj.autoState = autoState; }
                if (autoState.version) { obj.assetMetadata.version = autoState.version; }
                if (autoState.downloadedAt) { obj.assetMetadata.downloadedAt = autoState.downloadedAt; }
                if (autoState.lastChecked) { obj.assetMetadata.lastChecked = autoState.lastChecked; }
                if (autoState.source) { obj.assetMetadata.source = autoState.source; }
            }
        } catch (err) {
            console.error("[bypassmethods] Failed to compute asset metadata.", err);
            obj.assetMetadata = null;
        }
        return obj.assetMetadata;
    }

    function setupAssetWatcher() {
        try { fs.mkdirSync(obj.assetDir, { recursive: true }); } catch (err) { console.error("[bypassmethods] Unable to ensure asset directory exists.", err); }
        try {
            if (obj.assetWatcher) { obj.assetWatcher.close(); }
            obj.assetWatcher = fs.watch(obj.assetDir, { persistent: false }, function () {
                obj.assetMetadata = null;
            });
        } catch (err) {
            console.warn("[bypassmethods] Unable to watch asset directory.", err);
        }
    }

    const initialMeta = computeAssetMetadata(false);

    const frontendDefaultsLiteral = escapeForJavascript(JSON.stringify({
        deployDir: obj.settings.deployDir,
        runAsUser: obj.settings.runAsUser,
        skipPrerequisites: obj.settings.skipPrerequisites,
        skipTests: obj.settings.skipTests,
        launchGui: obj.settings.launchGui,
        assetVersion: (initialMeta && initialMeta.sha256) ? initialMeta.sha256.substring(0, 8) : (obj.settings.assetVersion || "dev"),
        assetFile: (initialMeta && initialMeta.name) || obj.settings.assetFile,
        forceRedeploy: false
    }));

    obj.exports = [
        "onDeviceRefreshEnd",
        "deploySelected",
        "undeploySelected",
        "requestStatus",
        "sendAction",
        "collectOptions",
        "jobUpdate",
        "appendLog",
        "renderAssetInfo",
        "assetInfo",
        "_getDefaults"
    ];

    obj._getDefaults = new Function("return JSON.parse(\"" + frontendDefaultsLiteral + "\");");

    function isSiteAdmin(user) {
        return !!(user && ((user.siteadmin & 0xFFFFFFFF) !== 0));
    }

    function ensurePluginRegistered() {
        const db = obj.meshServer && obj.meshServer.db;
        if (!db || typeof db.getPlugins !== "function" || typeof db.addPlugin !== "function") { return; }
        db.getPlugins(function (err, plugins) {
            if (err || !Array.isArray(plugins)) { return; }
            const existing = plugins.find((p) => p && p.shortName === (pluginMeta.shortName || "bypassmethods"));
            const payload = {
                name: pluginMeta.name || "Bypass Methods Deployer",
                shortName: pluginMeta.shortName || "bypassmethods",
                version: pluginMeta.version || "0.0.0",
                author: pluginMeta.author || "",
                description: pluginMeta.description || "Deploy and bootstrap the Bypass Methods hooking framework.",
                hasAdminPanel: true,
                homepage: pluginMeta.homepage || "",
                changelogUrl: pluginMeta.changelogUrl || pluginMeta.homepage || "",
                configUrl: pluginMeta.configUrl || "",
                downloadUrl: pluginMeta.downloadUrl || "",
                repository: pluginMeta.repository || {},
                meshCentralCompat: pluginMeta.meshCentralCompat || ">=1.0.0",
                status: 1
            };
            if (existing && existing._id) {
                const update = { ...payload };
                delete update.shortName;
                delete update.status;
                db.updatePlugin(existing._id, update, function () { });
                if (existing.status !== 1) {
                    db.setPluginStatus(existing._id, 1, function () { });
                }
            } else if (!existing) {
                db.addPlugin(payload, function () { });
            }
        });
    }

    const autoUpdater = createPayloadUpdater({
        pluginShortName: pluginMeta.shortName || "bypassmethods",
        pluginMeta,
        assetDir: obj.assetDir,
        defaultAssetName: defaultSettings.assetFile,
        intervalMs: 15 * 60 * 1000,
        log: function (level, message, err) {
            const logger = console[level] || console.log;
            if (err) {
                logger.call(console, "[bypassmethods] " + message, err);
            } else {
                logger.call(console, "[bypassmethods] " + message);
            }
        },
        onStateUpdated: function (state) {
            const previous = obj.autoState || null;
            obj.autoState = state || null;
            let refresh = false;
            if (state && state.assetFile && obj.settings.assetFile !== state.assetFile) {
                obj.settings.assetFile = state.assetFile;
                refresh = true;
            }
            if (!!previous !== !!state) {
                refresh = true;
            } else if (previous && state) {
                if (previous.assetFile !== state.assetFile ||
                    previous.sha256 !== state.sha256 ||
                    previous.downloadedAt !== state.downloadedAt ||
                    previous.version !== state.version) {
                    refresh = true;
                }
            }
            if (state && state.version && pluginMeta.version !== state.version) {
                pluginMeta.version = state.version;
                ensurePluginRegistered();
                refresh = true;
            }
            if (refresh) {
                obj.assetMetadata = null;
                computeAssetMetadata(true);
            }
        },
        onAssetReady: function (info) {
            if (info && info.assetFile) {
                obj.settings.assetFile = info.assetFile;
            }
            obj.assetMetadata = null;
            computeAssetMetadata(true);
            ensurePluginRegistered();
        }
    });
    obj.autoUpdater = autoUpdater;

    obj.onDeviceRefreshEnd = function () {
        var defaults = pluginHandler.bypassmethods._getDefaults();
        pluginHandler.registerPluginTab({ tabTitle: "Bypass Methods", tabId: "pluginBypassMethods" });
        var container = document.getElementById("pluginBypassMethods");
        if (!container) { return; }
        container.style.height = "calc(100vh - 220px)";
        container.style.overflowY = "auto";
        container.style.paddingRight = "12px";
        container.style.boxSizing = "border-box";
        if (!document.getElementById("bypassmethods-style")) {
            var style = document.createElement("style");
            style.id = "bypassmethods-style";
            style.textContent =
                ".bypassmethods-panel{padding:12px;display:flex;flex-direction:column;gap:12px;}" +
                ".bypassmethods-actions{display:flex;gap:8px;flex-wrap:wrap;}" +
                ".bypassmethods-log{max-height:220px;overflow:auto;border:1px solid #ccc;padding:8px;font-family:monospace;font-size:12px;background:#fafafa;}" +
                ".bypassmethods-log-entry{margin-bottom:4px;}" +
                ".bypassmethods-log-error{color:#b00020;}" +
                ".bypassmethods-btn{padding:6px 12px;}" +
                ".bypassmethods-meta{border:1px solid #ddd;padding:8px;background:#f7f7f7;font-size:12px;}" +
                ".bypassmethods-meta code{word-break:break-all;}";
            document.head.appendChild(style);
        }
        var forceChecked = defaults.forceRedeploy ? "checked" : "";
        var skipPrereqsChecked = defaults.skipPrerequisites ? "checked" : "";
        var skipTestsChecked = defaults.skipTests ? "checked" : "";
        var launchGuiChecked = defaults.launchGui ? "checked" : "";
        container.innerHTML =
            '<div class="bypassmethods-panel">' +
            '  <div class="bypassmethods-field">' +
            '    <label for="bypassmethods-target-dir">Staging directory</label>' +
            '    <input id="bypassmethods-target-dir" type="text" value="' + defaults.deployDir + '" style="width:100%;" />' +
            '  </div>' +
            '  <div class="bypassmethods-field">' +
            '    <label><input type="checkbox" id="bypassmethods-skip-prereqs" ' + skipPrereqsChecked + '> Skip prerequisite installers</label>' +
            '  </div>' +
            '  <div class="bypassmethods-field">' +
            '    <label><input type="checkbox" id="bypassmethods-skip-tests" ' + skipTestsChecked + '> Skip integration tests</label>' +
            '  </div>' +
            '  <div class="bypassmethods-field">' +
            '    <label><input type="checkbox" id="bypassmethods-launch-gui" ' + launchGuiChecked + '> Launch GUI controller after deploy</label>' +
            '  </div>' +
            '  <div class="bypassmethods-field">' +
            '    <label><input type="checkbox" id="bypassmethods-force" ' + forceChecked + '> Force redeploy</label>' +
            '  </div>' +
            '  <div class="bypassmethods-actions">' +
            '    <button class="bypassmethods-btn" onclick="return pluginHandler.bypassmethods.deploySelected();">Deploy</button>' +
            '    <button class="bypassmethods-btn" onclick="return pluginHandler.bypassmethods.undeploySelected();">Undeploy</button>' +
            '    <button class="bypassmethods-btn" onclick="return pluginHandler.bypassmethods.requestStatus();">Check Status</button>' +
            '  </div>' +
            '  <div id="bypassmethods-meta" class="bypassmethods-meta"></div>' +
            '  <div id="bypassmethods-log" class="bypassmethods-log"></div>' +
            '</div>';
        pluginHandler.bypassmethods.renderAssetInfo({ loading: true });
        pluginHandler.bypassmethods.sendAction("info");
    };

    obj.deploySelected = function () {
        return pluginHandler.bypassmethods.sendAction("deploy");
    };

    obj.undeploySelected = function () {
        return pluginHandler.bypassmethods.sendAction("undeploy");
    };

    obj.requestStatus = function () {
        return pluginHandler.bypassmethods.sendAction("status");
    };

    obj.collectOptions = function () {
        var opts = {};
        var dirInput = document.getElementById("bypassmethods-target-dir");
        if (dirInput && dirInput.value) { opts.deployDir = dirInput.value.trim(); }
        var skipPrereqsToggle = document.getElementById("bypassmethods-skip-prereqs");
        if (skipPrereqsToggle) { opts.skipPrerequisites = skipPrereqsToggle.checked; }
        var skipTestsToggle = document.getElementById("bypassmethods-skip-tests");
        if (skipTestsToggle) { opts.skipTests = skipTestsToggle.checked; }
        var launchGuiToggle = document.getElementById("bypassmethods-launch-gui");
        if (launchGuiToggle) { opts.launchGui = launchGuiToggle.checked; }
        var forceToggle = document.getElementById("bypassmethods-force");
        if (forceToggle) { opts.force = forceToggle.checked; }
        return opts;
    };

    obj.appendLog = function (text, level) {
        var log = document.getElementById("bypassmethods-log");
        if (!log) { return; }
        var row = document.createElement("div");
        row.className = "bypassmethods-log-entry";
        if (level === "error") { row.className += " bypassmethods-log-error"; }
        var ts = new Date();
        row.textContent = ts.toLocaleTimeString() + " " + text;
        if (log.firstChild) { log.insertBefore(row, log.firstChild); } else { log.appendChild(row); }
        while (log.childNodes.length > 100) {
            log.removeChild(log.lastChild);
        }
    };

    obj.jobUpdate = function (message) {
        if (!message || !message.details) { return; }
        var details = message.details;
        var nodeLabel = details.nodeName || details.nodeid || "device";
        var text = "[" + nodeLabel + "] " + details.status;
        pluginHandler.bypassmethods.appendLog(text, details.level || "info");
    };

    obj.renderAssetInfo = function (details) {
        var meta = document.getElementById("bypassmethods-meta");
        if (!meta) { return; }
        if (!details) {
            meta.textContent = "Unable to load asset details.";
            return;
        }
        if (details.loading) {
            meta.textContent = "Loading asset metadata…";
            return;
        }
        if (details.available === false) {
            meta.innerHTML = '<span class="bypassmethods-log-error">No deployment bundle available on the server.</span>';
            return;
        }
        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }
        var sizeString = (typeof details.size === "number")
            ? (details.size / (1024 * 1024)).toFixed(2) + " MB"
            : "unknown";
        var updated = details.updated ? new Date(details.updated).toLocaleString() : "unknown";
        var downloaded = details.downloadedAt ? new Date(details.downloadedAt).toLocaleString() : updated;
        var rows = [];
        rows.push("<div><strong>Bundle:</strong> " + escapeHtml(details.name) + "</div>");
        rows.push("<div><strong>Size:</strong> " + sizeString + "</div>");
        if (details.version) {
            rows.push("<div><strong>Version:</strong> " + escapeHtml(details.version) + "</div>");
        }
        rows.push("<div><strong>SHA256:</strong> <code>" + escapeHtml(details.sha256) + "</code></div>");
        rows.push("<div><strong>Downloaded:</strong> " + downloaded + "</div>");
        rows.push("<div><strong>File Timestamp:</strong> " + updated + "</div>");
        if (details.lastChecked) {
            rows.push("<div><strong>Last Check:</strong> " + new Date(details.lastChecked).toLocaleString() + "</div>");
        }
        if (details.source) {
            rows.push("<div><strong>Source:</strong> <code>" + escapeHtml(details.source) + "</code></div>");
        }
        meta.innerHTML = rows.join("");
    };

    obj.assetInfo = function (message) {
        if (!message || !message.details) { return; }
        pluginHandler.bypassmethods.renderAssetInfo(message.details);
    };

    obj.sendAction = function (action) {
        if (typeof meshserver === "undefined" || !currentNode) {
            pluginHandler.bypassmethods.appendLog("No device selected.", "error");
            return false;
        }
        var payload = {
            action: "plugin",
            plugin: "bypassmethods",
            pluginaction: action,
            nodeids: [currentNode._id],
            options: pluginHandler.bypassmethods.collectOptions(),
            origin: window.location.origin
        };
        meshserver.send(payload);
        if (action !== "info") {
            pluginHandler.bypassmethods.appendLog("Queued " + action + " for " + currentNode.name, "info");
        }
        return false;
    };

    obj.hook_setupHttpHandlers = function (webserver) {
        if (!webserver || !webserver.app) { return; }
        if (obj.httpRegistered) { return; }
        obj.httpRegistered = true;

        const serveAsset = function (req, res) {
            const filename = req.params.filename;
            if (typeof filename !== "string") { res.sendStatus(404); return; }
            const safeName = path.basename(filename);
            const assetPath = path.join(obj.assetDir, safeName);
            fs.stat(assetPath, function (err, stats) {
                if (err || !stats.isFile()) {
                    res.sendStatus(404);
                    return;
                }
                const ext = safeName.toLowerCase().endsWith(".zip") ? "application/zip" : "application/octet-stream";
                res.setHeader("Content-Type", ext);
                res.setHeader("Content-Length", stats.size);
                res.setHeader("Cache-Control", "no-store");
                res.sendFile(assetPath);
            });
        };

        webserver.app.get(obj.assetRoute + "/:filename", serveAsset);
        const serveConfig = function (req, res) {
            try {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.sendFile(path.join(__dirname, "config.json"));
            } catch (err) {
                console.error("[bypassmethods] Failed to serve config.json", err);
                res.sendStatus(500);
            }
        };
        webserver.app.get("/plugins/bypassmethods/config.json", serveConfig);
        try {
            const domains = Object.keys(obj.meshServer.config.domains || {});
            domains.filter((domainId) => domainId).forEach((domainId) => {
                webserver.app.get("/" + domainId + obj.assetRoute + "/:filename", serveAsset);
                webserver.app.get("/" + domainId + "/plugins/bypassmethods/config.json", serveConfig);
            });
        } catch (err) {
            console.error("[bypassmethods] Failed to register domain-specific asset routes.", err);
        }
    };

    obj.mergeOptions = function (incoming) {
        const merged = {
            deployDir: obj.settings.deployDir,
            runAsUser: obj.settings.runAsUser,
            cleanupOnUndeploy: obj.settings.cleanupOnUndeploy !== false,
            skipPrerequisites: obj.settings.skipPrerequisites,
            skipTests: obj.settings.skipTests,
            launchGui: obj.settings.launchGui,
            force: false
        };
        if (incoming && typeof incoming === "object") {
            if (typeof incoming.deployDir === "string" && incoming.deployDir.trim()) {
                merged.deployDir = incoming.deployDir.trim();
            }
            if (typeof incoming.runAsUser === "number") {
                merged.runAsUser = incoming.runAsUser;
            }
            if (incoming.skipPrerequisites === true) { merged.skipPrerequisites = true; }
            if (incoming.skipPrerequisites === false) { merged.skipPrerequisites = false; }
            if (incoming.skipTests === true) { merged.skipTests = true; }
            if (incoming.skipTests === false) { merged.skipTests = false; }
            if (incoming.launchGui === true) { merged.launchGui = true; }
            if (incoming.launchGui === false) { merged.launchGui = false; }
            if (incoming.force === true) {
                merged.force = true;
            }
        }
        return merged;
    };

    obj.normalizeNodeId = function (nodeid) {
        if (typeof nodeid !== "string") { return null; }
        if (nodeid.startsWith("node/")) { return nodeid; }
        return null;
    };

    function manifestFunctionLines() {
        return [
            "function Invoke-ManifestCommands {",
            "    param(",
            "        [Parameter()] $Manifest,",
            "        [Parameter(Mandatory=$true)][string]$PropertyName,",
            "        [Parameter(Mandatory=$true)][string]$Stage,",
            "        [string]$WorkingDirectory",
            "    )",
            "    if (-not $Manifest) { return }",
            "    $commands = $Manifest.$PropertyName",
            "    if (-not $commands) { return }",
            "    $commands = @($commands)",
            "    foreach ($entry in $commands) {",
            "        $ignore = $false",
            "        $command = $null",
            "        $description = $null",
            "        if ($entry -is [string]) {",
            "            $command = $entry",
            "        } elseif ($entry -and $entry.PSObject.Properties.Match('command').Count -gt 0) {",
            "            $command = $entry.command",
            "            if ($entry.PSObject.Properties.Match('ignoreErrors').Count -gt 0) {",
            "                $ignore = [bool]$entry.ignoreErrors",
            "            }",
            "            if ($entry.PSObject.Properties.Match('description').Count -gt 0) {",
            "                $description = $entry.description",
            "            }",
            "        }",
            "        if (-not $command) { continue }",
            "        if ($description) {",
            "            Write-Host ($Stage + ': ' + $description)",
            "        } else {",
            "            Write-Host ($Stage + ': ' + $command)",
            "        }",
            "        $previousLocation = $null",
            "        try {",
            "            if ($WorkingDirectory) {",
            "                try { $previousLocation = Get-Location } catch { $previousLocation = $null }",
            "                Set-Location -LiteralPath $WorkingDirectory",
            "            }",
            "            Invoke-Expression $command",
            "        } catch {",
            "            if (-not $ignore) {",
            "                throw ($Stage + ': command failed - ' + $_.Exception.Message)",
            "            }",
            "            Write-Warning ($Stage + ': command failed but continuing: ' + $_.Exception.Message)",
            "        } finally {",
            "            if ($WorkingDirectory -and $previousLocation) {",
            "                try { Set-Location $previousLocation } catch { Write-Warning ($Stage + ': unable to restore working directory: ' + $_.Exception.Message) }",
            "            }",
            "        }",
            "    }",
            "}",
            ""
        ];
    }

    obj.composeDeployScript = function (options, downloadUrl, metadata) {
        const sanitizedDir = options.deployDir.replace(/'/g, "''");
        const sanitizedUrl = downloadUrl.replace(/'/g, "''");
        const manifestLines = manifestFunctionLines();
        const lines = [
            ...manifestLines,
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            `$packageUrl = '${sanitizedUrl}'`,
            `$targetDir = '${sanitizedDir}'`,
            "$tempFile = Join-Path -Path $env:TEMP -ChildPath ('bypassmethods-' + [System.Guid]::NewGuid().ToString() + '.zip')",
            "if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }",
            options.force ? "" : "if (Test-Path (Join-Path $targetDir 'scripts\\build_windows.ps1') -or (Test-Path (Join-Path $targetDir 'bypass-methods'))) { Write-Host ('Existing Bypass Methods deployment detected at ' + $targetDir + '. Use Force redeploy to overwrite.'); exit 0 }",
            "Invoke-WebRequest -Uri $packageUrl -OutFile $tempFile -UseBasicParsing"
        ];
        if (metadata && metadata.sha256) {
            lines.push(`$expectedHash = '${metadata.sha256}'`);
            lines.push("$fileHash = (Get-FileHash -Path $tempFile -Algorithm SHA256).Hash");
            lines.push("if ($fileHash -ne $expectedHash) { throw 'SHA256 mismatch. Expected ' + $expectedHash + ' but received ' + $fileHash; }");
        }
        lines.push(
            "Expand-Archive -Path $tempFile -DestinationPath $targetDir -Force",
            "Remove-Item -LiteralPath $tempFile -Force",
            "$repoRoot = if (Test-Path (Join-Path $targetDir 'scripts\\build_windows.ps1')) { $targetDir } else { $null }",
            "if (-not $repoRoot) {",
            "  $candidate = Join-Path $targetDir 'bypass-methods'",
            "  if (Test-Path (Join-Path $candidate 'scripts\\build_windows.ps1')) {",
            "    $repoRoot = $candidate",
            "  }",
            "}",
            "if (-not $repoRoot) { throw 'Unable to locate build_windows.ps1 within extracted bundle.' }",
            "$manifestPath = Join-Path $repoRoot 'deploy.manifest.json'",
            "$pluginManifest = $null",
            "if (Test-Path -LiteralPath $manifestPath) {",
            "  Write-Host ('Manifest located at ' + $manifestPath)",
            "  try {",
            "    $pluginManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json",
            "  } catch {",
            "    throw 'Unable to parse deploy.manifest.json: ' + $_.Exception.Message",
            "  }",
            "} else {",
            "  Write-Host 'No deploy.manifest.json found; default build routine will run.'",
            "}",
            "Invoke-ManifestCommands -Manifest $pluginManifest -PropertyName 'preDeployCommands' -Stage 'Manifest:preDeploy' -WorkingDirectory $repoRoot",
            "$buildScript = Join-Path $repoRoot 'scripts\\build_windows.ps1'",
            "$logFile = Join-Path $repoRoot ('meshdeploy_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')",
            "$buildArgs = @('-LogFile', $logFile)",
            options.skipPrerequisites ? "$buildArgs += '-SkipPrerequisites'" : "",
            options.skipTests ? "$buildArgs += '-SkipTests'" : "",
            "Write-Host ('Executing build script: ' + $buildScript)",
            "$argumentList = @('-ExecutionPolicy','Bypass','-NoProfile','-File',$buildScript) + $buildArgs",
            "$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -Wait -NoNewWindow -PassThru",
            "if ($process.ExitCode -ne 0) { throw 'Build script failed with exit code ' + $process.ExitCode }");
        if (options.launchGui) {
            lines.push(
                "$launchScript = Join-Path $repoRoot 'launch_framework.bat'",
                "if (Test-Path $launchScript) {",
                "  Write-Host 'Launching GUI controller in background...'",
                "  Start-Process -FilePath $launchScript -WorkingDirectory $repoRoot -WindowStyle Minimized",
                "} else {",
                "  Write-Warning 'launch_framework.bat not found. Skipping GUI launch.'",
                "}"
            );
        }
        lines.push(
            "Invoke-ManifestCommands -Manifest $pluginManifest -PropertyName 'postDeployCommands' -Stage 'Manifest:postDeploy' -WorkingDirectory $repoRoot",
            "Invoke-ManifestCommands -Manifest $pluginManifest -PropertyName 'verifyCommands' -Stage 'Manifest:verify' -WorkingDirectory $repoRoot",
            "Write-Host ('Bypass Methods deployed at ' + $repoRoot)"
        );
        return lines.filter(Boolean).join('\r\n');
    };

    obj.composeUndeployScript = function (options) {
        const sanitizedDir = options.deployDir.replace(/'/g, "''");
        const manifestLines = manifestFunctionLines();
        const lines = [
            ...manifestLines,
            "$ErrorActionPreference = 'Stop'",
            `$targetDir = '${sanitizedDir}'`,
            "$repoRoot = if (Test-Path (Join-Path $targetDir 'scripts\\build_windows.ps1')) { $targetDir } elseif (Test-Path (Join-Path $targetDir 'bypass-methods')) { Join-Path $targetDir 'bypass-methods' } else { $null }",
            "$workingManifestRoot = if ($repoRoot) { $repoRoot } else { $targetDir }",
            "$manifestPath = Join-Path $workingManifestRoot 'deploy.manifest.json'",
            "$pluginManifest = $null",
            "if (Test-Path -LiteralPath $manifestPath) {",
            "  Write-Host ('Manifest located at ' + $manifestPath)",
            "  try {",
            "    $pluginManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json",
            "  } catch {",
            "    Write-Warning ('Unable to parse deploy.manifest.json during undeploy: ' + $_.Exception.Message)",
            "    $pluginManifest = $null",
            "  }",
            "} else {",
            "  Write-Host 'No deploy.manifest.json present for undeploy automation.'",
            "}",
            "Invoke-ManifestCommands -Manifest $pluginManifest -PropertyName 'preUndeployCommands' -Stage 'Manifest:preUndeploy' -WorkingDirectory $workingManifestRoot",
            "if ($repoRoot -and Test-Path $repoRoot) {",
            "  Write-Host ('Removing Bypass Methods deployment from ' + $repoRoot)",
            "  Remove-Item -LiteralPath $repoRoot -Recurse -Force",
            "} else {",
            "  Write-Host 'No Bypass Methods deployment found to remove.'",
            "}"
        ];
        if (options.cleanupOnUndeploy) {
            lines.push(
                "if (Test-Path $targetDir) {",
                "  Remove-Item -LiteralPath $targetDir -Recurse -Force",
                "  Write-Host ('Removed staging directory ' + $targetDir)",
                "}"
            );
        }
        lines.push(
            "Invoke-ManifestCommands -Manifest $pluginManifest -PropertyName 'postUndeployCommands' -Stage 'Manifest:postUndeploy' -WorkingDirectory $workingManifestRoot"
        );
        return lines.join('\r\n');
    };

    obj.getDownloadUrl = function (domainId, origin) {
        const metadata = computeAssetMetadata(false);
        if (!metadata) { return null; }
        const fileSegment = encodeURIComponent(metadata.name);
        if (typeof origin === "string" && origin.startsWith("http")) {
            const trimmed = origin.replace(/\/+$/, "");
            const prefix = domainId ? "/" + domainId : "";
            return trimmed + prefix + obj.assetRoute + "/" + fileSegment;
        }
        const domains = obj.meshServer.config.domains || {};
        const domain = domains[domainId] || domains[""] || {};
        const serverName = obj.meshServer.webserver.getWebServerName(domain, null);
        const args = obj.meshServer.webserver.args || {};
        const port = args.aliasport || args.port || 443;
        const proto = (args.tlsoffload === true || port === 443) ? "https" : "http";
        const portSegment = (port === 80 || port === 443) ? "" : ":" + port;
        const prefix = domainId ? "/" + domainId : "";
        return proto + "://" + serverName + portSegment + prefix + obj.assetRoute + "/" + fileSegment;
    };

    obj.sendPluginEvent = function (pluginaction, userid, details) {
        const event = {
            nolog: 1,
            action: "plugin",
            plugin: "bypassmethods",
            pluginaction: pluginaction,
            details: {
                timestamp: Date.now(),
                ...details
            }
        };
        let targets;
        if (Array.isArray(userid) && userid.length > 0) {
            targets = userid;
        } else if (typeof userid === "string" && userid.length > 0) {
            targets = [userid];
        } else {
            targets = ["server-users"];
        }
        obj.meshServer.DispatchEvent(targets, obj, event);
    };

    obj.sendAssetInfo = function (userid) {
        const metadata = computeAssetMetadata(false);
        if (!metadata) {
            obj.sendPluginEvent("assetInfo", userid, { available: false });
            return;
        }
        const autoState = obj.autoState || readAutoUpdateState();
        obj.sendPluginEvent("assetInfo", userid, {
            available: true,
            name: metadata.name,
            size: metadata.size,
            sha256: metadata.sha256,
            updated: metadata.mtime,
            version: (autoState && autoState.version) || pluginMeta.version || null,
            source: (autoState && autoState.source) || pluginMeta.downloadUrl || null,
            downloadedAt: autoState ? (autoState.downloadedAt || null) : null,
            lastChecked: autoState ? (autoState.lastChecked || null) : null
        });
    };

    obj.server_startup = function () {
        console.log("[bypassmethods] plugin initialized");
        computeAssetMetadata(true);
        setupAssetWatcher();
        ensurePluginRegistered();
        if (obj.autoUpdater) {
            obj.autoUpdater.start();
        }
        if (!obj.assetMetadata) {
            console.warn("[bypassmethods] No deployment bundle found in", obj.assetDir);
        }
    };

    obj.dispatchRunCommand = function (nodeid, script, runAsUser, userid, action, existingJob) {
        const agent = obj.meshServer.webserver.wsagents[nodeid];
        if (!agent) {
            obj.sendPluginEvent("jobUpdate", userid, { nodeid, status: "Agent offline", level: "error", action });
            if (existingJob) { obj._finishQueuedJob(existingJob.nodeid); }
            return;
        }
        const responseId = obj.generateResponseId();
        const job = existingJob || {
            nodeid,
            userid,
            action,
            script,
            runAsUser: (typeof runAsUser === "number") ? runAsUser : 0,
            started: Date.now(),
            retries: 0
        };
        job.started = (typeof job.started === "number") ? job.started : Date.now();
        job.retries = (typeof job.retries === "number" && isFinite(job.retries)) ? job.retries : 0;
        job.nodeName = agent ? (agent.dbNodeName || agent.name || agent.host || null) : null;
        if (existingJob) { existingJob.nodeName = job.nodeName; }
        job.responseId = responseId;
        job.script = job.script || script;
        job.runAsUser = (typeof job.runAsUser === "number") ? job.runAsUser : 0;
        job.queueEntry = (existingJob && existingJob.queueEntry) ? existingJob.queueEntry : (existingJob || null);
        if (job.timeout) { clearTimeout(job.timeout); job.timeout = null; }
        job.timeout = setTimeout(function () {
            if (!obj.activeJobs[responseId]) { return; }
            obj.sendPluginEvent("jobUpdate", userid, { nodeid, nodeName: job.nodeName, status: "Command timed out after " + Math.round(obj.jobTimeoutMs / 1000) + " seconds.", level: "error", action });
            delete obj.activeJobs[responseId];
            if (job.queueEntry) { obj._finishQueuedJob(job.queueEntry.nodeid); }
        }, obj.jobTimeoutMs);
        obj.activeJobs[responseId] = job;
        const message = {
            action: "runcommands",
            type: 2,
            cmds: job.script,
            runAsUser: job.runAsUser || 0,
            responseid: responseId,
            reply: true
        };
        try {
            agent.send(JSON.stringify(message));
            obj.sendPluginEvent("jobUpdate", userid, { nodeid, nodeName: job.nodeName, status: "Command dispatched", level: "info", action });
        } catch (err) {
            delete obj.activeJobs[responseId];
            obj.sendPluginEvent("jobUpdate", userid, { nodeid, status: "Failed to dispatch command: " + err.message, level: "error", action });
            if (job.queueEntry) { obj._finishQueuedJob(job.queueEntry.nodeid); }
        }
    };

    obj.serveraction = function (command) {
        if (!command || !Array.isArray(command.nodeids) || command.nodeids.length === 0) {
            obj.sendPluginEvent("jobUpdate", command ? command.userid : null, { status: "No target devices provided.", level: "error" });
            return;
        }

        const action = command.pluginaction;
        const options = obj.mergeOptions(command.options);
        console.log("[bypassmethods] request", JSON.stringify({
            action,
            nodes: command.nodeids.length,
            deployDir: options.deployDir,
            skipPrerequisites: !!options.skipPrerequisites,
            skipTests: !!options.skipTests,
            launchGui: !!options.launchGui,
            runAsUser: options.runAsUser,
            force: options.force === true
        }));

        if (action === "info") {
            obj.sendAssetInfo(command.userid);
            return;
        }

        const metadata = computeAssetMetadata(false);
        if (action === "deploy" && !metadata) {
            obj.sendPluginEvent("jobUpdate", command.userid, { status: "Deployment asset not found on server.", level: "error" });
            return;
        }

        command.nodeids.forEach((nodeid) => {
            const normalized = obj.normalizeNodeId(nodeid);
            if (!normalized) {
                obj.sendPluginEvent("jobUpdate", command.userid, { status: "Invalid node identifier: " + nodeid, level: "error", action });
                return;
            }
            const domainId = normalized.split("/")[1] || "";
            const downloadUrl = obj.getDownloadUrl(domainId, command.origin);
            if (!downloadUrl) {
                obj.sendPluginEvent("jobUpdate", command.userid, { nodeid: normalized, status: "Unable to derive asset URL.", level: "error", action });
                return;
            }

            if (action === "deploy") {
                const script = obj.composeDeployScript(options, downloadUrl, metadata);
                console.log("[bypassmethods] queue deploy", normalized);
                obj.enqueueRunCommand({
                    nodeid: normalized,
                    userid: command.userid,
                    action,
                    script,
                    runAsUser: options.runAsUser || 0
                });
            } else if (action === "undeploy") {
                const script = obj.composeUndeployScript(options);
                console.log("[bypassmethods] queue undeploy", normalized);
                obj.enqueueRunCommand({
                    nodeid: normalized,
                    userid: command.userid,
                    action,
                    script,
                    runAsUser: options.runAsUser || 0
                });
            } else if (action === "status") {
                const agent = obj.meshServer.webserver.wsagents[normalized];
                obj.sendPluginEvent("jobUpdate", command.userid, {
                    nodeid: normalized,
                    status: agent ? "Agent connected" : "Agent offline",
                    level: agent ? "info" : "error",
                    action
                });
            } else {
                obj.sendPluginEvent("jobUpdate", command.userid, { nodeid: normalized, status: "Unsupported action '" + action + "'", level: "error", action });
            }
        });
    };

    obj.hook_processAgentData = function (message) {
        if (!message || typeof message.responseid !== "string") { return; }
        if (message.action !== "msg" || message.type !== "runcommands") { return; }
        const job = obj.activeJobs[message.responseid];
        if (!job) { return; }
        if (job.timeout) { clearTimeout(job.timeout); job.timeout = null; }
        const output = typeof message.result === "string" && message.result.trim().length > 0
            ? message.result.trim()
            : (message.error ? ("Error: " + message.error) : "Command completed.");
        if (BUSY_MESSAGE_REGEX.test(output) && job.retries < obj.maxRunCommandRetries) {
            job.retries += 1;
            delete obj.activeJobs[message.responseid];
            const delay = obj.retryDelayMs * job.retries;
            obj.sendPluginEvent("jobUpdate", job.userid, {
                nodeid: job.nodeid,
                nodeName: job.nodeName,
                status: "Agent busy, retrying in " + Math.round(delay / 1000) + " seconds.",
                level: "warn",
                action: job.action
            });
            setTimeout(function () {
                obj.dispatchRunCommand(job.nodeid, job.script, job.runAsUser, job.userid, job.action, job);
            }, delay);
            return;
        }
        let level = "info";
        let finalOutput = output;
        if (BUSY_MESSAGE_REGEX.test(output)) {
            level = "error";
            finalOutput = "Agent busy - exceeded retry budget after " + job.retries + " attempts.";
        }
        obj.sendPluginEvent("jobUpdate", job.userid, {
            nodeid: job.nodeid,
            nodeName: job.nodeName,
            status: finalOutput,
            level,
            action: job.action
        });
        delete obj.activeJobs[message.responseid];
        if (job.queueEntry) { obj._finishQueuedJob(job.queueEntry.nodeid); }
    };

    obj.handleAdminReq = function (req, res, user) {
        if (!isSiteAdmin(user)) { res.sendStatus(401); return; }
        const meta = computeAssetMetadata(false);
        const autoState = obj.autoState || readAutoUpdateState();
        const assetInfo = meta ? {
            name: meta.name,
            sizeMB: ((meta.size || 0) / (1024 * 1024)).toFixed(2),
            sha256: meta.sha256,
            updated: meta.mtime ? new Date(meta.mtime).toISOString() : null,
            version: (autoState && autoState.version) || pluginMeta.version || null,
            downloadedAt: autoState ? (autoState.downloadedAt || null) : null,
            source: (autoState && autoState.source) || pluginMeta.downloadUrl || null,
            lastChecked: autoState ? (autoState.lastChecked || null) : null
        } : null;
        const pluginVersion = (autoState && autoState.version) || pluginMeta.version || "0.0.0";
        const autoInfo = {
            enabled: true,
            source: (autoState && autoState.source) || pluginMeta.downloadUrl || null,
            lastChecked: autoState ? (autoState.lastChecked || null) : null,
            lastUpdated: autoState ? (autoState.downloadedAt || null) : (assetInfo ? assetInfo.updated : null),
            status: assetInfo ? "Healthy" : "Awaiting bundle"
        };
        res.render(path.join(obj.viewsPath, "admin"), {
            plugin: {
                name: pluginMeta.name || "Bypass Methods Deployer",
                description: pluginMeta.description || "Deploy and bootstrap the Bypass Methods hooking framework.",
                version: pluginVersion,
                homepage: pluginMeta.homepage || ""
            },
            asset: assetInfo,
            auto: autoInfo
        });
    };

    obj.handleAdminPostReq = function (req, res, user) {
        if (!isSiteAdmin(user)) { res.sendStatus(401); return; }
        res.sendStatus(204);
    };

    obj.generateResponseId = function () {
        return "bypassmethods:" + obj.crypto.randomBytes(8).toString("hex");
    };

    return obj;
};
