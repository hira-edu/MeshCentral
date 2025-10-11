/**
 * Phase 1 Config UI plugin
 * Provides admin UI helpers to manage branding, network ports, agent and AMT core settings
 * including extended agent branding metadata.
 */

"use strict";

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports.phase1config = function (parent) {
  const obj = {};
  obj.parent = parent;
  obj.meshServer = parent.parent;
  obj.viewsPath = path.join(__dirname, 'views');
  obj.webPublicPath = path.resolve(parent.parent.datapath, '../meshcentral-web/public');
  obj.webImagesPath = path.join(obj.webPublicPath, 'images');
  obj.dataPath = parent.parent.datapath;
  obj.configPath = path.join(obj.dataPath, 'config.json');

  function isSiteAdmin(user) {
    return (user && ((user.siteadmin & 0xFFFFFFFF) !== 0));
  }

  function loadConfig() {
    const raw = fs.readFileSync(obj.configPath, 'utf8');
    return JSON.parse(raw);
  }

  function buildSnapshot(cfg) {
    const settings = cfg.settings || {};
    const domains = cfg.domains || {};
    const adminDomain = domains['admin'] || {};
    const agentCustomization = adminDomain.agentCustomization || {};
    const agentFileInfo = adminDomain.agentFileInfo || {};
    const agentTag = adminDomain.agentTag || {};

    return {
      settings: {
        title: settings.title || '',
        title2: settings.title2 || '',
        welcome: settings.welcome || '',
        port: settings.port || 443,
        aliasPort: settings.aliasPort || null,
        redirPort: settings.redirPort || 80,
        redirAliasPort: settings.redirAliasPort || null,
        agentPort: settings.agentPort || null,
        agentPortBind: settings.agentPortBind || '',
        agentAliasPort: settings.agentAliasPort || null,
        agentAliasDNS: settings.agentAliasDNS || '',
        agentPortTls: (settings.agentPortTls !== false),
        relayPort: settings.relayPort || null,
        relayPortBind: settings.relayPortBind || '',
        agentSignLock: settings.agentSignLock === true,
        agentUpdateSystem: settings.agentUpdateSystem || 1,
        allowHighQualityDesktop: settings.allowHighQualityDesktop !== false,
        agentsInRam: settings.agentsInRam === true,
        amtScanner: settings.amtScanner === true,
        amtProvisioningServer: settings.amtProvisioningServer || null,
        publicPushNotifications: settings.publicPushNotifications === true,
        desktopMultiplex: settings.desktopMultiplex === true,
        lockAgentDownload: (settings.lockAgentDownload === true),
        rootCertCommonName: settings.rootCertCommonName || ''
      },
      domain: {
        siteStyle: adminDomain.siteStyle || 0,
        title: adminDomain.title || settings.title || '',
        title2: adminDomain.title2 || settings.title2 || '',
        titlePicture: adminDomain.titlePicture || '',
        pwaLogo: adminDomain.pwaLogo || '',
        manageAllDeviceGroups: Array.isArray(adminDomain.manageAllDeviceGroups) ? adminDomain.manageAllDeviceGroups : [],
        manageCrossDomain: Array.isArray(adminDomain.manageCrossDomain) ? adminDomain.manageCrossDomain : [],
        agentSelfGuestSharing: adminDomain.agentSelfGuestSharing === true,
        agentCustomization,
        agentFileInfo,
        agentConfig: Array.isArray(adminDomain.agentConfig) ? adminDomain.agentConfig : [],
        agentInviteCodes: adminDomain.agentInviteCodes === true,
        agentNoProxy: adminDomain.agentNoProxy === true,
        agentTag,
        lockAgentDownload: adminDomain.lockAgentDownload === true
      },
      amt: {
        deviceGroup: settings.amtProvisioningServer ? settings.amtProvisioningServer.deviceGroup : '',
        port: settings.amtProvisioningServer ? settings.amtProvisioningServer.port : 9971,
        trustedFqdn: settings.amtProvisioningServer ? settings.amtProvisioningServer.trustedFqdn || '' : '',
        mebxPassword: settings.amtProvisioningServer ? settings.amtProvisioningServer.newMebxPassword || '' : '',
        ip: settings.amtProvisioningServer ? settings.amtProvisioningServer.ip || '' : ''
      }
    };
  }

  function listAmtDeviceGroups() {
    return new Promise((resolve) => {
      obj.meshServer.db.GetAllType('mesh', function (err, meshes) {
        if (err || !Array.isArray(meshes)) { resolve([]); return; }
        const groups = meshes
          .filter(m => m && m.mtype === 1)
          .map(m => ({ id: m._id, name: m.name, domain: m.domain || '' }));
        resolve(groups);
      });
    });
  }

  function sanitizeFileName(name) {
    const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    return base.substring(0, 120) || 'asset';
  }

  async function persistUploads(files) {
    if (!files) { return {}; }
    const saved = {};
    const descriptors = {
      titlePicture: { dir: obj.webImagesPath, prefix: 'title', returnType: 'web' },
      pwaLogo: { dir: obj.webImagesPath, prefix: 'pwa', returnType: 'web' },
      agentImage: { dir: obj.dataPath, prefix: 'agent-image', returnType: 'data' },
      agentIcon: { dir: obj.dataPath, prefix: 'agent-icon', returnType: 'data' }
    };

    for (const key of Object.keys(files)) {
      const entry = files[key];
      const descriptor = descriptors[key];
      if (!descriptor || !entry || !entry.name || !entry.data) { continue; }
      await fs.promises.mkdir(descriptor.dir, { recursive: true }).catch(() => {});
      const extensionMatch = entry.name.match(/\.[^.]+$/);
      const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '';
      const safeName = sanitizeFileName(entry.name);
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const finalName = `${descriptor.prefix}-${stamp}${extension || '.bin'}`;
      const dest = path.join(descriptor.dir, finalName);
      const buffer = Buffer.from(entry.data, 'base64');
      await fs.promises.writeFile(dest, buffer);

      if (descriptor.returnType === 'web') {
        saved[key] = `images/${finalName}`;
      } else {
        saved[key] = finalName;
      }
    }
    return saved;
  }

  function backupConfig() {
    const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const backupPath = path.join(obj.dataPath, `config.json.${ts}.bak`);
    fs.copyFileSync(obj.configPath, backupPath);
    return backupPath;
  }

  function restoreBackup(file) {
    try {
      if (file && fs.existsSync(file)) {
        fs.copyFileSync(file, obj.configPath);
      }
    } catch (ex) {
      console.log('phase1config: failed to restore config backup', ex);
    }
  }

  function restartMeshCentral() {
    return new Promise((resolve, reject) => {
      const proc = spawn('systemctl', ['restart', 'meshcentral']);
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) { resolve(); } else { reject(new Error('systemctl restart exited with code ' + code)); }
      });
    });
  }

  function parseBool(value) {
    if (typeof value === 'boolean') { return value; }
    if (typeof value === 'string') { return ['true', '1', 'on', 'yes'].includes(value.toLowerCase()); }
    return false;
  }

  function toInt(value, fallback) {
    const n = parseInt(value, 10);
    if (isNaN(n)) { return fallback; }
    return n;
  }

  function validatePort(value, label, fallback, allowZero = false) {
    if (value === null || value === undefined) { return fallback; }
    const str = String(value).trim();
    if (str.length === 0) { return fallback; }
    const n = toInt(str, fallback);
    if (allowZero && n === 0) { return 0; }
    if (n < 1 || n > 65535) {
      throw new Error(label + ' must be between 1 and 65535' + (allowZero ? ' (or 0 to disable)' : ''));
    }
    return n;
  }

  function normalizeArrayFromText(value) {
    if (!value) { return []; }
    if (Array.isArray(value)) { return value.map(v => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean); }
    return String(value).split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
  }

  function normalizeAgentTag(input, existing) {
    const out = Object.assign({}, existing || {});
    if (input && typeof input === 'object') {
      ['ServerName', 'ServerDesc', 'ServerTags'].forEach((key) => {
        if (key in input) {
          const val = parseInt(input[key], 10);
          if (!isNaN(val) && val >= 0 && val <= 3) { out[key] = val; }
        }
      });
    }
    return out;
  }

  async function applyChanges(payload, user) {
    if (!isSiteAdmin(user)) { throw new Error('Not authorized'); }
    const cfg = loadConfig();

    if (!cfg.settings) { cfg.settings = {}; }
    if (!cfg.domains) { cfg.domains = {}; }
    if (!cfg.domains['admin']) { cfg.domains['admin'] = {}; }

    const domainAdmin = cfg.domains['admin'];

    const uploadedFiles = await persistUploads(Object.assign({}, (payload.branding && payload.branding.files) || {}, (payload.agent && payload.agent.files) || {}));

    const branding = payload.branding || {};
    if (typeof branding.title === 'string') { cfg.settings.title = branding.title.trim(); }
    if (typeof branding.title2 === 'string') { cfg.settings.title2 = branding.title2.trim(); }
    if (typeof branding.welcome === 'string') { cfg.settings.welcome = branding.welcome; }
    if (typeof branding.siteStyle !== 'undefined') { domainAdmin.siteStyle = toInt(branding.siteStyle, domainAdmin.siteStyle || 0); }
    if (typeof branding.headerTitle === 'string') { domainAdmin.title = branding.headerTitle.trim(); }
    if (typeof branding.headerSubtitle === 'string') { domainAdmin.title2 = branding.headerSubtitle.trim(); }

    if (uploadedFiles.titlePicture) {
      domainAdmin.titlePicture = uploadedFiles.titlePicture;
    } else if (typeof branding.titlePicture === 'string') {
      domainAdmin.titlePicture = branding.titlePicture.trim();
    }
    if (uploadedFiles.pwaLogo) {
      domainAdmin.pwaLogo = uploadedFiles.pwaLogo;
    } else if (typeof branding.pwaLogo === 'string') {
      domainAdmin.pwaLogo = branding.pwaLogo.trim();
    }

    const ports = payload.ports || {};
    if (Object.prototype.hasOwnProperty.call(ports, 'port')) {
      cfg.settings.port = validatePort(ports.port, 'HTTPS port', cfg.settings.port || 443);
    }
    if (Object.prototype.hasOwnProperty.call(ports, 'aliasPort')) {
      const fallbackAlias = (cfg.settings.aliasPort != null ? cfg.settings.aliasPort : (cfg.settings.port || 443));
      cfg.settings.aliasPort = validatePort(ports.aliasPort, 'HTTPS alias port', fallbackAlias);
    }
    if (Object.prototype.hasOwnProperty.call(ports, 'redirPort')) {
      cfg.settings.redirPort = validatePort(ports.redirPort, 'HTTP redirect port', cfg.settings.redirPort || 80);
    }
    if (Object.prototype.hasOwnProperty.call(ports, 'redirAliasPort')) {
      const fallbackRedirAlias = (cfg.settings.redirAliasPort != null ? cfg.settings.redirAliasPort : (cfg.settings.redirPort || 80));
      cfg.settings.redirAliasPort = validatePort(ports.redirAliasPort, 'HTTP redirect alias port', fallbackRedirAlias);
    }
    if (Object.prototype.hasOwnProperty.call(ports, 'agentPort')) {
      const fallbackAgent = (cfg.settings.agentPort != null ? cfg.settings.agentPort : 0);
      cfg.settings.agentPort = validatePort(ports.agentPort, 'Agent port', fallbackAgent, true);
    }
    if (typeof ports.agentPortBind === 'string') { cfg.settings.agentPortBind = ports.agentPortBind.trim(); }
    if (Object.prototype.hasOwnProperty.call(ports, 'agentAliasPort')) {
      const fallbackAgentAlias = (cfg.settings.agentAliasPort != null ? cfg.settings.agentAliasPort : (cfg.settings.agentPort || 0));
      cfg.settings.agentAliasPort = validatePort(ports.agentAliasPort, 'Agent alias port', fallbackAgentAlias, true);
    }
    if (typeof ports.agentAliasDNS === 'string') { cfg.settings.agentAliasDNS = ports.agentAliasDNS.trim(); }
    if (Object.prototype.hasOwnProperty.call(ports, 'relayPort')) {
      const fallbackRelay = (cfg.settings.relayPort != null ? cfg.settings.relayPort : 0);
      cfg.settings.relayPort = validatePort(ports.relayPort, 'Relay port', fallbackRelay, true);
    }
    if (typeof ports.relayPortBind === 'string') { cfg.settings.relayPortBind = ports.relayPortBind.trim(); }

    const agent = payload.agent || {};
    if (typeof agent.agentSignLock !== 'undefined') { cfg.settings.agentSignLock = parseBool(agent.agentSignLock); }
    if (typeof agent.agentUpdateSystem !== 'undefined') {
      const updateSystem = toInt(agent.agentUpdateSystem, cfg.settings.agentUpdateSystem || 1);
      cfg.settings.agentUpdateSystem = (updateSystem === 2) ? 2 : 1;
    }
    if (typeof agent.allowHighQualityDesktop !== 'undefined') { cfg.settings.allowHighQualityDesktop = parseBool(agent.allowHighQualityDesktop); }
    if (typeof agent.agentsInRam !== 'undefined') { cfg.settings.agentsInRam = parseBool(agent.agentsInRam); }
    if (typeof agent.agentPortTls !== 'undefined') { cfg.settings.agentPortTls = parseBool(agent.agentPortTls); }
    if (typeof agent.lockAgentDownload !== 'undefined') {
      const lock = parseBool(agent.lockAgentDownload);
      cfg.settings.lockAgentDownload = lock;
      domainAdmin.lockAgentDownload = lock;
    }
    if (typeof agent.rootCertCommonName === 'string') {
      cfg.settings.rootCertCommonName = agent.rootCertCommonName.trim();
    }

    if (typeof agent.agentInviteCodes !== 'undefined') { domainAdmin.agentInviteCodes = parseBool(agent.agentInviteCodes); }
    if (typeof agent.agentNoProxy !== 'undefined') { domainAdmin.agentNoProxy = parseBool(agent.agentNoProxy); }

    if (agent.agentCustomization && typeof agent.agentCustomization === 'object') {
      domainAdmin.agentCustomization = domainAdmin.agentCustomization || {};
      const custom = agent.agentCustomization;
      if (typeof custom.displayName === 'string') { domainAdmin.agentCustomization.displayName = custom.displayName.trim(); }
      if (typeof custom.description === 'string') { domainAdmin.agentCustomization.description = custom.description.trim(); }
      if (typeof custom.companyName === 'string') { domainAdmin.agentCustomization.companyName = custom.companyName.trim(); }
      if (typeof custom.serviceName === 'string') { domainAdmin.agentCustomization.serviceName = custom.serviceName.trim(); }
      if (typeof custom.installText === 'string') { domainAdmin.agentCustomization.installText = custom.installText; }
      if (typeof custom.fileName === 'string') { domainAdmin.agentCustomization.fileName = custom.fileName.trim(); }
      if (typeof custom.foregroundColor === 'string') { domainAdmin.agentCustomization.foregroundColor = custom.foregroundColor.trim(); }
      if (typeof custom.backgroundColor === 'string') { domainAdmin.agentCustomization.backgroundColor = custom.backgroundColor.trim(); }
      if (uploadedFiles.agentImage) {
        domainAdmin.agentCustomization.image = uploadedFiles.agentImage;
      } else if (typeof custom.image === 'string') {
        domainAdmin.agentCustomization.image = custom.image.trim();
      }
    }

    if (agent.agentFileInfo && typeof agent.agentFileInfo === 'object') {
      domainAdmin.agentFileInfo = domainAdmin.agentFileInfo || {};
      const info = agent.agentFileInfo;
      const keys = ['fileDescription', 'fileVersion', 'internalName', 'legalCopyright', 'originalFilename', 'productName', 'productVersion'];
      keys.forEach((key) => {
        if (typeof info[key] === 'string') { domainAdmin.agentFileInfo[key] = info[key].trim(); }
      });
      if (uploadedFiles.agentIcon) {
        domainAdmin.agentFileInfo.icon = uploadedFiles.agentIcon;
      } else if (typeof info.icon === 'string') {
        domainAdmin.agentFileInfo.icon = info.icon.trim();
      }
    }

    if (agent.agentConfig !== undefined) {
      if (Array.isArray(agent.agentConfig)) {
        domainAdmin.agentConfig = agent.agentConfig.map(v => String(v).trim()).filter(Boolean);
      } else if (typeof agent.agentConfig === 'string') {
        domainAdmin.agentConfig = normalizeArrayFromText(agent.agentConfig);
      }
    }

    if (agent.agentAllowedIP !== undefined) {
      const allowed = normalizeArrayFromText(agent.agentAllowedIP);
      if (allowed.length === 0) {
        delete domainAdmin.agentAllowedIP;
      } else if (allowed.length === 1) {
        domainAdmin.agentAllowedIP = allowed[0];
      } else {
        domainAdmin.agentAllowedIP = allowed;
      }
    }

    if (agent.agentBlockedIP !== undefined) {
      const blocked = normalizeArrayFromText(agent.agentBlockedIP);
      if (blocked.length === 0) {
        delete domainAdmin.agentBlockedIP;
      } else if (blocked.length === 1) {
        domainAdmin.agentBlockedIP = blocked[0];
      } else {
        domainAdmin.agentBlockedIP = blocked;
      }
    }

    if (agent.agentKey !== undefined) {
      if (Array.isArray(agent.agentKey)) {
        const keys = agent.agentKey.map(v => String(v).trim()).filter(Boolean);
        if (keys.length === 0) {
          delete domainAdmin.agentKey;
        } else if (keys.length === 1) {
          domainAdmin.agentKey = keys[0];
        } else {
          domainAdmin.agentKey = keys;
        }
      } else if (typeof agent.agentKey === 'string') {
        const keys = normalizeArrayFromText(agent.agentKey);
        if (keys.length === 0) {
          delete domainAdmin.agentKey;
        } else if (keys.length === 1) {
          domainAdmin.agentKey = keys[0];
        } else {
          domainAdmin.agentKey = keys;
        }
      } else {
        delete domainAdmin.agentKey;
      }
    }

    if (agent.agentTag) {
      domainAdmin.agentTag = normalizeAgentTag(agent.agentTag, domainAdmin.agentTag);
    }

    const amt = payload.amt || {};
    if (typeof amt.amtScanner !== 'undefined') { cfg.settings.amtScanner = parseBool(amt.amtScanner); }
    if (parseBool(amt.provisioningEnabled) === false) {
      delete cfg.settings.amtProvisioningServer;
    } else {
      cfg.settings.amtProvisioningServer = cfg.settings.amtProvisioningServer || {};
      const prov = cfg.settings.amtProvisioningServer;
      prov.port = validatePort(amt.port, 'AMT provisioning port', prov.port || 9971);
      if (typeof amt.deviceGroup === 'string') { prov.deviceGroup = amt.deviceGroup.trim(); }
      if (typeof amt.trustedFqdn === 'string') { prov.trustedFqdn = amt.trustedFqdn.trim(); }
      if (typeof amt.mebxPassword === 'string') {
        const trimmed = amt.mebxPassword.trim();
        if (trimmed.length > 0) { prov.newMebxPassword = trimmed; }
      }
      if (typeof amt.ip === 'string') { prov.ip = amt.ip.trim(); }
    }

    if (amt.manageAllDeviceGroups !== undefined) {
      domainAdmin.manageAllDeviceGroups = normalizeArrayFromText(amt.manageAllDeviceGroups);
    }
    if (amt.manageCrossDomain !== undefined) {
      domainAdmin.manageCrossDomain = normalizeArrayFromText(amt.manageCrossDomain);
    }

    let backupFile = null;
    try {
      backupFile = backupConfig();
      fs.writeFileSync(obj.configPath, JSON.stringify(cfg, null, 2) + '\n');
      await restartMeshCentral();
      return { backup: path.basename(backupFile) };
    } catch (err) {
      restoreBackup(backupFile);
      throw err;
    }
  }

  obj.handleAdminReq = async function (req, res, user) {
    if (!isSiteAdmin(user)) { res.sendStatus(401); return; }
    let cfg;
    try {
      cfg = loadConfig();
    } catch (err) {
      res.status(500).send('Unable to load config: ' + err.message);
      return;
    }
    const snapshot = buildSnapshot(cfg);
    const amtGroups = await listAmtDeviceGroups();
    const viewModel = {
      datajson: JSON.stringify({ snapshot, amtGroups })
    };
    res.render(path.join(obj.viewsPath, 'admin'), viewModel);
  };

  obj.handleAdminPostReq = async function (req, res, user) {
    if (!isSiteAdmin(user)) { res.sendStatus(401); return; }
    try {
      const action = req.body.action;
      if (action === 'save') {
        const payload = JSON.parse(req.body.payload || '{}');
        const result = await applyChanges(payload, user);
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify({ ok: true, result }));
      } else if (action === 'snapshot') {
        const cfg = loadConfig();
        const snapshot = buildSnapshot(cfg);
        const amtGroups = await listAmtDeviceGroups();
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify({ ok: true, snapshot, amtGroups }));
      } else {
        res.status(400); res.set('Content-Type', 'application/json'); res.send(JSON.stringify({ ok: false, error: 'Unknown action' }));
      }
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      res.status(500); res.set('Content-Type', 'application/json'); res.send(JSON.stringify({ ok: false, error: msg }));
    }
  };

  return obj;
};
