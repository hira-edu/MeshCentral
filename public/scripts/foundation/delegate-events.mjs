function getEventTargetElement(event) {
  if (event.target instanceof Element) {
    return event.target;
  }

  if (event.target && event.target.parentElement instanceof Element) {
    return event.target.parentElement;
  }

  return null;
}

function rootContains(root, element) {
  if (root instanceof Document) {
    return root.documentElement.contains(element);
  }

  if (root instanceof Element) {
    return root.contains(element);
  }

  return false;
}

export function delegateEvents(root, definitions, sharedContext = {}) {
  if (!(root instanceof EventTarget)) {
    throw new TypeError("delegateEvents expects an EventTarget root.");
  }

  if (!Array.isArray(definitions)) {
    throw new TypeError("delegateEvents expects an array of definitions.");
  }

  const listenersByType = new Map();

  for (const definition of definitions) {
    if (!definition || !definition.type || !definition.selector || typeof definition.handler !== "function") {
      throw new TypeError("Each delegated event definition requires type, selector, and handler.");
    }

    const bucket = listenersByType.get(definition.type) || [];
    bucket.push(definition);
    listenersByType.set(definition.type, bucket);
  }

  const teardowns = [];

  for (const [type, bucket] of listenersByType.entries()) {
    const listener = (event) => {
      const origin = getEventTargetElement(event);
      if (!origin) {
        return;
      }

      for (const definition of bucket) {
        const match = origin.closest(definition.selector);
        if (!match || !rootContains(root, match)) {
          continue;
        }

        if ((typeof definition.guard === "function") && !definition.guard({ event, match, root, sharedContext })) {
          continue;
        }

        if (definition.preventDefault === true) {
          event.preventDefault();
        }

        if (definition.stopPropagation === true) {
          event.stopPropagation();
        }

        definition.handler({ event, match, root, sharedContext });
        return;
      }
    };

    root.addEventListener(type, listener);
    teardowns.push(() => root.removeEventListener(type, listener));
  }

  return () => {
    while (teardowns.length > 0) {
      const teardown = teardowns.pop();
      teardown();
    }
  };
}
