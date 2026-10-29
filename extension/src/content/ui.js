// In-page Jobu panel: a floating button that opens a card listing every field
// Jobu found on the page (filled, ready to fill, needs you), with Autofill,
// Next page, Submit and Fill all pages actions. Lives in a shadow root so the
// host page's CSS can't touch it (and vice versa). Top frame only; fields in
// iframes reach it through the service worker's scan.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    button { font: inherit; color: inherit; }
    .fab { display: flex; align-items: center; gap: 8px; border: 0; cursor: pointer; background: #4f46e5; color: #fff; padding: 10px 16px 10px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(79,70,229,.35); font-weight: 600; font-size: 14px; }
    .logo { width: 22px; height: 22px; flex: none; border-radius: 6px; background: #fff; color: #4f46e5; display: grid; place-items: center; font-weight: 800; }
    .panel .logo { background: #4f46e5; color: #fff; width: 28px; height: 28px; border-radius: 8px; }
    .panel { width: 340px; max-height: calc(100vh - 100px); max-height: calc(100dvh - 100px); display: flex; flex-direction: column; background: #fff; border-radius: 16px; box-shadow: 0 16px 40px rgba(17,24,39,.22), 0 0 0 1px rgba(17,24,39,.06); overflow: hidden; }
    header { display: flex; align-items: center; gap: 10px; padding: 12px 10px 10px 14px; border-bottom: 1px solid #eef0f3; }
    .titles { flex: 1; min-width: 0; }
    .job { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { color: #6b7280; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon { flex: none; border: 0; background: none; cursor: pointer; color: #6b7280; width: 28px; height: 28px; border-radius: 8px; font-size: 15px; }
    .body { overflow-y: auto; padding: 12px 14px 14px; }
    .meter { font-size: 12px; color: #4b5563; margin-bottom: 6px; }
    .meter b { font-size: 18px; color: #111827; }
    .bar { height: 6px; border-radius: 99px; background: #eef0f3; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: #22c55e; transition: width .3s; }
    .counts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; font-size: 12px; color: #4b5563; }
    .dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .d-ready { background: #4f46e5; } .d-missing { background: #f59e0b; } .d-filled { background: #22c55e; } .d-skipped { background: #d1d5db; }
    .empty { margin: 0; color: #4b5563; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .btn { border: 1px solid #e5e7eb; background: #fff; padding: 8px 10px; border-radius: 10px; cursor: pointer; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn.primary { grid-column: 1 / -1; background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .btn.dark { background: #111827; border-color: #111827; color: #fff; }
    .btn.wide { grid-column: 1 / -1; }
    .btn.ghost { background: #f5f5ff; border-color: #e0e7ff; color: #4338ca; }
    .resume-row { display: flex; gap: 8px; margin-top: 8px; }
    .resume-row .btn { flex: none; }
    .resume-row select { flex: 1; min-width: 0; font: inherit; font-size: 12px; color: #111827; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0 6px; }
    .tailor { display: block; margin-top: 6px; }
    .confirm { margin-top: 12px; padding: 12px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 12px; }
    .confirm p { margin: 0 0 6px; }
    .cq { font-weight: 700; }
    .cw { color: #b45309; font-weight: 600; }
    .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .status { margin: 10px 0 0; font-size: 12px; color: #4b5563; }
    .status:empty { display: none; }
    .status.ok { color: #15803d; } .status.warn { color: #b45309; }
    .status.busy::before { content: ""; display: inline-block; width: 9px; height: 9px; margin-right: 6px; border: 2px solid #c7d2fe; border-top-color: #4f46e5; border-radius: 50%; vertical-align: -1px; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .errors { margin: 8px 0 0; padding: 8px 10px 8px 26px; background: #fef2f2; color: #b91c1c; border-radius: 10px; font-size: 12px; }
    .guide { margin-top: 12px; padding: 10px 12px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 12px; }
    .guide.optional { border-color: #e5e7eb; background: #f9fafb; }
    .guide.done { border-color: #bbf7d0; background: #f0fdf4; }
    .g-top { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #b45309; }
    .guide.optional .g-top { color: #6b7280; } .guide.done .g-top { color: #15803d; }
    .g-q { margin-top: 4px; font-weight: 700; overflow-wrap: anywhere; }
    .g-q:empty, .g-hint:empty { display: none; }
    .g-hint { margin-top: 2px; color: #4b5563; font-size: 12px; }
    .g-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .g-row .go { flex: 1; }
    .btn.amber { background: #f59e0b; border-color: #f59e0b; color: #fff; }
    .field.current { background: #eef2ff; box-shadow: inset 3px 0 #4f46e5; }
    .account { margin-top: 12px; padding: 10px 12px; border: 1px solid #e0e7ff; background: #f5f5ff; border-radius: 12px; }
    .a-title { font-weight: 700; overflow-wrap: anywhere; }
    .a-text { margin-top: 2px; color: #4b5563; font-size: 12px; }
    .account .g-row { flex-wrap: wrap; }
    .account .go { flex: 1 0 auto; }
    details { margin-top: 12px; }
    summary { cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; padding: 2px 0; }
    .field { display: grid; grid-template-columns: auto 1fr; align-items: baseline; width: 100%; text-align: left; border: 0; background: none; padding: 6px 8px; margin-top: 2px; border-radius: 8px; cursor: pointer; }
    .field .q, .field .v { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .field .dot { grid-row: 1; }
    .field .v { color: #6b7280; font-size: 12px; }
    footer { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 8px; border-top: 1px solid #eef0f3; }
    .link { border: 0; background: none; color: #4f46e5; cursor: pointer; padding: 4px 6px; border-radius: 6px; font-size: 12px; }
    .toast { background: #111827; color: #fff; padding: 10px 14px; border-radius: 10px; max-width: 300px; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
    /* Mouse hover only: on a touch screen it sticks to whatever was tapped. */
    @media (hover: hover) {
      .fab:hover { background: #4338ca; }
      .icon:hover { background: #f3f4f6; color: #111827; }
      .btn:hover:not(:disabled) { border-color: #4f46e5; color: #4f46e5; }
      .btn.primary:hover:not(:disabled) { background: #4338ca; color: #fff; }
      .btn.dark:hover:not(:disabled) { background: #1f2937; color: #fff; }
      .btn.amber:hover:not(:disabled) { background: #d97706; border-color: #d97706; color: #fff; }
      .field:hover { background: #f5f5ff; }
      .link:hover { background: #eef2ff; }
    }
    /* Phones: a sheet along the bottom that leaves the top of the page in view
       (dvh: the height between the browser's toolbars), with bigger targets.
       While the user types in a field on the page it steps aside (.aside), and
       the Jobu button brings it back. */
    @media (max-width: 480px) {
      .wrap { left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
      .panel { width: 100%; max-height: 62vh; max-height: 62dvh; }
      .wrap.open .fab, .wrap.aside .panel { display: none; }
      .wrap.aside .fab { display: flex; }
      .icon { width: 40px; height: 40px; font-size: 17px; }
      .btn { padding: 11px 10px; }
      .link { padding: 8px 8px; font-size: 13px; }
      .field { padding: 9px 8px; }
      .resume-row select { font-size: 16px; }
      .toast { max-width: none; }
    }
  `;

  const SKELETON = `
    <div class="wrap">
      <section class="panel" hidden aria-label="Jobu">
        <header>
          <span class="logo">J</span>
          <div class="titles"><div class="job">Jobu</div><div class="sub"></div></div>
          <button class="icon" data-act="rescan" title="Scan the page again" aria-label="Scan the page again">↻</button>
          <button class="icon" data-act="close" title="Close" aria-label="Close">✕</button>
        </header>
        <div class="body">
          <div class="summary">
            <div class="meter"><b class="answered">0</b> of <span class="of">0</span> <span class="noun">fields</span> answered</div>
            <div class="bar"><i></i></div>
            <div class="counts"></div>
          </div>
          <p class="empty" hidden></p>
          <div class="actions">
            <button class="btn primary" data-act="autofill">Autofill this page</button>
            <button class="btn" data-act="next">Next page →</button>
            <button class="btn dark" data-act="submit">Submit</button>
            <button class="btn ghost wide" data-act="flow">Fill all pages</button>
          </div>
          <div class="resume-row">
            <button class="btn" data-act="attach">📎 Attach resume</button>
            <select class="which" aria-label="Resume to attach"></select>
          </div>
          <button class="link tailor" data-act="tailor">✨ Tailor my resume to this job</button>
          <div class="confirm" hidden role="alertdialog" aria-label="Confirm submission">
            <p class="cq">Submit your application?</p>
            <p class="cd"></p>
            <p class="cw" hidden></p>
            <div class="row">
              <button class="btn" data-act="cancel">Cancel</button>
              <button class="btn dark" data-act="confirm">Submit application</button>
            </div>
          </div>
          <p class="status" role="status"></p>
          <ul class="errors" hidden></ul>
          <div class="guide" hidden role="group" aria-label="Fields Jobu left empty">
            <div class="g-top"><span class="g-tag"></span><span class="g-pos"></span></div>
            <div class="g-text" aria-live="polite"><div class="g-q"></div><div class="g-hint"></div></div>
            <div class="g-row">
              <button class="btn" data-act="guidePrev" title="Previous empty field" aria-label="Previous empty field">←</button>
              <button class="btn amber go" data-act="guideNext"></button>
              <button class="link" data-act="guideEnd">Done</button>
            </div>
          </div>
          <div class="account" hidden role="group" aria-label="Job site account">
            <div class="a-title"></div>
            <div class="a-text"></div>
            <div class="g-row">
              <button class="btn dark go" data-act="accountMain"></button>
              <button class="link" data-act="accountAlt"></button>
            </div>
          </div>
          <div class="fields"></div>
        </div>
        <footer>
          <button class="link" data-act="save">Save job</button>
          <button class="link" data-act="applied">Mark applied</button>
          <button class="link" data-act="learn">Remember my answers</button>
          <button class="link" data-act="profile">Profile</button>
          <button class="link" data-act="hide">Hide</button>
        </footer>
      </section>
      <div class="toasts"></div>
      <button class="fab" title="Open Jobu (Alt+Shift+J)"><span class="logo">J</span><span>Jobu</span></button>
    </div>`;

  const GROUPS = [
    ['missing', 'Needs you'],
    ['ready', 'Ready to fill'],
    ['filled', 'Filled'],
    ['skipped', 'Optional, no saved answer'],
  ];
  const expanded = { missing: true, ready: true, filled: false, skipped: false };

  let host;
  let shadow;
  let isOpen = false;
  let aside = false; // phone: the open panel is out of the way while the user types
  let busy = null; // null | 'autofill' | 'next' | 'submit' | 'flow'
  let scan = null;
  // While stepping through empty fields: the field the guide is on, and its
  // place in the list (where the next one will be once it's answered).
  let guide = null; // { id, frameId, question, at }
  let chosenResume = null; // id the user picked in the resume picker
  let toastTimer;
  let refreshTimer;

  const $ = (sel) => shadow.querySelector(sel);
  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch (e) {
      return Promise.reject(e); // extension reloaded under this page
    }
  };

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.append(...children);
    return n;
  }

  function ensureHost() {
    if (window.top !== window) return false;
    if (host) return true;
    host = el('div');
    host.dataset.jobuUi = '';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${SKELETON}`;
    $('.fab').onclick = () => (aside ? stepAside(false) : setOpen(!isOpen));
    $('.which').onchange = (e) => {
      chosenResume = e.target.value;
      e.target.title = e.target.selectedOptions[0]?.label || '';
    };
    shadow.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) actions[act]();
    });
    const typing = (e) => isOpen && PHONE.matches && typesIn(e.target) && stepAside(true);
    document.addEventListener('focusin', typing, true);
    // A tap on a field that kept focus (the Jobu button brought the panel
    // back over it) fires no focusin.
    document.addEventListener('pointerdown', typing, true);
    // Back once focus leaves the page's fields, not when it moves between them
    // or to the Jobu button (tapping it focuses it first on Android; its click
    // brings the panel back).
    document.addEventListener('focusout', () => {
      if (aside) setTimeout(() => !typesIn(document.activeElement) && document.activeElement !== host && stepAside(false));
    }, true);
    document.documentElement.append(host);
    return true;
  }

  // On a phone the open panel would cover the field being typed in, and the
  // keyboard, so it steps aside while one has focus (CSS .aside). A field in
  // a frame focuses the frame itself.
  const PHONE = matchMedia('(max-width: 480px)');
  const NO_TYPING = /^(button|checkbox|radio|file|submit|reset|image|range|color|hidden)$/;
  const typesIn = (t) =>
    !!t && t !== host && (t.tagName === 'TEXTAREA' || t.tagName === 'IFRAME' || t.isContentEditable || (t.tagName === 'INPUT' && !NO_TYPING.test(t.type)));

  function stepAside(on) {
    aside = on;
    $('.wrap').classList.toggle('aside', on);
  }

  function setOpen(open) {
    if (!ensureHost()) return Promise.resolve();
    if (!open) endGuide();
    isOpen = open;
    stepAside(false);
    $('.panel').hidden = !open;
    $('.wrap').classList.toggle('open', open);
    return open ? refresh() : Promise.resolve();
  }

  function status(text, tone = '') {
    $('.status').textContent = text;
    $('.status').className = `status ${tone}`;
  }

  J.toast = (text, ms = 6000) => {
    if (!ensureHost()) return;
    const t = el('div', { className: 'toast', textContent: text });
    $('.toasts').replaceChildren(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  };

  async function refresh() {
    clearTimeout(refreshTimer);
    if (!isOpen) return;
    try {
      const s = await send({ type: 'SCAN_TAB' });
      if (s?.error) status(s.error, 'warn');
      else if (s) render(s);
    } catch {
      status('Jobu was updated. Reload the page to keep using it.', 'warn');
    }
  }

  // Called on page mutations and field edits; ignored while an action runs.
  J.scheduleRefresh = () => {
    if (!isOpen || busy) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 900);
  };

  function setBusy(kind) {
    busy = kind;
    updateButtons();
  }

  function updateButtons() {
    const nav = scan?.nav || {};
    const flowing = busy === 'flow';
    const set = (act, label, disabled, title) => {
      const b = $(`[data-act="${act}"]`);
      b.textContent = label;
      b.disabled = disabled;
      b.title = title;
    };
    set('autofill', busy === 'autofill' ? 'Filling…' : 'Autofill this page', !!busy, 'Fill every field Jobu has an answer for');
    set(
      'next',
      nav.next ? `${nav.next.label} →` : 'Next page →',
      !!busy || !nav.next || nav.next.disabled,
      nav.next ? `Click “${nav.next.label}” and autofill the next page` : 'No Next or Continue button on this page',
    );
    set(
      'submit',
      nav.submit ? nav.submit.label : 'Submit',
      !!busy || !nav.submit || nav.submit.disabled,
      nav.submit ? `Click “${nav.submit.label}”` : 'No submit button on this page yet',
    );
    set('flow', flowing ? 'Stop' : 'Fill all pages', !!busy && !flowing, 'Autofill each page and click Next until the last page, then stop for your review');
    const resumes = scan?.resumes || [];
    set(
      'attach',
      resumes.length ? (busy === 'attach' ? 'Attaching…' : '📎 Attach resume') : '📎 Add a resume',
      !!busy,
      resumes.length ? "Put this resume into the application's upload field" : 'Add your resume to your Jobu profile',
    );
    renderGuide();
  }

  // Sign-in and create-account forms: what Jobu can do with the password.
  // Each button's op goes to the service worker, which does the filling.
  let accountOps = {};

  function renderAccount(a) {
    const box = $('.account');
    box.hidden = !a;
    if (!a) return;
    const create = a.kind === 'create';
    const saved = a.saved || [];
    const [main, alt] = [$('[data-act="accountMain"]'), $('[data-act="accountAlt"]')];
    const text = (title, body, mainOp, mainLabel, altOp = null, altLabel = '') => {
      $('.a-title').textContent = title;
      $('.a-text').textContent = body;
      accountOps = { accountMain: mainOp, accountAlt: altOp };
      main.textContent = mainLabel;
      main.hidden = !mainOp;
      alt.textContent = altLabel;
      alt.hidden = !altOp;
      main.disabled = alt.disabled = !!busy;
    };
    const title = create ? `Creating an account on ${a.site}?` : `Signing in to ${a.site}?`;
    if (a.vault === 'none') {
      return text(title, 'Jobu can make a strong password for each job site, fill it in, and keep it encrypted for next time.', 'setup', 'Turn on saved passwords');
    }
    if (a.vault === 'locked') {
      const body = saved.length ? `You have a saved password here (${saved.join(', ')}). Unlock your saved passwords to use it.` : 'Unlock your saved passwords so Jobu can make and save one for this site.';
      return text(title, body, 'setup', 'Unlock saved passwords');
    }
    const typed = a.typed ? ['save', 'Save the password I typed'] : [];
    if (create) {
      return text(
        title,
        'Jobu makes a strong password, fills it in (both boxes if there are two) and saves it for this site.',
        'create',
        '🔑 Create password',
        ...(saved.length ? ['fill', 'Use my saved password'] : typed),
      );
    }
    if (saved.length) return text(title, `Saved password for ${saved.join(', ')}.`, 'fill', '🔑 Fill saved password', ...typed);
    return text(title, 'No saved password for this site yet. Sign in, and Jobu can save the password you type.', typed[0] || null, typed[1] || '');
  }

  async function accountAction(slot) {
    const op = accountOps[slot];
    if (op === 'setup') return send({ type: 'OPEN_OPTIONS', section: 'passwords' }).catch(() => {});
    setBusy('password');
    status(op === 'create' ? 'Making a password…' : 'Working…', 'busy');
    const r = await send({ type: 'ACCOUNT_PASSWORD', op, frameId: scan.account.frameId }).catch((e) => ({ error: e.message }));
    setBusy(null);
    const { text, tone } = J.describeResult(r);
    status(text, tone);
    if (r?.vault) send({ type: 'OPEN_OPTIONS', section: 'passwords' }).catch(() => {});
    await refresh();
  }

  // The picker shows the default resume (one tailored for this job, if any)
  // until the user picks another.
  function renderResumes(resumes = []) {
    const select = $('.which');
    select.replaceChildren(...resumes.map((r) => new Option(r.label, r.id)));
    if (resumes.some((r) => r.id === chosenResume)) select.value = chosenResume;
    select.hidden = resumes.length < 2;
    select.title = resumes.find((r) => r.id === select.value)?.label || '';
  }

  const questionOf = (f) => f.question.replace(/\s*\*\s*$/, '');
  const fieldKey = (f) => `${f.frameId}:${f.id}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function fieldRow(f) {
    const question = questionOf(f) + (f.required ? ' *' : '');
    const value =
      f.value || (f.missed ? `Didn't take Jobu's answer: ${f.missed}` : f.status === 'missing' ? 'Required: Jobu has no answer' : 'No saved answer');
    const b = el('button', { className: 'field', title: `${question}\n${value}` }, [
      el('span', { className: `dot d-${f.status}` }),
      el('span', { className: 'q', textContent: question }),
      el('span', { className: 'v', textContent: value }),
    ]);
    b.dataset.field = fieldKey(f);
    b.onclick = () => {
      const at = emptyFields().findIndex((e) => fieldKey(e) === fieldKey(f));
      if (at >= 0) return goTo(at);
      send({ type: 'FOCUS_FIELD', frameId: f.frameId, id: f.id }).catch(() => {});
    };
    return b;
  }

  // ---- Guide through empty fields ----

  // Fields still without an answer, required ones first, each in page order.
  // An unticked optional checkbox (newsletter, consent) isn't missing anything.
  function emptyFields() {
    const fields = scan?.isApplication ? scan.fields : [];
    return [...fields.filter((f) => f.status === 'missing'), ...fields.filter((f) => f.status === 'skipped' && f.kind !== 'checkbox')];
  }

  function hintFor(f) {
    if (f.missed) {
      return f.kind === 'file'
        ? `Jobu couldn't attach ${f.missed}. Upload it here.`
        : `This field didn't take Jobu's answer, “${f.missed}”. Pick the closest option.`;
    }
    if (f.kind === 'file' && f.key === 'resume') return 'Upload your resume here. Add it to your Jobu profile and Jobu attaches it for you next time.';
    if (f.kind === 'file') return f.required ? 'Upload a file here.' : 'Optional. Upload a file here if you want to.';
    if (f.kind === 'checkbox') return 'Tick this box if it applies to you.';
    const tip = f.key ? '' : ' Use “Remember my answers” afterwards to save it for next time.';
    return (f.required ? 'Jobu has no saved answer. Fill it in on the page.' : 'Optional. Jobu has no saved answer. Fill it in or skip it.') + tip;
  }

  // Moves the guide to the at-th empty field: scrolls the page to it,
  // focuses it and outlines it.
  function goTo(at) {
    const f = emptyFields()[at];
    if (!f) return;
    guide = { id: f.id, frameId: f.frameId, question: questionOf(f), at };
    send({ type: 'FOCUS_FIELD', frameId: f.frameId, id: f.id, current: true }).catch(() => {});
    renderGuide();
  }

  function endGuide() {
    if (!guide) return;
    guide = null;
    send({ type: 'END_GUIDE' }).catch(() => {});
    if (host) renderGuide();
  }

  function renderGuide() {
    const todo = emptyFields();
    const at = guide ? todo.findIndex((f) => f.id === guide.id && f.frameId === guide.frameId) : -1;
    // The guide's field went away (a new step loaded): start over.
    if (guide && at < 0 && !scan?.fields.some((f) => f.id === guide.id && f.frameId === guide.frameId)) guide = null;
    const box = $('.guide');
    box.hidden = !guide && (!todo.length || !!busy);
    const set = (sel, text) => ($(sel).textContent = text);
    const prev = $('[data-act="guidePrev"]');
    const next = $('[data-act="guideNext"]');
    const done = $('[data-act="guideEnd"]');
    next.hidden = !todo.length;
    next.disabled = !!busy;
    done.hidden = !guide;

    if (!guide) {
      const req = todo.filter((f) => f.required).length;
      const opt = todo.length - req;
      box.className = `guide${req ? '' : ' optional'}`;
      set('.g-tag', 'Left empty');
      set('.g-pos', '');
      set('.g-q', req && opt ? `${plural(req, 'required field')} and ${opt} optional` : req ? plural(req, 'required field') : plural(opt, 'optional field'));
      set('.g-hint', 'Jobu takes you to each one so you can answer it.');
      next.textContent = 'Show me →';
      prev.hidden = true;
    } else if (at >= 0) {
      const f = todo[at];
      guide.at = at;
      box.className = `guide${f.required ? '' : ' optional'}`;
      set('.g-tag', f.required ? 'Required' : 'Optional');
      set('.g-pos', `${at + 1} of ${todo.length}`);
      set('.g-q', guide.question);
      set('.g-hint', hintFor(f));
      next.textContent = 'Next empty field →';
      next.disabled ||= todo.length < 2;
      prev.hidden = false;
      prev.disabled = !!busy || todo.length < 2;
    } else {
      // The user answered the field the guide is on.
      box.className = 'guide done';
      set('.g-tag', '✓ Answered');
      set('.g-pos', todo.length ? `${todo.length} left` : '');
      set('.g-q', guide.question);
      set('.g-hint', todo.length ? '' : 'Every field has an answer now. Look the page over, then continue.');
      next.textContent = 'Next empty field →';
      prev.hidden = true;
    }
    for (const row of shadow.querySelectorAll('.field')) {
      row.classList.toggle('current', !!guide && row.dataset.field === `${guide.frameId}:${guide.id}`);
    }
  }

  function render(s) {
    scan = s;
    const job = s.job || {};
    const c = s.counts;
    $('.job').textContent = job.title || 'Jobu';
    $('.sub').textContent = [job.company, job.ats !== 'Other' && job.ats, s.step && `Step ${s.step.current} of ${s.step.total}`]
      .filter(Boolean)
      .join(' · ');

    $('.summary').hidden = !s.isApplication;
    $('.empty').hidden = s.isApplication;
    $('.empty').textContent = s.nav.next
      ? `No application form here yet. “${s.nav.next.label}” should open it.`
      : 'No application form found on this page.';
    const relevant = c.total - c.skipped;
    $('.answered').textContent = c.filled;
    $('.of').textContent = relevant;
    $('.noun').textContent = relevant === 1 ? 'field' : 'fields';
    $('.bar i').style.width = `${relevant ? Math.round((100 * c.filled) / relevant) : 0}%`;
    const words = { ready: 'to fill', missing: 'need you', filled: 'filled', skipped: 'optional' };
    $('.counts').replaceChildren(
      ...Object.entries(words)
        .filter(([k]) => c[k])
        .map(([k, word]) => el('span', {}, [el('i', { className: `dot d-${k}` }), `${c[k]} ${word}`])),
    );

    renderResumes(s.resumes);
    renderAccount(s.account);
    $('.errors').hidden = !s.errors.length;
    $('.errors').replaceChildren(...s.errors.map((t) => el('li', { textContent: t })));

    $('.fields').replaceChildren(
      ...GROUPS.flatMap(([key, title]) => {
        const items = s.fields.filter((f) => f.status === key);
        if (!items.length) return [];
        const d = el('details', { open: expanded[key] }, [el('summary', { textContent: `${title} (${items.length})` })]);
        d.addEventListener('toggle', () => (expanded[key] = d.open));
        d.append(...items.map(fieldRow));
        return [d];
      }),
    );
    updateButtons();
  }

  function confirmSubmit(missing) {
    const job = scan?.job;
    const label = scan?.nav.submit?.label || 'Submit';
    const what = job?.title ? ` for ${job.title}${job.company ? ` at ${job.company}` : ''}` : '';
    $('.cd').textContent = `Jobu will click “${label}”${what}. You can't undo this.`;
    $('.cw').textContent = missing
      ? `${missing} required field${missing === 1 ? ' is' : 's are'} still empty. The site may reject the application.`
      : '';
    $('.cw').hidden = !missing;
    $('[data-act="confirm"]').textContent = missing ? 'Submit anyway' : 'Submit application';
    $('.confirm').hidden = false;
  }

  // Next, Submit and Fill all pages can replace this page, so their outcome
  // arrives through J.reportResult instead of the message reply.
  function start(kind, text, msg) {
    endGuide();
    setBusy(kind);
    status(text, 'busy');
    send(msg).catch(() => {});
  }

  const saveJob = (job, text) =>
    send({ type: 'SAVE_JOB', job }).then(() => status(text, 'ok'), () => {});

  const actions = {
    rescan: () => refresh(),
    close: () => setOpen(false),
    async autofill() {
      setBusy('autofill');
      status('Filling…', 'busy');
      const r = await send({ type: 'AUTOFILL_TAB' }).catch((e) => ({ error: e.message }));
      setBusy(null);
      const { text, tone } = J.describeResult(r);
      status(text, tone);
      await refresh();
    },
    next: () => start('next', 'Going to the next page…', { type: 'NEXT_TAB' }),
    async attach() {
      if (!scan?.resumes?.length) return actions.profile();
      setBusy('attach');
      status('Attaching…', 'busy');
      const r = await send({ type: 'ATTACH_RESUME', resume: $('.which').value }).catch((e) => ({ error: e.message }));
      setBusy(null);
      const { text, tone } = J.describeResult(r);
      status(text, tone);
      await refresh();
    },
    tailor: () => send({ type: 'TAILOR_RESUME' }).catch(() => {}),
    accountMain: () => accountAction('accountMain'),
    accountAlt: () => accountAction('accountAlt'),
    async submit() {
      const { settings } = await J.store.load();
      const missing = scan?.counts.missing || 0;
      if (settings.confirmSubmit || missing) return confirmSubmit(missing);
      start('submit', 'Submitting…', { type: 'SUBMIT_TAB' });
    },
    confirm() {
      $('.confirm').hidden = true;
      start('submit', 'Submitting…', { type: 'SUBMIT_TAB', force: true });
    },
    cancel: () => ($('.confirm').hidden = true),
    guideNext() {
      const todo = emptyFields();
      if (!todo.length) return scan?.isApplication && status('Every field on this page has an answer.', 'ok');
      const at = guide ? todo.findIndex((f) => f.id === guide.id && f.frameId === guide.frameId) : -1;
      goTo(!guide ? 0 : at >= 0 ? (at + 1) % todo.length : guide.at % todo.length);
    },
    guidePrev() {
      const todo = emptyFields();
      const at = guide ? todo.findIndex((f) => f.id === guide.id && f.frameId === guide.frameId) : -1;
      if (at >= 0) goTo((at - 1 + todo.length) % todo.length);
    },
    guideEnd: () => endGuide(),
    flow() {
      if (busy !== 'flow') return start('flow', 'Filling all pages…', { type: 'APPLY_FLOW' });
      send({ type: 'STOP_FLOW' }).catch(() => {});
      status('Stopping after this step…', 'busy');
    },
    save: () => saveJob(scan?.job || J.extractJob(), 'Saved to your Jobu tracker.'),
    applied: () => saveJob({ ...(scan?.job || J.extractJob()), status: 'applied' }, 'Marked as applied.'),
    async learn() {
      const r = await send({ type: 'LEARN_TAB' }).catch(() => null);
      const n = r?.learned || 0;
      status(n ? `Saved ${n} answer${n === 1 ? '' : 's'} for future applications.` : 'No new custom answers found.', n ? 'ok' : '');
      refresh();
    },
    profile: () => send({ type: 'OPEN_OPTIONS' }).catch(() => {}),
    hide() {
      endGuide();
      host.remove();
      host = null;
      isOpen = false;
    },
  };

  // Back from the profile tab (say, after unlocking saved passwords): rescan.
  document.addEventListener('visibilitychange', () => document.hidden || J.scheduleRefresh());

  // Floating button only; shown when an application form is detected.
  J.showButton = () => ensureHost();
  J.openPanel = () => setOpen(true);
  J.togglePanel = () => setOpen(!isOpen);

  // Shortcut: open the panel and go to the next field Jobu left empty.
  J.guideNext = async () => {
    if (!ensureHost()) return;
    await setOpen(true);
    actions.guideNext();
  };

  J.showProgress = (text) => {
    if (!ensureHost()) return;
    setOpen(true);
    setBusy('flow');
    status(text, 'busy');
  };

  J.askSubmit = async () => {
    if (!ensureHost()) return;
    await setOpen(true);
    if (!scan?.nav.submit) return status("Couldn't find a submit button on this page.", 'warn');
    confirmSubmit(scan.counts.missing);
  };

  // Outcome of an action, from the service worker. A shortcut autofill with
  // the panel closed gets a toast; everything else opens the panel.
  J.reportResult = (r) => {
    if (!r || r.asked || !ensureHost()) return;
    const { text, tone } = J.describeResult(r);
    if (r.action === 'autofill' && !isOpen) return J.toast(text);
    setBusy(null);
    status(text, tone);
    setOpen(true).then(() => {
      if (r.action === 'submit' && r.blocked) confirmSubmit(r.missing);
    });
  };
})(globalThis);
