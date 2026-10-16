// In-memory stand-in for the extension `api` used by the background tests.
// Only the calls the background makes are implemented; each records enough
// state for a test to assert on.

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
    hasListener: (fn) => listeners.includes(fn),
    fire: (...args) => listeners.map((fn) => fn(...args)),
  };
}

function storageArea(areaName, onChanged) {
  const data = new Map();
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    data,
    async get(keys) {
      if (keys == null) return Object.fromEntries([...data].map(([k, v]) => [k, copy(v)]));
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) {
        if (data.has(k)) out[k] = copy(data.get(k));
        else if (keys && typeof keys === "object" && !Array.isArray(keys)) out[k] = keys[k];
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: copy(data.get(k)), newValue: copy(v) };
        data.set(k, copy(v));
      }
      onChanged.fire(changes, areaName);
    },
    async remove(keys) {
      const changes = {};
      for (const k of typeof keys === "string" ? [keys] : keys) {
        if (!data.has(k)) continue;
        changes[k] = { oldValue: copy(data.get(k)) };
        data.delete(k);
      }
      if (Object.keys(changes).length) onChanged.fire(changes, areaName);
    },
  };
}

export function makeFakeApi({ id = "ext-id", origin = "chrome-extension://ext-id/" } = {}) {
  const onChanged = event();
  const calls = { tabsUpdate: [], tabsCreate: [], tabsSendMessage: [], badgeText: [], badgeColor: [] };
  let dynamicRules = [];
  const alarms = new Map();
  return {
    calls,
    runtime: {
      id,
      getURL: (path) => origin + path.replace(/^\//, ""),
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
    },
    storage: {
      onChanged,
      local: storageArea("local", onChanged),
      session: storageArea("session", onChanged),
      sync: storageArea("sync", onChanged),
    },
    alarms: {
      onAlarm: event(),
      async create(name, info) {
        alarms.set(name, { name, ...info });
      },
      async get(name) {
        return alarms.get(name);
      },
      all: alarms,
    },
    action: {
      async setBadgeText(details) {
        calls.badgeText.push(details);
      },
      async setBadgeBackgroundColor(details) {
        calls.badgeColor.push(details);
      },
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        return structuredClone(dynamicRules);
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        const ids = new Set(addRules.map((r) => r.id));
        if (ids.size !== addRules.length) throw new Error("duplicate rule id");
        dynamicRules = dynamicRules.filter((r) => !removeRuleIds.includes(r.id));
        for (const r of addRules) {
          if (dynamicRules.some((x) => x.id === r.id)) throw new Error(`rule id ${r.id} already exists`);
        }
        dynamicRules.push(...structuredClone(addRules));
      },
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      async update(tabId, props) {
        calls.tabsUpdate.push({ tabId, ...props });
      },
      async create(props) {
        calls.tabsCreate.push(props);
      },
      async sendMessage(tabId, message, options) {
        calls.tabsSendMessage.push({ tabId, message, options });
      },
    },
  };
}

/** Send a runtime message the way the browser would and await the reply. */
export function sendMessage(api, message, sender) {
  return new Promise((resolve) => {
    let replied = false;
    const sendResponse = (value) => {
      replied = true;
      resolve(value);
    };
    const keepOpen = api.runtime.onMessage.listeners.map((fn) => fn(message, sender, sendResponse)).some((r) => r === true);
    if (!keepOpen && !replied) resolve(undefined);
  });
}
