// Service worker: coordinates autofill, page scans and step navigation across
// all frames of a tab, keeps the job tracker, and wires up the context menu
// and keyboard shortcuts. Firefox runs it as a background script instead,
// after the files manifest.json lists before it, so there's no importScripts.
// Phones have no context menu or shortcuts for extensions (Firefox for
// Android, Safari on iOS); those APIs are missing there.
if (typeof importScripts === 'function') importScripts('shared/schema.js', 'shared/vault.js');
const J = globalThis.JOBU;

const CONTENT_FILES = [
  'src/shared/schema.js',
  'src/shared/results.js',
  'src/content/classifier.js',
  'src/content/dom.js',
  'src/content/autofill.js',
  'src/content/navigate.js',
  'src/content/job.js',
  'src/content/account.js',
  'src/content/ui.js',
  'src/content/main.js',
];

// How long to wait for a click to take effect (ms).
const WAIT = { poll: 400, stuck: 6000, timeout: 15000, settle: 2500 };
const MAX_PAGES = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MENU = {
  'jobu-autofill': 'Autofill application with Jobu',
  'jobu-next': 'Go to the next page of the application',
  'jobu-submit': 'Submit application…',
  'jobu-save': 'Save job to Jobu tracker',
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus?.removeAll(() => {
    for (const [id, title] of Object.entries(MENU)) chrome.contextMenus.create({ id, title, contexts: ['page', 'editable', 'frame'] });
  });
  if (reason === 'install') J.openProfile();
  // Claude now runs through Claude Code (shared/claude-code.mjs), so an API
  // key saved by an earlier version isn't needed any more.
  if (reason === 'update') chrome.storage.local.remove('anthropicKey');
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`job:${tabId}`));

// Runs a function in frames of the tab (all of them by default), injecting
// Jobu first into frames that loaded before the extension was installed or
// updated.
async function runInFrames(tabId, func, frameIds, args = []) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  const probe = await chrome.scripting.executeScript({ target, func: () => !!globalThis.JOBU?.started });
  const missing = probe.filter((r) => !r.result).map((r) => r.frameId);
  if (missing.length) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: missing }, files: CONTENT_FILES }).catch(() => {});
  }
  return chrome.scripting.executeScript({ target, func, args });
}

// Frames holding the application form, or every frame when none looks like one.
async function appFrames(tabId) {
  const probe = await runInFrames(tabId, () => globalThis.JOBU.looksLikeApplication());
  const app = probe.filter((r) => r.result).map((r) => r.frameId);
  return app.length ? app : probe.map((r) => r.frameId);
}

// Shows a result in the page's panel or a toast. Actions that can move the
// tab to a new page report here, because the panel that started them may be gone.
const notifyTop = (tabId, result) =>
  runInFrames(tabId, (r) => globalThis.JOBU.reportResult(r), [0], [result]).catch(() => {});

const progress = (tabId, text) =>
  runInFrames(tabId, (t) => globalThis.JOBU.showProgress(t), [0], [text]).catch(() => {});

async function report(tabId, work) {
  const result = await work.catch((e) => ({ error: e.message }));
  notifyTop(tabId, result);
  return result;
}

async function autofillTab(tabId) {
  const { profile } = await J.store.load();
  if (!profile.firstName || !profile.email) {
    J.openProfile();
    return { action: 'autofill', needsProfile: true };
  }
  try {
    const results = await runInFrames(tabId, () => globalThis.JOBU.autofill(), await appFrames(tabId));
    const total = { action: 'autofill', filled: 0, attention: 0, empty: 0, prefilled: 0, total: 0 };
    for (const { result } of results) {
      if (!result) continue;
      for (const k of ['filled', 'attention', 'empty', 'prefilled', 'total']) total[k] += result[k] || 0;
    }
    return total;
  } catch (e) {
    return { action: 'autofill', error: `Jobu can't run on this page (${e.message}).` };
  }
}

