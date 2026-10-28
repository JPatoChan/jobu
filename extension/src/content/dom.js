// DOM helpers: reading the question behind a control and filling controls in
// a way that framework-managed forms (React, Vue, Workday) register.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const CONTROL_SEL = 'input:not([type=hidden]), select, textarea, [role="combobox"], button[aria-haspopup="listbox"]';

  J.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  J.waitFor = async (fn, timeout = 1500, step = 50) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v && (!Array.isArray(v) || v.length)) return v;
      await J.sleep(step);
    }
    return null;
  };

  J.isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  // Text of a node without the text of any controls or options nested in it.
  function ownText(node) {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('input, select, textarea, option, button, [role="listbox"], [aria-hidden="true"], .sr-only').forEach((n) => n.remove());
    return clean(c.textContent);
  }

  function byIds(el, attr) {
    const ids = el.getAttribute(attr);
    if (!ids) return '';
    return ids
      .split(/\s+/)
      .map((id) => ownText(el.ownerDocument.getElementById(id)))
      .join(' ');
  }

  const LABEL_CANDIDATES =
    'label, legend, [class*="label" i], [class*="question" i], [class*="title" i], [data-automation-id*="formLabel" i], [data-automation-id*="richText" i], h2, h3, h4, h5, p, span';

  // Finds the question text that precedes a control (or group of controls)
  // inside the nearest container that holds nothing but that control/group.
  J.questionText = (el, group = [el]) => {
    const groupSet = new Set(group);
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.tagName === 'FIELDSET') {
        const legend = node.querySelector(':scope > legend');
        if (legend && ownText(legend)) return ownText(legend);
      }
      const describedBy = node.getAttribute('aria-labelledby');
      if (describedBy && /^(radiogroup|group)$/.test(node.getAttribute('role') || '')) {
        const t = byIds(node, 'aria-labelledby');
        if (t) return t;
      }
      const others = [...node.querySelectorAll(CONTROL_SEL)].filter((c) => !groupSet.has(c));
      if (others.length) break; // container now spans other questions
      for (const cand of node.querySelectorAll(LABEL_CANDIDATES)) {
        if (group.some((g) => cand.contains(g))) continue;
        const wrap = cand.closest('label');
        if (wrap && group.some((g) => wrap.contains(g))) continue; // an option's own text
        if (!(cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (cand.htmlFor && !group.some((g) => g.id === cand.htmlFor)) continue;
        const t = ownText(cand);
        if (t.length >= 2 && t.length <= 400) return t;
      }
    }
    return '';
  };

  // Human-readable label for a single control.
  J.labelFor = (el) => {
    const parts = [byIds(el, 'aria-labelledby')];
    if (el.labels) for (const l of el.labels) parts.push(ownText(l));
    parts.push(el.getAttribute('aria-label') || '');
    const direct = clean(parts.join(' '));
    if (direct) return direct;
    return J.questionText(el) || el.getAttribute('placeholder') || el.getAttribute('title') || '';
  };

  J.attrText = (el) =>
    ['name', 'id', 'data-automation-id', 'data-qa', 'data-testid', 'placeholder']
      .map((a) => el.getAttribute(a) || '')
      .join(' ');

  J.signals = (el) => ({ label: J.labelFor(el), attrs: J.attrText(el), autocomplete: el.getAttribute('autocomplete') });

  J.optionText = (input) => {
    const parts = [];
    if (input.labels) for (const l of input.labels) parts.push(ownText(l));
    parts.push(byIds(input, 'aria-labelledby'), input.getAttribute('aria-label') || '');
    let t = clean(parts.join(' '));
    if (!t && input.nextSibling) t = clean(input.nextSibling.textContent);
    return t || input.value;
  };

  J.isRequired = (el) =>
    el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(J.labelFor(el));

  // ---- Filling primitives ----

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value); // bypasses React's value tracker so onChange fires
  }

  const fire = (el, ...types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));

  function clickLikeUser(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }
  J.clickLikeUser = clickLikeUser;

  J.fillText = (el, value) => {
    el.focus();
    setNativeValue(el, value);
    fire(el, 'input', 'change');
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
    el.blur();
    fire(el, 'blur', 'focusout');
    return true;
  };

  J.fillSelect = (el, value) => {
    const opts = [...el.options].map((o) => ({ text: o.textContent, value: o.value, o }));
    const best = J.bestOption(opts, value) || J.bestOption(opts.map((x) => ({ ...x, text: x.value })), value);
    if (!best) return false;
    setNativeValue(el, best.value);
    best.o.selected = true;
    fire(el, 'input', 'change');
    return true;
  };

  J.fillChoice = (inputs, value) => {
    const opts = inputs.map((i) => ({ text: J.optionText(i), i }));
    const best = J.bestOption(opts, value);
    if (!best) return false;
    if (!best.i.checked) clickLikeUser(best.i);
    if (!best.i.checked) {
      // Some styled radios hide the input; click its label instead.
      if (best.i.labels?.[0]) best.i.labels[0].click();
    }
    return best.i.checked;
  };

  J.fillCheckbox = (el, checked) => {
    if (el.checked !== checked) clickLikeUser(el);
    return el.checked === checked;
  };

  function dataUrlToFile({ dataUrl, name, type }) {
    const [, b64] = dataUrl.split(',');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: type || 'application/octet-stream' });
  }

  J.fillFile = (el, stored) => {
    const dt = new DataTransfer();
    dt.items.add(dataUrlToFile(stored));
    el.files = dt.files;
    fire(el, 'input', 'change');
    return el.files.length > 0;
  };

  // For upload areas with no file input: drags the file onto them as a user would.
  J.dropFile = (zone, stored) => {
    const dt = new DataTransfer();
    dt.items.add(dataUrlToFile(stored));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  };

  const visibleOptions = () =>
    [...document.querySelectorAll('[role="option"], [id^="react-select"][id*="-option-"]')].filter(J.isVisible);

  // Custom dropdowns: react-select style inputs (type to filter) and
  // Workday/ARIA buttons that open a listbox.
  J.fillCombobox = async (el, value) => {
    el.scrollIntoView({ block: 'center' });
    el.focus();
    if (el.tagName === 'INPUT') {
      setNativeValue(el, value);
      fire(el, 'input');
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    } else {
      clickLikeUser(el);
    }
    let opts = await J.waitFor(visibleOptions, 1500);
    if (!opts && el.tagName === 'INPUT') {
      // Filtering by the full answer can hide everything; open the full list.
      setNativeValue(el, '');
      fire(el, 'input');
      clickLikeUser(el);
      opts = await J.waitFor(visibleOptions, 800);
    }
    const best = opts && J.bestOption(opts.map((o) => ({ text: o.textContent, o })), value);
    if (best) {
      best.o.scrollIntoView({ block: 'nearest' });
      clickLikeUser(best.o);
      await J.sleep(150);
      return true;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    if (el.tagName === 'INPUT') {
      setNativeValue(el, '');
      fire(el, 'input');
    }
    el.blur();
    return false;
  };

  // ---- Panel support ----

  // Stable handle for a control or button so the panel can point back at it.
  // The counter lives on J so re-injected scripts don't reuse ids.
  J.tag = (el) => (el.dataset.jobuId ||= `j${(J.seq = (J.seq || 0) + 1)}`);
  J.byTag = (id) => document.querySelector(`[data-jobu-id="${id}"]`);

  // Scrolls a field into view, focuses it and pulses it briefly. With
  // current, it also keeps the field outlined (the panel's guide is on it).
  J.focusField = (id, { current = false } = {}) => {
    const el = J.byTag(id);
    if (!el) return false;
    const target = J.fieldBox(el);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (J.isVisible(el)) el.focus({ preventScroll: true });
    if (current) J.setCurrent(el);
    const prev = target.style.boxShadow;
    target.style.boxShadow = '0 0 0 4px rgba(79, 70, 229, .45)';
    setTimeout(() => (target.style.boxShadow = prev), 1600);
    return true;
  };

  // Validation messages the site is showing, e.g. after a rejected Next.
  J.pageErrors = () => {
    const seen = new Set();
    const sel = '[role="alert"], [aria-live="assertive"], [class*="error" i], [data-automation-id*="error" i]';
    for (const n of document.querySelectorAll(sel)) {
      if (seen.size >= 5) break;
      if (n.querySelector('input, select, textarea') || !J.isVisible(n)) continue;
      const t = clean(n.textContent);
      if (t && t.length <= 160) seen.add(t);
    }
    return [...seen];
  };

  // ---- Highlighting ----

  // The element to outline for a control: the smallest box around a radio or
  // checkbox group, the label of a lone checkbox or a hidden file input,
  // otherwise the control itself.
  J.fieldBox = (el) => {
    if (el.type === 'radio' || el.type === 'checkbox') {
      const peers = el.name ? [...document.getElementsByName(el.name)].filter((p) => p.type === el.type) : [];
      if (peers.length > 1) {
        let box = el.parentElement;
        while (box?.parentElement && !peers.every((p) => box.contains(p))) box = box.parentElement;
        return box || el;
      }
    }
    if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file' || !J.isVisible(el)) {
      return el.labels?.[0] || el.closest('label') || el.parentElement || el;
    }
    return el;
  };

  // filled: Jobu filled it. attention: required, and Jobu couldn't fill it.
  // empty: optional, left empty. current: the panel's guide is on it.
  const OUTLINES = { filled: '2px solid #22c55e', attention: '2px solid #f59e0b', empty: '2px dashed #f59e0b', current: '3px solid #4f46e5' };

  function paint(t) {
    const state = 'jobuCurrent' in t.dataset ? 'current' : t.dataset.jobuMark;
    if (state) {
      if (!('jobuOutline' in t.dataset)) t.dataset.jobuOutline = t.style.outline;
      t.style.outline = OUTLINES[state];
      t.style.outlineOffset = '2px';
    } else if ('jobuOutline' in t.dataset) {
      t.style.outline = t.dataset.jobuOutline;
      t.style.outlineOffset = '';
      delete t.dataset.jobuOutline;
    }
  }

  // state: filled | attention | empty, or null to remove the mark.
  J.mark = (el, state) => {
    const t = J.fieldBox(el);
    if (state) t.dataset.jobuMark = state;
    else delete t.dataset.jobuMark;
    paint(t);
  };
  J.clearMarks = () =>
    document.querySelectorAll('[data-jobu-mark]').forEach((t) => {
      delete t.dataset.jobuMark;
      paint(t);
    });

  // Moves the guide's outline to el, or removes it when el is null.
  J.setCurrent = (el) => {
    document.querySelectorAll('[data-jobu-current]').forEach((t) => {
      delete t.dataset.jobuCurrent;
      paint(t);
    });
    if (!el) return;
    const t = J.fieldBox(el);
    t.dataset.jobuCurrent = '';
    paint(t);
  };

  // Once a field Jobu left empty has an answer, its amber outline goes.
  J.clearEmptyMark = (el) => {
    const state = J.fieldBox(el).dataset.jobuMark;
    if (state === 'attention' || state === 'empty') J.mark(el, null);
  };

  // From the page's input and change events, so the outline goes as the user types.
  J.markAnswered = (el) => {
    if (!el?.matches?.('input, select, textarea') || el.closest('[data-jobu-ui]')) return;
    const answered = el.type === 'radio' || el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files?.length > 0 : !!el.value.trim();
    if (answered) J.clearEmptyMark(el);
  };
})(globalThis);
