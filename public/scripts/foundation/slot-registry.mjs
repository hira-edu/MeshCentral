function isElement(value) {
  return (typeof Element !== "undefined") && (value instanceof Element);
}

function resolveScopeRoot(root, documentRef) {
  if (isElement(root)) {
    return root;
  }

  if (documentRef && isElement(documentRef.documentElement)) {
    return documentRef.documentElement;
  }

  return null;
}

function collectSlotElements(root) {
  const slots = new Map();
  if (!isElement(root)) {
    return slots;
  }

  if (root.dataset && root.dataset.mcSlot) {
    slots.set(root.dataset.mcSlot, root);
  }

  if (typeof root.querySelectorAll !== "function") {
    return slots;
  }

  const matches = root.querySelectorAll("[data-mc-slot]");
  for (const element of matches) {
    if (isElement(element) && element.dataset && element.dataset.mcSlot) {
      slots.set(element.dataset.mcSlot, element);
    }
  }

  return slots;
}

function normalizeLifecycleResult(result) {
  if (typeof result === "function") {
    return { cleanup: result, update: null };
  }

  if (result && typeof result === "object") {
    return {
      cleanup: (typeof result.cleanup === "function") ? result.cleanup : null,
      update: (typeof result.update === "function") ? result.update : null,
    };
  }

  return { cleanup: null, update: null };
}

export class SlotRegistry {
  constructor(options = {}) {
    this.document = options.document || globalThis.document || null;
    this.root = options.root || null;
    this.extensions = new Map();
    this.records = new Map();
  }

  register(extension) {
    if (!extension || !extension.id || !extension.slot || typeof extension.mount !== "function") {
      throw new TypeError("SlotRegistry.register requires id, slot, and mount.");
    }

    if (this.extensions.has(extension.id)) {
      throw new Error(`SlotRegistry extension "${extension.id}" is already registered.`);
    }

    this.extensions.set(extension.id, Object.freeze({ ...extension }));
    return () => this.unregister(extension.id);
  }

  unregister(extensionId, reason = "unregister") {
    this.extensions.delete(extensionId);
    this._teardown(extensionId, reason);
  }

  sync(context = {}) {
    const documentRef = context.document || this.document;
    const scopeRoot = resolveScopeRoot(context.root || this.root, documentRef);
    const slotElements = collectSlotElements(scopeRoot);
    const activeExtensions = new Set();

    for (const extension of this.extensions.values()) {
      activeExtensions.add(extension.id);
      const slotElement = slotElements.get(extension.slot) || null;
      const existingRecord = this.records.get(extension.id) || null;

      if (!slotElement) {
        this._teardown(extension.id, "missing-slot");
        continue;
      }

      if (existingRecord && existingRecord.slotElement !== slotElement) {
        this._teardown(extension.id, "slot-moved");
      }

      const record = this.records.get(extension.id);
      const payload = this._buildPayload(extension, slotElement, context);

      if (record) {
        if (typeof record.update === "function") {
          record.update(payload);
        }
        continue;
      }

      this._mount(extension, slotElement, payload);
    }

    for (const extensionId of Array.from(this.records.keys())) {
      if (!activeExtensions.has(extensionId)) {
        this._teardown(extensionId, "removed");
      }
    }
  }

  destroy(reason = "destroy") {
    for (const extensionId of Array.from(this.records.keys())) {
      this._teardown(extensionId, reason);
    }
  }

  _buildPayload(extension, slotElement, context) {
    const record = this.records.get(extension.id) || null;
    return {
      container: record ? record.container : null,
      context,
      extension,
      permissionSummary: context.permissionSummary || null,
      selection: context.selection || null,
      shell: context.shell || null,
      slot: extension.slot,
      slotElement,
      surfaceId: context.surfaceId || null,
      workspace: context.workspace || null,
    };
  }

  _mount(extension, slotElement, payload) {
    if (!this.document || typeof this.document.createElement !== "function") {
      throw new Error("SlotRegistry requires a document with createElement().");
    }

    const container = this.document.createElement("div");
    container.dataset.mcExtensionId = extension.id;
    container.dataset.mcExtensionSlot = extension.slot;
    slotElement.appendChild(container);

    const lifecycle = normalizeLifecycleResult(extension.mount({
      ...payload,
      container,
    }));

    this.records.set(extension.id, {
      cleanup: lifecycle.cleanup,
      container,
      slot: extension.slot,
      slotElement,
      update: lifecycle.update,
    });
  }

  _teardown(extensionId, reason) {
    const record = this.records.get(extensionId);
    if (!record) {
      return;
    }

    if (typeof record.cleanup === "function") {
      record.cleanup({ reason });
    }

    if (
      isElement(record.slotElement) &&
      isElement(record.container) &&
      typeof record.slotElement.removeChild === "function" &&
      record.slotElement.contains(record.container)
    ) {
      record.slotElement.removeChild(record.container);
    }

    this.records.delete(extensionId);
  }
}
