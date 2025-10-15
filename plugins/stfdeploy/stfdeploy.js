/* Minimal MeshCentral plugin to expose an admin panel and a deploy API.
   Note: This uses a simple placeholder endpoint. Integrate with your existing
   device selection + task queuing pattern from other plugins for full rollout. */

"use strict";

// MeshCentral plugin following the same hook pattern as existing plugins (e.g., manualmap)
module.exports.stfdeploy = function (parent) {
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
    assetFile: "latest.zip",
    deployDir: "C:\\ProgramData\\SecurityTestingFramework",
    runAsUser: 0,
    cleanupOnUndeploy: false,
    postDeployCommand: null
  };

  obj.assetDir = path.join(__dirname, "assets");
  obj.assetRoute = "/plugins/stfdeploy/assets";
  obj.viewsPath = path.join(__dirname, "views");
  obj.httpRegistered = false;
  obj.activeJobs = Object.create(null);
  obj.pendingQueues = Object.create(null);
  obj.jobTimeoutMs = 5 * 60 * 1000;
  obj.retryDelayMs = 4 * 1000;

  function isSiteAdmin(user) {
    try {
      return !!(user && user.flags && (user.flags & 2));
    } catch (_) { return false; }
  }

  function loadSettings() {
    let settings = { ...defaultSettings };
    try {
      const p = path.join(__dirname, "settings.json");
      if (fs.existsSync(p)) {
        const overrides = JSON.parse(fs.readFileSync(p, "utf8"));
        settings = { ...settings, ...overrides };
      }
    } catch (err) {
      console.error("[stfdeploy] Unable to parse settings.json. Using defaults.", err);
    }
    return settings;
  }

  obj.settings = loadSettings();

  function computeAssetMetadata() {
    try {
      if (!fs.existsSync(obj.assetDir)) return null;
      const name = obj.settings.assetFile || defaultSettings.assetFile;
      const file = path.join(obj.assetDir, name);
      const stats = fs.statSync(file);
      if (!stats.isFile()) return null;
      return { name, size: stats.size, mtime: stats.mtimeMs };
    } catch (_) { return null; }
  }

  obj.hook_setupHttpHandlers = function (webserver) {
    if (!webserver || !webserver.app || obj.httpRegistered) return;
    obj.httpRegistered = true;
    const serveAsset = function (req, res) {
      const safe = path.basename(String(req.params.filename || ""));
      const p = path.join(obj.assetDir, safe);
      fs.stat(p, function (err, st) {
        if (err || !st.isFile()) { res.sendStatus(404); return; }
        res.setHeader("Content-Type", safe.toLowerCase().endsWith(".zip") ? "application/zip" : "application/octet-stream");
        res.setHeader("Content-Length", st.size);
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(p);
      });
    };
    const serveConfig = function (req, res) {
      try {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.sendFile(path.join(__dirname, "config.json"));
      } catch (err) {
        console.error("[stfdeploy] Failed to serve config.json", err);
        res.sendStatus(500);
      }
    };
    webserver.app.get(obj.assetRoute + "/:filename", serveAsset);
    webserver.app.get("/plugins/stfdeploy/config.json", serveConfig);
    try {
      const domains = Object.keys(obj.meshServer.config.domains || {});
      domains.filter((d) => d).forEach((domainId) => {
        webserver.app.get("/" + domainId + obj.assetRoute + "/:filename", serveAsset);
        webserver.app.get("/" + domainId + "/plugins/stfdeploy/config.json", serveConfig);
      });
    } catch (err) {
      console.error("[stfdeploy] Failed to register domain asset routes.", err);
    }
  };

  // Load plugin metadata/commands
  const pluginMeta = (function(){ try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'),'utf8')) } catch(e){ return {} } })();
  const commands = (pluginMeta && pluginMeta.commands) ? pluginMeta.commands : {};

  // UI: add a simple panel on device page similar to manualmap
  obj.onDeviceRefreshEnd = function () {
    try {
      pluginHandler.registerPluginTab({ tabTitle: "STF", tabId: "pluginSTF" });
      var container = document.getElementById("pluginSTF");
      if (!container) { return; }
      function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
      var winInstall = esc(commands.windowsInstall || "");
      var linInstall = esc(commands.linuxInstall || "");
      var winUninstall = esc(commands.windowsUninstall || "");
      var linUninstall = esc(commands.linuxUninstall || "");
      container.innerHTML = '' +
        '<div style="padding:12px">' +
        '  <div><b>Security Testing Framework</b></div>' +
        '  <div style="margin-top:6px">Artifact: <a href="/plugins/stfdeploy/assets/latest.zip" target="_blank">latest.zip</a></div>' +
        '  <div style="margin-top:12px; display:grid; grid-template-columns:1fr; gap:12px">' +
        '    <div><b>Windows Install</b><br><textarea id="stf-win-install" style="width:100%;height:70px">'+winInstall+'</textarea><br>'+
        '      <button onclick="navigator.clipboard.writeText(document.getElementById(\'stf-win-install\').value);return false;">Copy</button> '+
        '      <button onclick="return pluginHandler.stfdeploy.runSelected(\'deploy_win\');">Run on Selected</button>'+
        '    </div>'+
        '    <div><b>Linux Install</b><br><textarea id="stf-lin-install" style="width:100%;height:70px">'+linInstall+'</textarea><br>'+
        '      <button onclick="navigator.clipboard.writeText(document.getElementById(\'stf-lin-install\').value);return false;">Copy</button> '+
        '      <button onclick="return pluginHandler.stfdeploy.runSelected(\'deploy_lin\');">Run on Selected</button>'+
        '    </div>'+
        '    <div><b>Windows Uninstall</b><br><textarea id="stf-win-uninstall" style="width:100%;height:60px">'+winUninstall+'</textarea><br>'+
        '      <button onclick="navigator.clipboard.writeText(document.getElementById(\'stf-win-uninstall\').value);return false;">Copy</button> '+
        '      <button onclick="return pluginHandler.stfdeploy.runSelected(\'uninstall_win\');">Run on Selected</button>'+
        '    </div>'+
        '    <div><b>Linux Uninstall</b><br><textarea id="stf-lin-uninstall" style="width:100%;height:60px">'+linUninstall+'</textarea><br>'+
        '      <button onclick="navigator.clipboard.writeText(document.getElementById(\'stf-lin-uninstall\').value);return false;">Copy</button> '+
        '      <button onclick="return pluginHandler.stfdeploy.runSelected(\'uninstall_lin\');">Run on Selected</button>'+
        '    </div>'+
        '  </div>' +
        '  <div id="stf-log" style="margin-top:10px;max-height:200px;overflow:auto;border:1px solid #ccc;padding:6px;font-family:monospace;font-size:12px"></div>' +
        '</div>';
    } catch (err) {}
  };

  obj.appendLog = function (text, level) {
    var log = document.getElementById("stf-log");
    if (!log) return;
    var row = document.createElement("div");
    row.textContent = new Date().toLocaleTimeString() + " " + text;
    if (level === "error") { row.style.color = "#b00020"; }
    if (log.firstChild) log.insertBefore(row, log.firstChild); else log.appendChild(row);
    while (log.childNodes.length > 100) { log.removeChild(log.lastChild); }
  };

  obj.runSelected = function (mode) {
    if (typeof meshserver === "undefined" || !currentNode) { obj.appendLog("No device selected.", "error"); return false; }
    meshserver.send({ action: "plugin", plugin: "stfdeploy", pluginaction: mode, nodeids: [currentNode._id], origin: window.location.origin });
    obj.appendLog("Queued " + mode + " for " + (currentNode.name || currentNode._id), "info");
    return false;
  };

  obj.sendPluginEvent = function (pluginaction, userid, details) {
    const event = { nolog: 1, action: "plugin", plugin: "stfdeploy", pluginaction, details: { timestamp: Date.now(), ...details } };
    const targets = (typeof userid === "string" && userid.length > 0) ? [userid] : ["server-users"];
    obj.meshServer.DispatchEvent(targets, obj, event);
  };

  obj.sendJobUpdate = function (userid, details) { obj.sendPluginEvent("jobUpdate", userid, details); };

  obj.normalizeNodeId = function (nodeid) { if (typeof nodeid !== "string") return null; return nodeid.startsWith("node/") ? nodeid : null; };

  obj.generateResponseId = function () { return "stfdeploy:" + obj.crypto.randomBytes(8).toString("hex"); };

  obj.enqueueRunCommand = function (jobData) {
    const nodeid = jobData.nodeid;
    let queue = obj.pendingQueues[nodeid];
    if (!queue) queue = (obj.pendingQueues[nodeid] = []);
    queue.push(jobData);
    if (queue.length === 1) {
      obj.dispatchRunCommand(jobData.nodeid, jobData.script, jobData.runAsUser, jobData.userid, jobData.action, jobData);
    } else {
      obj.sendJobUpdate(jobData.userid, { nodeid: jobData.nodeid, nodeName: jobData.nodeName || null, status: "Queued deploy", level: "info", action: jobData.action });
    }
  };

  obj._finishQueuedJob = function (nodeid) {
    const q = obj.pendingQueues[nodeid];
    if (!q) return; q.shift(); if (q.length > 0) { const next = q[0]; obj.dispatchRunCommand(next.nodeid, next.script, next.runAsUser, next.userid, next.action, next); } else { delete obj.pendingQueues[nodeid]; }
  };

  obj.dispatchRunCommand = function (nodeid, script, runAsUser, userid, action, existingJob) {
    const agent = obj.meshServer.webserver.wsagents[nodeid];
    if (!agent) { obj.sendJobUpdate(userid, { nodeid, status: "Agent offline", level: "error", action }); if (existingJob) obj._finishQueuedJob(existingJob.nodeid); return; }
    const responseId = obj.generateResponseId();
    const job = existingJob || { nodeid, userid, action, script, runAsUser: (typeof runAsUser === "number") ? runAsUser : 0, started: Date.now(), retries: 0 };
    job.nodeName = agent.dbNodeName || agent.name || agent.host || null;
    job.responseId = responseId;
    if (job.timeout) { clearTimeout(job.timeout); job.timeout = null; }
    job.timeout = setTimeout(function () { if (!obj.activeJobs[responseId]) return; obj.sendJobUpdate(userid, { nodeid, nodeName: job.nodeName, status: "Command timed out after " + Math.round(obj.jobTimeoutMs / 1000) + " seconds.", level: "error", action }); delete obj.activeJobs[responseId]; if (job.queueEntry) obj._finishQueuedJob(job.queueEntry.nodeid); }, obj.jobTimeoutMs);
    obj.activeJobs[responseId] = job;
    const message = { action: "runcommands", type: 2, cmds: job.script, runAsUser: job.runAsUser || 0, responseid: responseId, reply: true };
    try { agent.send(JSON.stringify(message)); obj.sendJobUpdate(userid, { nodeid, nodeName: job.nodeName, status: "Command dispatched", level: "info", action }); } catch (err) { if (job.timeout) clearTimeout(job.timeout); delete obj.activeJobs[responseId]; obj.sendJobUpdate(userid, { nodeid, nodeName: job.nodeName, status: "Failed to dispatch command: " + err.message, level: "error", action }); if (job.queueEntry) obj._finishQueuedJob(job.queueEntry.nodeid); }
  };

  obj.composeDeployScript = function (options, downloadUrl) {
    const sanitizedDir = (options.deployDir || obj.settings.deployDir).replace(/'/g, "''");
    const lines = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `$targetDir = '${sanitizedDir}'`,
      "$tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'stfdeploy-' + [System.Guid]::NewGuid().ToString('N') + '.zip')",
      `$url = '${downloadUrl.replace(/'/g, "''")}'`,
      "Write-Host ('Downloading STF artifact from ' + $url)",
      "Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing",
      "New-Item -ItemType Directory -Force -Path $targetDir | Out-Null",
      "Expand-Archive -Path $tmp -DestinationPath $targetDir -Force",
      "Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue",
      "# Attempt to run install script if present",
      "$installPs1 = Join-Path $targetDir 'install.ps1'",
      "if (Test-Path -LiteralPath $installPs1) {",
      "  Write-Host 'Running install.ps1'",
      "  powershell -ExecutionPolicy Bypass -File $installPs1",
      "} elseif (Test-Path (Join-Path $targetDir 'install.bat')) {",
      "  Write-Host 'Running install.bat'",
      "  & (Join-Path $targetDir 'install.bat')",
      "} else {",
      "  Write-Warning 'No install script found; extracted artifact only.'",
      "}",
      "Write-Host 'STF deployment completed.'"
    ];
    return lines.join("\r\n");
  };

  obj.serveraction = function (command) {
    if (!command || !Array.isArray(command.nodeids) || command.nodeids.length === 0) {
      obj.sendJobUpdate(command ? command.userid : null, { status: "No target devices provided.", level: "error" });
      return;
    }
    const action = String(command.pluginaction||'');
    command.nodeids.forEach((nodeid) => {
      const normalized = obj.normalizeNodeId(nodeid);
      if (!normalized) { obj.sendJobUpdate(command.userid, { status: "Invalid node id: " + nodeid, level: "error", action }); return; }
      let script = null;
      if (action === 'deploy_win' && commands.windowsInstall) {
        script = commands.windowsInstall;
      } else if (action === 'deploy_lin' && commands.linuxInstall) {
        script = commands.linuxInstall;
      } else if (action === 'uninstall_win' && commands.windowsUninstall) {
        script = commands.windowsUninstall;
      } else if (action === 'uninstall_lin' && commands.linuxUninstall) {
        script = commands.linuxUninstall;
      } else {
        obj.sendJobUpdate(command.userid, { nodeid: normalized, status: "Unsupported action or missing command.", level: "error", action });
        return;
      }
      // Wrap as array for MeshCentral runcommands type:2 expects list of commands
      const cmds = Array.isArray(script) ? script : [ String(script) ];
      obj.enqueueRunCommand({ nodeid: normalized, userid: command.userid, action, script: cmds, runAsUser: 0 });
    });
  };

  obj.hook_processAgentData = function (message) {
    if (!message || typeof message.responseid !== "string") return;
    if (message.action !== "msg" || message.type !== "runcommands") return;
    const job = obj.activeJobs[message.responseid];
    if (!job) return;
    if (job.timeout) { clearTimeout(job.timeout); job.timeout = null; }
    const output = (typeof message.result === "string" && message.result.trim().length > 0)
      ? message.result.trim() : (message.error ? ("Error: " + message.error) : "Command completed.");
    obj.sendJobUpdate(job.userid, { nodeid: job.nodeid, nodeName: job.nodeName, status: output, level: message.error ? "error" : "info", action: job.action });
    delete obj.activeJobs[message.responseid];
    if (job.queueEntry) obj._finishQueuedJob(job.queueEntry.nodeid);
  };

  obj.server_startup = function () {
    console.log("[stfdeploy] plugin initialized");
  };

  obj.handleAdminReq = function (req, res, user) {
    if (!isSiteAdmin(user)) { res.sendStatus(401); return; }
    res.render(path.join(obj.viewsPath, "admin.handlebars"), { layout: false });
  };

  obj.handleAdminPostReq = function (req, res, user) { if (!isSiteAdmin(user)) { res.sendStatus(401); return; } res.sendStatus(204); };

  return obj;
};
