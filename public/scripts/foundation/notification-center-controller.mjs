import { PanelController } from "./panel-controller.mjs";

const defaultNotificationCenterContract = Object.freeze({
  actionSelector: "[data-mc-notification-action]",
  panelOpenClass: "is-open",
  panelSelector: "[data-mc-notification-panel]",
  triggerOpenClass: "is-active",
  triggerSelector: "[data-mc-notification-trigger]",
});

function isElement(value) {
  return (typeof Element !== "undefined") && (value instanceof Element);
}

function queryElement(documentRef, selector) {
  if (!documentRef || (typeof documentRef.querySelector !== "function") || !selector) {
    return null;
  }

  const match = documentRef.querySelector(selector);
  return isElement(match) ? match : null;
}

function containsTarget(element, target) {
  return isElement(element) && (typeof Node !== "undefined") && (target instanceof Node) && element.contains(target);
}

function syncOpenState(element, open, openClass) {
  if (!isElement(element)) {
    return;
  }

  if (openClass) {
    element.classList.toggle(openClass, open);
  }
}

function syncExpandedState(element, open) {
  if (!isElement(element)) {
    return;
  }

  element.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncHiddenState(element, open) {
  if (!isElement(element)) {
    return;
  }

  element.hidden = !open;
  element.style.display = open ? "" : "none";
  element.setAttribute("aria-hidden", open ? "false" : "true");
}

function readOpenState(controller) {
  if (controller.context.state) {
    return Boolean(controller.context.state.get("shell.notificationsOpen"));
  }

  const panel = queryElement(controller.context.document, controller.contract.panelSelector);
  return Boolean(panel && !panel.hidden);
}

export class NotificationCenterController extends PanelController {
  get contract() {
    const shellContract = this.context.shellContract && this.context.shellContract.disclosures;
    return {
      ...defaultNotificationCenterContract,
      ...(shellContract && shellContract.notifications),
      ...(this.context.notificationCenterContract || {}),
    };
  }

  onMount() {
    this.delegate([
      {
        type: "click",
        selector: this.contract.triggerSelector,
        preventDefault: true,
        handler: () => this.toggle({ source: "notification-center" }),
      },
      {
        type: "keydown",
        selector: this.contract.triggerSelector,
        handler: ({ event }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.toggle({ source: "notification-center" });
        },
      },
      {
        type: "click",
        selector: this.contract.actionSelector,
        preventDefault: true,
        handler: ({ match, event }) => this.handleAction(match, event),
      },
    ]);

    if (this.context.document) {
      this.listen(this.context.document, "click", (event) => this.handleDocumentClick(event));
      this.listen(this.context.document, "keydown", (event) => this.handleDocumentKeydown(event));
    }

    if (!this.context.state) {
      this.sync(false);
      return;
    }

    this.track(this.context.state.subscribe((snapshot, previousState, meta) => {
      if ((meta && meta.source) === "notification-center") {
        return;
      }

      this.sync(Boolean(snapshot.shell && snapshot.shell.notificationsOpen));
    }, { immediate: true }));
  }

  open(meta = {}) {
    this.setState({
      shell: {
        notificationsOpen: true,
      },
    }, {
      ...meta,
      source: "notification-center",
    });
    this.sync(true);
  }

  close(meta = {}) {
    this.setState({
      shell: {
        notificationsOpen: false,
      },
    }, {
      ...meta,
      source: "notification-center",
    });
    this.sync(false);
  }

  toggle(meta = {}) {
    const nextOpenState = !readOpenState(this);
    if (nextOpenState) {
      this.open(meta);
      return;
    }

    this.close(meta);
  }

  handleAction(match, event) {
    const action = match.dataset.mcNotificationAction || match.dataset.action || null;
    if (!action) {
      return;
    }

    const payload = {
      action,
      event,
      id: match.dataset.mcNotificationId || null,
      match,
    };
    const actionHandler = this.context.notificationActions && this.context.notificationActions[action];

    if (typeof actionHandler === "function") {
      actionHandler(payload);
    }
    if (typeof this.context.handleNotificationAction === "function") {
      this.context.handleNotificationAction(payload);
    }
  }

  handleDocumentClick(event) {
    if (!this.context.state || !this.context.state.get("shell.notificationsOpen")) {
      return;
    }

    const trigger = queryElement(this.context.document, this.contract.triggerSelector);
    const panel = queryElement(this.context.document, this.contract.panelSelector);
    const target = event.target;
    if (containsTarget(trigger, target) || containsTarget(panel, target)) {
      return;
    }

    this.close({ trigger: "outside-click" });
  }

  handleDocumentKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (this.context.state && this.context.state.get("shell.notificationsOpen")) {
      this.close({ trigger: "escape-key" });
    }
  }

  sync(open) {
    const trigger = queryElement(this.context.document, this.contract.triggerSelector);
    const panel = queryElement(this.context.document, this.contract.panelSelector);
    syncOpenState(trigger, open, this.contract.triggerOpenClass);
    syncExpandedState(trigger, open);
    syncOpenState(panel, open, this.contract.panelOpenClass);
    syncHiddenState(panel, open);
  }
}
