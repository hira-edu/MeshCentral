import { PanelController } from "./panel-controller.mjs";

const defaultUserMenuContract = Object.freeze({
  actionSelector: "[data-mc-user-menu-action]",
  menuOpenClass: "is-open",
  menuSelector: "[data-mc-user-menu-panel]",
  submenuChevronOpenClass: "is-open",
  submenuChevronSelector: "[data-mc-user-menu-submenu-chevron]",
  submenuOpenClass: "is-open",
  submenuSelector: "[data-mc-user-menu-submenu]",
  submenuTriggerSelector: "[data-mc-user-menu-submenu-trigger]",
  triggerOpenClass: "is-active",
  triggerSelector: "[data-mc-user-menu-trigger]",
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

function readOpenState(controller, selector, statePath) {
  if (controller.context.state) {
    return Boolean(controller.context.state.get(statePath));
  }

  const element = queryElement(controller.context.document, selector);
  return Boolean(element && !element.hidden);
}

export class UserMenuController extends PanelController {
  get contract() {
    const shellContract = this.context.shellContract && this.context.shellContract.disclosures;
    return {
      ...defaultUserMenuContract,
      ...(shellContract && shellContract.userMenu),
      ...(this.context.userMenuContract || {}),
    };
  }

  onMount() {
    this.delegate([
      {
        type: "click",
        selector: this.contract.triggerSelector,
        preventDefault: true,
        handler: ({ event }) => this.toggleMenu({ event, source: "user-menu" }),
      },
      {
        type: "keydown",
        selector: this.contract.triggerSelector,
        handler: ({ event }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.toggleMenu({ event, source: "user-menu" });
        },
      },
      {
        type: "click",
        selector: this.contract.submenuTriggerSelector,
        preventDefault: true,
        handler: ({ event }) => this.toggleSubmenu({ event, source: "user-menu" }),
      },
      {
        type: "keydown",
        selector: this.contract.submenuTriggerSelector,
        handler: ({ event }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.toggleSubmenu({ event, source: "user-menu" });
        },
      },
      {
        type: "click",
        selector: this.contract.actionSelector,
        preventDefault: true,
        handler: ({ match, event }) => this.handleAction(match, event),
      },
      {
        type: "keydown",
        selector: this.contract.actionSelector,
        handler: ({ match, event }) => {
          if ((event.key !== "Enter") && (event.key !== " ")) {
            return;
          }
          event.preventDefault();
          this.handleAction(match, event);
        },
      },
    ]);

    if (this.context.document) {
      this.listen(this.context.document, "click", (event) => this.handleDocumentClick(event));
      this.listen(this.context.document, "keydown", (event) => this.handleDocumentKeydown(event));
    }

    if (!this.context.state) {
      this.sync({ menuOpen: false, submenuOpen: false });
      return;
    }

    this.track(this.context.state.subscribe((snapshot, previousState, meta) => {
      if ((meta && meta.source) === "user-menu") {
        return;
      }

      const menuOpen = Boolean(snapshot.shell && snapshot.shell.userMenuOpen);
      const submenuOpen = menuOpen && Boolean(snapshot.shell && snapshot.shell.uiSubmenuOpen);
      if (!menuOpen && snapshot.shell && snapshot.shell.uiSubmenuOpen) {
        this.closeSubmenu({ trigger: "menu-closed" });
      } else {
        this.sync({ menuOpen, submenuOpen });
      }
    }, { immediate: true }));
  }

  openMenu(meta = {}) {
    this.setState({
      shell: {
        userMenuOpen: true,
      },
    }, {
      ...meta,
      source: "user-menu",
    });
    this.sync({ menuOpen: true, submenuOpen: false });
  }

  closeMenu(meta = {}) {
    this.setState({
      shell: {
        uiSubmenuOpen: false,
        userMenuOpen: false,
      },
    }, {
      ...meta,
      source: "user-menu",
    });
    this.sync({ menuOpen: false, submenuOpen: false });
  }

  toggleMenu(meta = {}) {
    const nextOpenState = !readOpenState(this, this.contract.menuSelector, "shell.userMenuOpen");
    if (nextOpenState) {
      this.openMenu(meta);
      return;
    }

    this.closeMenu(meta);
  }

  openSubmenu(meta = {}) {
    this.setState({
      shell: {
        uiSubmenuOpen: true,
        userMenuOpen: true,
      },
    }, {
      ...meta,
      source: "user-menu",
    });
    this.sync({ menuOpen: true, submenuOpen: true });
  }

  closeSubmenu(meta = {}) {
    this.setState({
      shell: {
        uiSubmenuOpen: false,
      },
    }, {
      ...meta,
      source: "user-menu",
    });
    this.sync({
      menuOpen: readOpenState(this, this.contract.menuSelector, "shell.userMenuOpen"),
      submenuOpen: false,
    });
  }

  toggleSubmenu(meta = {}) {
    const nextOpenState = !readOpenState(this, this.contract.submenuSelector, "shell.uiSubmenuOpen");
    if (nextOpenState) {
      this.openSubmenu(meta);
      return;
    }

    this.closeSubmenu(meta);
  }

  handleAction(match, event) {
    const action = match.dataset.mcUserMenuAction || match.dataset.action || null;
    if (!action) {
      return;
    }

    this.closeMenu({ action, trigger: "menu-action" });
    const payload = {
      action,
      event,
      match,
    };
    const actionHandler = this.context.userMenuActions && this.context.userMenuActions[action];

    if (typeof actionHandler === "function") {
      actionHandler(payload);
    }
    if (typeof this.context.handleUserMenuAction === "function") {
      this.context.handleUserMenuAction(payload);
    }
  }

  handleDocumentClick(event) {
    if (!this.context.state || !this.context.state.get("shell.userMenuOpen")) {
      return;
    }

    const trigger = queryElement(this.context.document, this.contract.triggerSelector);
    const menu = queryElement(this.context.document, this.contract.menuSelector);
    const target = event.target;
    if (containsTarget(trigger, target) || containsTarget(menu, target)) {
      return;
    }

    this.closeMenu({ trigger: "outside-click" });
  }

  handleDocumentKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (this.context.state && this.context.state.get("shell.uiSubmenuOpen")) {
      this.closeSubmenu({ trigger: "escape-key" });
      return;
    }

    if (this.context.state && this.context.state.get("shell.userMenuOpen")) {
      this.closeMenu({ trigger: "escape-key" });
    }
  }

  sync(state) {
    const menuOpen = Boolean(state && state.menuOpen);
    const submenuOpen = menuOpen && Boolean(state && state.submenuOpen);
    const trigger = queryElement(this.context.document, this.contract.triggerSelector);
    const menu = queryElement(this.context.document, this.contract.menuSelector);
    const submenuTrigger = queryElement(this.context.document, this.contract.submenuTriggerSelector);
    const submenu = queryElement(this.context.document, this.contract.submenuSelector);
    const submenuChevron = queryElement(this.context.document, this.contract.submenuChevronSelector);

    syncOpenState(trigger, menuOpen, this.contract.triggerOpenClass);
    syncExpandedState(trigger, menuOpen);
    syncOpenState(menu, menuOpen, this.contract.menuOpenClass);
    syncHiddenState(menu, menuOpen);

    syncOpenState(submenuTrigger, submenuOpen, this.contract.triggerOpenClass);
    syncExpandedState(submenuTrigger, submenuOpen);
    syncOpenState(submenu, submenuOpen, this.contract.submenuOpenClass);
    syncHiddenState(submenu, submenuOpen);
    syncOpenState(submenuChevron, submenuOpen, this.contract.submenuChevronOpenClass);
  }
}
