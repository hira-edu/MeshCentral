import { PanelController } from "./panel-controller.mjs";

const routes = [
  { id: "devices", viewId: 1, group: "main", title: "My Devices", selector: "#p1", mainMenuId: "MainMenuMyDevices", leftMenuId: "LeftMenuMyDevices", mainRouteId: "devices" },
  { id: "account", viewId: 2, group: "main", title: "My Account", selector: "#p2", mainMenuId: "MainMenuMyAccount", leftMenuId: "LeftMenuMyAccount", mainRouteId: "account" },
  { id: "events", viewId: 3, group: "main", title: "My Events", selector: "#p3", mainMenuId: "MainMenuMyEvents", leftMenuId: "LeftMenuMyEvents", submenuSpanId: "EventsSubMenuSpan", submenuItemId: "EventsLive", mainRouteId: "events" },
  { id: "users", viewId: 4, group: "main", title: "My Users", selector: "#p4", mainMenuId: "MainMenuMyUsers", leftMenuId: "LeftMenuMyUsers", submenuSpanId: "UsersSubMenuSpan", submenuItemId: "UsersGeneral", mainRouteId: "users" },
  { id: "files", viewId: 5, group: "main", title: "My Files", selector: "#p5", mainMenuId: "MainMenuMyFiles", leftMenuId: "LeftMenuMyFiles", mainRouteId: "files" },
  { id: "server", viewId: 6, group: "main", title: "My Server", selector: "#p6", mainMenuId: "MainMenuMyServer", leftMenuId: "LeftMenuMyServer", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerGeneral", mainRouteId: "server" },
  { id: "device-general", viewId: 10, group: "device", title: "Device General", selector: "#p10", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDev", backButtonId: "p10BackButton", mainRouteId: "devices" },
  { id: "device-desktop", viewId: 11, group: "device", title: "Desktop", selector: "#p11", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevDesktop", backButtonId: "p11BackButton", mainRouteId: "devices" },
  { id: "device-terminal", viewId: 12, group: "device", title: "Terminal", selector: "#p12", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevTerminal", backButtonId: "p12BackButton", mainRouteId: "devices" },
  { id: "device-files", viewId: 13, group: "device", title: "Files", selector: "#p13", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevFiles", backButtonId: "p13BackButton", mainRouteId: "devices" },
  { id: "device-amt", viewId: 14, group: "device", title: "Intel AMT", selector: "#p14", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevAmt", backButtonId: "p14BackButton", mainRouteId: "devices" },
  { id: "device-console", viewId: 15, group: "device", title: "Device Console", selector: "#p15", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevConsole", backButtonId: "p15BackButton", mainRouteId: "devices" },
  { id: "device-events", viewId: 16, group: "device", title: "Device Events", selector: "#p16", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevEvents", backButtonId: "p16BackButton", mainRouteId: "devices" },
  { id: "device-details", viewId: 17, group: "device", title: "Device Details", selector: "#p17", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevInfo", backButtonId: "p17BackButton", mainRouteId: "devices" },
  { id: "device-plugins", viewId: 19, group: "device", title: "Device Plugins", selector: "#p19", submenuSpanId: "MainSubMenuSpan", submenuItemId: "MainDevPlugins", backButtonId: "p19BackButton", mainRouteId: "devices" },
  { id: "group-general", viewId: 20, group: "device-group", title: "Device Group General", selector: "#p20", submenuSpanId: "MeshSubMenuSpan", submenuItemId: "MeshGeneral", backButtonId: "p20BackButton", mainRouteId: "devices" },
  { id: "group-summary", viewId: 21, group: "device-group", title: "Device Group Summary", selector: "#p21", submenuSpanId: "MeshSubMenuSpan", submenuItemId: "MeshSummary", backButtonId: "p21BackButton", mainRouteId: "devices" },
  { id: "user-general", viewId: 30, group: "user", title: "User General", selector: "#p30", submenuSpanId: "UserSubMenuSpan", submenuItemId: "UserGeneral", backButtonId: "p30BackButton", mainRouteId: "users" },
  { id: "user-events", viewId: 31, group: "user", title: "User Events", selector: "#p31", submenuSpanId: "UserSubMenuSpan", submenuItemId: "UserEvents", backButtonId: "p31BackButton", mainRouteId: "users" },
  { id: "server-stats", viewId: 40, group: "server", title: "Server Stats", selector: "#p40", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerStats", mainRouteId: "server" },
  { id: "server-trace", viewId: 41, group: "server", title: "Server Trace", selector: "#p41", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerTrace", mainRouteId: "server" },
  { id: "server-plugins", viewId: 42, group: "server", title: "Server Plugins", selector: "#p42", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerPlugins", mainRouteId: "server" },
  { id: "server-plugin-detail", viewId: 43, group: "server", title: "Server Plugin Detail", selector: "#p43", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerPlugins", backButtonId: "p43BackButton", mainRouteId: "server" },
  { id: "users-groups", viewId: 50, group: "users", title: "User Groups", selector: "#p50", submenuSpanId: "UsersSubMenuSpan", submenuItemId: "UsersGroups", mainRouteId: "users" },
  { id: "user-group-detail", viewId: 51, group: "users", title: "User Group Detail", selector: "#p51", submenuSpanId: "UsersSubMenuSpan", submenuItemId: "UsersGroups", backButtonId: "p51BackButton", mainRouteId: "users" },
  { id: "users-recordings", viewId: 52, group: "users", title: "User Recordings", selector: "#p52", submenuSpanId: "UsersSubMenuSpan", submenuItemId: "UsersRecordings", mainRouteId: "users" },
  { id: "events-report", viewId: 60, group: "events", title: "Reports", selector: "#p60", submenuSpanId: "EventsSubMenuSpan", submenuItemId: "EventsReport", mainRouteId: "events" },
  { id: "server-console", viewId: 115, group: "server", title: "Server Console", selector: "#p15", submenuSpanId: "ServerSubMenuSpan", submenuItemId: "ServerConsole", mainRouteId: "server" },
];

export const legacyDefault3RouteMap = Object.freeze(routes.map((route) => Object.freeze({ ...route })));

export const legacyDefault3ShellContract = Object.freeze({
  disclosures: Object.freeze({
    notifications: Object.freeze({
      actionSelector: "#notifiyBox [data-mc-notification-action]",
      panelOpenClass: "show",
      panelSelector: "#notifiyBox",
      triggerSelector: "#notificationCount",
    }),
    userMenu: Object.freeze({
      actionSelector: "#userDropdownMenu [data-action]",
      menuOpenClass: "show",
      menuSelector: "#userDropdownMenu",
      submenuChevronOpenClass: "rotated",
      submenuChevronSelector: ".userDropdownUISettings .submenu-arrow, .userDropdownUISettings .fa-chevron-right",
      submenuOpenClass: "show",
      submenuSelector: "#uiSubmenu",
      submenuTriggerSelector: ".userDropdownUISettings",
      triggerSelector: "#userDropdownButton",
    }),
  }),
  primaryNavigation: Object.freeze({
    closeSelector: "[data-mc-nav-close]",
    openClass: "is-nav-open",
    overlayOpenClass: "is-visible",
    overlaySelector: "[data-mc-shell-nav-overlay]",
    sidebarSelector: "[data-mc-shell-primary-nav]",
    triggerSelector: "[data-mc-nav-toggle]",
  }),
  leftbarId: "page_leftbar",
  mainMenuSpanId: "MainMenuSpan",
  mainMenuIds: Object.freeze([
    "MainMenuMyDevices",
    "MainMenuMyAccount",
    "MainMenuMyEvents",
    "MainMenuMyFiles",
    "MainMenuMyUsers",
    "MainMenuMyServer",
  ]),
  leftMenuIds: Object.freeze([
    "LeftMenuMyDevices",
    "LeftMenuMyAccount",
    "LeftMenuMyEvents",
    "LeftMenuMyFiles",
    "LeftMenuMyUsers",
    "LeftMenuMyServer",
  ]),
  submenuSpanIds: Object.freeze([
    "MainSubMenuSpan",
    "MeshSubMenuSpan",
    "EventsSubMenuSpan",
    "UserSubMenuSpan",
    "UsersSubMenuSpan",
    "ServerSubMenuSpan",
  ]),
  activeClasses: Object.freeze({
    leftMenu: "lbbuttonsel",
    mainMenu: "style3sel",
    submenu: "style3sel",
  }),
});

const routeById = new Map();
const routeByViewId = new Map();
const routeByDomId = new Map();

for (const route of legacyDefault3RouteMap) {
  routeById.set(route.id, route);
  routeByViewId.set(route.viewId, route);
  for (const domId of [route.mainMenuId, route.leftMenuId, route.submenuItemId]) {
    if (domId) {
      routeByDomId.set(domId, route);
    }
  }
}

export function getRouteById(routeId) {
  return routeById.get(routeId) || null;
}

export function getRouteByViewId(viewId) {
  return routeByViewId.get(viewId) || null;
}

export function getRouteByDomId(domId) {
  return routeByDomId.get(domId) || null;
}

export function buildLegacyDefault3Routes(options = {}) {
  const controllerByRoute = options.controllerByRoute || {};
  const controllerByGroup = options.controllerByGroup || {};

  return legacyDefault3RouteMap.map((route) => ({
    cache: options.defaultCache ?? true,
    group: route.group,
    id: route.id,
    mainRouteId: route.mainRouteId,
    selector: route.selector,
    title: route.title,
    viewId: route.viewId,
    createController(context) {
      const ControllerClass = controllerByRoute[route.id] || controllerByGroup[route.group] || PanelController;
      return new ControllerClass({
        ...context,
        shellContract: legacyDefault3ShellContract,
        routeMeta: route,
      });
    },
  }));
}
