import { PanelController } from "./panel-controller.mjs";

function resolveRoot(route, context) {
  if (typeof route.resolveRoot === "function") {
    return route.resolveRoot(context);
  }

  if (route.root instanceof Element) {
    return route.root;
  }

  if (route.selector && context.document) {
    return context.document.querySelector(route.selector);
  }

  return null;
}

function createController(route, context) {
  if (typeof route.createController === "function") {
    return route.createController(context);
  }

  const ControllerClass = route.controller || PanelController;
  return new ControllerClass(context);
}

export class RouteRegistry {
  constructor(options = {}) {
    this.document = options.document || globalThis.document || null;
    this.state = options.state || null;
    this.routes = new Map();
    this.instances = new Map();
    this.current = null;
  }

  register(route) {
    if (!route || !route.id) {
      throw new TypeError("RouteRegistry.register requires a route with an id.");
    }

    if (!route.selector && !route.resolveRoot && !route.root) {
      throw new TypeError("RouteRegistry.register requires selector, root, or resolveRoot.");
    }

    if (!route.createController && !route.controller) {
      throw new TypeError("RouteRegistry.register requires createController or controller.");
    }

    this.routes.set(route.id, route);
    return this;
  }

  navigate(routeId, payload = {}) {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error(`Unknown route "${routeId}".`);
    }

    if (this.current && this.current.id === routeId) {
      this.current.controller.update(payload);
      this._syncState(route, payload);
      return this.current.controller;
    }

    if (this.current) {
      this.current.controller.unmount(`navigate:${routeId}`);
      if (this.current.route.cache !== true) {
        this.instances.delete(this.current.id);
      }
    }

    const context = {
      document: this.document,
      payload,
      route,
      root: resolveRoot(route, { document: this.document, payload, state: this.state }),
      state: this.state,
    };

    if (!(context.root instanceof Element)) {
      throw new Error(`Route "${routeId}" did not resolve to a root element.`);
    }

    let controller = (route.cache === true) ? this.instances.get(routeId) : null;

    if (controller) {
      controller.root = context.root;
      controller.route = route;
      controller.context = context;
      controller.update(payload);
    } else {
      controller = createController(route, context);
      if (!(controller instanceof PanelController)) {
        throw new TypeError(`Route "${routeId}" did not create a PanelController instance.`);
      }
      controller.mount(payload);
      if (route.cache === true) {
        this.instances.set(routeId, controller);
      }
    }

    this.current = { controller, id: routeId, route };
    this._syncState(route, payload);
    return controller;
  }

  destroy() {
    if (this.current) {
      this.current.controller.unmount("destroy");
      this.current = null;
    }

    for (const controller of this.instances.values()) {
      controller.unmount("destroy");
    }

    this.instances.clear();
  }

  _syncState(route, payload) {
    if (!this.state) {
      return;
    }

    this.state.set({
      route: {
        group: route.group || null,
        id: route.id,
        mainRouteId: route.mainRouteId || route.id,
        payload,
        title: route.title || route.id,
        viewId: route.viewId || null,
      },
    }, {
      route: route.id,
      source: "route-registry",
    });
  }
}
