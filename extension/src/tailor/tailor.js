// The tailor page, opened beside a job tab from the Jobu panel or popup.
// Scores the profile's resume against the job, lists the job's keywords and
// tailors the resume (resume-model.js); Claude can also rewrite it
// (resume-ai.mjs). The user edits the result in place, and it's saved as a
// PDF that the panel attaches to the application.
import { extractText } from '../options/resume-text.mjs';
import { resumePdf } from './resume-pdf.mjs';

const J = globalThis.JOBU;
const $ = (id) => document.getElementById(id);
const tabId = Number(new URLSearchParams(location.search).get('tab')) || null;
const KEEP = 10; // tailored resumes kept in storage
const SUMMARY = Symbol('summary');
const DROPPED = 'A few characters the PDF font can’t show were left out.';

const state = {
  job: {},
  profile: null,
  facts: {},
  base: null, // the resume as uploaded
  keywords: [],
  added: new Set(), // missing skills the user says they have
  // What the user (or Claude) changed: original text -> new text ('' removes
  // it). Skill lists are edited whole, by section title and position.
  edits: new Map(),
  groupEdits: new Map(),
  claude: new Map(), // key -> Claude's text, for undo
  beforeClaude: new Map(),
  tailored: null, // { structure, changes } before edits
};
let binds = new WeakMap(); // editable element -> { save }
let sideTimer;

const tidy = (t) => String(t).replace(/\s+/g, ' ').trim();
const edit = (t) => (state.edits.has(t) ? state.edits.get(t) : t);
const splitItems = (t) => t.split(/\s*[,;]\s*/).map(tidy).filter(Boolean);
const sameJob = (a, b) => !!a && !!b && (a.url === b.url || (!!a.title && a.title === b.title && a.company === b.company));
const jobLabel = () => [state.job.title, state.job.company].filter(Boolean).join(' at ');

function status(text, tone = '') {
  $('status').textContent = text;
  $('status').className = `status ${tone}`;
}

function show(id) {
  for (const s of ['need-resume', 'need-jd', 'layout']) $(s).hidden = s !== id;
  if (id) status('');
}

const say = (id, text, tone = '') => {
  $(id).textContent = text;
  $(id).className = `small ${tone || (id === 'doc-msg' ? 'muted' : '')}`;
};

// ---- The resume, with the user's edits ----

function groupItems(title, i, g) {
  const ge = state.groupEdits.get(`${title}|${i}`);
  if (!ge) return g.items;
  const items = splitItems(ge.text);
  return [...items, ...g.items.filter((x) => !ge.had.includes(x) && !items.includes(x))];
}

// The tailored structure's sections, plus a summary if only Claude or the
// user wrote one.
function sectionsOf(s) {
  const needSummary = state.edits.has(SUMMARY) && !s.sections.some((sec) => sec.kind === 'summary');
  return needSummary ? [{ title: 'Summary', kind: 'summary', text: '' }, ...s.sections] : s.sections;
}

function current() {
  const s = state.tailored.structure;
  return {
    name: edit(s.name),
    contact: s.contact.map(edit).filter(Boolean),
    sections: sectionsOf(s).map((sec) => ({
      title: edit(sec.title),
      kind: sec.kind,
      ...(sec.text != null && { text: state.edits.get(SUMMARY) ?? edit(sec.text) }),
      ...(sec.groups && { groups: sec.groups.map((g, i) => ({ label: edit(g.label), items: groupItems(sec.title, i, g) })) }),
      ...(sec.entries && { entries: sec.entries.map((e) => ({ head: e.head.map(edit).filter(Boolean), bullets: e.bullets.map(edit).filter(Boolean) })) }),
    })),
  };
}

// ---- Rendering ----

function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// An editable piece of the resume. By default an edit replaces `key`.
function field(tag, key, { cls = '', text = edit(key), save } = {}) {
  const e = el(tag, cls);
  e.contentEditable = 'plaintext-only';
  e.textContent = text;
  binds.set(e, { save: () => (save ? save(e) : state.edits.set(key, tidy(e.textContent))) });
  return e;
}

