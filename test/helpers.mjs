// Loads the extension's classic scripts into a jsdom window with a fake chrome API.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const root = new URL('../extension/src/', import.meta.url);
const SCRIPTS = [
  'shared/schema.js',
  'shared/results.js',
  'content/classifier.js',
  'content/dom.js',
  'content/autofill.js',
  'content/navigate.js',
  'content/job.js',
  'content/account.js',
];

export function loadPure() {
  const g = {};
  for (const f of ['shared/schema.js', 'content/classifier.js', 'options/resume-parse.js', 'tailor/resume-model.js']) {
    new Function('globalThis', readFileSync(new URL(f, root), 'utf8'))(g);
  }
  return g.JOBU;
}

// pageScripts: also run the fixture's own <script> tags (for multi-step demos).
export function loadPage(html, { storage = {}, url = 'https://boards.greenhouse.io/acme/jobs/1', pageScripts = false } = {}) {
  const dom = new JSDOM(html, { url, runScripts: pageScripts ? 'dangerously' : 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom has no layout: treat every element as visible unless hidden or display:none.
  w.Element.prototype.getBoundingClientRect = function () {
    return this.closest('[hidden], [style*="display: none"], [style*="display:none"]') ? { width: 0, height: 0 } : { width: 100, height: 20 };
  };
  const HIDDEN = '[hidden], script, style, [style*="display: none"], [style*="display:none"]';
  // jsdom has no innerText; approximate it as the text that isn't hidden.
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      const walker = w.document.createTreeWalker(this, w.NodeFilter.SHOW_TEXT);
      let out = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement.closest(HIDDEN)) out += n.data;
      return out;
    },
  });
  w.Element.prototype.scrollIntoView = () => {};
  w.PointerEvent ??= w.MouseEvent;
  w.DragEvent ??= class extends w.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer || null;
    }
  };
  w.DataTransfer = class {
    constructor() {
      this.list = [];
      this.items = { add: (f) => this.list.push(f) };
    }
    get files() {
      return this.list;
    }
  };
  // jsdom refuses plain arrays for input.files; keep them on the element instead.
  Object.defineProperty(w.HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() {
      return this._files || [];
    },
    set(v) {
      this._files = v;
    },
  });
  const store = { ...storage };
  w.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (obj) => Object.assign(store, structuredClone(obj)),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
      },
    },
  };
  for (const f of SCRIPTS) w.eval(readFileSync(new URL(f, root), 'utf8'));
  return { window: w, document: w.document, J: w.JOBU, store };
}

// Runs background.js in a sandbox for a one-tab, one-frame page from
// loadPage(). chrome.scripting re-creates injected functions inside the page
// from their source, as Chrome does, so `globalThis.JOBU` resolves there.
// Results the service worker pushes to the page panel land in `reported`.
export function loadBackground(page) {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const session = {};
  const reported = [];
  const created = []; // tabs the service worker opened
  page.J.reportResult = (r) => reported.push(r);
  page.J.showProgress = () => {};
  page.J.askSubmit = () => reported.push({ asked: true });

  const chrome = {
    runtime: { onInstalled: event('installed'), onMessage: event('message'), openOptionsPage() {}, getURL: (p) => `chrome-extension://jobu/${p}` },
    contextMenus: { create() {}, removeAll: (cb) => cb?.(), onClicked: event('menu') },
    commands: { onCommand: event('command') },
    action: { setBadgeBackgroundColor() {}, setBadgeText() {}, setTitle() {} },
    tabs: {
      get: async (id) => ({ id, status: 'complete', url: page.window.location.href }),
      sendMessage: async () => {},
      create: async (props) => (created.push(props), { id: 99, ...props }),
      onRemoved: event('removed'),
    },
    storage: {
      local: page.window.chrome.storage.local,
      session: {
        get: async (k) => (k in session ? { [k]: session[k] } : {}),
        set: async (o) => Object.assign(session, o),
        remove: async (k) => delete session[k],
      },
    },
    scripting: {
      async executeScript({ func, args = [], files }) {
        if (files) return [];
        const result = await page.window.eval(`(${func})`)(...structuredClone(args));
        return [{ frameId: 0, result: result === undefined ? undefined : JSON.parse(JSON.stringify(result)) }];
      },
    },
  };
  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, crypto, TextEncoder, TextDecoder, btoa, atob, structuredClone });
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx));
  vm.runInContext(readFileSync(new URL('background.js', root), 'utf8'), ctx);

  // Replies are cloned into this realm, as Chrome's messaging would. The
  // sender is the page's tab unless given (another tab: an extension page).
  const call = (msg, sender = { tab: { id: 1 } }) =>
    new Promise((resolve) => listeners.message(msg, sender, (r) => resolve(structuredClone(r))));
  // Resolves with the next result the service worker reports to the page.
  const nextReport = () =>
    new Promise((resolve) => {
      const n = reported.length;
      const t = setInterval(() => reported.length > n && (clearInterval(t), resolve(structuredClone(reported[n]))), 20);
    });
  const run = (code) => vm.runInContext(code, ctx);
  const installed = (details) => listeners.installed(details);
  return { call, nextReport, reported, session, created, run, installed };
}

export const PROFILE = {
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '555-010-2000',
  address: { line1: '1 Analytical Way', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'United States' },
  links: { linkedin: 'https://linkedin.com/in/ada', github: 'https://github.com/ada', portfolio: 'https://ada.dev' },
  work: { currentTitle: 'Senior Engineer', currentCompany: 'Engines Ltd', yearsExperience: '8' },
  education: { school: 'University of London', degree: "Bachelor's", major: 'Mathematics' },
  authorization: { workAuthorized: 'Yes', requireSponsorship: 'No', over18: 'Yes' },
  preferences: { willingToRelocate: 'No', salary: '$180,000', startDate: '2 weeks' },
  howHeard: 'LinkedIn',
  eeo: { gender: 'Female', hispanic: 'Decline to self-identify', race: 'Decline to self-identify', veteran: 'I am not a protected veteran', disability: 'Decline to self-identify' },
  customAnswers: [{ q: 'Why do you want to work at Acme?', a: 'Because Acme builds engines.' }],
};

export const RESUME = { name: 'ada.pdf', type: 'application/pdf', size: 4, dataUrl: 'data:application/pdf;base64,JVBERg==' };
