export function createDefaultShellState() {
  return {
    route: {
      group: null,
      id: null,
      mainRouteId: null,
      payload: {},
      title: null,
      viewId: null,
    },
    shell: {
      activeMainRoute: null,
      activeSubmenuRoute: null,
      notificationsOpen: false,
      primaryNavOpen: false,
      submenuVisible: false,
      uiSubmenuOpen: false,
      userMenuOpen: false,
    },
    preferences: {
      contrast: "normal",
      density: "comfortable",
      theme: "system",
    },
    selection: {
      deviceId: null,
      deviceGroupId: null,
      userGroupId: null,
      userId: null,
    },
    workspace: {
      backButtonId: null,
      panelSelector: null,
      title: null,
    },
  };
}

export function createLegacyDefault3ShellState() {
  const state = createDefaultShellState();
  state.shell.primaryNavModel = "leftbar";
  state.shell.renderStack = "default3";
  return state;
}