function renderSheet() {
  const s = state.tailored.structure;
  binds = new WeakMap();
  const sheet = $('sheet');
  sheet.replaceChildren(field('h1', s.name, { cls: 'name' }));

  const contact = el('p', 'contact');
  s.contact.filter(edit).forEach((c, i) => {
    if (i) contact.append(el('span', 'sep', '|'));
    contact.append(field('span', c));
  });
  sheet.append(contact);

  for (const sec of sectionsOf(s)) {
    const box = el('section');
    box.append(field('h2', sec.title));
    if (sec.text != null) {
      const text = state.edits.get(SUMMARY) ?? edit(sec.text);
      box.append(field('p', SUMMARY, { cls: `summary${state.claude.has(SUMMARY) ? ' ai' : ''}`, text, save: (e) => state.edits.set(SUMMARY, tidy(e.textContent)) }));
    }
    (sec.groups || []).forEach((g, i) => {
      const row = el('div', 'group');
      if (g.label) row.append(field('span', g.label, { cls: 'gl' }), ': ');
      row.append(
        field('span', null, {
          text: groupItems(sec.title, i, g).join(', '),
          save: (e) => state.groupEdits.set(`${sec.title}|${i}`, { text: e.textContent, had: [...g.items] }),
        }),
      );
      box.append(row);
    });
    for (const e of sec.entries || []) {
      const titled = e.bullets.length > 0 || e.head.some((h) => /\t/.test(h) || /\b(19|20)\d{2}\b/.test(h));
      const entry = el('div', `entry${titled ? ' titled' : ''}`);
      for (const h of e.head.filter(edit)) {
        const [l, ...r] = edit(h).split(/\t+/);
        const row = el('div', 'head');
        const parts = [];
        const save = () => state.edits.set(h, parts.map((p) => tidy(p.textContent)).filter(Boolean).join('\t'));
        parts.push(field('span', h, { cls: 'l', text: l, save }));
        if (r.length) parts.push(field('span', h, { cls: 'r', text: r.join(' '), save }));
        row.append(...parts);
        entry.append(row);
      }
      const bullets = e.bullets.filter(edit);
      if (bullets.length) {
        const ul = el('ul');
        for (const b of bullets) {
          const li = el('li', state.claude.has(b) ? 'ai' : '');
          li.append(field('span', b), Object.assign(el('button', 'x', '×'), { title: 'Remove this bullet', type: 'button' }));
          li.dataset.key = b;
          ul.append(li);
        }
        entry.append(ul);
      }
      box.append(entry);
    }
    sheet.append(box);
  }
}

function meter(which, score) {
  $(`score-${which}`).textContent = `${score}%`;
  $(`bar-${which}`).style.width = `${score}%`;
}

function chip(k, kind) {
  const isButton = kind === 'missing' || kind === 'added';
  const c = el(isButton ? 'button' : 'span', `chip ${kind}`);
  c.append(kind === 'have' || kind === 'added' ? `✓ ${k.term}` : kind === 'missing' ? `+ ${k.term}` : k.term);
  if (k.weight >= 3 && !k.soft) c.append(el('span', 'req', 'required'));
  if (isButton) {
    c.type = 'button';
    c.dataset.term = k.term;
    c.title = kind === 'added' ? 'Remove from my skills' : 'I have this: add it to my skills';
  }
  return c;
}

