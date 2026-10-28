// Multi-step navigation: finds the button that moves an application to its
// next page and the one that submits it, and clicks them like a user would.
// The service worker decides when (see goNext / submitTab in background.js).
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const BUTTONS = 'button, input[type=submit], input[type=button], [role="button"], a[href]';
  const IGNORE_AREAS = '[data-jobu-ui], [id*="cookie" i], [class*="cookie" i], [id*="onetrust" i], [id*="consent-banner" i], [class*="consent-banner" i]';

  // All matched against normalized button text (see J.normalize).
  const AVOID = /\b(back|previous|prev|cancel|close|dismiss|sign ?in|log ?in|sign ?up|register|create (an )?account|upload|attach|add|remove|delete|clear|draft|later|withdraw|search|filter|subscribe|share|print|edit|autofill|import|apply (with|using)|linked ?in|indeed|google|refer|feedback|accept|reject|decline|cookies?|read|learn more|more jobs|similar)\b/;
  const NEXT = /^(next|continue|proceed|(save|submit) (and|&) (continue|next|proceed|go to next)|go to next|review (and|&) submit|review (your |my )?application$|review$)\b/;
  const SUBMIT = /^(submit|finish$|(send|complete|finalize) (my |your |the )?application)\b/;
  // A job posting's call to action. Counts as "next" only when this frame has
  // no form yet, so a Greenhouse "Apply" link above the form is ignored.
  const START = /^(apply|apply now|apply (for|to) (this|the) (job|position|role|opening)|easy apply|i m interested|start (my |your )?application|begin (my |your )?application)$/;

  const buttonLabel = (el) =>
    clean(el.tagName === 'INPUT' ? el.value : el.textContent) || clean(el.getAttribute('aria-label') || el.title);

  const isSubmitType = (el) => (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.type === 'submit';

  const formWithControls = (el) => {
    const form = el.form || el.closest('form');
    return form?.querySelector('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea') ? form : null;
  };

  // Returns { kind: 'next' | 'submit', label, score, start } or null.
  function classify(el, hasForm) {
    const label = buttonLabel(el);
    const t = J.normalize(label);
    if (!t || t.length > 60 || AVOID.test(t)) return null;
    const inForm = !!formWithControls(el);
    let kind = null;
    let start = false;
    if (NEXT.test(t)) kind = 'next';
    else if (SUBMIT.test(t) || (inForm && isSubmitType(el) && /^apply( now)?$/.test(t))) kind = 'submit';
    else if (!hasForm && START.test(t)) [kind, start] = ['next', true];
    if (!kind) return null;

    const hint = ['id', 'class', 'name', 'data-automation-id', 'data-qa', 'data-testid']
      .map((a) => el.getAttribute(a) || '')
      .join(' ')
      .toLowerCase();
    let score = 50;
    if (inForm) score += 20;
    if (isSubmitType(el)) score += 10;
    if (/next|continue|submit/.test(hint)) score += 10;
    if (/primary|cta/.test(hint)) score += 5;
    if (el.tagName === 'A') score -= 10;
    if (start) score -= 20;
    return { kind, label, score, start };
  }

  // Best Next and Submit buttons in this frame. Disabled buttons are reported
  // (so the panel can say why) but lose to enabled ones. On ties the later
  // button wins, since forms put their real actions at the bottom.
  J.findNav = ({ hasForm = J.looksLikeApplication() } = {}) => {
    const best = { next: null, submit: null };
    let starts = 0;
    for (const el of document.querySelectorAll(BUTTONS)) {
      if (el.closest(IGNORE_AREAS) || !J.isVisible(el)) continue;
      const c = classify(el, hasForm);
      if (!c) continue;
      if (c.start) starts++;
      const disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true';
      const score = c.score - (disabled ? 30 : 0);
      if (!best[c.kind] || score >= best[c.kind].score) best[c.kind] = { id: J.tag(el), label: c.label, score, disabled, start: c.start };
    }
    // Many "Apply" buttons means a list of jobs, not one posting.
    if (best.next?.start && starts > 2) best.next = null;
    return best;
  };

  J.clickNav = (id) => {
    const el = J.byTag(id);
    if (!el || !J.isVisible(el)) return false;
    el.scrollIntoView({ block: 'center' });
    J.clickLikeUser(el);
    return true;
  };

  const bodyText = () => document.body?.innerText ?? document.body?.textContent ?? '';

  // "Step 2 of 4" style progress, from Workday/ARIA step lists or page text.
  J.stepInfo = () => {
    const active = document.querySelector('[aria-current="step"], [data-automation-id="progressBarActiveStep"]');
    if (active?.parentElement) {
      const steps = [...active.parentElement.children];
      return { current: steps.indexOf(active) + 1, total: steps.length, label: clean(active.textContent).slice(0, 60) };
    }
    const m = bodyText().match(/\b(?:step|page)\s+(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/i);
    return m && +m[1] <= +m[2] ? { current: +m[1], total: +m[2] } : null;
  };

  const THANKS = /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(successfully )?(submitted|received|sent|completed?)\b|we('ve| have) received your application|you('ve| have) (successfully )?applied|successfully (submitted|applied)/i;

  // The post-submit confirmation message, if the page shows one.
  J.confirmationText = () => bodyText().match(THANKS)?.[0] || '';

  // Fingerprint of the current step, polled after a click to tell whether
  // the application moved on (full navigation or an SPA re-render).
  J.pageState = () => {
    const controls = J.collectControls();
    return {
      sig: [location.href, J.stepInfo()?.current ?? '', ...controls.slice(0, 40).map((c) => `${c.kind}:${J.labelFor(c.el) || c.el.name}`)].join('|'),
      controls: controls.length,
      submit: !!J.findNav({ hasForm: controls.length > 1 }).submit,
      errors: J.pageErrors().length,
    };
  };
})(globalThis);
