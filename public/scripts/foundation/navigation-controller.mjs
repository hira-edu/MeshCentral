import { PanelController } from "./panel-controller.mjs";
import { getRouteByDomId, getRouteById } from "./meshcentral-route-map.mjs";

function normalizeTriggerElement(match) {
  if (match instanceof HTMLElement && match.id) {
    return match;
  }

  if ((match instanceof HTMLElement) && match.closest("[id]")) {
    return match.closest("[id]");
  }

  return null;
}

export class NavigationController extends PanelController {
  onMount() {
    this.delegate([
      {
        type: "click",
        selector: "[data-mc-route], #MainMenuSpan [id], #page_leftbar [id], [id$='SubMenuSpan'] [id]",
        preventDefault: true,
        handler: ({ match, event }) => this.handleNavigate(match, event),
      },
      {
        type: "keydown",
        selector: "[data-mc-route], #MainMenuSpan [id], #page_leftbar [id], [id$='SubMenuSpan'] [id]",
        handler: ({ match, event }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.handleNavigate(match, event);
        },
      },
    ]);

    if (this.context.state) {
      this.track(this.context.state.subscribe((snapshot) => {
        this.syncActiveRoute(snapshot.route && snapshot.route.id);
      }, { immediate: true }));
    }
  }

  handleNavigate(match, event) {
    const trigger = normalizeTriggerElement(match);
    if (!trigger) {
      return;
    }

    const routeId = trigger.dataset.mcRoute || (getRouteByDomId(trigger.id) && getRouteByDomId(trigger.id).id);
    if (!routeId || typeof this.context.navigate !== "function") {
      return;
    }

    const route = getRouteById(routeId);
    this.context.navigate(routeId, {
      domId: trigger.id || null,
      source: "navigation-controller",
      trigger: event.type,
      viewId: route ? route.viewId : null,
    });
  }

  syncActiveRoute(routeId) {
    if (!this.context.document) {
      return;
    }

    const route = getRouteById(routeId);
    const shellContract = this.context.shellContract;
    if (!route || !shellContract) {
      return;
    }

    const mainRoute = getRouteById(route.mainRouteId) || route;
    this.toggleClassList(shellContract.mainMenuIds, shellContract.activeClasses.mainMenu, mainRoute.mainMenuId);
    this.toggleClassList(shellContract.leftMenuIds, shellContract.activeClasses.leftMenu, mainRoute.leftMenuId);

    const submenuIds = Array.from(new Set(
      Array.from(this.context.document.querySelectorAll("[id$='SubMenuSpan'] [id]"))
        .map((element) => element.id)
        .filter(Boolean),
    ));
    this.toggleClassList(submenuIds, shellContract.activeClasses.submenu, route.submenuItemId);
  }

  toggleClassList(ids, className, activeId) {
    for (const id of ids) {
      const element = this.context.document.getElementById(id);
      if (!element) {
        continue;
      }

      element.classList.toggle(className, id === activeId);
      if (id === activeId) {
        element.setAttribute("aria-current", "page");
      } else {
        element.removeAttribute("aria-current");
      }
    }
  }
}