// Every field in the tab's application frames with its status, plus the
// best Next and Submit buttons across frames.
async function scanTab(tabId) {
  const results = (await runInFrames(tabId, () => globalThis.JOBU.scanPage())).filter((r) => r.result);
  const app = results.filter((r) => r.result.isApplication);
  const scan = { isApplication: app.length > 0, fields: [], errors: [], nav: { next: null, submit: null }, step: null };
  for (const { frameId, result: r } of app) {
    scan.fields.push(...r.fields.map((f) => ({ ...f, frameId })));
    scan.errors.push(...r.errors);
    scan.step ||= r.step;
  }
  // A job posting without a form still has an Apply button worth finding.
  for (const { frameId, result: r } of app.length ? app : results) {
    for (const kind of ['next', 'submit']) {
      const b = r.nav[kind];
      if (b && (!scan.nav[kind] || b.score > scan.nav[kind].score)) scan.nav[kind] = { ...b, frameId };
    }
  }
  // A sign-in or create-account form, wherever it is (often not an "application").
  const account = results.find((r) => r.result.account);
  if (account) {
    scan.account = { ...account.result.account, frameId: account.frameId, vault: await J.vault.status() };
    scan.account.saved = (await J.vault.index()).filter((e) => e.site === scan.account.site).map((e) => e.username);
  }
  scan.counts = { total: scan.fields.length };
  for (const s of ['filled', 'ready', 'missing', 'skipped']) scan.counts[s] = scan.fields.filter((f) => f.status === s).length;
  scan.job = brief(await jobForTab(tabId));
  scan.resumes = await resumeChoices(scan.job);
  return scan;
}

// ---- Job-site passwords ----

// op: create (make a password, fill it in, save it) | fill (the saved one) |
// save (what the user typed). The site is always the host of the frame that
// holds the form, so a password is only ever filled into its own site.
async function accountPassword(tabId, frameId, op) {
  const vault = await J.vault.status();
  if (vault !== 'unlocked') return { action: 'password', op, vault };
  const run = (func, args = []) => runInFrames(tabId, func, [frameId], args).then(([r]) => r.result);
  const form = await run(() => globalThis.JOBU.accountForm());
  if (!form) return { action: 'password', op, noForm: true };
  const label = (await jobForTab(tabId))?.company || '';
  if (op === 'create') {
    const { profile } = await J.store.load();
    const password = J.vault.generate();
    const filled = await run((a) => globalThis.JOBU.fillAccount(a), [{ username: form.username || profile.email, password }]);
    await J.vault.save({ site: form.site, username: filled.username, password, label });
    return { action: 'password', op, done: true, site: form.site, username: filled.username };
  }
  if (op === 'fill') {
    const entry = await J.vault.find(form.site, form.username);
    if (!entry) return { action: 'password', op, none: true, site: form.site, username: form.username };
    await run((a) => globalThis.JOBU.fillAccount(a), [{ username: entry.username, password: entry.password }]);
    return { action: 'password', op, done: true, site: form.site, username: entry.username };
  }
  const typed = await run(() => globalThis.JOBU.typedAccount());
  if (!typed) return { action: 'password', op, noForm: true };
  await J.vault.save({ ...typed, label });
  return { action: 'password', op, done: true, site: typed.site, username: typed.username };
}

// ---- Resumes ----

const isForJob = (t, job) => !!job && (t.job.url === job.url || (!!t.job.title && t.job.title === job.title && t.job.company === job.company));

// Resumes the panel offers to attach, the default first: one tailored for
// this job, else the profile's resume. Then a few other tailored ones.
async function resumeChoices(job) {
  const { resume, tailored = [] } = await chrome.storage.local.get(['resume', 'tailored']);
  const label = (t) => `Tailored: ${[t.job.title, t.job.company].filter(Boolean).join(' at ') || t.file.name}`;
  const mine = tailored.filter((t) => isForJob(t, job));
  return [
    ...mine.map((t) => ({ id: t.id, label: label(t) })),
    ...(resume ? [{ id: 'original', label: `My resume (${resume.name})` }] : []),
    ...tailored.filter((t) => !mine.includes(t)).slice(0, 3).map((t) => ({ id: t.id, label: label(t) })),
  ];
}

