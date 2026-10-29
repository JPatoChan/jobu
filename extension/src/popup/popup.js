const J = globalThis.JOBU;
const $ = (id) => document.getElementById(id);
const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];

let tab;
let job;

function setStatus(text, cls = '') {
  $('status').textContent = text;
  $('status').className = `small ${cls}`;
}

async function renderProfile() {
  const { profile, resume } = await J.store.load();
  const pct = J.profileCompleteness(profile, resume);
  $('completeness').textContent = `${pct}%`;
  $('bar-fill').style.width = `${pct}%`;
  $('profile-hint').textContent =
    pct === 100
      ? `Ready to apply as ${profile.firstName} ${profile.lastName}.`
      : resume
        ? 'Finish your profile for the best autofill.'
        : 'Upload your resume in settings and Jobu fills in your profile from it.';
}

async function renderJobs() {
  const jobs = await J.store.jobs();
  $('empty').hidden = jobs.length > 0;
  const count = (s) => jobs.filter((j) => j.status === s).length;
  $('counts').textContent = jobs.length ? `${count('applied')} applied · ${count('interview')} interviewing` : '';
  const list = $('jobs');
  list.replaceChildren(
    ...jobs.map((j) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = j.url;
      a.target = '_blank';
      a.innerHTML = '<div class="t ellipsis"></div><div class="muted small ellipsis"></div>';
      a.firstChild.textContent = j.title || j.url;
      a.lastChild.textContent = [j.company, j.location].filter(Boolean).join(' · ');
      const sel = document.createElement('select');
      sel.append(...STATUSES.map((s) => new Option(s[0].toUpperCase() + s.slice(1), s, false, s === j.status)));
      sel.onchange = () => chrome.runtime.sendMessage({ type: 'SAVE_JOB', job: { url: j.url, status: sel.value } }).then(renderJobs);
      const del = document.createElement('button');
      del.className = 'del';
      del.title = 'Remove';
      del.textContent = '✕';
      del.onclick = async () => {
        const all = await J.store.jobs();
        await chrome.storage.local.set({ jobs: all.filter((x) => x.url !== j.url) });
        renderJobs();
      };
      li.append(a, sel, del);
      return li;
    }),
  );
}

const PAGE_BUTTONS = ['autofill', 'save', 'next', 'submit', 'flow', 'panel', 'attach', 'tailor'];
const send = (msg) => chrome.runtime.sendMessage({ ...msg, tabId: tab.id });

function showResult(r) {
  const { text, tone } = J.describeResult(r);
  setStatus(text, tone);
}

// Scan summary and which of Next / Submit the page offers.
async function renderScan() {
  const scan = await send({ type: 'SCAN_TAB' }).catch(() => null);
  if (!scan || scan.error) return;
  const { counts: c, nav, step } = scan;
  const parts = [];
  if (scan.isApplication) {
    for (const [k, word] of [['ready', 'to fill'], ['missing', 'need you'], ['filled', 'filled']]) {
      if (c[k]) parts.push(`<span><i class="dot ${k}"></i><b>${c[k]}</b> ${word}</span>`);
    }
    if (step) parts.push(`<span>Step ${step.current} of ${step.total}</span>`);
  } else {
    parts.push('<span>No application form on this page yet.</span>');
  }
  $('scan').innerHTML = parts.join('');
  $('scan').hidden = false;
  $('next').disabled = !nav.next || nav.next.disabled;
  $('next').title = nav.next ? `Click “${nav.next.label}”` : 'No Next or Continue button on this page';
  $('submit').disabled = !nav.submit || nav.submit.disabled;
  $('submit').title = nav.submit ? `Click “${nav.submit.label}”` : 'No submit button on this page yet';
}

// The page the popup is for. On a phone the popup can open as a tab of its
// own; then it's for the web page the user was on last.
async function pageTab() {
  const own = await chrome.tabs.getCurrent().catch(() => null);
  if (!own) return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const pages = (await chrome.tabs.query({})).filter((t) => t.id !== own.id && /^https?:/.test(t.url || ''));
  return pages.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

async function renderJob() {
  tab = await pageTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('job-title').textContent = 'Open a job application to use Jobu';
    for (const id of PAGE_BUTTONS) $(id).disabled = true;
    return;
  }
  renderScan();
  job = await send({ type: 'GET_JOB' });
  if (!job) return;
  $('job-title').textContent = job.title || 'This page';
  $('job-company').textContent = [job.company, job.location].filter(Boolean).join(' · ');
  if (job.ats && job.ats !== 'Other') {
    $('ats').textContent = job.ats;
    $('ats').hidden = false;
  }
}

async function runAction(button, busyText, msg) {
  $(button).disabled = true;
  setStatus(busyText);
  const r = await send(msg).catch((e) => ({ error: e.message }));
  $(button).disabled = false;
  showResult(r);
  renderScan();
  return r;
}

$('autofill').onclick = () => runAction('autofill', 'Filling…', { type: 'AUTOFILL_TAB' });
$('next').onclick = () => runAction('next', 'Going to the next page…', { type: 'NEXT_TAB' });

// With confirmation on, the panel on the page asks before anything is sent.
$('submit').onclick = async () => {
  const r = await send({ type: 'REQUEST_SUBMIT' }).catch((e) => ({ error: e.message }));
  if (r?.asked) return window.close();
  showResult(r);
  renderScan();
};

// The page's panel shows progress and the outcome.
$('flow').onclick = async () => {
  await send({ type: 'APPLY_FLOW' });
  window.close();
};

// Attaches the default resume: one tailored for this job, else the profile's.
$('attach').onclick = () => runAction('attach', 'Attaching…', { type: 'ATTACH_RESUME' });

$('tailor').onclick = async () => {
  await send({ type: 'TAILOR_RESUME' }).catch(() => {});
  window.close();
};

$('panel').onclick = async () => {
  await send({ type: 'OPEN_PANEL' }).catch(() => {});
  window.close();
};

$('save').onclick = async () => {
  if (!job) return;
  await chrome.runtime.sendMessage({ type: 'SAVE_JOB', job });
  setStatus('Saved to tracker.', 'ok');
  renderJobs();
};

$('settings').onclick = () => J.openProfile();

renderProfile();
renderJobs();
renderJob();
