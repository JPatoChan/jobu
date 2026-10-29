// The tailor page, opened beside a job tab from the Jobu panel or popup.
// Scores the profile's resume against the job, lists the job's keywords and
// tailors the resume (resume-model.js). It suggests writing skills the way
// the job does, and, only when Claude Code is connected, Claude can suggest
// ways to word each bullet (resume-ai.mjs); the user picks one or keeps their
// own. The user edits the result in place, and it's saved as a PDF that the
// panel attaches to the application.
import { extractText } from '../options/resume-text.mjs';
import { resumePdf } from './resume-pdf.mjs';
import { claudeCodeStatus } from '../shared/claude-code.mjs';

const J = globalThis.JOBU;
const $ = (id) => document.getElementById(id);
const tabId = Number(new URLSearchParams(location.search).get('tab')) || null;
const KEEP = 10; // tailored resumes kept in storage
const SUMMARY = Symbol('summary');
const DROPPED = 'A few characters the PDF font can’t show were left out.';
const YOURS = 'Your wording';

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
  claude: new Map(), // key -> the Claude option the user picked, for undo
  beforeClaude: new Map(),
  options: new Map(), // key -> { was, options: [{ text, focus }] }, from Claude
  showOptions: true,
  swapped: [], // "JS as JavaScript": wording the user took from the job
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
// user wrote one, or Claude has options for one.
function sectionsOf(s) {
  const wanted = state.edits.has(SUMMARY) || (state.showOptions && state.options.has(SUMMARY));
  const needSummary = wanted && !s.sections.some((sec) => sec.kind === 'summary');
  return needSummary ? [{ title: 'Summary', kind: 'summary', text: '' }, ...s.sections] : s.sections;
}

function current() {
  const s = state.tailored.structure;
  return {
    name: edit(s.name),
    contact: s.contact.map(edit).filter(Boolean),
    sections: sectionsOf(s)
      .map((sec) => ({
        title: edit(sec.title),
        kind: sec.kind,
        ...(sec.text != null && { text: state.edits.get(SUMMARY) ?? edit(sec.text) }),
        ...(sec.groups && { groups: sec.groups.map((g, i) => ({ label: edit(g.label), items: groupItems(sec.title, i, g) })) }),
        ...(sec.entries && { entries: sec.entries.map((e) => ({ head: e.head.map(edit).filter(Boolean), bullets: e.bullets.map(edit).filter(Boolean) })) }),
      }))
      .filter((sec) => sec.text !== ''),
  };
}

// The summary as tailoring left it, before anyone's edits.
const tailoredSummary = () => state.tailored.structure.sections.find((sec) => sec.kind === 'summary')?.text ?? '';

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

// Claude's options for one part of the resume, shown under it: the user's
// own wording first, then each option, with the one in use marked.
function optionsBox(key, now) {
  const o = state.options.get(key);
  if (!o || !state.showOptions) return '';
  const box = el('div', 'opts');
  const row = (text, focus, fromClaude) => {
    const b = el('button', `opt${tidy(text) === tidy(now) ? ' on' : ''}`);
    b.type = 'button';
    b.append(el('span', 'focus', focus), el('span', 'text', text || 'No summary'));
    b.onclick = () => pick(key, text, fromClaude);
    return b;
  };
  box.append(row(o.was, YOURS, false), ...o.options.map((x) => row(x.text, x.focus, true)));
  return box;
}

function pick(key, text, fromClaude) {
  const original = key === SUMMARY ? tailoredSummary() : key;
  if (text === original) state.edits.delete(key);
  else state.edits.set(key, text);
  if (fromClaude) state.claude.set(key, text);
  else state.claude.delete(key);
  renderSheet();
  renderSide();
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
      box.append(
        field('p', SUMMARY, { cls: `summary${state.claude.has(SUMMARY) ? ' ai' : ''}`, text, save: (e) => state.edits.set(SUMMARY, tidy(e.textContent)) }),
        optionsBox(SUMMARY, text),
      );
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
          li.append(field('span', b), Object.assign(el('button', 'x', '×'), { title: 'Remove this bullet', type: 'button' }), optionsBox(b, edit(b)));
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

  const wording = J.wordingSuggestions(text, state.job.description || '', state.keywords);
  $('wording-card').hidden = !wording.length;
  $('wording').replaceChildren(
    ...wording.map((w) => {
      const li = el('li');
      const use = Object.assign(el('button', 'link-btn', 'Use'), { type: 'button', title: `Write ${w.from} as ${w.to} everywhere on your resume` });
      use.onclick = () => useWording([w]);
      li.append(el('span', '', `${w.from} → `), el('b', '', w.to), el('span', 'muted', ` · ${w.count} place${w.count === 1 ? '' : 's'} `), use);
      return li;
    }),
  );
  $('wording-all').hidden = wording.length < 2;
  $('wording-all').onclick = () => useWording(wording);

  const mine = [...state.edits.keys()].filter((k) => state.edits.get(k) !== state.claude.get(k)).length + state.groupEdits.size;
  const changes = [...state.tailored.changes];
  if (state.swapped.length) changes.push(`Wrote ${listOf(state.swapped)}, as the job does.`);
  if (state.claude.size) changes.push(`You used ${state.claude.size} of Claude’s options (marked in blue).`);
  if (mine) changes.push(`You edited ${mine} part${mine === 1 ? '' : 's'}.`);
  $('changes').replaceChildren(
    ...(changes.length ? changes.map((c) => el('li', '', c)) : [el('li', 'none', 'Your resume already leads with what this job asks for.')]),
  );
  $('reset').hidden = !mine;
  $('ai-undo').hidden = !state.claude.size;
  $('ai-toggle').hidden = !state.options.size;
  $('ai-toggle').textContent = state.showOptions ? 'Hide the options' : `Show the options (${state.options.size})`;
}

