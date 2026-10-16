// A small in-memory DOM for the UI and content tests. It implements only
// what src/ui and src/content use; anything else throws, so a test fails
// loudly if the code starts relying on something new.

class Node {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    if (n instanceof ShadowRoot) return n.host.isConnected;
    return n === this.ownerDocument;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this.replaceChildren(this.ownerDocument.createTextNode(String(value)));
  }

  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === "string" ? this.ownerDocument.createTextNode(n) : n;
      node.remove?.();
      node.parentNode = this;
      this.childNodes.push(node);
      this.ownerDocument._mutated(this);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
    this.ownerDocument._mutated(this);
  }

  remove() {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
    this.ownerDocument._mutated(p);
  }

  /** Depth-first walk of elements, into open and closed shadow roots. */
  *walk() {
    const kids = this._shadow ? [...this._shadow.childNodes, ...this.childNodes] : this.childNodes;
    for (const c of kids) {
      if (c instanceof Element) yield c;
      yield* c.walk();
    }
  }

  /** Test helper: all elements matching a predicate. */
  findAll(pred) {
    return [...this.walk()].filter(pred);
  }

  find(pred) {
    return this.findAll(pred)[0] ?? null;
  }
}

class Text extends Node {
  constructor(doc, data) {
    super(doc);
    this.data = data;
  }

  get textContent() {
    return this.data;
  }

  *walk() {}
}

class ShadowRoot extends Node {
  constructor(doc, host, mode) {
    super(doc);
    this.host = host;
    this.mode = mode;
  }
}

class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this._shadow = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    if (list.includes(fn)) list.splice(list.indexOf(fn), 1);
  }

  dispatch(type, init = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }

  click() {
    return this.dispatch("click");
  }

  attachShadow({ mode }) {
    if (this._shadow) throw new Error("shadow root already attached");
    this._shadow = new ShadowRoot(this.ownerDocument, this, mode);
    return mode === "open" ? (this.shadowRoot = this._shadow) : this._shadow;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  get innerText() {
    return this.textContent;
  }
}

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.observers = [];
    this.activeElement = null;
    this.documentElement = new Element(this, "html");
    this.documentElement.parentNode = this;
    this.childNodes.push(this.documentElement);
    this.head = new Element(this, "head");
    this.body = new Element(this, "body");
    this.documentElement.append(this.head, this.body);
  }

  createElement(tag) {
    return new Element(this, tag);
  }

  createTextNode(data) {
    return new Text(this, String(data));
  }

  querySelector(selector) {
    // Only the `meta[property="og:..."]` and tag-name forms are used.
    const meta = /^meta\[property="([^"]+)"\]$/.exec(selector);
    if (meta) return this.find((e) => e.tagName === "META" && e.getAttribute("property") === meta[1]);
    if (/^[a-z0-9]+$/i.test(selector)) return this.find((e) => e.tagName === selector.toUpperCase());
    throw new Error(`fake dom: unsupported selector ${selector}`);
  }

  _mutated(target) {
    for (const o of this.observers) o._notify(target);
  }
}

/**
 * A browser-like window: document, location, history, timers driven by a
 * fake clock, and a MutationObserver that records into the clock's queue.
 */
export function makeFakeWindow({ href = "https://page.example/", top = null } = {}) {
  const document = new Document();
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  class MutationObserver {
    constructor(fn) {
      this.fn = fn;
      this.target = null;
    }

    observe(target) {
      this.target = target;
      document.observers.push(this);
    }

    disconnect() {
      const i = document.observers.indexOf(this);
      if (i >= 0) document.observers.splice(i, 1);
    }

    _notify(target) {
      // Delivered synchronously; real observers batch, which the code under
      // test must already tolerate.
      let n = target;
      while (n && n !== this.target) n = n.parentNode ?? (n.host ?? null);
      if (n === this.target || target === document) this.fn([{ target }], this);
    }
  }

  const win = {
    document,
    location: {
      href,
      replace(url) {
        win.location.href = url;
        win.replaced.push(url);
      },
    },
    replaced: [],
    history: {
      length: 1,
      back() {
        win.wentBack = (win.wentBack ?? 0) + 1;
      },
    },
    MutationObserver,
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!win.listeners.has(type)) win.listeners.set(type, []);
      win.listeners.get(type).push(fn);
    },
    removeEventListener() {},
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms, every: ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    now: () => now,
    /** Advance the clock, running due timers in order. Awaits between timers. */
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        t.fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
  win.top = top ?? win;
  win.self = win;
  return win;
}

/** Let pending promise callbacks run. */
export async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

/** Append a paragraph of text to the page body. */
export function addText(win, text) {
  const p = win.document.createElement("p");
  p.append(text);
  win.document.body.append(p);
  return p;
}
