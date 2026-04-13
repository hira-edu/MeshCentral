import { PanelController } from "./panel-controller.mjs";

const defaultPrimaryNavigationContract = Object.freeze({
  appRootSelector: "[data-mc-shell='app']",
  closeSelector: "[data-mc-nav-close]",
  openClass: "is-nav-open",
  overlayOpenClass: "is-visible",
  overlaySelector: "[data-mc-shell-nav-overlay]",
  sidebarSelector: "[data-mc-shell-primary-nav]",
  triggerSelector: "[data-mc-nav-toggle]",
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

function isSelectorMatch(element, selector) {
  return isElement(element) && (typeof element.closest === "function") && (element.closest(selector) === element);
}

function syncOpenState(element, open, openClass) {
  if (!isElement(element) || !openClass) {
    return;
  }

  element.classList.toggle(openClass, open);
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
  element.setAttribute("aria-hidden", open ? "false" : "true");
}

function readOpenState(controller) {
  if (controller.context.state) {
    return Boolean(controller.context.state.get("shell.primaryNavOpen"));
  }

  const appRoot = queryElement(controller.context.document, controller.contract.appRootSelector);
  return Boolean(appRoot && appRoot.classList.contains(controller.contract.openClass));
}

export class PrimaryNavController extends PanelController {
  get contract() {
    return {
      ...defaultPrimaryNavigationContract,
      ...((this.context.shellContract && this.context.shellContract.primaryNavigation) || {}),
      ...(this.context.primaryNavigationContract || {}),
    };
  }

  onMount() {
    this.delegate([
      {
        type: "click",
        selector: `${this.contract.triggerSelector}, ${this.contract.closeSelector}, ${this.contract.overlaySelector}`,
        preventDefault: true,
        handler: ({ match }) => this.handleToggleAction(match),
      },
      {
        type: "keydown",
        selector: `${this.contract.triggerSelector}, ${this.contract.closeSelector}`,
        handler: ({ event, match }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.handleToggleAction(match);
        },
      },
    ]);

    if (this.context.document) {
      this.listen(this.context.document, "keydown", (event) => this.handleDocumentKeydown(event));
    }

    if (!this.context.state) {
      this.sync(false);
      return;
    }

    this.track(this.context.state.subscribe((snapshot, previousState) => {
      const open = Boolean(snapshot.shell && snapshot.shell.primaryNavOpen);
      if (
        open &&
        previousState &&
        previousState.route &&
        snapshot.route &&
        previousState.route.id &&
        snapshot.route.id &&
        previousState.route.id !== snapshot.route.id
      ) {
        this.close({ trigger: "route-change" });
        return;
      }

      this.sync(open);
    }, { immediate: true }));
  }

  open(meta = {}) {
    this.setState({
      shell: {
        notificationsOpen: false,
        primaryNavOpen: true,
        uiSubmenuOpen: false,
        userMenuOpen: false,
      },
    }, {
      ...meta,
      source: "primary-nav-controller",
    });
    this.sync(true);
  }

  close(meta = {}) {
    this.setState({
      shell: {
        primaryNavOpen: false,
      },
    }, {
      ...meta,
      source: "primary-nav-controller",
    });
    this.sync(false);
  }

  toggle(meta = {}) {
    if (readOpenState(this)) {
      this.close(meta);
      return;
    }

    this.open(meta);
  }

  handleToggleAction(match) {
    if (!isElement(match)) {
      return;
    }

    if (isSelectorMatch(match, this.contract.overlaySelector) || isSelectorMatch(match, this.contract.closeSelector)) {
      this.close({ trigger: "dismiss-control" });
      return;
    }

    this.toggle({ trigger: "toggle-control" });
  }

  handleDocumentKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (readOpenState(this)) {
      this.close({ trigger: "escape-key" });
    }
  }

  sync(open) {
    const appRoot = queryElement(this.context.document, this.contract.appRootSelector);
    const overlay = queryElement(this.context.document, this.contract.overlaySelector);
    const sidebar = queryElement(this.context.document, this.contract.sidebarSelector);
    const trigger = queryElement(this.context.document, this.contract.triggerSelector);

    syncOpenState(appRoot, open, this.contract.openClass);
    if (isElement(appRoot)) {
      appRoot.dataset.mcNavOpen = open ? "true" : "false";
    }

    syncOpenState(sidebar, open, this.contract.openClass);
    syncOpenState(overlay, open, this.contract.overlayOpenClass);
    syncHiddenState(overlay, open);
    syncExpandedState(trigger, open);
  }
}