const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// Writes skills the way the job does, everywhere on the resume, as the
// user's own edit. Only the same name is ever swapped (J.wordingSuggestions).
function useWording(swaps) {
  const s = state.tailored.structure;
  const swap = (now) => swaps.reduce((t, w) => J.swapWording(t, w.from, w.to), now);
  const set = (key, now) => swap(now) !== now && state.edits.set(key, swap(now));
  for (const sec of sectionsOf(s)) {
    if (sec.text != null) set(SUMMARY, state.edits.get(SUMMARY) ?? edit(sec.text));
    (sec.groups || []).forEach((g, i) => {
      const now = groupItems(sec.title, i, g).join(', ');
      if (swap(now) !== now) state.groupEdits.set(`${sec.title}|${i}`, { text: swap(now), had: [...g.items] });
    });
    for (const e of sec.entries || []) for (const k of [...e.head, ...e.bullets]) if (edit(k)) set(k, edit(k));
  }
  state.swapped.push(...swaps.map((w) => `${w.from} as ${w.to}`));
  renderSheet();
  renderSide();
}

function renderJob() {
  const link = $('job-link');
  link.textContent = jobLabel() || 'this job';
  if (state.job.url) link.href = state.job.url;
  else link.removeAttribute('href');
  document.title = `Tailor Resume${state.job.company ? ` for ${state.job.company}` : ''} · Jobu`;
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
  const [{ profile, resume }, session] = await Promise.all([J.store.load(), tabId ? chrome.storage.session.get(key) : {}]);
  state.job = session[key] || {};
  state.profile = profile;
  state.facts = { title: profile.work.currentTitle, years: profile.work.yearsExperience };
  renderJob();
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
  state.swapped = [];
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

// Claude's card only appears when Claude Code is connected.
async function checkClaude() {
  $('ai').hidden = !(await claudeCodeStatus()).connected;
}

// Sends the resume (without name, contact details and skills the user added)
// and the job to Claude, and keeps each option only if J.checkRewrite finds
// nothing in it that the resume doesn't say.
async function suggest() {
  const s = current();
  const { suggestRewrites } = await import('./resume-ai.mjs');
  const bullets = [];
  for (const sec of state.tailored.structure.sections) {
    for (const e of sec.entries || []) {
      const entry = e.head.map(edit).filter(Boolean).map((h) => h.replace(/\t+/g, ', ')).join(' | ');
      const source = [...e.head, ...e.bullets].map(edit).join('\n');
      for (const b of e.bullets) if (edit(b)) bullets.push({ id: `b${bullets.length + 1}`, entry, text: edit(b), key: b, source });
    }
  }
  const summary = s.sections.find((sec) => sec.kind === 'summary')?.text || '';
  const own = (sec) => (sec.groups ? { ...sec, groups: sec.groups.map((g) => ({ ...g, items: g.items.filter((x) => !state.added.has(x)) })) } : sec);
  const resumeText = J.structureText({ name: '', contact: [], sections: s.sections.map(own) });
  const out = await suggestRewrites({
    resumeText,
    summary,
    bullets: bullets.map(({ id, entry, text }) => ({ id, entry, text })),
    job: state.job,
    keywords: state.keywords.map((k) => k.term),
  });

  if (!state.claude.size) state.beforeClaude = new Map(state.edits);
  state.options.clear();
  state.showOptions = true;
  const dropped = [];
  const keep = (key, was, options, source) => {
    const seen = new Set([tidy(was).toLowerCase()]);
    const good = [];
    for (const o of options) {
      const text = tidy(o.text);
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      const why = J.checkRewrite(text, source, { keywords: state.keywords });
      if (why) dropped.push(why);
      else good.push({ text, focus: tidy(o.focus) || 'Option' });
    }
    if (good.length) state.options.set(key, { was, options: good });
  };
  for (const b of bullets) keep(b.key, b.text, out.bullets[b.id] || [], b.source);
  const facts = state.facts.years ? `${state.facts.years} years ${state.facts.title || ''}` : '';
  keep(SUMMARY, summary, out.summary, `${resumeText}\n${facts}`);

  renderSheet();
  renderSide();
  const n = state.options.size;
  say(
    'ai-msg',
    `${n ? `Claude suggested new wording for ${n} part${n === 1 ? '' : 's'} of your resume. Pick one under each, or keep yours.` : 'Claude had no new wording to suggest.'}` +
      (dropped.length ? ` Jobu hid ${dropped.length} option${dropped.length === 1 ? '' : 's'} where Claude ${[...new Set(dropped)].slice(0, 3).join('; ')}, which your resume doesn’t say.` : ''),
    'ok',
  );
}

$('ai-run').onclick = async () => {
  const button = $('ai-run');
  button.disabled = true;
  say('ai-msg', 'Claude is reading your resume and the job. This can take a minute…');
  try {
    await suggest();
  } catch (err) {
    console.warn('Jobu: rewrite failed', err);
    say('ai-msg', err.name === 'RewriteError' ? err.message : 'Claude couldn’t suggest anything this time. Your resume is unchanged; try again.', 'warn');
  } finally {
    button.disabled = false;
  }
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

$('ai-toggle').onclick = () => {
  state.showOptions = !state.showOptions;
  renderSheet();
  renderSide();
};

checkClaude();
load().catch((err) => {
  console.error('Jobu: tailor page failed', err);
  status('Something went wrong loading this page. Close it and press “Tailor my resume” again.', 'warn');
});