function renderSide() {
  const s = current();
  const text = J.structureText(s);
  meter('before', J.matchResume(J.structureText(state.base), state.keywords).score);
  meter('after', J.matchResume(text, state.keywords).score);

  const hard = state.keywords.filter((k) => !k.soft);
  const soft = state.keywords.filter((k) => k.soft);
  const kindOf = (k) => (state.added.has(k.term) ? 'added' : J.mentions(text, k.term) ? 'have' : 'missing');
  $('chips-have').replaceChildren(...hard.filter((k) => kindOf(k) !== 'missing').map((k) => chip(k, kindOf(k))));
  const missing = hard.filter((k) => kindOf(k) === 'missing');
  $('chips-missing').replaceChildren(...missing.map((k) => chip(k, 'missing')));
  $('missing-title').hidden = $('missing-help').hidden = !missing.length;
  $('chips-soft-wrap').hidden = !soft.length;
  $('chips-soft').replaceChildren(...soft.map((k) => chip(k, J.mentions(text, k.term) ? 'have' : 'soft')));

  const mine = [...state.edits.keys()].filter((k) => state.edits.get(k) !== state.claude.get(k)).length + state.groupEdits.size;
  const changes = [...state.tailored.changes];
  if (state.claude.size) changes.push(`Claude rewrote ${state.claude.size} part${state.claude.size === 1 ? '' : 's'} (marked in blue).`);
  if (mine) changes.push(`You edited ${mine} part${mine === 1 ? '' : 's'}.`);
  $('changes').replaceChildren(
    ...(changes.length ? changes.map((c) => el('li', '', c)) : [el('li', 'none', 'Your resume already leads with what this job asks for.')]),
  );
  $('reset').hidden = !mine;
  $('ai-undo').hidden = !state.claude.size;
}

function renderJob() {
  const link = $('job-link');
  link.textContent = jobLabel() || 'this job';
  if (state.job.url) link.href = state.job.url;
  else link.removeAttribute('href');
  document.title = `Tailor Resume${state.job.company ? ` for ${state.job.company}` : ''} · Jobu`;
}

function renderAi() {
  $('ai-key').hidden = !!state.key;
  $('ai-ready').hidden = !state.key;
}

function retailor() {
  state.tailored = J.tailorResume(state.base, state.keywords, { addSkills: [...state.added], facts: state.facts });
  renderSheet();
  renderSide();
}

function analyze() {
  state.keywords = J.jobKeywords(state.job.description || '');
  $('jd').value = state.job.description || '';
  show('layout');
  if (!state.keywords.length) status('Jobu didn’t find any skills or tools in this job description, so there’s nothing to match. You can still edit and save your resume.', 'warn');
  retailor();
}

// ---- Loading ----

async function load() {
  const key = `tailor:${tabId}`;
  const [{ profile, resume }, session, local] = await Promise.all([
    J.store.load(),
    tabId ? chrome.storage.session.get(key) : {},
    chrome.storage.local.get('anthropicKey'),
  ]);
  state.job = session[key] || {};
  state.profile = profile;
  state.facts = { title: profile.work.currentTitle, years: profile.work.yearsExperience };
  state.key = local.anthropicKey || '';
  renderJob();
  renderAi();
  if (tabId) $('attach').hidden = !(await chrome.tabs.get(tabId).catch(() => null));
  if (!resume) return show('need-resume');

  let text;
  try {
    const blob = await (await fetch(resume.dataUrl)).blob();
    text = await extractText(new File([blob], resume.name, { type: resume.type }));
  } catch (err) {
    console.warn('Jobu: could not read the resume', err);
    return status(err.name === 'ResumeError' ? err.message : 'Jobu couldn’t read your resume. Upload a PDF or DOCX version in your profile and try again.', 'warn');
  }
  if (!text.trim()) return status('Jobu couldn’t find any text in your resume. If it’s a scanned image, upload a PDF or DOCX with selectable text.', 'warn');
  state.base = J.resumeStructure(text);

  if ((state.job.description || '').length < 200) {
    $('jd-paste').value = state.job.description || '';
    return show('need-jd');
  }
  analyze();
}

// ---- Saving ----

