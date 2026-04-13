import { getRouteById, legacyDefault3RouteMap } from "./meshcentral-route-map.mjs";

const mainNavIconClassByRoute = Object.freeze({
  account: "fa-solid fa-user-gear",
  devices: "fa-solid fa-computer",
  events: "fa-solid fa-calendar-alt",
  files: "fa-solid fa-folder-open",
  server: "fa-solid fa-server",
  users: "fa-solid fa-users",
});

const primaryNavigationOrder = Object.freeze([
  "devices",
  "account",
  "events",
  "files",
  "users",
  "server",
]);

const workspaceNavigationOrderBySubmenu = Object.freeze({
  EventsSubMenuSpan: Object.freeze(["events", "events-report"]),
  MainSubMenuSpan: Object.freeze([
    "device-general",
    "device-desktop",
    "device-terminal",
    "device-files",
    "device-events",
    "device-details",
    "device-amt",
    "device-console",
    "device-plugins",
  ]),
  MeshSubMenuSpan: Object.freeze(["group-general", "group-summary"]),
  ServerSubMenuSpan: Object.freeze([
    "server",
    "server-stats",
    "server-console",
    "server-trace",
    "server-plugins",
  ]),
  UserSubMenuSpan: Object.freeze(["user-general", "user-events"]),
  UsersSubMenuSpan: Object.freeze(["users", "users-groups", "users-recordings"]),
});

function toSafeString(value, fallbackValue = "") {
  return (value == null) ? fallbackValue : String(value);
}

function toSafeCount(value, fallbackValue = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallbackValue;
}

export function buildPrimaryNavigation(activeRouteId) {
  const activeRoute = getRouteById(activeRouteId);
  const activeMainRouteId = activeRoute ? activeRoute.mainRouteId : null;

  return primaryNavigationOrder.map((routeId) => getRouteById(routeId)).filter(Boolean).map((route) => ({
    domId: route.leftMenuId || route.mainMenuId || null,
    href: "#",
    iconClass: mainNavIconClassByRoute[route.id] || null,
    isActive: route.id === activeMainRouteId,
    label: route.title,
    routeId: route.id,
  }));
}

export function buildWorkspaceNavigation(activeRouteId) {
  const activeRoute = getRouteById(activeRouteId);
  if (!activeRoute || !activeRoute.submenuSpanId) {
    return [];
  }

  const orderedRouteIds = workspaceNavigationOrderBySubmenu[activeRoute.submenuSpanId] || [];

  return orderedRouteIds
    .map((routeId) => getRouteById(routeId))
    .filter((route) => route && route.submenuItemId)
    .map((route) => ({
      domId: route.submenuItemId,
      href: "#",
      isActive: route.id === activeRoute.id,
      label: route.title,
      routeId: route.id,
    }));
}

export function buildPrimaryNavigationModel(activeRouteId, options = {}) {
  return {
    closeButtonLabel: toSafeString(options.closeButtonLabel, "Close navigation"),
    footer: toSafeString(options.footer),
    items: buildPrimaryNavigation(activeRouteId),
    label: toSafeString(options.label, "Primary navigation"),
    title: toSafeString(options.title, "Navigation"),
  };
}

export function buildWorkspaceFrameModel(options = {}) {
  const route = getRouteById(options.routeId);
  if (!route) {
    throw new Error(`Unknown route "${options.routeId}" for workspace frame model.`);
  }

  return {
    backButton: route.backButtonId ? {
      domId: route.backButtonId,
      label: toSafeString(options.backButtonLabel, "Back"),
    } : null,
    content: toSafeString(options.content),
    emptyState: toSafeString(options.emptyState),
    headerActions: toSafeString(options.headerActions),
    route,
    subtitle: toSafeString(options.subtitle, null),
    title: toSafeString(options.title, route.title),
    toolbar: toSafeString(options.toolbar),
  };
}

export function buildNotificationCenterModel(options = {}) {
  return {
    content: toSafeString(options.content),
    count: toSafeCount(options.count),
    panelId: toSafeString(options.panelId, "mc-shell-notification-panel"),
    panelLabel: toSafeString(options.panelLabel, "Notifications"),
    triggerContent: toSafeString(options.triggerContent, "Notifications"),
  };
}

export function buildUserMenuModel(options = {}) {
  const uiSettings = options.uiSettings || null;

  return {
    menuContent: toSafeString(options.menuContent),
    menuId: toSafeString(options.menuId, "mc-shell-user-menu-panel"),
    triggerContent: toSafeString(options.triggerContent, "User menu"),
    uiSettings: uiSettings ? {
      chevronClass: toSafeString(uiSettings.chevronClass, "fa-solid fa-chevron-right"),
      content: toSafeString(uiSettings.content),
      label: toSafeString(uiSettings.label, "UI Settings"),
      menuId: toSafeString(uiSettings.menuId, "mc-shell-user-menu-ui-panel"),
    } : null,
  };
}

export function buildHeaderChromeModel(options = {}) {
  return {
    extraActions: toSafeString(options.extraActions),
    notifications: options.notifications ? buildNotificationCenterModel(options.notifications) : null,
    userMenu: options.userMenu ? buildUserMenuModel(options.userMenu) : null,
  };
}

export function buildShellNavToggleModel(options = {}) {
  return {
    ariaLabel: toSafeString(options.ariaLabel, "Open navigation"),
    iconClass: toSafeString(options.iconClass, "fa-solid fa-bars"),
    label: toSafeString(options.label, "Menu"),
  };
}

export function buildShellHeaderModel(routeId, options = {}) {
  const route = getRouteById(routeId);
  if (!route) {
    throw new Error(`Unknown route "${routeId}" for shell header model.`);
  }

  return {
    actions: toSafeString(options.actions),
    badge: toSafeString(options.badge, route.group),
    chrome: options.chrome ? buildHeaderChromeModel(options.chrome) : null,
    navToggle: options.navToggle ? buildShellNavToggleModel(options.navToggle) : null,
    subtitle: toSafeString(options.subtitle, null),
    title: toSafeString(options.title, route.title),
  };
}

export function buildAppShellViewModel(options = {}) {
  const route = getRouteById(options.routeId);
  if (!route) {
    throw new Error(`Unknown route "${options.routeId}" for shell view model.`);
  }

  return {
    contextPanel: toSafeString(options.contextPanel),
    density: toSafeString(options.density, "comfortable"),
    header: buildShellHeaderModel(route.id, options.header || {}),
    primaryNavigation: buildPrimaryNavigationModel(route.id, options.primaryNavigation || {}),
    route,
    shell: {
      primaryNavOpen: Boolean(options.shell && options.shell.primaryNavOpen),
    },
    theme: toSafeString(options.theme, "system"),
    workspaceNavigation: buildWorkspaceNavigation(route.id),
  };
}