async function resumeFile(id) {
  const { resume, tailored = [] } = await chrome.storage.local.get(['resume', 'tailored']);
  return id === 'original' ? resume : tailored.find((t) => t.id === id)?.file;
}

// Puts a resume into the application's upload field, in whichever frame has
// the best place for it. No id: the default (see resumeChoices).
async function attachResume(tabId, id) {
  id ||= (await resumeChoices(await jobForTab(tabId)))[0]?.id;
  const file = await resumeFile(id);
  if (!file) return { action: 'attach', needsResume: true };
  const scores = await runInFrames(tabId, () => globalThis.JOBU.resumeTargetScore(), await appFrames(tabId));
  const best = scores.filter((r) => r.result > 0).sort((a, b) => b.result - a.result)[0];
  if (!best) return { action: 'attach', attached: false, name: file.name };
  const [{ result }] = await runInFrames(tabId, (f) => globalThis.JOBU.attachResume(f), [best.frameId], [file]);
  return { action: 'attach', name: file.name, ...result };
}

// Fingerprint of the tab's current step across frames that hold controls.
// Null while the tab is loading or a frame is mid-navigation.
async function pageState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== 'complete') return null;
    const rs = (await runInFrames(tabId, () => globalThis.JOBU.pageState()))
      .filter((r) => r.result && (r.frameId === 0 || r.result.controls))
      .sort((a, b) => a.frameId - b.frameId);
    return {
      sig: [tab.url, ...rs.map((r) => r.result.sig)].join('\n'),
      controls: rs.reduce((n, r) => n + r.result.controls, 0),
      submit: rs.some((r) => r.result.submit),
      errors: rs.reduce((n, r) => n + r.result.errors, 0),
    };
  } catch {
    return null;
  }
}

async function confirmationText(tabId) {
  try {
    return (await runInFrames(tabId, () => globalThis.JOBU.confirmationText())).map((r) => r.result || '').join('\n').trim();
  } catch {
    return '';
  }
}

const clickButton = (tabId, btn) =>
  chrome.scripting
    .executeScript({ target: { tabId, frameIds: [btn.frameId] }, func: (id) => globalThis.JOBU.clickNav(id), args: [btn.id] })
    .catch(() => {}); // the click may navigate the frame away mid-call

// After clicking Next: true once the tab shows a different step (full page
// load or SPA re-render), false if it still shows the same one, which usually
// means the site rejected the step with validation errors.
async function waitForNewPage(tabId, before) {
  const start = Date.now();
  let last = null;
  let lastAt = 0;
  while (Date.now() - start < WAIT.timeout) {
    await sleep(WAIT.poll);
    const s = await pageState(tabId);
    if (!s) {
      last = null;
      continue;
    }
    if (s.sig === before?.sig) {
      if (Date.now() - start > WAIT.stuck) return false;
      last = null;
      continue;
    }
    if (s.sig !== last?.sig) {
      [last, lastAt] = [s, Date.now()];
      continue;
    }
    // Changed and stable. A page with no fields may be a loading overlay, so give it longer.
    if (s.controls || Date.now() - lastAt > WAIT.settle) return true;
  }
  return !!last;
}

// After clicking Submit: 'confirmed' when a thank-you message appears,
// 'left' when the form and its submit button are gone, 'errors' when the
// site flags fields, 'unknown' when nothing visible happens.
async function waitForSubmission(tabId, before, thanksBefore) {
  const start = Date.now();
  let goneSig = null;
  let goneAt = 0;
  while (Date.now() - start < WAIT.timeout) {
    await sleep(WAIT.poll);
    const thanks = await confirmationText(tabId);
    if (thanks && thanks !== thanksBefore) return 'confirmed';
    const s = await pageState(tabId);
    if (!s) continue;
    if (s.sig !== before?.sig && !s.submit) {
      if (s.sig !== goneSig) [goneSig, goneAt] = [s.sig, Date.now()];
      else if (Date.now() - goneAt > WAIT.settle) return 'left';
    } else {
      goneSig = null;
    }
    const newErrors = s.errors > (before?.errors ?? 0) || Date.now() - start > WAIT.stuck;
    if (s.errors && s.sig === before?.sig && newErrors) return 'errors';
  }
  return 'unknown';
}

