const TOP_ROUTE_PANELS = [
  ['devices', 'p1'],
  ['account', 'p2'],
  ['events', 'p3'],
  ['users', 'p4'],
  ['files', 'p5'],
  ['server', 'p6'],
];

const SUBNAV_SELECTORS = [
  '#MainSubMenuSpan',
  '#MeshSubMenuSpan',
  '#EventsSubMenuSpan',
  '#UserSubMenuSpan',
  '#UsersSubMenuSpan',
  '#ServerSubMenuSpan'
];

function getElement(selector) {
  return document.querySelector(selector);
}

function isVisible(node) {
  if (!node) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function ensureSlot(hostSelector, slotName, className) {
  const host = getElement(hostSelector);
  if (!host) return null;

  let slot = host.querySelector(`[data-mc-slot="${slotName}"]`);
  if (!slot) {
    slot = document.createElement('div');
    slot.dataset.mcSlot = slotName;
    if (className) slot.className = className;
    host.prepend(slot);
  }

  return slot;
}

function getActiveTopRoute() {
  for (const [routeId, panelId] of TOP_ROUTE_PANELS) {
    if (isVisible(document.getElementById(panelId))) return routeId;
  }
  return null;
}

function getConnectionState() {
  const panel = getElement('#p0');
  if (!isVisible(panel)) return 'connected';

  const message = getElement('#p0span')?.textContent?.trim()?.toLowerCase() || '';
  if (message.includes('invalid origin')) return 'invalid-origin';
  if (message.includes('disconnected')) return 'disconnected';
  return 'degraded';
}

function getVisibleSubmenus() {
  return SUBNAV_SELECTORS
    .filter((selector) => isVisible(document.querySelector(selector)))
    .map((selector) => selector.slice(1));
}

function syncShellState() {
  const body = document.body;
  const container = getElement('#container');
  const masthead = getElement('#masthead');
  const leftbar = getElement('#page_leftbar');
  const topbar = getElement('#topbar');
  const workspace = getElement('#column_l');
  if (!body || !container || !masthead || !leftbar || !topbar || !workspace) return;

  ensureSlot('#masthead .masthead-right', 'shell-header-chrome', 'mc-default3-bridge__header-slot');
  ensureSlot('#topbar > div > div', 'workspace-nav-actions', 'mc-default3-bridge__subnav-slot');

  const activeRoute = getActiveTopRoute();
  const navMode = isVisible(leftbar) ? 'leftbar' : 'topbar';
  const responsiveMode = window.innerWidth >= 1024 ? 'expanded' : 'compact';
  const connectionState = getConnectionState();
  const visibleSubmenus = getVisibleSubmenus();
  const subnavActive = visibleSubmenus.length > 0;

  body.dataset.mcSurface = 'default3';
  body.dataset.mcShell = 'default3-bridge';
  body.dataset.mcActiveRoute = activeRoute || '';
  body.dataset.mcNavMode = navMode;
  body.dataset.mcResponsiveMode = responsiveMode;
  body.dataset.mcConnectionState = connectionState;
  body.dataset.mcSubnavActive = subnavActive ? 'true' : 'false';

  container.dataset.mcActiveRoute = activeRoute || '';
  container.dataset.mcNavMode = navMode;
  container.dataset.mcResponsiveMode = responsiveMode;
  container.dataset.mcSubnavActive = subnavActive ? 'true' : 'false';

  masthead.dataset.mcShellRegion = 'masthead';
  leftbar.dataset.mcShellRegion = 'primary-nav';
  topbar.dataset.mcShellRegion = 'subnav';
  topbar.dataset.mcSubnavActive = subnavActive ? 'true' : 'false';
  topbar.dataset.mcVisibleSubmenus = visibleSubmenus.join(' ');
  workspace.dataset.mcShellRegion = 'workspace';
}

function patchLegacyGo() {
  if (typeof window.go !== 'function' || window.go.__mcDefault3BridgePatched === true) return;

  const originalGo = window.go.bind(window);
  const wrappedGo = (...args) => {
    const result = originalGo(...args);
    requestAnimationFrame(() => requestAnimationFrame(syncShellState));
    return result;
  };

  wrappedGo.__mcDefault3BridgePatched = true;
  window.go = wrappedGo;
}

function installObservers() {
  const workspace = getElement('#column_l');
  if (!workspace || workspace.__mcDefault3BridgeObserverInstalled === true) return;

  const observer = new MutationObserver(() => {
    requestAnimationFrame(syncShellState);
  });
  observer.observe(workspace, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  workspace.__mcDefault3BridgeObserverInstalled = true;
}

function boot() {
  patchLegacyGo();
  installObservers();
  syncShellState();
}

window.addEventListener('resize', syncShellState, { passive: true });
window.addEventListener('load', boot);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
