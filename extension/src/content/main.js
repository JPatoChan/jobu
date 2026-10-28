// Content-script entry point. Runs in every frame.
(function (root) {
  const J = root.JOBU;
  if (J.started) return;
  J.started = true;

  let announced = false;
  let timer;

  // An application form, or a sign-in / create-account page on a known job site.
  async function detect() {
    if (announced || !(J.looksLikeApplication() || (J.detectATS() && J.accountForm()))) return;
    announced = true;
    const { settings } = await J.store.load();
    chrome.runtime.sendMessage({ type: 'FORM_DETECTED', ats: J.detectATS(), showButton: settings.showButton });
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(detect, 800);
  };

  // Application forms are often rendered late (SPAs, multi-step Workday flows).
  // The open panel rescans when the page changes under it.
  new MutationObserver(() => {
    schedule();
    J.scheduleRefresh();
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  // Fields Jobu left empty lose their amber outline as the user answers them.
  for (const type of ['input', 'change']) {
    document.addEventListener(type, (e) => e.isTrusted && J.markAnswered(e.target), true);
  }

  // Keep the panel's field list current as the user answers questions.
  // Fields in iframes tell the top frame through the service worker.
  document.addEventListener(
    'change',
    (e) => {
      if (!e.isTrusted) return;
      if (window.top === window) J.scheduleRefresh();
      else chrome.runtime.sendMessage({ type: 'FIELD_CHANGED' }).catch(() => {});
    },
    true,
  );

  // Record the application when a form we filled is submitted.
  document.addEventListener(
    'submit',
    () => {
      if (!J.filledThisPage) return;
      chrome.runtime.sendMessage({ type: 'APPLICATION_SUBMITTED' });
    },
    true,
  );

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'SHOW_BUTTON') J.showButton();
    if (msg.type === 'REFRESH') J.scheduleRefresh();
    if (msg.type === 'GET_JOB' && window.top === window) reply(J.extractJob());
  });
})(globalThis);
