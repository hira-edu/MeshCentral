import { buildLegacyDefault3Routes, legacyDefault3ShellContract } from "./meshcentral-route-map.mjs";
import { NavigationController } from "./navigation-controller.mjs";
import { NotificationCenterController } from "./notification-center-controller.mjs";
import { PrimaryNavController } from "./primary-nav-controller.mjs";
import { RouteRegistry } from "./route-registry.mjs";
import { ShellController } from "./shell-controller.mjs";
import { createLegacyDefault3ShellState } from "./shell-state.mjs";
import { SlotRegistry } from "./slot-registry.mjs";
import { StateRegistry } from "./state-registry.mjs";
import { UserMenuController } from "./user-menu-controller.mjs";

export class ShellRuntime {
  constructor(options = {}) {
    this.document = options.document || globalThis.document || null;
    this.handleNotificationAction = options.handleNotificationAction || null;
    this.handleUserMenuAction = options.handleUserMenuAction || null;
    this.initialPayload = options.initialPayload || {};
    this.initialRouteId = options.initialRouteId || null;
    this.notificationActions = options.notificationActions || null;
    this.permissionSummary = options.permissionSummary || null;
    this.root = options.root || this.document;
    this.state = options.state || new StateRegistry(options.initialState || createLegacyDefault3ShellState());
    this.routes = options.routes || new RouteRegistry({
      document: this.document,
      state: this.state,
    });
    this.routes.document = this.document;
    this.routes.state = this.state;
    this.shellContract = options.shellContract || legacyDefault3ShellContract;
    this.slots = options.slots || new SlotRegistry({
      document: this.document,
      root: this.root,
    });
    this.userMenuActions = options.userMenuActions || null;
    this._mounted = false;
    this._persistentControllers = [];
    this._slotSyncTeardown = null;
  }

  registerRoutes(routeDefinitions = []) {
    for (const route of routeDefinitions) {
      this.routes.register(route);
    }

    return this;
  }

  mount() {
    if (this._mounted) {
      return this;
    }

    if (!this.document || (typeof this.document.querySelector !== "function")) {
      throw new Error("ShellRuntime.mount requires a document.");
    }

    const context = {
      document: this.document,
      handleNotificationAction: this.handleNotificationAction,
      handleUserMenuAction: this.handleUserMenuAction,
      navigate: (routeId, payload = {}) => this.navigate(routeId, payload),
      notificationActions: this.notificationActions,
      root: this.root || this.document,
      routes: this.routes,
      shellContract: this.shellContract,
      slots: this.slots,
      state: this.state,
      userMenuActions: this.userMenuActions,
    };

    this._persistentControllers = [
      new PrimaryNavController(context),
      new NavigationController(context),
      new ShellController(context),
      new NotificationCenterController(context),
      new UserMenuController(context),
    ];

    for (const controller of this._persistentControllers) {
      controller.mount();
    }

    if (this.slots) {
      this.slots.document = this.document;
      this.slots.root = this.root || this.document;
      this._slotSyncTeardown = this.state.subscribe((snapshot) => {
        this.slots.sync({
          document: this.document,
          permissionSummary: this.permissionSummary,
          preferences: snapshot.preferences,
          root: this.root || this.document,
          route: snapshot.route,
          selection: snapshot.selection,
          shell: snapshot.shell,
          surfaceId: snapshot.route && snapshot.route.id,
          workspace: snapshot.workspace,
        });
      }, { immediate: true });
    }

    this._mounted = true;

    const existingRouteId = this.state.get("route.id");
    const existingPayload = this.state.get("route.payload", {});
    if (existingRouteId) {
      this.navigate(existingRouteId, existingPayload);
    } else if (this.initialRouteId) {
      this.navigate(this.initialRouteId, this.initialPayload);
    }

    return this;
  }

  navigate(routeId, payload = {}) {
    return this.routes.navigate(routeId, payload);
  }

  destroy() {
    if (typeof this._slotSyncTeardown === "function") {
      this._slotSyncTeardown();
      this._slotSyncTeardown = null;
    }

    while (this._persistentControllers.length > 0) {
      const controller = this._persistentControllers.pop();
      controller.unmount("destroy");
    }

    if (this.slots) {
      this.slots.destroy("shell-runtime-destroy");
    }

    this.routes.destroy();
    this._mounted = false;
  }
}

export function createLegacyDefault3ShellRuntime(options = {}) {
  const documentRef = options.document || globalThis.document || null;
  const state = options.state || new StateRegistry(options.initialState || createLegacyDefault3ShellState());
  const routes = options.routes || new RouteRegistry({
    document: documentRef,
    state,
  });
  const runtime = new ShellRuntime({
    ...options,
    document: documentRef,
    initialRouteId: options.initialRouteId || "devices",
    routes,
    shellContract: options.shellContract || legacyDefault3ShellContract,
    state,
  });

  runtime.registerRoutes(options.routeDefinitions || buildLegacyDefault3Routes(options));
  return runtime;
}
