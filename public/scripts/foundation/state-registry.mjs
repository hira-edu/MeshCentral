function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    const copy = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      copy[key] = cloneValue(nestedValue);
    }
    return copy;
  }

  return value;
}

function mergeState(base, patch) {
  const left = isPlainObject(base) ? cloneValue(base) : {};
  const right = isPlainObject(patch) ? patch : {};

  for (const [key, value] of Object.entries(right)) {
    if (isPlainObject(value) && isPlainObject(left[key])) {
      left[key] = mergeState(left[key], value);
    } else {
      left[key] = cloneValue(value);
    }
  }

  return left;
}

function readPath(source, path, fallbackValue) {
  if (!path) {
    return source;
  }

  const segments = Array.isArray(path) ? path : String(path).split(".");
  let cursor = source;

  for (const segment of segments) {
    if ((cursor == null) || !(segment in cursor)) {
      return fallbackValue;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

export class StateRegistry {
  constructor(initialState = {}) {
    this._state = cloneValue(initialState);
    this._listeners = new Set();
  }

  snapshot() {
    return cloneValue(this._state);
  }

  get(path, fallbackValue = undefined) {
    return readPath(this._state, path, fallbackValue);
  }

  set(patch, meta = {}) {
    const resolvedPatch = (typeof patch === "function") ? patch(this.snapshot()) : patch;
    const nextState = mergeState(this._state, resolvedPatch);
    this._commit(nextState, meta);
    return this.snapshot();
  }

  replace(nextState, meta = {}) {
    this._commit(cloneValue(nextState), meta);
    return this.snapshot();
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      throw new TypeError("StateRegistry.subscribe expects a function listener.");
    }

    this._listeners.add(listener);

    if (options.immediate === true) {
      listener(this.snapshot(), null, { source: "subscribe" });
    }

    return () => {
      this._listeners.delete(listener);
    };
  }

  _commit(nextState, meta) {
    const previousState = this.snapshot();
    this._state = cloneValue(nextState);

    for (const listener of this._listeners) {
      listener(this.snapshot(), previousState, meta);
    }
  }
}
