export { delegateEvents } from "./delegate-events.mjs";
export { NavigationController } from "./navigation-controller.mjs";
export { NotificationCenterController } from "./notification-center-controller.mjs";
export { PanelController } from "./panel-controller.mjs";
export { PrimaryNavController } from "./primary-nav-controller.mjs";
export { RouteRegistry } from "./route-registry.mjs";
export { ShellController } from "./shell-controller.mjs";
export { ShellRuntime, createLegacyDefault3ShellRuntime } from "./shell-runtime.mjs";
export { SlotRegistry } from "./slot-registry.mjs";
export {
  buildAppShellViewModel,
  buildHeaderChromeModel,
  buildNotificationCenterModel,
  buildPrimaryNavigationModel,
  buildPrimaryNavigation,
  buildShellNavToggleModel,
  buildShellHeaderModel,
  buildUserMenuModel,
  buildWorkspaceFrameModel,
  buildWorkspaceNavigation,
} from "./shell-view-models.mjs";
export {
  buildLegacyDefault3Routes,
  getRouteByDomId,
  getRouteById,
  getRouteByViewId,
  legacyDefault3RouteMap,
  legacyDefault3ShellContract,
} from "./meshcentral-route-map.mjs";
export {
  createDefaultShellState,
  createLegacyDefault3ShellState,
} from "./shell-state.mjs";
export { StateRegistry } from "./state-registry.mjs";

import { RouteRegistry } from "./route-registry.mjs";
import { createDefaultShellState } from "./shell-state.mjs";
import { StateRegistry } from "./state-registry.mjs";
export { UserMenuController } from "./user-menu-controller.mjs";

export function createFoundationContext(options = {}) {
  const initialState = options.initialState || createDefaultShellState();
  const state = options.state || new StateRegistry(initialState);
  const routes = options.routes || new RouteRegistry({
    document: options.document || globalThis.document,
    state,
  });

  return { state, routes };
}
