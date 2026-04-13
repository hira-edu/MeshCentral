import { PanelController } from "./panel-controller.mjs";
import { legacyDefault3RouteMap, legacyDefault3ShellContract, getRouteById } from "./meshcentral-route-map.mjs";

function setVisibility(documentRef, id, visible) {
  const element = documentRef && documentRef.getElementById(id);
  if (!element) {
    return;
  }

  element.style.display = visible ? "" : "none";
  element.setAttribute("aria-hidden", visible ? "false" : "true");
}

export class ShellController extends PanelController {
  onMount() {
    if (!this.context.state) {
      return;
    }

    this.track(this.context.state.subscribe((snapshot, previousState, meta) => {
      if ((meta && meta.source) === "shell-controller") {
        return;
      }
      const route = getRouteById(snapshot.route && snapshot.route.id);
      if (!route) {
        return;
      }

      this.applyRoute(route, snapshot.route && snapshot.route.payload);
    }, { immediate: true }));
  }

  applyRoute(route, payload = {}) {
    const documentRef = this.context.document;
    const shellContract = this.context.shellContract || legacyDefault3ShellContract;

    if (!documentRef) {
      return;
    }

    for (const submenuSpanId of shellContract.submenuSpanIds) {
      setVisibility(documentRef, submenuSpanId, submenuSpanId === route.submenuSpanId);
    }

    const selectors = Array.from(new Set(legacyDefault3RouteMap.map((candidateRoute) => candidateRoute.selector)));
    for (const selector of selectors) {
      const panel = documentRef.querySelector(selector);
      if (!panel) {
        continue;
      }

      const visible = selector === route.selector;
      panel.style.display = visible ? "" : "none";
      panel.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    this.syncBackButtons(route, payload);
    this.syncDatasets(route);
    this.setState({
      shell: {
        activeMainRoute: route.mainRouteId || null,
        activeSubmenuRoute: route.submenuItemId ? route.id : null,
        submenuVisible: Boolean(route.submenuSpanId),
      },
      workspace: {
        backButtonId: route.backButtonId || null,
        panelSelector: route.selector,
        title: route.title,
      },
    }, {
      route: route.id,
      source: "shell-controller",
    });
  }

  syncBackButtons(route, payload = {}) {
    const documentRef = this.context.document;
    const allBackButtons = Array.from(documentRef.querySelectorAll("[id$='BackButton']"));

    for (const button of allBackButtons) {
      const visible = button.id === route.backButtonId && payload.showBackButton !== false;
      button.style.display = visible ? "" : "none";
      button.setAttribute("aria-hidden", visible ? "false" : "true");
    }
  }

  syncDatasets(route) {
    const root = this.root || this.context.document && this.context.document.documentElement;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    root.dataset.mcRoute = route.id;
    root.dataset.mcRouteGroup = route.group;
    root.dataset.mcViewId = String(route.viewId);
  }
}