const dataUrlOf = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function makePdf() {
  const s = current();
  const { bytes, dropped } = await resumePdf(s, { subject: jobLabel() });
  const who = (s.name || `${state.profile.firstName} ${state.profile.lastName}`).replace(/[^\p{L}\p{N} .'-]+/gu, '').trim();
  return { bytes, dropped, name: `${who ? `${who} ` : ''}Resume.pdf` };
}

// Keeps one tailored resume per job, newest first.
async function save() {
  const { bytes, dropped, name } = await makePdf();
  const entry = {
    id: crypto.randomUUID(),
    job: { title: state.job.title || '', company: state.job.company || '', url: state.job.url || '' },
    createdAt: new Date().toISOString(),
    file: { name, type: 'application/pdf', size: bytes.length, dataUrl: await dataUrlOf(new Blob([bytes], { type: 'application/pdf' })) },
  };
  const { tailored = [] } = await chrome.storage.local.get('tailored');
  await chrome.storage.local.set({ tailored: [entry, ...tailored.filter((t) => !sameJob(t.job, entry.job))].slice(0, KEEP) });
  return { entry, dropped };
}

async function busy(button, work) {
  button.disabled = true;
  try {
    await work();
  } catch (err) {
    console.warn('Jobu:', err);
    say('doc-msg', err.message || 'Something went wrong. Try again.', 'warn');
  } finally {
    button.disabled = false;
  }
}

$('download').onclick = () =>
  busy($('download'), async () => {
    const { bytes, dropped, name } = await makePdf();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    Object.assign(el('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    say('doc-msg', `Downloaded ${name}.${dropped ? ` ${DROPPED}` : ''}`, 'ok');
  });

$('save').onclick = () =>
  busy($('save'), async () => {
    const { entry, dropped } = await save();
    say('doc-msg', `Saved. The Jobu panel offers “${entry.file.name}” first when you apply to this job.${dropped ? ` ${DROPPED}` : ''}`, 'ok');
  });

$('attach').onclick = () =>
  busy($('attach'), async () => {
    const { entry, dropped } = await save();
    const r = await chrome.runtime.sendMessage({ type: 'ATTACH_RESUME', tabId, resume: entry.id });
    const { text, tone } = J.describeResult(r);
    if (r?.attached === false) return say('doc-msg', `${text} Download the PDF here to upload it yourself.`, 'warn');
    say('doc-msg', `${text}${dropped ? ` ${DROPPED}` : ''}`, tone || 'ok');
    const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
    if (tab) chrome.windows.update(tab.windowId, { focused: true });
  });

// ---- Editing ----

$('sheet').addEventListener('input', (e) => {
  binds.get(e.target.closest('[contenteditable]'))?.save();
  clearTimeout(sideTimer);
  sideTimer = setTimeout(renderSide, 300);
});

$('sheet').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.isContentEditable) {
    e.preventDefault();
    e.target.blur();
  }
});

$('sheet').addEventListener('click', (e) => {
  if (!e.target.matches('.x')) return;
  const li = e.target.closest('li');
  state.edits.set(li.dataset.key, '');
  li.remove();
  renderSide();
});

document.querySelector('.side').addEventListener('click', (e) => {
  const term = e.target.closest('button.chip')?.dataset.term;
  if (!term) return;
  if (state.added.has(term)) state.added.delete(term);
  else state.added.add(term);
  retailor();
});

$('reset').onclick = () => {
  for (const k of [...state.edits.keys()]) if (state.edits.get(k) !== state.claude.get(k)) state.edits.delete(k);
  state.groupEdits.clear();
  retailor();
};

$('jd-again').onclick = () => {
  state.job.description = $('jd').value;
  analyze();
};

$('jd-go').onclick = () => {
  const jd = $('jd-paste').value.trim();
  if (jd.length < 100) return status('That looks too short to be a job description. Paste the whole posting.', 'warn');
  state.job.description = jd;
  analyze();
};

$('open-profile').onclick = () => chrome.runtime.openOptionsPage();

// ---- Claude ----

// Sends the resume (without name and contact details) and the job to Claude,
// then keeps each rewrite only if J.checkRewrite finds nothing new in it.
async function rewrite(apiKey) {
  const s = current();
  const { rewriteResume } = await import('./resume-ai.mjs');
  const bullets = [];
  for (const sec of state.tailored.structure.sections) {
    for (const e of sec.entries || []) {
      const entry = e.head.map(edit).filter(Boolean).map((h) => h.replace(/\t+/g, ', ')).join(' | ');
      const source = [...e.head, ...e.bullets].map(edit).join('\n');
      for (const b of e.bullets) if (edit(b)) bullets.push({ id: `b${bullets.length + 1}`, entry, text: edit(b), key: b, source });
    }
  }
  const summary = s.sections.find((sec) => sec.kind === 'summary')?.text || '';
  const resumeText = J.structureText({ ...s, name: '', contact: [] });
  const confirmed = [...state.added];
  const out = await rewriteResume({
    apiKey,
    resumeText,
    summary,
    bullets: bullets.map(({ id, entry, text }) => ({ id, entry, text })),
    job: state.job,
    keywords: state.keywords.map((k) => k.term),
    confirmed,
  });

  state.beforeClaude = new Map(state.edits);
  const dropped = [];
  const check = (text, source) => J.checkRewrite(text, source, { confirmed, keywords: state.keywords });
  for (const b of bullets) {
    const text = tidy(out.bullets[b.id] || '');
    if (!text || text === b.text) continue;
    const why = check(text, b.source);
    if (why) dropped.push(why);
    else {
      state.edits.set(b.key, text);
      state.claude.set(b.key, text);
    }
  }
  const facts = state.facts.years ? `${state.facts.years} years ${state.facts.title || ''}` : '';
  const newSummary = tidy(out.summary || '');
  if (newSummary && newSummary !== summary) {
    const why = check(newSummary, `${resumeText}\n${facts}`);
    if (why) dropped.push(`summary ${why}`);
    else {
      state.edits.set(SUMMARY, newSummary);
      state.claude.set(SUMMARY, newSummary);
    }
  }
  retailor();
  const n = state.claude.size;
  say(
    'ai-msg',
    `${n ? `Claude rewrote ${n} part${n === 1 ? '' : 's'} of your resume, marked in blue. Read them over before you save.` : 'Claude didn’t change anything.'}` +
      (dropped.length ? ` Jobu kept your original in ${dropped.length} place${dropped.length === 1 ? '' : 's'} where the rewrite ${[...new Set(dropped)].slice(0, 3).join('; ')}.` : ''),
    'ok',
  );
}

async function runClaude(button, apiKey) {
  button.disabled = true;
  say('ai-msg', 'Claude is rewriting your resume. This can take a minute…');
  try {
    await rewrite(apiKey);
    return true;
  } catch (err) {
    console.warn('Jobu: rewrite failed', err);
    say('ai-msg', err.name === 'RewriteError' ? err.message : 'The rewrite didn’t work. Your resume is unchanged; try again.', 'warn');
    return false;
  } finally {
    button.disabled = false;
  }
}

$('ai-key').onsubmit = async (e) => {
  e.preventDefault();
  const apiKey = $('key').value.trim();
  const ok = await runClaude(e.target.querySelector('button'), apiKey);
  if (!ok) return;
  $('key').value = '';
  if ($('remember').checked) {
    await chrome.storage.local.set({ anthropicKey: apiKey });
    state.key = apiKey;
    renderAi();
  }
};

$('ai-run').onclick = () => runClaude($('ai-run'), state.key);

$('ai-forget').onclick = async () => {
  await chrome.storage.local.remove('anthropicKey');
  state.key = '';
  renderAi();
  say('ai-msg', 'Forgot your API key.');
};

$('ai-undo').onclick = () => {
  for (const [k, text] of state.claude) {
    if (state.edits.get(k) !== text) continue; // edited since
    if (state.beforeClaude.has(k)) state.edits.set(k, state.beforeClaude.get(k));
    else state.edits.delete(k);
  }
  state.claude.clear();
  retailor();
  say('ai-msg', 'Put back your resume as it was before Claude.');
};

load().catch((err) => {
  console.error('Jobu: tailor page failed', err);
  status('Something went wrong loading this page. Close it and press “Tailor my resume” again.', 'warn');
});
