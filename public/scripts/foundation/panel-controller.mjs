import { delegateEvents } from "./delegate-events.mjs";

export class PanelController {
  constructor(context = {}) {
    this.context = context;
    this.root = context.root || null;
    this.route = context.route || null;
    this.state = context.state || null;
    this._mounted = false;
    this._teardowns = [];
  }

  mount(payload = {}) {
    if (this._mounted) {
      return this.update(payload);
    }

    this._mounted = true;
    return this.onMount(payload);
  }

  update(payload = {}) {
    return this.onUpdate(payload);
  }

  unmount(reason = "route-change") {
    if (!this._mounted) {
      return;
    }

    while (this._teardowns.length > 0) {
      const teardown = this._teardowns.pop();
      teardown();
    }

    this.onUnmount(reason);
    this._mounted = false;
  }

  onMount() {}

  onUpdate() {}

  onUnmount() {}

  track(teardown) {
    if (typeof teardown === "function") {
      this._teardowns.push(teardown);
    }
    return teardown;
  }

  listen(target, type, handler, options = undefined) {
    if (!(target instanceof EventTarget)) {
      throw new TypeError("PanelController.listen expects an EventTarget.");
    }

    target.addEventListener(type, handler, options);
    return this.track(() => target.removeEventListener(type, handler, options));
  }

  delegate(definitions, sharedContext = {}) {
    if (!(this.root instanceof EventTarget)) {
      throw new TypeError("PanelController.delegate requires a root EventTarget.");
    }

    return this.track(delegateEvents(this.root, definitions, sharedContext));
  }

  setState(patch, meta = {}) {
    if (!this.state) {
      return null;
    }

    return this.state.set(patch, meta);
  }
}