async function goNext(tabId) {
  const scan = await scanTab(tabId);
  const btn = scan.nav.next;
  if (!btn) {
    const error = scan.nav.submit
      ? `This is the last page. Use Submit (“${scan.nav.submit.label}”).`
      : "Couldn't find a Next or Continue button on this page.";
    return { action: 'next', error };
  }
  if (btn.disabled) return { action: 'next', error: `“${btn.label}” is disabled. Something on this page still needs you.` };
  const before = await pageState(tabId);
  await clickButton(tabId, btn);
  if (!(await waitForNewPage(tabId, before))) return { action: 'next', stuck: true, label: btn.label };
  const { settings } = await J.store.load();
  const fill = settings.autofillOnNext ? await autofillTab(tabId) : null;
  return { action: 'next', advanced: true, label: btn.label, fill: fill?.error || fill?.needsProfile ? null : fill };
}

// Clicks the application's submit button. Refuses while required fields are
// empty unless force is set (the user confirmed in the panel).
async function submitTab(tabId, { force = false } = {}) {
  const scan = await scanTab(tabId);
  const btn = scan.nav.submit;
  if (!btn) {
    const error = scan.nav.next
      ? `This isn't the last page yet. Use Next (“${scan.nav.next.label}”).`
      : "Couldn't find a submit button on this page.";
    return { action: 'submit', error };
  }
  if (btn.disabled) return { action: 'submit', error: `“${btn.label}” is disabled. Something on this page still needs you.` };
  if (scan.counts.missing && !force) return { action: 'submit', blocked: true, missing: scan.counts.missing, label: btn.label };

  const before = await pageState(tabId);
  const thanksBefore = await confirmationText(tabId);
  await clickButton(tabId, btn);
  const outcome = await waitForSubmission(tabId, before, thanksBefore);
  const submitted = outcome === 'confirmed' || outcome === 'left';
  if (submitted) {
    if (scan.job) await saveJob({ ...scan.job, status: 'applied' });
    await chrome.storage.session.remove(`job:${tabId}`);
  }
  return { action: 'submit', label: btn.label, outcome, submitted };
}

// Submit from the shortcut, menu or popup. With confirmation on, the page's
// panel asks first and sends SUBMIT_TAB itself.
async function requestSubmit(tabId) {
  const { settings } = await J.store.load();
  if (!settings.confirmSubmit) return report(tabId, submitTab(tabId));
  await runInFrames(tabId, () => globalThis.JOBU.askSubmit(), [0]);
  return { action: 'submit', asked: true };
}

const flows = new Map(); // tabId → { stop }

// "Fill all pages": autofill, click Next, repeat. Stops on the page with the
// submit button so the user reviews before sending, or earlier when a page
// has required questions Jobu can't answer.
async function applyFlow(tabId) {
  if (flows.has(tabId)) return { action: 'flow', error: 'Jobu is already filling this application.' };
  const flow = { stop: false };
  flows.set(tabId, flow);
  const out = { action: 'flow', pages: 0, filled: 0 };
  try {
    while (out.pages < MAX_PAGES) {
      out.pages++;
      progress(tabId, `Page ${out.pages}: filling…`);
      const fill = await autofillTab(tabId);
      if (fill.error || fill.needsProfile) return { ...out, ...fill, action: 'flow' };
      out.filled += fill.filled;
      const { nav, counts } = await scanTab(tabId);
      if (flow.stop) return { ...out, stopped: 'user' };
      if (nav.submit && !nav.next) return { ...out, stopped: 'submit', missing: counts.missing, label: nav.submit.label };
      if (counts.missing) return { ...out, stopped: 'missing', missing: counts.missing };
      if (!nav.next) return { ...out, stopped: 'no-next' };
      if (nav.next.disabled) return { ...out, stopped: 'disabled', label: nav.next.label };
      progress(tabId, `Page ${out.pages}: clicking “${nav.next.label}”…`);
      const before = await pageState(tabId);
      await clickButton(tabId, nav.next);
      if (!(await waitForNewPage(tabId, before))) return { ...out, stopped: 'stuck', label: nav.next.label };
      if (flow.stop) return { ...out, stopped: 'user' };
    }
    return { ...out, stopped: 'limit' };
  } finally {
    flows.delete(tabId);
  }
}

