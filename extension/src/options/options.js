const J = globalThis.JOBU;
const $ = (s, root = document) => root.querySelector(s);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FIELDS = J.SCHEMA.flatMap((s) => s.fields);
const labelOf = (path) => FIELDS.find((f) => f.path === path)?.label || path;
const list = (paths) => paths.map(labelOf).join(', ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let state;
let saveTimer;
// Profile fields the last resume upload filled. They stay highlighted until edited.
const fromResume = new Set();

function flashSaved(text = 'Saved') {
  $('#saved').textContent = text;
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => ($('#saved').textContent = ''), 1500);
}

function updateCompleteness() {
  $('#completeness').textContent = `Profile ${J.profileCompleteness(state.profile, state.resume)}% complete`;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await J.store.saveProfile(state.profile);
    updateCompleteness();
    flashSaved();
  }, 300);
}

function renderSections() {
  const root = $('#sections');
  root.replaceChildren();
  for (const section of J.SCHEMA) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<h2></h2>${section.note ? '<p class="muted"></p>' : ''}<div class="grid"></div>`;
    $('h2', card).textContent = section.title;
    if (section.note) $('p', card).textContent = section.note;
    const grid = $('.grid', card);
    for (const f of section.fields) {
      const wrap = document.createElement('label');
      wrap.className = `field${f.type === 'textarea' ? ' wide' : ''}${fromResume.has(f.path) ? ' from-resume' : ''}`;
      wrap.innerHTML = '<span class="label"></span>';
      $('.label', wrap).textContent = f.label;
      if (f.required) $('.label', wrap).insertAdjacentHTML('beforeend', ' <span class="req">*</span>');
      let input;
      if (f.options) {
        input = document.createElement('select');
        input.append(new Option('—', ''), ...f.options.map((o) => new Option(o, o)));
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
      }
      if (f.placeholder) input.placeholder = f.placeholder;
      input.value = J.getPath(state.profile, f.path) ?? '';
      input.addEventListener('input', () => {
        J.setPath(state.profile, f.path, input.value);
        fromResume.delete(f.path);
        wrap.classList.remove('from-resume');
        queueSave();
      });
      wrap.append(input);
      grid.append(wrap);
    }
    root.append(card);
  }
}

function renderAnswers() {
  const root = $('#answers');
  root.replaceChildren(
    ...state.profile.customAnswers.map((item, i) => {
      const row = document.createElement('div');
      row.className = 'answer';
      const q = Object.assign(document.createElement('input'), { type: 'text', value: item.q, placeholder: 'Question, e.g. Why do you want to work here?' });
      const a = Object.assign(document.createElement('textarea'), { value: item.a, placeholder: 'Your answer' });
      const del = Object.assign(document.createElement('button'), { className: 'del', title: 'Delete', textContent: '✕' });
      q.oninput = () => ((item.q = q.value), queueSave());
      a.oninput = () => ((item.a = a.value), queueSave());
      del.onclick = () => {
        state.profile.customAnswers.splice(i, 1);
        renderAnswers();
        queueSave();
      };
      row.append(q, a, del);
      return row;
    }),
  );
}

function renderFiles() {
  for (const box of document.querySelectorAll('.file-field')) {
    const key = box.dataset.key;
    const file = state[key];
    const name = $('.file-name', box);
    name.dataset.empty ??= name.textContent;
    name.textContent = file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : name.dataset.empty;
    name.classList.toggle('muted', !file);
    $('.remove', box).hidden = !file;
  }
  $('#reparse').hidden = !state.resume;
}

// The note under the resume upload. action: { label, run } adds a button.
function showImport(text, tone = '', action = null) {
  const note = $('#resume-import');
  note.hidden = !text;
  note.className = `import-note ${tone}`;
  $('.text', note).textContent = text;
  const btn = $('button', note);
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.run;
  }
}

const readDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

async function storeFile(key, file) {
  if (file.size > MAX_FILE_BYTES) return alert('Please choose a file under 8 MB.');
  state[key] = { name: file.name, type: file.type, size: file.size, dataUrl: await readDataUrl(file) };
  await chrome.storage.local.set({ [key]: state[key] });
  renderFiles();
  updateCompleteness();
  flashSaved();
  if (key === 'resume') await fillFromResume(file);
}

// Reads the resume and fills the profile from it. Only empty fields, or ones
// still at their default, are filled. Fields that already hold something else
// are listed with a button to replace them.
async function fillFromResume(file) {
  showImport('Reading your resume…');
  let found;
  try {
    const { extractText } = await import('./resume-text.mjs');
    const text = await extractText(file);
    if (!text.trim()) {
      return showImport('Jobu couldn’t find any text in this resume. If it’s a scanned image, upload a PDF or DOCX with selectable text, or fill in your profile below.', 'warn');
    }
    found = J.parseResume(text);
  } catch (err) {
    console.warn('Jobu: could not read the resume', err);
    return showImport(
      err.name === 'ResumeError' ? err.message : 'Jobu couldn’t read this resume. Try a PDF or DOCX version, or fill in your profile below.',
      'warn',
    );
  }

  const filled = [];
  const differs = [];
  for (const [path, value] of Object.entries(found)) {
    const current = String(J.getPath(state.profile, path) ?? '').trim();
    if (current === String(value)) continue;
    if (!current || current === String(J.getPath(J.DEFAULT_PROFILE, path) ?? '')) filled.push(path);
    else differs.push(path);
  }
  const apply = async (paths) => {
    for (const path of paths) {
      J.setPath(state.profile, path, String(found[path]));
      fromResume.add(path);
    }
    clearTimeout(saveTimer);
    await J.store.saveProfile(state.profile);
    renderSections();
    updateCompleteness();
    flashSaved();
  };
  await apply(filled);

  const missing = FIELDS.filter((f) => f.required && !String(J.getPath(state.profile, f.path) ?? '').trim()).map((f) => f.path);
  const summary = () => {
    if (!Object.keys(found).length) return 'Jobu couldn’t find profile details in this resume. Fill in your profile below.';
    const parts = [];
    if (filled.length) parts.push(`Filled ${plural(filled.length, 'field')} from your resume. Check the highlighted ones below.`);
    else if (!differs.length) parts.push('Your profile already matches this resume.');
    if (differs.length) parts.push(`Your resume has different values for ${list(differs)}.`);
    if (missing.length) parts.push(`Still needed: ${list(missing)}.`);
    return parts.join(' ');
  };
  const tone = !Object.keys(found).length ? 'warn' : filled.length && !missing.length ? 'ok' : '';
  const replace = {
    label: 'Use the resume’s values',
    run: async () => {
      await apply(differs);
      filled.push(...differs.splice(0));
      showImport(summary(), 'ok');
    },
  };
  showImport(summary(), tone, differs.length ? replace : null);
}

async function storedResume() {
  const { name, type, dataUrl } = state.resume;
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

function wireFiles() {
  for (const box of document.querySelectorAll('.file-field')) {
    const key = box.dataset.key;
    $('input[type=file]', box).onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) storeFile(key, file);
    };
    const drop = $('.file-box', box);
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const file = e.dataTransfer.files[0];
      if (file) storeFile(key, file);
    };
    $('.remove', box).onclick = async () => {
      state[key] = null;
      await chrome.storage.local.remove(key);
      if (key === 'resume') {
        showImport('');
        fromResume.clear();
        renderSections();
      }
      renderFiles();
      updateCompleteness();
    };
  }
  $('#reparse').onclick = async () => fillFromResume(await storedResume());
  // A file dropped outside the boxes would open in place of this page.
  for (const type of ['dragover', 'drop']) {
    document.addEventListener(type, (e) => e.dataTransfer.types.includes('Files') && e.preventDefault());
  }
}

function wireSettings() {
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = !!state.settings[box.dataset.setting];
    box.onchange = async () => {
      state.settings[box.dataset.setting] = box.checked;
      await J.store.saveSettings(state.settings);
      flashSaved();
    };
  }
}

$('#add-answer').onclick = () => {
  state.profile.customAnswers.push({ q: '', a: '' });
  renderAnswers();
  $('#answers .answer:last-child input').focus();
};

// One file that sets Jobu up on another device, such as a phone: profile,
// saved answers, settings, resume, cover letter and tracked jobs. Saved
// passwords stay where they are.
$('#export').onclick = async () => {
  const jobs = await J.store.jobs();
  const data = { jobu: 2, profile: state.profile, settings: state.settings, resume: state.resume, coverLetterFile: state.coverLetterFile, jobs };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'jobu-profile.json' });
  a.click();
  // Phone browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};

// Tracked jobs are added to the ones here; a job tracked on both keeps this
// device's status.
$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.profile) throw new Error('missing profile');
    state.profile = J.deepMerge(J.DEFAULT_PROFILE, data.profile);
    if (data.settings) state.settings = { ...J.DEFAULT_SETTINGS, ...data.settings };
    const files = {};
    for (const key of ['resume', 'coverLetterFile']) if (data[key]?.dataUrl) files[key] = state[key] = data[key];
    const jobs = await J.store.jobs();
    const added = (Array.isArray(data.jobs) ? data.jobs : []).filter((j) => j?.url && !jobs.some((x) => x.url === j.url));
    await Promise.all([J.store.saveProfile(state.profile), J.store.saveSettings(state.settings), chrome.storage.local.set({ ...files, jobs: [...jobs, ...added] })]);
    render();
    flashSaved(`Imported${files.resume ? ' with your resume' : ''}${added.length ? `, ${added.length} tracked job${added.length === 1 ? '' : 's'}` : ''}`);
  } catch (err) {
    alert(`That file isn't a Jobu profile export (${err.message}).`);
  }
};

function render() {
  renderSections();
  renderAnswers();
  renderFiles();
  wireSettings();
  updateCompleteness();
}

(async () => {
  state = await J.store.load();
  wireFiles();
  render();
})();

// Answers learned from a job page while this tab was in the background.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    clearTimeout(saveTimer); // flush pending edits before leaving
    await J.store.saveProfile(state.profile);
    return;
  }
  state = await J.store.load();
  render();
});
