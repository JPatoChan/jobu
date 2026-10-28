// Autofill engine: finds the application's controls in this frame, works out
// what each one asks, and fills it from the saved profile.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search', 'range', 'color']);
  const SELECTOR = 'input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"]';

  // Returns [{ kind, el, group? }]. kind: text | select | combo | file | choice | checkbox
  J.collectControls = (doc = document) => {
    const out = [];
    const groups = new Map();
    for (const el of doc.querySelectorAll(SELECTOR)) {
      if (el.disabled || el.closest('[data-jobu-ui]')) continue;
      const tag = el.tagName;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'INPUT' && SKIP_TYPES.has(type)) continue;
      if (type === 'file') {
        out.push({ kind: 'file', el }); // usually visually hidden behind a drop zone
        continue;
      }
      if (type === 'radio' || type === 'checkbox') {
        if (!J.isVisible(el) && !J.isVisible(el.labels?.[0])) continue;
        const key = el.name || (el.closest('fieldset, [role="radiogroup"], [role="group"]') ?? el);
        if (!groups.has(key)) groups.set(key, { type, inputs: [] });
        groups.get(key).inputs.push(el);
        continue;
      }
      if (!J.isVisible(el) || el.readOnly) continue;
      // A combobox wrapper that contains its own input is handled via the input.
      if (tag !== 'INPUT' && el.getAttribute('role') === 'combobox' && el.querySelector('input')) continue;
      const isCombo =
        tag === 'BUTTON' ||
        (tag !== 'SELECT' && tag !== 'TEXTAREA' && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list'));
      out.push({ kind: tag === 'SELECT' ? 'select' : isCombo ? 'combo' : 'text', el });
    }
    for (const { type, inputs } of groups.values()) {
      if (type === 'checkbox' && inputs.length === 1) out.push({ kind: 'checkbox', el: inputs[0] });
      else out.push({ kind: 'choice', el: inputs[0], group: inputs });
    }
    return out;
  };

  // What is this control asking? Returns { key, question }.
  function describe(c) {
    if (c.kind === 'choice') {
      const question = J.questionText(c.el, c.group);
      return { key: J.classify({ label: question, attrs: c.el.name }), question };
    }
    const s = J.signals(c.el);
    return { key: J.classify(s), question: s.label };
  }

  const currentValue = (c) => {
    if (c.kind === 'choice') return c.group.some((i) => i.checked) ? 'checked' : '';
    if (c.kind === 'checkbox') return '';
    if (c.kind === 'file') return c.el.files?.length ? 'file' : '';
    if (c.el.tagName === 'BUTTON') {
      const t = c.el.textContent.trim();
      return /^(select|choose)\b/i.test(t) ? '' : t;
    }
    if (c.kind === 'select') return c.el.selectedIndex > 0 ? c.el.value : '';
    return c.el.value;
  };

  // The control's current answer as the user would read it.
  function shownValue(c) {
    if (c.kind === 'choice') return c.group.filter((i) => i.checked).map(J.optionText).join(', ');
    if (c.kind === 'checkbox') return c.el.checked ? 'Checked' : '';
    if (c.kind === 'file') return c.el.files?.[0]?.name || '';
    if (c.kind === 'select') return c.el.selectedIndex > 0 ? c.el.options[c.el.selectedIndex].textContent.trim() : '';
    return currentValue(c);
  }

  // Marked required by the form. A resume upload counts too: sites nearly
  // always need one, even when they don't mark it.
  const isRequired = (c, key, question) =>
    J.isRequired(c.el) || /\*\s*$/.test(question) || !!c.el.closest('[aria-required="true"]') || (c.kind === 'file' && key === 'resume');

  function valueFor(c, key, question, data) {
    const { profile } = data;
    if (key && key !== 'resume') {
      let v = J.resolveValue(key, profile);
      if (key === 'coverLetter' && c.el.tagName !== 'TEXTAREA') v = '';
      if (v && c.el.type === 'number') v = v.replace(/[^\d.]/g, '');
      if (v) return v;
    }
    const custom = J.matchCustomAnswer(question, profile.customAnswers);
    return custom ? custom.a : '';
  }

  // What Jobu would put in a control: a string, a stored file for uploads,
  // or null. ctx carries page-wide state so the resume is attached once.
  function plan(c, key, question, data, ctx) {
    if (c.kind === 'file') {
      if (key === 'coverLetter') return data.coverLetterFile;
      const accept = c.el.accept || '';
      const looksLikeResume = key === 'resume' || (!key && !ctx.resumeUsed && (!accept || /pdf|doc/i.test(accept)));
      if (!looksLikeResume || !data.resume) return null;
      ctx.resumeUsed = true;
      return data.resume;
    }
    // Only tick boxes we understand (e.g. "willing to relocate"); never consent boxes.
    if (c.kind === 'checkbox') return (key && J.resolveValue(key, data.profile)) || null;
    return valueFor(c, key, question, data) || null;
  }

  function fill(c, v) {
    if (c.kind === 'file') return J.fillFile(c.el, v);
    if (c.kind === 'checkbox') return J.fillCheckbox(c.el, /^y/i.test(v));
    if (c.kind === 'select') return J.fillSelect(c.el, v);
    if (c.kind === 'combo') return J.fillCombobox(c.el, v);
    if (c.kind === 'choice') return J.fillChoice(c.group, v);
    return J.fillText(c.el, v);
  }

  // Fills every recognised control in this frame. Never clicks Next or Submit;
  // navigate.js does that when the user asks.
  J.autofill = async () => {
    const data = await J.store.load();
    const { settings } = data;
    J.clearMarks();
    const result = { filled: 0, attention: 0, empty: 0, prefilled: 0, total: 0, frame: location.hostname };
    const ctx = {};

    for (const c of J.collectControls()) {
      result.total++;
      const { key, question } = describe(c);
      try {
        if (currentValue(c) && !(settings.overwrite && c.kind !== 'file' && c.kind !== 'choice')) {
          result.prefilled++;
          continue;
        }
        const v = plan(c, key, question, data, ctx);
        const ok = v ? await fill(c, v) : false;
        if (ok) {
          delete c.el.dataset.jobuMissed;
          result.filled++;
          if (settings.highlight) J.mark(c.el, 'filled');
          continue;
        }
        if (v) c.el.dataset.jobuMissed = typeof v === 'object' ? v.name : v; // the control wouldn't take Jobu's answer
        const required = isRequired(c, key, question);
        // A ticked checkbox is answered; an optional one (newsletter, consent) isn't missing information.
        if (c.kind === 'checkbox' && (c.el.checked || !required)) continue;
        result[required ? 'attention' : 'empty']++;
        if (settings.highlight) J.mark(c.el, required ? 'attention' : 'empty');
      } catch (err) {
        console.warn('[Jobu] could not fill', c.el, err);
      }
    }
    if (result.filled) J.filledThisPage = true;
    return result;
  };

  // Reads every control in this frame without changing it: what it asks,
  // what it holds, and what Jobu would put there. Feeds the panel. Fields
  // answered since the last autofill lose their amber outline.
  // status: filled (has a value) | ready (Jobu has an answer) |
  //         missing (required, no answer) | skipped (optional, no answer)
  // missed: the answer autofill tried and the control wouldn't take.
  J.scanPage = async () => {
    const data = await J.store.load();
    const ctx = {};
    // Page order, so the panel (and its guide) go down the form as the user reads it.
    const controls = J.collectControls().sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const fields = controls.map((c) => {
      const { key, question } = describe(c);
      const current = shownValue(c);
      const required = isRequired(c, key, question);
      const v = current ? null : plan(c, key, question, data, ctx);
      const missed = (v && c.el.dataset.jobuMissed) || '';
      if (current) J.clearEmptyMark(c.el);
      return {
        id: J.tag(c.el),
        kind: c.kind,
        key,
        question: question || J.attrText(c.el).trim() || c.kind,
        value: current || (missed ? '' : v && typeof v === 'object' ? v.name : v || ''),
        missed,
        required,
        status: current ? 'filled' : v && !missed ? 'ready' : required ? 'missing' : 'skipped',
      };
    });
    const hasForm = J.looksLikeApplication();
    const nav = J.findNav({ hasForm });
    const step = J.stepInfo();
    // Review steps have few or no inputs; a step indicator plus a Next or
    // Submit button still marks them as part of the application.
    const isApplication = hasForm || (!!step && !!(nav.next || nav.submit));
    return { isApplication, fields, nav, step: isApplication ? step : null, errors: J.pageErrors(), account: J.accountForm() };
  };

  // ---- Attach resume ----

  const DROP_TEXT = /drag\s*(and|&|n|or)\s*drop|drop (your |a |the )?(files?|resume|cv)|drop (it|them) here/i;

  // Smallest visible element that invites dropping a file, preferring one
  // that mentions a resume.
  function findDropZone() {
    const zones = [...document.querySelectorAll('div, section, label, span, p')].filter(
      (z) => z.textContent.length < 300 && DROP_TEXT.test(z.textContent) && J.isVisible(z) && !z.closest('[data-jobu-ui]'),
    );
    const innermost = zones.filter((z) => !zones.some((o) => o !== z && z.contains(o)));
    return innermost.find((z) => /resume|cv\b/i.test(z.closest('section, fieldset, form, div')?.textContent || '')) || innermost[0] || null;
  }

  // Where a resume would go in this frame: the resume file input, any file
  // input that takes documents, or a drop area. score ranks frames against
  // each other; 0 means nowhere.
  function resumeTarget() {
    let best = null;
    for (const c of J.collectControls()) {
      if (c.kind !== 'file') continue;
      const { key, question } = describe(c);
      const score = key === 'resume' ? 3 : key === 'coverLetter' ? 0 : !c.el.accept || /pdf|doc/i.test(c.el.accept) ? 2 : 0;
      if (score > (best?.score || 0)) best = { el: c.el, score, question };
    }
    if (best) return best;
    const zone = findDropZone();
    return zone ? { el: zone, score: 1, drop: true } : { score: 0 };
  }

  J.resumeTargetScore = () => resumeTarget().score;

  // Puts a stored resume ({ name, type, dataUrl }) into this frame's resume
  // upload, replacing any file already there.
  J.attachResume = (stored) => {
    const t = resumeTarget();
    if (!t.el) return { attached: false };
    if (t.drop) {
      J.dropFile(t.el, stored);
      return { attached: true, drop: true };
    }
    const attached = J.fillFile(t.el, stored);
    if (attached) {
      delete t.el.dataset.jobuMissed;
      J.clearEmptyMark(t.el);
    }
    return { attached, question: t.question };
  };

  // Stores answers the user typed into questions Jobu didn't recognise, so
  // the next application with a similar question is filled automatically.
  J.learnAnswers = async () => {
    const data = await J.store.load();
    const answers = [...(data.profile.customAnswers || [])];
    let learned = 0;
    for (const c of J.collectControls()) {
      if (c.kind === 'file' || c.kind === 'checkbox') continue;
      const { key, question } = describe(c);
      if (key || !question || question.length < 4) continue;
      let a = '';
      if (c.kind === 'choice') {
        const checked = c.group.find((i) => i.checked);
        a = checked ? J.optionText(checked) : '';
      }
      else if (c.kind === 'select') a = c.el.selectedIndex > 0 ? c.el.options[c.el.selectedIndex].textContent.trim() : '';
      else a = currentValue(c);
      if (!a || !a.trim()) continue;
      const existing = answers.find((x) => J.normalize(x.q) === J.normalize(question));
      if (existing) existing.a = a;
      else answers.push({ q: question, a });
      learned++;
    }
    if (learned) await J.store.saveProfile({ ...data.profile, customAnswers: answers });
    return { learned };
  };

  // Rough signal that this frame holds a job application form.
  J.looksLikeApplication = () => {
    const controls = J.collectControls();
    if (controls.length < 2 || controls.length > 400) return false;
    let known = 0;
    for (const c of controls) {
      if (c.kind === 'file') known += 2;
      else if (describe(c).key) known++;
      if (known >= 3) return true;
    }
    return false;
  };
})(globalThis);