async function learnTab(tabId) {
  const probe = await runInFrames(tabId, () => globalThis.JOBU.looksLikeApplication());
  const frames = probe.filter((r) => r.result).map((r) => r.frameId);
  let learned = 0;
  for (const frameId of frames) {
    // Sequential: each frame reads and writes the same customAnswers list.
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: () => globalThis.JOBU.learnAnswers() });
    learned += r?.result?.learned || 0;
  }
  return { learned };
}

// The job this tab is applying to. Multi-step flows (Workday, iCIMS) drop the
// posting's details after the first page, so each tab remembers the last
// posting it showed and uses it for later application pages on that site.
// full: make sure the job has a description (for the tailor page).
async function jobForTab(tabId, { full = false } = {}) {
  const key = `job:${tabId}`;
  let page = null;
  try {
    [{ result: page }] = await runInFrames(
      tabId,
      (full) => ({ job: globalThis.JOBU.extractJob({ full }), posting: globalThis.JOBU.isJobPosting(), form: globalThis.JOBU.looksLikeApplication() }),
      [0],
      [full],
    );
  } catch {
    // restricted page
  }
  if (page?.posting) {
    await chrome.storage.session.set({ [key]: page.job });
    return page.job;
  }
  const stored = (await chrome.storage.session.get(key))[key];
  if (stored && page?.form && new URL(stored.url).hostname === new URL(page.job.url).hostname) {
    return stored.description ? stored : { ...stored, description: page.job.description };
  }
  return page?.job || null;
}

// A job without its (long) description, for the panel and the tracker.
const brief = (job) => {
  if (!job) return job;
  const { description, ...rest } = job;
  return rest;
};

async function saveJob(job) {
  if (!job?.url) return null;
  const jobs = await J.store.jobs();
  const now = new Date().toISOString();
  const i = jobs.findIndex((j) => j.url === job.url);
  const prev = i >= 0 ? jobs[i] : { id: crypto.randomUUID(), status: 'saved', savedAt: now };
  const next = { ...prev, ...brief(job), status: job.status || prev.status, updatedAt: now };
  if (next.status === 'applied' && !next.appliedAt) next.appliedAt = now;
  if (i >= 0) jobs[i] = next;
  else jobs.unshift(next);
  await chrome.storage.local.set({ jobs });
  return next;
}

// Opens the tailor page for the job in this tab, next to it where the
// browser can place tabs (not every phone browser can).
async function openTailor(tabId) {
  const job = tabId ? await jobForTab(tabId, { full: true }) : null;
  await chrome.storage.session.set({ [`tailor:${tabId}`]: job });
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const url = chrome.runtime.getURL(`src/tailor/tailor.html?tab=${tabId || ''}`);
  await chrome.tabs.create({ url, ...(tab && { index: tab.index + 1, openerTabId: tab.id }) }).catch(() => chrome.tabs.create({ url }));
  return { opened: true };
}

// Marks the toolbar button on a tab with an application form. Some phone
// browsers have no badge, so anything that fails is skipped.
function markTab(tabId, ats) {
  for (const call of [
    () => chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' }),
    () => chrome.action.setBadgeText({ tabId, text: 'J' }),
    () => chrome.action.setTitle({ tabId, title: `Jobu — application form detected${ats ? ` (${ats})` : ''}` }),
  ]) {
    Promise.resolve().then(call).catch(() => {});
  }
}

