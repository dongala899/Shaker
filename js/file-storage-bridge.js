(function fileStorageBridge(global) {
  const STORAGE_URL = "/__shaker__/storage";
  const MANIFEST_KEY = "__shaker_file_storage_manifest__";
  let bridgeEnabled = false;
  let patchApplied = false;
  let internalWrite = false;

  function parseJsonSafely(text, fallback = null) {
    try {
      return JSON.parse(String(text || ""));
    } catch (error) {
      return fallback;
    }
  }

  function readManifest() {
    const raw = global.localStorage.getItem(MANIFEST_KEY);
    const parsed = parseJsonSafely(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeManifest(keys) {
    global.localStorage.setItem(MANIFEST_KEY, JSON.stringify(keys));
  }

  function applySnapshot(snapshot) {
    const storage = snapshot && typeof snapshot === "object" ? snapshot : {};
    const keys = Object.keys(storage);
    const previousKeys = readManifest();

    internalWrite = true;
    try {
      previousKeys.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(storage, key)) {
          global.localStorage.removeItem(key);
        }
      });

      keys.forEach((key) => {
        global.localStorage.setItem(key, String(storage[key] ?? ""));
      });

      writeManifest(keys);
    } finally {
      internalWrite = false;
    }
  }

  function buildSnapshot() {
    const snapshot = {};
    for (let index = 0; index < global.localStorage.length; index += 1) {
      const key = global.localStorage.key(index);
      if (!key || key === MANIFEST_KEY) continue;
      snapshot[key] = global.localStorage.getItem(key);
    }
    return snapshot;
  }

  function request(method, payload) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, STORAGE_URL, false);
    xhr.setRequestHeader("Cache-Control", "no-store");
    if (method !== "GET") {
      xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    }
    xhr.send(payload ? JSON.stringify(payload) : null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`Storage request failed with ${xhr.status}`);
    }
    return parseJsonSafely(xhr.responseText, null);
  }

  function persistSnapshot() {
    if (!bridgeEnabled || internalWrite) return;
    try {
      request("POST", { storage: buildSnapshot() });
    } catch (error) {
      bridgeEnabled = false;
    }
  }

  function patchStorageMethods() {
    if (patchApplied || !global.Storage || !global.localStorage) return;

    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;

    Storage.prototype.setItem = function patchedSetItem(key, value) {
      const result = originalSetItem.call(this, key, value);
      if (this === global.localStorage && key !== MANIFEST_KEY) {
        persistSnapshot();
      }
      return result;
    };

    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      const result = originalRemoveItem.call(this, key);
      if (this === global.localStorage && key !== MANIFEST_KEY) {
        persistSnapshot();
      }
      return result;
    };

    Storage.prototype.clear = function patchedClear() {
      const result = originalClear.call(this);
      if (this === global.localStorage) {
        persistSnapshot();
      }
      return result;
    };

    patchApplied = true;
  }

  function initialize() {
    if (!global.localStorage) return;

    try {
      const response = request("GET");
      if (!response || response.ok !== true || response.fileBacked !== true) {
        return;
      }

      applySnapshot(response.storage);
      bridgeEnabled = true;
      patchStorageMethods();

      if (Object.keys(response.storage || {}).length === 0 && global.localStorage.length > 0) {
        persistSnapshot();
      }
    } catch (error) {
      bridgeEnabled = false;
    }
  }

  initialize();

  global.ShakerFileStorage = {
    isFileBacked() {
      return bridgeEnabled;
    },
    persistNow() {
      persistSnapshot();
    }
  };
})(window);
