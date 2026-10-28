// Account pages on job sites (Workday, iCIMS, Taleo...): finds a sign-in or
// create-account form and fills the email and password the service worker
// hands over. Passwords never pass through the panel.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const CREATE = /create (an |your )?account|register|sign ?up|new password|confirm password|verify password|re-?enter|repeat password/i;
  const USER = 'input[type=email], input[autocomplete=username], input[autocomplete=email], input[name*=user i], input[name*=email i], input[name*=login i], input[id*=user i], input[id*=email i]';

  const passwordFields = () => [...document.querySelectorAll('input[type=password]')].filter((el) => J.isVisible(el) && !el.disabled);

  // The email or username field that goes with the password fields: in the
  // same form (or the page), before the first password field.
  function usernameField(first) {
    const scope = first.form || document;
    const before = (el) => el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING;
    const candidates = [...scope.querySelectorAll('input')].filter(
      (el) => (el.type === 'text' || el.type === 'email') && J.isVisible(el) && !el.disabled && !el.readOnly && before(el),
    );
    return candidates.filter((el) => el.matches(USER)).at(-1) || candidates.at(-1) || null;
  }

  // null, or { kind: 'create' | 'signin', site, username, typed }.
  // typed: the user has typed a password Jobu could save.
  J.accountForm = () => {
    const fields = passwordFields();
    if (!fields.length) return null;
    const first = fields[0];
    const context = [first.form?.textContent || '', document.title, ...fields.map((f) => `${J.signals(f).label} ${f.autocomplete}`)].join(' ');
    const kind = fields.length >= 2 || first.autocomplete === 'new-password' || CREATE.test(context) ? 'create' : 'signin';
    const user = usernameField(first);
    return { kind, site: location.hostname, username: user?.value.trim() || '', typed: !!first.value };
  };

  // Fills the username (when empty) and the password. A create form gets the
  // password in every box (password and confirm); a sign-in form in the first.
  J.fillAccount = ({ username, password }) => {
    const fields = passwordFields();
    if (!fields.length) return { filled: false };
    const user = usernameField(fields[0]);
    if (user && !user.value.trim() && username) J.fillText(user, username);
    const kind = J.accountForm().kind;
    for (const el of kind === 'create' ? fields : fields.slice(0, 1)) {
      J.fillText(el, password);
      J.mark(el, 'filled');
    }
    return { filled: true, kind, site: location.hostname, username: user?.value.trim() || username || '' };
  };

  // What the user typed, so it can be saved for next time.
  J.typedAccount = () => {
    const [first] = passwordFields();
    if (!first?.value) return null;
    return { site: location.hostname, username: usernameField(first)?.value.trim() || '', password: first.value };
  };
})(globalThis);