// Shared by the context menu and keyboard shortcuts.
// Removes the guide's outline in every frame. Frames without Jobu have none.
const clearGuide = (tabId) =>
  chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: () => globalThis.JOBU?.setCurrent?.(null) })
    .catch(() => {});

const ACTIONS = {
  autofill: (tabId) => report(tabId, autofillTab(tabId)),
  next: (tabId) => report(tabId, goNext(tabId)),
  submit: (tabId) => requestSubmit(tabId),
  panel: (tabId) => runInFrames(tabId, () => globalThis.JOBU.togglePanel(), [0]),
  guide: (tabId) => runInFrames(tabId, () => globalThis.JOBU.guideNext(), [0]),
  save: async (tabId) => {
    const job = await jobForTab(tabId);
    if (job) await saveJob(job);
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  const handlers = {
    AUTOFILL_TAB: () => autofillTab(tabId),
    SCAN_TAB: () => scanTab(tabId),
    NEXT_TAB: () => report(tabId, goNext(tabId)),
    SUBMIT_TAB: () => report(tabId, submitTab(tabId, { force: !!msg.force })),
    REQUEST_SUBMIT: () => requestSubmit(tabId),
    // Replies at once; the outcome reaches the page via notifyTop.
    APPLY_FLOW: () => (report(tabId, applyFlow(tabId)), { started: true }),
    STOP_FLOW: () => {
      if (flows.has(tabId)) flows.get(tabId).stop = true;
    },
    OPEN_PANEL: () => runInFrames(tabId, () => globalThis.JOBU.openPanel(), [0]).then(() => true),
    FOCUS_FIELD: async () => {
      // current: the panel's guide moves its outline here, out of any other frame.
      if (msg.current) await clearGuide(tabId);
      await runInFrames(tabId, (id, current) => globalThis.JOBU.focusField(id, { current }), [msg.frameId], [msg.id, !!msg.current]);
      return true;
    },
    END_GUIDE: () => clearGuide(tabId).then(() => true),
    FIELD_CHANGED: () => chrome.tabs.sendMessage(tabId, { type: 'REFRESH' }, { frameId: 0 }).catch(() => {}),
    LEARN_TAB: () => learnTab(tabId),
    // From the tailor page the result also goes to the job tab's panel.
    ATTACH_RESUME: () => (sender.tab && sender.tab.id !== tabId ? report(tabId, attachResume(tabId, msg.resume)) : attachResume(tabId, msg.resume)),
    TAILOR_RESUME: () => openTailor(tabId),
    ACCOUNT_PASSWORD: () => accountPassword(tabId, msg.frameId, msg.op),
    GET_JOB: () => jobForTab(tabId),
    SAVE_JOB: () => saveJob(msg.job),
    OPEN_OPTIONS: () => J.openProfile(msg.section),
    APPLICATION_SUBMITTED: async () => {
      const job = await jobForTab(tabId);
      return job && saveJob({ ...job, status: 'applied' });
    },
    FORM_DETECTED: async () => {
      markTab(tabId, msg.ats);
      if (msg.showButton) await chrome.tabs.sendMessage(tabId, { type: 'SHOW_BUTTON' }, { frameId: 0 }).catch(() => {});
    },
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then(reply, (e) => reply({ error: e.message }));
  return true; // async reply
});

const MENU_ACTIONS = { 'jobu-autofill': 'autofill', 'jobu-next': 'next', 'jobu-submit': 'submit', 'jobu-save': 'save' };
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  const action = MENU_ACTIONS[info.menuItemId];
  if (action && tab?.id) ACTIONS[action](tab.id).catch(() => {});
});

const COMMAND_ACTIONS = { autofill: 'autofill', 'next-page': 'next', submit: 'submit', 'toggle-panel': 'panel', 'next-empty-field': 'guide' };
chrome.commands?.onCommand.addListener((command, tab) => {
  const action = COMMAND_ACTIONS[command];
  if (action && tab?.id) ACTIONS[action](tab.id).catch(() => {});
});
