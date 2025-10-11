(function () {
  'use strict';

  if (window.phase1ConfigUILoaded) { return; }
  window.phase1ConfigUILoaded = true;

  const tabId = 'phase1configTab';
  const state = { files: {} };

  function registerTab() {
    if (!window.pluginHandler || typeof pluginHandler.registerPluginTab !== 'function') {
      setTimeout(registerTab, 200);
      return;
    }
    pluginHandler.registerPluginTab(function () {
      return { tabId: tabId, tabTitle: 'Phase 1 Config' };
    });
    waitForHost();
  }

  function waitForHost() {
    const host = document.getElementById(tabId);
    if (!host) {
      setTimeout(waitForHost, 200);
      return;
    }
    if (host.phase1Initialized) { return; }
    host.phase1Initialized = true;
    buildUI(host);
    attachHandlers();
    reloadSnapshot();
  }

  function buildUI(host) {
    host.innerHTML = [
      '<div class="padded">',
      '  <fieldset>',
      '    <legend>Branding</legend>',
      '    <table class="inputtable">',
      '      <tr><td>Site Title<td><input id="phase1-brandingTitle" type="text"></td></tr>',
      '      <tr><td>Site Subtitle<td><input id="phase1-brandingSubtitle" type="text"></td></tr>',
      '      <tr><td>Welcome Message<td><textarea id="phase1-brandingWelcome"></textarea></td></tr>',
      '      <tr><td>Portal Title<td><input id="phase1-domainTitle" type="text"></td></tr>',
      '      <tr><td>Portal Subtitle<td><input id="phase1-domainSubtitle" type="text"></td></tr>',
      '      <tr><td>Site Style<td><select id="phase1-siteStyle"><option value="0">Classic</option><option value="1">Modern (compact)</option><option value="2">Modern (wide)</option></select></td></tr>',
      '      <tr><td>Title Picture<td><input id="phase1-titlePicturePath" type="text" placeholder="images/login-logobig.png"><br><input id="phase1-titlePictureFile" type="file" accept="image/png,image/jpeg,image/webp"></td></tr>',
      '      <tr><td>PWA Logo<td><input id="phase1-pwaLogoPath" type="text" placeholder="images/login-small.png"><br><input id="phase1-pwaLogoFile" type="file" accept="image/png,image/svg+xml"></td></tr>',
      '    </table>',
      '  </fieldset>',
      '  <fieldset>',
      '    <legend>Ports &amp; Network</legend>',
      '    <table class="inputtable">',
      '      <tr><td>HTTPS Port<td><input id="phase1-portMain" type="number" min="1" max="65535"></td></tr>',
      '      <tr><td>HTTPS Alias Port<td><input id="phase1-portAlias" type="number" min="1" max="65535"></td></tr>',
      '      <tr><td>HTTP Redirect Port<td><input id="phase1-portRedir" type="number" min="1" max="65535"></td></tr>',
      '      <tr><td>HTTP Redirect Alias<td><input id="phase1-portRedirAlias" type="number" min="1" max="65535"></td></tr>',
      '      <tr><td>Agent Port<td><input id="phase1-agentPort" type="number" min="0" max="65535"></td></tr>',
      '      <tr><td>Agent Bind Address<td><input id="phase1-agentPortBind" type="text" placeholder="0.0.0.0"></td></tr>',
      '      <tr><td>Agent Alias Port<td><input id="phase1-agentAliasPort" type="number" min="0" max="65535"></td></tr>',
      '      <tr><td>Agent DNS<td><input id="phase1-agentAliasDNS" type="text" placeholder="agents.example.com"></td></tr>',
      '      <tr><td>Relay Port<td><input id="phase1-relayPort" type="number" min="0" max="65535"></td></tr>',
      '      <tr><td>Relay Bind Address<td><input id="phase1-relayPortBind" type="text" placeholder="0.0.0.0"></td></tr>',
      '    </table>',
      '    <div class="checkboxrow"><input id="phase1-agentPortTls" type="checkbox"> <label for="phase1-agentPortTls">TLS on agent-only port</label></div>',
      '  </fieldset>',
      '  <fieldset>',
      '    <legend>Agent Branding</legend>',
      '    <table class="inputtable">',
      '      <tr><td>Display Name<td><input id="phase1-agentDisplayName" type="text"></td></tr>',
      '      <tr><td>Description<td><input id="phase1-agentDescription" type="text"></td></tr>',
      '      <tr><td>Company Name<td><input id="phase1-agentCompany" type="text"></td></tr>',
      '      <tr><td>Service Name<td><input id="phase1-agentService" type="text"></td></tr>',
      '      <tr><td>Agent Filename<td><input id="phase1-agentFileName" type="text"></td></tr>',
      '      <tr><td>Install Text<td><textarea id="phase1-agentInstallText"></textarea></td></tr>',
      '      <tr><td>Foreground Color<td><input id="phase1-agentForeground" type="text" placeholder="#ffffff"></td></tr>',
      '      <tr><td>Background Color<td><input id="phase1-agentBackground" type="text" placeholder="#1b4058"></td></tr>',
      '      <tr><td>Agent Image<td><input id="phase1-agentImagePath" type="text" placeholder="agent-logo.png"><br><input id="phase1-agentImageFile" type="file" accept="image/png"></td></tr>',
      '    </table>',
      '  </fieldset>',
      '  <fieldset>',
      '    <legend>Windows Agent Metadata</legend>',
      '    <table class="inputtable">',
      '      <tr><td>Icon<td><input id="phase1-agentIconPath" type="text" placeholder="agent-icon.ico"><br><input id="phase1-agentIconFile" type="file" accept="image/x-icon"></td></tr>',
      '      <tr><td>File Description<td><input id="phase1-fileDescription" type="text"></td></tr>',
      '      <tr><td>File Version<td><input id="phase1-fileVersion" type="text" placeholder="1.0.0.0"></td></tr>',
      '      <tr><td>Internal Name<td><input id="phase1-internalName" type="text"></td></tr>',
      '      <tr><td>Product Name<td><input id="phase1-productName" type="text"></td></tr>',
      '      <tr><td>Product Version<td><input id="phase1-productVersion" type="text"></td></tr>',
      '      <tr><td>Original Filename<td><input id="phase1-originalFilename" type="text"></td></tr>',
      '      <tr><td>Legal Copyright<td><input id="phase1-legalCopyright" type="text"></td></tr>',
      '    </table>',
      '  </fieldset>',
      '  <fieldset>',
      '    <legend>Agent Behaviour</legend>',
      '    <div class="checkboxrow"><input id="phase1-agentSignLock" type="checkbox"> <label for="phase1-agentSignLock">Lock signed agents to this server</label></div>',
      '    <div class="checkboxrow"><input id="phase1-allowHighQualityDesktop" type="checkbox"> <label for="phase1-allowHighQualityDesktop">Allow high quality desktop</label></div>',
      '    <div class="checkboxrow"><input id="phase1-agentsInRam" type="checkbox"> <label for="phase1-agentsInRam">Cache agent binaries in RAM</label></div>',
      '    <div class="checkboxrow"><input id="phase1-agentInviteCodes" type="checkbox"> <label for="phase1-agentInviteCodes">Require invite codes</label></div>',
      '    <div class="checkboxrow"><input id="phase1-agentNoProxy" type="checkbox"> <label for="phase1-agentNoProxy">Disable proxy for new agents</label></div>',
      '    <div class="checkboxrow"><input id="phase1-lockAgentDownload" type="checkbox"> <label for="phase1-lockAgentDownload">Require login for agent downloads</label></div>',
      '    <table class="inputtable">',
      '      <tr><td>Update System<td><select id="phase1-agentUpdateSystem"><option value="1">Native updater</option><option value="2">meshcore.js updater</option></select></td></tr>',
      '      <tr><td>Root Certificate CN<td><input id="phase1-rootCertCommonName" type="text" placeholder="MeshCentralRoot-XXXXXX"></td></tr>',
      '    </table>',
      '    <table class="inputtable">',
      '      <tr><td>agentConfig<td><textarea id="phase1-agentConfig" placeholder="key=value"></textarea></td></tr>',
      '      <tr><td>manageAllDeviceGroups<td><textarea id="phase1-manageAllDeviceGroups" placeholder="user/admin/admin"></textarea></td></tr>',
      '      <tr><td>manageCrossDomain<td><textarea id="phase1-manageCrossDomain" placeholder="user/admin/admin"></textarea></td></tr>',
      '      <tr><td>Agent Key<td><input id="phase1-agentKey" type="text" placeholder="leave blank to disable"></td></tr>',
      '      <tr><td>Allowed Agent IPs<td><textarea id="phase1-agentAllowedIp" placeholder="192.168.1.10\\n10.0.0.0/24"></textarea></td></tr>',
      '      <tr><td>Blocked Agent IPs<td><textarea id="phase1-agentBlockedIp" placeholder="0.0.0.0/8\\n127.0.0.0/8"></textarea></td></tr>',
      '      <tr><td>agentTag.ServerName<td><select id="phase1-tagServerName"><option value="-1">Leave unchanged</option><option value="0">Ignore</option><option value="1">Set</option></select></td></tr>',
      '      <tr><td>agentTag.ServerDesc<td><select id="phase1-tagServerDesc"><option value="-1">Leave unchanged</option><option value="0">Ignore</option><option value="1">Set</option><option value="2">Set if empty</option></select></td></tr>',
      '      <tr><td>agentTag.ServerTags<td><select id="phase1-tagServerTags"><option value="-1">Leave unchanged</option><option value="0">Ignore</option><option value="1">Set</option><option value="2">Set if empty</option><option value="3">Append</option></select></td></tr>',
      '    </table>',
      '  </fieldset>',
      '  <fieldset>',
      '    <legend>Intel&reg; AMT</legend>',
      '    <div class="checkboxrow"><input id="phase1-amtScanner" type="checkbox"> <label for="phase1-amtScanner">Enable AMT scanner</label></div>',
      '    <div class="checkboxrow"><input id="phase1-amtProvisioning" type="checkbox"> <label for="phase1-amtProvisioning">Enable provisioning server</label></div>',
      '    <table class="inputtable">',
      '      <tr><td>Provisioned Device Group<td><input id="phase1-amtDeviceGroup" type="text" list="phase1-amtDeviceGroupList"></td></tr>',
      '      <tr><td>Provisioning Port<td><input id="phase1-amtPort" type="number" min="1" max="65535"></td></tr>',
      '      <tr><td>Trusted FQDN<td><input id="phase1-amtFqdn" type="text"></td></tr>',
      '      <tr><td>Server IP<td><input id="phase1-amtIp" type="text"></td></tr>',
      '      <tr><td>MEBX Password<td><input id="phase1-amtPassword" type="text"></td></tr>',
      '    </table>',
      '    <datalist id="phase1-amtDeviceGroupList"></datalist>',
      '  </fieldset>',
      '  <div class="buttonrow">',
      '    <button id="phase1-saveBtn" class="inputbtn">Save &amp; Restart MeshCentral</button>',
      '    <button id="phase1-reloadBtn" class="inputbtn">Reload Current Values</button>',
      '  </div>',
      '  <div id="phase1-status" class="paddedtop"></div>',
      '</div>'
    ].join('');
  }

  function q(id) {
    return document.getElementById(id);
  }

  function log(message, type) {
    const box = q('phase1-status');
    if (!box) { return; }
    const ts = new Date().toLocaleTimeString();
    const line = '[' + ts + '] ' + message;
    box.textContent = line + (box.textContent ? '\n' + box.textContent : '');
    box.style.border = type === 'error' ? '1px solid #ff6b6b' : '1px solid rgba(255,255,255,0.2)';
  }

  function setValue(id, value) {
    const node = q(id);
    if (!node) { return; }
    if (value === undefined || value === null) { node.value = ''; }
    else { node.value = value; }
  }

  function setCheckbox(id, value) {
    const node = q(id);
    if (!node) { return; }
    node.checked = !!value;
  }

  function setSelectValue(id, value, fallback) {
    const node = q(id);
    if (!node) { return; }
    const val = (value === undefined || value === null) ? fallback : String(value);
    if ([...node.options].some(opt => opt.value === val)) {
      node.value = val;
    } else if (fallback !== undefined) {
      node.value = fallback;
    }
  }

  function normalizeArray(value) {
    if (!value) { return []; }
    if (Array.isArray(value)) { return value; }
    if (typeof value === 'string') {
      return value.split(/\r?\n|,/).map(function (part) { return part.trim(); }).filter(Boolean);
    }
    return [];
  }

  function listFromTextarea(id) {
    const node = q(id);
    if (!node || !node.value) { return []; }
    return node.value.split(/\r?\n/).map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function hydrate(payload) {
    if (!payload || !payload.snapshot) { return; }
    const snap = payload.snapshot;
    const dom = snap.domain || {};
    const custom = dom.agentCustomization || {};
    const info = dom.agentFileInfo || {};
    const tag = dom.agentTag || {};

    setValue('phase1-brandingTitle', snap.settings.title);
    setValue('phase1-brandingSubtitle', snap.settings.title2);
    setValue('phase1-brandingWelcome', snap.settings.welcome);
    setValue('phase1-domainTitle', dom.title);
    setValue('phase1-domainSubtitle', dom.title2);
    setSelectValue('phase1-siteStyle', dom.siteStyle, '0');
    setValue('phase1-titlePicturePath', dom.titlePicture);
    setValue('phase1-pwaLogoPath', dom.pwaLogo);

    setValue('phase1-portMain', snap.settings.port);
    setValue('phase1-portAlias', snap.settings.aliasPort);
    setValue('phase1-portRedir', snap.settings.redirPort);
    setValue('phase1-portRedirAlias', snap.settings.redirAliasPort);
    setValue('phase1-agentPort', snap.settings.agentPort);
    setValue('phase1-agentPortBind', snap.settings.agentPortBind);
    setValue('phase1-agentAliasPort', snap.settings.agentAliasPort);
    setValue('phase1-agentAliasDNS', snap.settings.agentAliasDNS);
    setValue('phase1-relayPort', snap.settings.relayPort);
    setValue('phase1-relayPortBind', snap.settings.relayPortBind);
    setCheckbox('phase1-agentPortTls', snap.settings.agentPortTls);

    setCheckbox('phase1-agentSignLock', snap.settings.agentSignLock);
    setCheckbox('phase1-allowHighQualityDesktop', snap.settings.allowHighQualityDesktop);
    setCheckbox('phase1-agentsInRam', snap.settings.agentsInRam);
    setSelectValue('phase1-agentUpdateSystem', snap.settings.agentUpdateSystem, '1');
    setCheckbox('phase1-agentInviteCodes', dom.agentInviteCodes);
    setCheckbox('phase1-agentNoProxy', dom.agentNoProxy);
    setCheckbox('phase1-lockAgentDownload', dom.lockAgentDownload || snap.settings.lockAgentDownload);
    setValue('phase1-rootCertCommonName', snap.settings.rootCertCommonName);

    setValue('phase1-agentDisplayName', custom.displayName);
    setValue('phase1-agentDescription', custom.description);
    setValue('phase1-agentCompany', custom.companyName);
    setValue('phase1-agentService', custom.serviceName);
    setValue('phase1-agentFileName', custom.fileName);
    setValue('phase1-agentInstallText', custom.installText);
    setValue('phase1-agentForeground', custom.foregroundColor);
    setValue('phase1-agentBackground', custom.backgroundColor);
    setValue('phase1-agentImagePath', custom.image);

    setValue('phase1-agentIconPath', info.icon);
    setValue('phase1-fileDescription', info.fileDescription);
    setValue('phase1-fileVersion', info.fileVersion);
    setValue('phase1-internalName', info.internalName);
    setValue('phase1-productName', info.productName);
    setValue('phase1-productVersion', info.productVersion);
    setValue('phase1-originalFilename', info.originalFilename);
    setValue('phase1-legalCopyright', info.legalCopyright);

    setValue('phase1-agentConfig', (dom.agentConfig || []).join('\n'));
    setValue('phase1-manageAllDeviceGroups', (dom.manageAllDeviceGroups || []).join('\n'));
    setValue('phase1-manageCrossDomain', (dom.manageCrossDomain || []).join('\n'));
    setValue('phase1-agentKey', Array.isArray(dom.agentKey) ? dom.agentKey.join(', ') : (dom.agentKey || ''));
    setValue('phase1-agentAllowedIp', normalizeArray(dom.agentAllowedIP).join('\n'));
    setValue('phase1-agentBlockedIp', normalizeArray(dom.agentBlockedIP).join('\n'));
    setSelectValue('phase1-tagServerName', (tag.ServerName !== undefined ? tag.ServerName : '-1'), '-1');
    setSelectValue('phase1-tagServerDesc', (tag.ServerDesc !== undefined ? tag.ServerDesc : '-1'), '-1');
    setSelectValue('phase1-tagServerTags', (tag.ServerTags !== undefined ? tag.ServerTags : '-1'), '-1');

    setCheckbox('phase1-amtScanner', snap.settings.amtScanner);
    setCheckbox('phase1-amtProvisioning', !!snap.settings.amtProvisioningServer);
    setValue('phase1-amtDeviceGroup', snap.amt.deviceGroup);
    setValue('phase1-amtPort', snap.amt.port);
    setValue('phase1-amtFqdn', snap.amt.trustedFqdn);
    setValue('phase1-amtIp', snap.amt.ip);
    setValue('phase1-amtPassword', snap.amt.mebxPassword);

    const list = q('phase1-amtDeviceGroupList');
    if (list && Array.isArray(payload.amtGroups)) {
      list.innerHTML = '';
      payload.amtGroups.forEach(function (g) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.label = g.name + (g.domain ? ' (domain: ' + g.domain + ')' : '');
        list.appendChild(opt);
      });
    }
  }

  function watchFileInput(inputId, stateKey, pathFieldId) {
    const input = q(inputId);
    if (!input) { return; }
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      if (!file) {
        delete state.files[stateKey];
        return;
      }
      const reader = new FileReader();
      reader.onload = function () {
        const base64 = reader.result.split(',')[1];
        state.files[stateKey] = { name: file.name, data: base64 };
        if (pathFieldId) {
          const field = q(pathFieldId);
          if (field && !field.value) { field.value = file.name; }
        }
        log('Queued ' + file.name + ' (' + stateKey + ') for upload.');
      };
      reader.readAsDataURL(file);
    });
  }

  function reloadSnapshot() {
    log('Refreshing values from config...');
    const body = new URLSearchParams();
    body.set('action', 'snapshot');
    fetch('pluginadmin.ashx?pin=phase1config', { method: 'POST', body: body })
      .then(function (res) {
        if (!res.ok) { throw new Error('HTTP ' + res.status); }
        return res.json();
      })
      .then(function (json) {
        hydrate(json);
        state.files = {};
        log('Values reloaded from current configuration.');
      })
      .catch(function (err) {
        log('Refresh failed: ' + err.message, 'error');
      });
  }

  function collectAgentTag() {
    const name = parseInt(q('phase1-tagServerName').value, 10);
    const desc = parseInt(q('phase1-tagServerDesc').value, 10);
    const tags = parseInt(q('phase1-tagServerTags').value, 10);
    const out = {};
    if (!isNaN(name) && name >= 0) { out.ServerName = name; }
    if (!isNaN(desc) && desc >= 0) { out.ServerDesc = desc; }
    if (!isNaN(tags) && tags >= 0) { out.ServerTags = tags; }
    return out;
  }

  function collectPayload() {
    function lines(id) {
      const value = q(id).value;
      return value ? value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
    }

    const brandingFiles = {};
    if (state.files.titlePicture) { brandingFiles.titlePicture = state.files.titlePicture; }
    if (state.files.pwaLogo) { brandingFiles.pwaLogo = state.files.pwaLogo; }

    const agentFiles = {};
    if (state.files.agentImage) { agentFiles.agentImage = state.files.agentImage; }
    if (state.files.agentIcon) { agentFiles.agentIcon = state.files.agentIcon; }

    return {
      branding: {
        title: q('phase1-brandingTitle').value,
        title2: q('phase1-brandingSubtitle').value,
        welcome: q('phase1-brandingWelcome').value,
        headerTitle: q('phase1-domainTitle').value,
        headerSubtitle: q('phase1-domainSubtitle').value,
        siteStyle: q('phase1-siteStyle').value,
        titlePicture: q('phase1-titlePicturePath').value,
        pwaLogo: q('phase1-pwaLogoPath').value,
        files: brandingFiles
      },
      ports: {
        port: q('phase1-portMain').value,
        aliasPort: q('phase1-portAlias').value,
        redirPort: q('phase1-portRedir').value,
        redirAliasPort: q('phase1-portRedirAlias').value,
        agentPort: q('phase1-agentPort').value,
        agentPortBind: q('phase1-agentPortBind').value,
        agentAliasPort: q('phase1-agentAliasPort').value,
        agentAliasDNS: q('phase1-agentAliasDNS').value,
        relayPort: q('phase1-relayPort').value,
        relayPortBind: q('phase1-relayPortBind').value
      },
      agent: {
        agentSignLock: q('phase1-agentSignLock').checked,
        agentUpdateSystem: q('phase1-agentUpdateSystem').value,
        allowHighQualityDesktop: q('phase1-allowHighQualityDesktop').checked,
        agentsInRam: q('phase1-agentsInRam').checked,
        agentPortTls: q('phase1-agentPortTls').checked,
        agentInviteCodes: q('phase1-agentInviteCodes').checked,
        agentNoProxy: q('phase1-agentNoProxy').checked,
        lockAgentDownload: q('phase1-lockAgentDownload').checked,
        rootCertCommonName: q('phase1-rootCertCommonName').value,
        agentCustomization: {
          displayName: q('phase1-agentDisplayName').value,
          description: q('phase1-agentDescription').value,
          companyName: q('phase1-agentCompany').value,
          serviceName: q('phase1-agentService').value,
          fileName: q('phase1-agentFileName').value,
          installText: q('phase1-agentInstallText').value,
          foregroundColor: q('phase1-agentForeground').value,
          backgroundColor: q('phase1-agentBackground').value,
          image: q('phase1-agentImagePath').value
        },
        agentFileInfo: {
          icon: q('phase1-agentIconPath').value,
          fileDescription: q('phase1-fileDescription').value,
          fileVersion: q('phase1-fileVersion').value,
          internalName: q('phase1-internalName').value,
          productName: q('phase1-productName').value,
          productVersion: q('phase1-productVersion').value,
          originalFilename: q('phase1-originalFilename').value,
          legalCopyright: q('phase1-legalCopyright').value
        },
        agentConfig: q('phase1-agentConfig').value,
        agentKey: q('phase1-agentKey').value,
        agentAllowedIP: listFromTextarea('phase1-agentAllowedIp'),
        agentBlockedIP: listFromTextarea('phase1-agentBlockedIp'),
        agentTag: collectAgentTag(),
        files: agentFiles
      },
      amt: {
        amtScanner: q('phase1-amtScanner').checked,
        provisioningEnabled: q('phase1-amtProvisioning').checked,
        deviceGroup: q('phase1-amtDeviceGroup').value,
        port: q('phase1-amtPort').value,
        trustedFqdn: q('phase1-amtFqdn').value,
        ip: q('phase1-amtIp').value,
        mebxPassword: q('phase1-amtPassword').value,
        manageAllDeviceGroups: q('phase1-manageAllDeviceGroups').value,
        manageCrossDomain: q('phase1-manageCrossDomain').value
      }
    };
  }

  function save() {
    const payload = collectPayload();
    log('Validating and applying changes...');
    const body = new URLSearchParams();
    body.set('action', 'save');
    body.set('payload', JSON.stringify(payload));

    fetch('pluginadmin.ashx?pin=phase1config', { method: 'POST', body: body })
      .then(function (res) {
        if (!res.ok) { return res.text().then(function (text) { throw new Error(text || ('HTTP ' + res.status)); }); }
        return res.json();
      })
      .then(function (json) {
        if (json.ok) {
          state.files = {};
          log('Configuration saved. MeshCentral restart triggered (backup: ' + (json.result.backup || 'n/a') + ').');
        } else {
          throw new Error(json.error || 'Unknown error');
        }
      })
      .catch(function (err) {
        log('Save failed: ' + err.message, 'error');
      });
  }

  function attachHandlers() {
    watchFileInput('phase1-titlePictureFile', 'titlePicture', 'phase1-titlePicturePath');
    watchFileInput('phase1-pwaLogoFile', 'pwaLogo', 'phase1-pwaLogoPath');
    watchFileInput('phase1-agentImageFile', 'agentImage', 'phase1-agentImagePath');
    watchFileInput('phase1-agentIconFile', 'agentIcon', 'phase1-agentIconPath');

    const saveBtn = q('phase1-saveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        save();
      });
    }

    const reloadBtn = q('phase1-reloadBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        reloadSnapshot();
      });
    }
  }

  registerTab();
})();
