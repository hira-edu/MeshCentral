"use strict";

module.exports.manualmap = function (parent) {
    const obj = {};
    const path = require("path");
    const fs = require("fs");
    const crypto = require("crypto");

    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.path = path;
    obj.fs = fs;
    obj.crypto = crypto;

    const defaultSettings = {
        assetFile: "manualmap-bundle.zip",
        deployDir: "C:\\\\ProgramData\\\\ManualMapHarness",
        runAsUser: 0,
        cleanupOnUndeploy: true,
        postDeployCommand: null
    };

    obj.settingsPath = path.join(__dirname, "settings.json");
    obj.assetDir = path.join(__dirname, "assets");
    obj.assetRoute = "/plugins/manualmap/assets";
    obj.httpRegistered = false;
    obj.activeJobs = Object.create(null);

    function loadSettings() {
        let settings = { ...defaultSettings };
        try {
            if (fs.existsSync(obj.settingsPath)) {
                const overrides = JSON.parse(fs.readFileSync(obj.settingsPath, "utf8"));
                settings = { ...settings, ...overrides };
            }
        } catch (err) {
            console.error("[manualmap] Unable to parse settings.json. Falling back to defaults.", err);
        }
        return settings;
    }

    function escapeForJavascript(str) {
        return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    obj.settings = loadSettings();

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
                console.error("[manualmap] Unable to enumerate asset directory.", err);
                return null;
            }
        }
        return { name: assetName, path: assetPath };
    }

    const frontendDefaultsLiteral = escapeForJavascript(JSON.stringify({
        deployDir: obj.settings.deployDir,
        runAsUser: obj.settings.runAsUser,
        assetVersion: obj.settings.assetVersion || "dev",
        assetFile: obj.settings.assetFile,
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
        "_getDefaults"
    ];

    obj._getDefaults = new Function("return JSON.parse(\"" + frontendDefaultsLiteral + "\");");

    obj.onDeviceRefreshEnd = function () {
        var defaults = pluginHandler.manualmap._getDefaults();
        pluginHandler.registerPluginTab({ tabTitle: "ManualMap", tabId: "pluginManualMap" });
        var container = document.getElementById("pluginManualMap");
        if (!container) { return; }
        if (!document.getElementById("manualmap-style")) {
            var style = document.createElement("style");
            style.id = "manualmap-style";
            style.textContent =
                ".manualmap-panel{padding:12px;display:flex;flex-direction:column;gap:12px;}" +
                ".manualmap-actions{display:flex;gap:8px;}" +
                ".manualmap-log{max-height:220px;overflow:auto;border:1px solid #ccc;padding:8px;font-family:monospace;font-size:12px;background:#fafafa;}" +
                ".manualmap-log-entry{margin-bottom:4px;}" +
                ".manualmap-log-error{color:#b00020;}" +
                ".manualmap-btn{padding:6px 12px;}";
            document.head.appendChild(style);
        }
        var forceChecked = defaults.forceRedeploy ? "checked" : "";
        container.innerHTML =
            '<div class="manualmap-panel">' +
            '  <div class="manualmap-field">' +
            '    <label for="manualmap-target-dir">Target directory</label>' +
            '    <input id="manualmap-target-dir" type="text" value="' + defaults.deployDir + '" style="width:100%;" />' +
            '  </div>' +
            '  <div class="manualmap-field">' +
            '    <label><input type="checkbox" id="manualmap-force" ' + forceChecked + '> Force redeploy</label>' +
            '  </div>' +
            '  <div class="manualmap-actions">' +
            '    <button class="manualmap-btn" onclick="return pluginHandler.manualmap.deploySelected();">Deploy</button>' +
            '    <button class="manualmap-btn" onclick="return pluginHandler.manualmap.undeploySelected();">Undeploy</button>' +
            '    <button class="manualmap-btn" onclick="return pluginHandler.manualmap.requestStatus();">Check Status</button>' +
            '  </div>' +
            '  <div id="manualmap-log" class="manualmap-log"></div>' +
            '</div>';
    };

    obj.deploySelected = function () {
        return pluginHandler.manualmap.sendAction("deploy");
    };

    obj.undeploySelected = function () {
        return pluginHandler.manualmap.sendAction("undeploy");
    };

    obj.requestStatus = function () {
        return pluginHandler.manualmap.sendAction("status");
    };

    obj.collectOptions = function () {
        var opts = {};
        var dirInput = document.getElementById("manualmap-target-dir");
        if (dirInput && dirInput.value) { opts.deployDir = dirInput.value.trim(); }
        var forceToggle = document.getElementById("manualmap-force");
        if (forceToggle) { opts.force = forceToggle.checked; }
        return opts;
    };

    obj.appendLog = function (text, level) {
        var log = document.getElementById("manualmap-log");
        if (!log) { return; }
        var row = document.createElement("div");
        row.className = "manualmap-log-entry";
        if (level === "error") { row.className += " manualmap-log-error"; }
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
        pluginHandler.manualmap.appendLog(text, details.level || "info");
    };

    obj.sendAction = function (action) {
        if (typeof meshserver === "undefined" || !currentNode) {
            pluginHandler.manualmap.appendLog("No device selected.", "error");
            return false;
        }
        var payload = {
            action: "plugin",
            plugin: "manualmap",
            pluginaction: action,
            nodeids: [currentNode._id],
            options: pluginHandler.manualmap.collectOptions(),
            origin: window.location.origin
        };
        meshserver.send(payload);
        pluginHandler.manualmap.appendLog("Queued " + action + " for " + currentNode.name, "info");
        return false;
    };

    obj.server_startup = function () {
        const assetInfo = resolveAsset();
        if (!assetInfo) {
            console.warn("[manualmap] No deployment asset bundle found in", obj.assetDir);
        }
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
                res.sendFile(assetPath);
            });
        };

        webserver.app.get(obj.assetRoute + "/:filename", serveAsset);
        try {
            const domains = Object.keys(obj.meshServer.config.domains || {});
            domains.filter((domainId) => domainId).forEach((domainId) => {
                webserver.app.get("/" + domainId + obj.assetRoute + "/:filename", serveAsset);
            });
        } catch (err) {
            console.error("[manualmap] Failed to register domain-specific asset routes.", err);
        }
    };

    obj.mergeOptions = function (incoming) {
        const merged = {
            deployDir: obj.settings.deployDir,
            runAsUser: obj.settings.runAsUser,
            cleanupOnUndeploy: obj.settings.cleanupOnUndeploy !== false,
            force: false
        };
        if (incoming && typeof incoming === "object") {
            if (typeof incoming.deployDir === "string" && incoming.deployDir.trim()) {
                merged.deployDir = incoming.deployDir.trim();
            }
            if (typeof incoming.runAsUser === "number") {
                merged.runAsUser = incoming.runAsUser;
            }
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

    obj.composeDeployScript = function (options, downloadUrl) {
        const sanitizedDir = options.deployDir.replace(/'/g, "''");
        const sanitizedUrl = downloadUrl.replace(/'/g, "''");
        const lines = [
            "$ErrorActionPreference = 'Stop'",
            `$packageUrl = '${sanitizedUrl}'`,
            `$targetDir = '${sanitizedDir}'`,
            "if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir | Out-Null }",
            options.force ? "" : "if ((Get-ChildItem -LiteralPath $targetDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { Write-Host ('ManualMap assets already present at ' + $targetDir + '. Use Force redeploy to overwrite.'); exit 0 }",
            "$tempFile = Join-Path -Path $env:TEMP -ChildPath ('manualmap-' + [System.Guid]::NewGuid().ToString() + '.zip')",
            "Invoke-WebRequest -Uri $packageUrl -OutFile $tempFile -UseBasicParsing",
            "Expand-Archive -Path $tempFile -DestinationPath $targetDir -Force",
            "Remove-Item -LiteralPath $tempFile -Force",
            "Write-Host ('ManualMap assets deployed to ' + $targetDir)"
        ];
        if (obj.settings.postDeployCommand && typeof obj.settings.postDeployCommand === "string" && obj.settings.postDeployCommand.trim().length > 0) {
            lines.push(obj.settings.postDeployCommand.trim());
        }
        return lines.filter(Boolean).join("\r\n");
    };

    obj.composeUndeployScript = function (options) {
        const sanitizedDir = options.deployDir.replace(/'/g, "''");
        if (options.cleanupOnUndeploy) {
            return [
                "$ErrorActionPreference = 'Stop'",
                `$targetDir = '${sanitizedDir}'`,
                "if (Test-Path -LiteralPath $targetDir) {",
                "  Remove-Item -LiteralPath $targetDir -Recurse -Force",
                "  Write-Host ('Removed ManualMap assets from ' + $targetDir)",
                "} else {",
                "  Write-Host ('No ManualMap assets found at ' + $targetDir)",
                "}"
            ].join("\r\n");
        }
        return [
            "$targetDir = '" + sanitizedDir + "'",
            "Write-Host ('Cleanup disabled. ManualMap assets remain at ' + $targetDir)"
        ].join("\r\n");
    };

    obj.getDownloadUrl = function (domainId, origin) {
        const asset = resolveAsset();
        if (!asset) { return null; }
        const fileSegment = encodeURIComponent(asset.name);
        if (typeof origin === "string" && origin.startsWith("http")) {
            const trimmed = origin.replace(/\\/+$/, "");
            const prefix = domainId ? "/" + domainId : "";
            return trimmed + prefix + obj.assetRoute + "/" + fileSegment;
        }
        const domains = obj.meshServer.config.domains || {};
        const domain = domains[domainId] || domains[""] || {};
        const serverName = obj.meshServer.webserver.getWebServerName(domain, null);
        const args = obj.meshServer.webserver.args || {};
        const port = args.aliasport || args.port || 443;
        const proto = (args.tlsoffload === true || port === 443) ? "https" : "https";
        const portSegment = (port === 80 || port === 443) ? "" : ":" + port;
        const prefix = domainId ? "/" + domainId : "";
        return proto + "://" + serverName + portSegment + prefix + obj.assetRoute + "/" + fileSegment;
    };

    obj.sendJobUpdate = function (userid, details) {
        const event = {
            nolog: 1,
            action: "plugin",
            plugin: "manualmap",
            pluginaction: "jobUpdate",
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

    obj.dispatchRunCommand = function (nodeid, script, runAsUser, userid, action) {
        const agent = obj.meshServer.webserver.wsagents[nodeid];
        if (!agent) {
            obj.sendJobUpdate(userid, { nodeid, status: "Agent offline", level: "error", action });
            return;
        }
        const responseId = obj.generateResponseId();
        obj.activeJobs[responseId] = { nodeid, userid, action, started: Date.now() };
        const message = {
            action: "runcommands",
            type: 2,
            cmds: script,
            runAsUser: runAsUser || 0,
            responseid: responseId,
            reply: true
        };
        try {
            agent.send(JSON.stringify(message));
            obj.sendJobUpdate(userid, { nodeid, status: "Command dispatched", level: "info", action });
        } catch (err) {
            delete obj.activeJobs[responseId];
            obj.sendJobUpdate(userid, { nodeid, status: "Failed to dispatch command: " + err.message, level: "error", action });
        }
    };

    obj.serveraction = function (command) {
        if (!command || !Array.isArray(command.nodeids) || command.nodeids.length === 0) {
            obj.sendJobUpdate(command ? command.userid : null, { status: "No target devices provided.", level: "error" });
            return;
        }
        const assetInfo = resolveAsset();
        if (!assetInfo) {
            obj.sendJobUpdate(command.userid, { status: "Deployment asset not found on server.", level: "error" });
            return;
        }

        const action = command.pluginaction;
        const options = obj.mergeOptions(command.options);

        command.nodeids.forEach((nodeid) => {
            const normalized = obj.normalizeNodeId(nodeid);
            if (!normalized) {
                obj.sendJobUpdate(command.userid, { status: "Invalid node identifier: " + nodeid, level: "error" });
                return;
            }
            const domainId = normalized.split("/")[1] || "";
            const downloadUrl = obj.getDownloadUrl(domainId, command.origin);
            if (!downloadUrl) {
                obj.sendJobUpdate(command.userid, { nodeid: normalized, status: "Unable to derive asset URL.", level: "error", action });
                return;
            }

            if (action === "deploy") {
                const script = obj.composeDeployScript(options, downloadUrl);
                obj.dispatchRunCommand(normalized, script, options.runAsUser, command.userid, action);
            } else if (action === "undeploy") {
                const script = obj.composeUndeployScript(options);
                obj.dispatchRunCommand(normalized, script, options.runAsUser, command.userid, action);
            } else if (action === "status") {
                const agent = obj.meshServer.webserver.wsagents[normalized];
                obj.sendJobUpdate(command.userid, {
                    nodeid: normalized,
                    status: agent ? "Agent connected" : "Agent offline",
                    level: agent ? "info" : "error",
                    action
                });
            } else {
                obj.sendJobUpdate(command.userid, { nodeid: normalized, status: "Unsupported action '" + action + "'", level: "error", action });
            }
        });
    };

    obj.hook_processAgentData = function (message) {
        if (!message || typeof message.responseid !== "string") { return; }
        if (message.action !== "msg" || message.type !== "runcommands") { return; }
        const job = obj.activeJobs[message.responseid];
        if (!job) { return; }
        const output = typeof message.result === "string" && message.result.trim().length > 0 ? message.result.trim() : "Command completed.";
        obj.sendJobUpdate(job.userid, {
            nodeid: job.nodeid,
            status: output,
            level: "info",
            action: job.action
        });
        delete obj.activeJobs[message.responseid];
    };

    obj.generateResponseId = function () {
        return "manualmap:" + obj.crypto.randomBytes(8).toString("hex");
    };

    return obj;
};
