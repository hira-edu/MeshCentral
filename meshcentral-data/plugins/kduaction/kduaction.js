"use strict";

module.exports.kduaction = function (parent) {
    const obj = {};
    const path = require("path");
    const fs = require("fs");

    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.assetDir = path.join(__dirname, "assets");
    obj.assetRoute = "/plugins/kduaction/assets";
    obj.httpRegistered = false;

    const REQUIRED_ASSETS = [
        "run-kdu.ps1",
        "kdu.exe",
        "kdu.exe.sha256",
        "drv64.dll",
        "drv64.dll.sha256"
    ];
    const DEFAULT_PROVIDER = 1;

    obj.exports = ["uiCustomEvent"];

    console.log("kduaction: plugin initialized");

    function psEscapeSingle(str) {
        return (str || "").replace(/'/g, "''");
    }

    function resolveAsset(filename) {
        if (typeof filename !== "string" || filename.length === 0) { return null; }
        const safeName = path.basename(filename);
        const fullPath = path.join(obj.assetDir, safeName);
        try {
            const stats = fs.statSync(fullPath);
            if (stats.isFile()) { return fullPath; }
        } catch (err) { }
        return null;
    }

    function ensureAssets() {
        const missing = [];
        REQUIRED_ASSETS.forEach((file) => {
            if (!resolveAsset(file)) {
                missing.push(file);
            }
        });
        if (missing.length > 0) {
            console.warn("[kduaction] Missing asset(s) in", obj.assetDir, ":", missing.join(", "));
        } else {
            console.log("[kduaction] All required assets located.");
        }
    }

    obj.server_startup = function () {
        ensureAssets();
    };

    obj.hook_setupHttpHandlers = function (webserver) {
        if (!webserver || !webserver.app) { return; }
        if (obj.httpRegistered) { return; }
        obj.httpRegistered = true;

        const serveAsset = function (req, res) {
            const filename = req.params.filename;
            if (typeof filename !== "string") { res.sendStatus(404); return; }
            const fullPath = resolveAsset(filename);
            if (!fullPath) {
                res.sendStatus(404);
                return;
            }
            fs.stat(fullPath, function (err, stats) {
                if (err || !stats.isFile()) {
                    res.sendStatus(404);
                    return;
                }
                const lower = filename.toLowerCase();
                let contentType = "application/octet-stream";
                if (lower.endsWith(".ps1")) { contentType = "text/plain"; }
                else if (lower.endsWith(".exe")) { contentType = "application/vnd.microsoft.portable-executable"; }
                else if (lower.endsWith(".dll")) { contentType = "application/octet-stream"; }
                else if (lower.endsWith(".sha256")) { contentType = "text/plain"; }
                res.setHeader("Content-Type", contentType);
                res.setHeader("Content-Length", stats.size);
                res.sendFile(fullPath);
            });
        };

        webserver.app.get(obj.assetRoute + "/:filename", serveAsset);
        try {
            const domains = Object.keys(obj.meshServer.config.domains || {});
            domains.filter((domainId) => domainId).forEach((domainId) => {
                webserver.app.get("/" + domainId + obj.assetRoute + "/:filename", serveAsset);
            });
        } catch (err) {
            console.error("[kduaction] Failed to register domain-specific asset routes.", err);
        }
    };

    function buildAssetUrl(domainId, filename) {
        if (!resolveAsset(filename)) { return null; }
        const fileSegment = encodeURIComponent(filename);
        const domains = obj.meshServer.config.domains || {};
        const domain = domains[domainId] || domains[""] || {};
        const web = obj.meshServer.webserver;
        const serverName = web.getWebServerName(domain, null);
        const args = web.args || {};
        const port = args.aliasport || args.port || 443;
        const proto = (args.tlsoffload === true || port === 443) ? "https" : "https";
        const portSegment = (port === 80 || port === 443) ? "" : ":" + port;
        const prefix = domainId ? "/" + domainId : "";
        return proto + "://" + serverName + portSegment + prefix + obj.assetRoute + "/" + fileSegment;
    }

    function buildPowerShellCommand(options) {
        const lines = [];
        lines.push("$ErrorActionPreference='Stop'");
        lines.push("$ProgressPreference='SilentlyContinue'");
        lines.push("$workingRoot = 'C:\\ProgramData\\MeshKDU'");
        lines.push("New-Item -ItemType Directory -Path $workingRoot -Force | Out-Null");
        lines.push("$scriptPath = Join-Path $workingRoot 'run-kdu.ps1'");
        lines.push(`Invoke-WebRequest -Uri '${psEscapeSingle(options.scriptUrl)}' -OutFile $scriptPath -UseBasicParsing`);
        lines.push("$params = @(" +
            "'-KduUrl','" + psEscapeSingle(options.exeUrl) + "'," +
            "'-HashUrl','" + psEscapeSingle(options.hashUrl) + "'," +
            "'-DriverUrl','" + psEscapeSingle(options.driverUrl) + "'," +
            "'-DriverHashUrl','" + psEscapeSingle(options.driverHashUrl) + "'," +
            "'-WorkingRoot',$workingRoot,'-Keep'" +
            ")");
        if (options.provider !== null && options.provider !== undefined) {
            lines.push(`$params += '-Provider'; $params += '${psEscapeSingle(String(options.provider))}'`);
        }
        if (options.pid !== null && options.pid !== undefined) {
            lines.push(`$params += '-Pid'; $params += '${psEscapeSingle(String(options.pid))}'`);
        }
        if (options.arguments && options.arguments.length > 0) {
            lines.push(`$params += '-Arguments'; $params += '${psEscapeSingle(options.arguments)}'`);
        }
        if (options.runLabel && options.runLabel.length > 0) {
            lines.push(`$params += '-RunLabel'; $params += '${psEscapeSingle(options.runLabel)}'`);
        }
        if (options.skipHash === true) {
            lines.push("$params += '-SkipHash'");
        }
        lines.push("& $scriptPath @params");
        return lines.join("; ");
    }

    function ensureFullNodeId(nodeid, domainId) {
        if (!nodeid) { return null; }
        if (nodeid.indexOf("/") === -1) {
            return "node/" + domainId + "/" + nodeid;
        }
        return nodeid;
    }

    obj.uiCustomEvent = function (command, meshUser) {
        try {
            console.log("kduaction: uiCustomEvent received", JSON.stringify({
                section: command && command.section,
                element: command && command.element,
                values: command && command.values,
                selectedDevices: command && command.selectedDevices,
                src: command && command.src
            }));
            if (!command || !command.section || !command.element) { return; }
            const section = command.section;
            const element = command.element;
            if (section !== "dialogs" || element !== "kduDeploy") {
                return;
            }

            const selection = [];
            if (command && Array.isArray(command.selectedDevices)) {
                selection.push(...command.selectedDevices);
            }
            if (command && command.src && Array.isArray(command.src.selectedDevices)) {
                selection.push(...command.src.selectedDevices);
            }
            if (command && command.nodeid) {
                selection.push(command.nodeid);
            }
            const uniqueSelection = [...new Set(selection.filter((node) => typeof node === "string" && node.length > 0))];
            if (uniqueSelection.length === 0) {
                console.log("kduaction: no devices in selection");
                return;
            }

            const server = meshUser.parent;
            const domainId = meshUser.domain.id;

            const scriptUrl = buildAssetUrl(domainId, "run-kdu.ps1");
            const exeUrl = buildAssetUrl(domainId, "kdu.exe");
            const hashUrl = buildAssetUrl(domainId, "kdu.exe.sha256");
            const driverUrl = buildAssetUrl(domainId, "drv64.dll");
            const driverHashUrl = buildAssetUrl(domainId, "drv64.dll.sha256");

            if (!scriptUrl || !exeUrl || !hashUrl || !driverUrl || !driverHashUrl) {
                console.error("[kduaction] Missing asset URLs, deployment aborted.");
                return;
            }

            const providerRaw = (command.values && typeof command.values.provider === "string") ? command.values.provider.trim() : "";
            const pidRaw = (command.values && typeof command.values.pid === "string") ? command.values.pid.trim() : "";
            const argsRaw = (command.values && typeof command.values.arguments === "string") ? command.values.arguments.trim() : "";
            const skipHash = (command.values && command.values.skiph && command.values.skiph === "1") ? true : false;

            let provider = null;
            if (argsRaw.length === 0) {
                if (providerRaw.toLowerCase() === "custom" || providerRaw === "") {
                    provider = DEFAULT_PROVIDER;
                } else {
                    const parsedProvider = parseInt(providerRaw, 10);
                    provider = Number.isNaN(parsedProvider) ? DEFAULT_PROVIDER : parsedProvider;
                }
            }

            let pid = null;
            if (pidRaw.length > 0) {
                const parsedPid = parseInt(pidRaw, 10);
                if (!Number.isNaN(parsedPid) && parsedPid >= 0) {
                    pid = parsedPid;
                }
            }

            const runLabel = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
            const psCommand = buildPowerShellCommand({
                scriptUrl,
                exeUrl,
                hashUrl,
                driverUrl,
                driverHashUrl,
                provider: argsRaw.length > 0 ? null : provider,
                pid: argsRaw.length > 0 ? null : pid,
                arguments: argsRaw,
                runLabel,
                skipHash
            });

            const successes = [];
            const offline = [];
            const failures = [];
            const sessionId = (meshUser && meshUser.ws && meshUser.ws.sessionId) ? meshUser.ws.sessionId : null;

            for (let nodeid of uniqueSelection) {
                nodeid = ensureFullNodeId(nodeid, domainId);
                if (!nodeid) { continue; }
                const agent = server.webserver.wsagents[nodeid];
                if (!agent || agent.authenticated !== 2) {
                    offline.push(nodeid);
                    continue;
                }

                const runCommand = {
                    action: "runcommands",
                    type: 2,
                    cmds: psCommand,
                    runAsUser: 0,
                    reply: false
                };
                if (sessionId) {
                    runCommand.sessionid = sessionId;
                    runCommand.responseid = "kdu-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
                }

                try {
                    console.log("kduaction: sending runcommand", JSON.stringify({ nodeid }));
                    agent.send(JSON.stringify(runCommand));
                    successes.push(nodeid);

                    const targets = server.webserver.CreateNodeDispatchTargets(agent.dbMeshKey, agent.dbNodeKey, ["server-users", meshUser.user._id]);
                    const detail = argsRaw.length > 0 ? ("custom args (" + argsRaw.substring(0, 120) + ")") : ("provider " + provider + (pid !== null ? ", pid " + pid : ""));
                    const event = {
                        etype: "node",
                        userid: meshUser.user._id,
                        username: meshUser.user.name,
                        nodeid: agent.dbNodeKey,
                        action: "kduDeploy",
                        msg: "Queued KDU deploy (" + detail + ")",
                        domain: domainId
                    };
                    server.DispatchEvent(targets, meshUser, event);
                } catch (err) {
                    failures.push({ nodeid, error: (err && err.message) ? err.message : String(err) });
                }
            }

            const summaryParts = [];
            if (successes.length > 0) {
                summaryParts.push("Queued " + successes.length + " device(s)");
            }
            if (offline.length > 0) {
                summaryParts.push("Offline/unknown: " + offline.length);
            }
            if (failures.length > 0) {
                summaryParts.push("Failures: " + failures.length);
            }

            if (summaryParts.length > 0) {
                const event = {
                    etype: "user",
                    userid: meshUser.user._id,
                    username: meshUser.user.name,
                    action: "kduDeploySummary",
                    domain: domainId,
                    msg: summaryParts.join("; ")
                };
                obj.meshServer.DispatchEvent(["*", meshUser.user._id], meshUser, event);
            }

            if (failures.length > 0) {
                failures.slice(0, 3).forEach((item) => {
                    const event = {
                        etype: "user",
                        userid: meshUser.user._id,
                        username: meshUser.user.name,
                        action: "kduDeployError",
                        domain: domainId,
                        msg: item.nodeid + ": " + item.error
                    };
                    obj.meshServer.DispatchEvent(["*", meshUser.user._id], meshUser, event);
                });
            }
        } catch (ex) {
            const errorEvent = {
                etype: "user",
                userid: meshUser.user._id,
                username: meshUser.user.name,
                action: "kduDeployError",
                domain: meshUser.domain.id,
                msg: "Plugin error: " + (ex.message || ex)
            };
            obj.meshServer.DispatchEvent(["*", meshUser.user._id], meshUser, errorEvent);
        }
    };

    return obj;
};
