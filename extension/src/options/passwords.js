// "Saved passwords" on the profile page: turn the vault on, unlock it, and
// see, copy, add or delete job-site passwords (see shared/vault.js).
(() => {
  const J = globalThis.JOBU;
  const card = document.getElementById('passwords');
  const $ = (s) => card.querySelector(s);

  function say(text, tone = '') {
    $('.vault-msg').textContent = text;
    $('.vault-msg').className = `vault-msg small ${tone}`;
  }

  function row(entry) {
    const el = document.createElement('div');
    el.className = 'vault-row';
    el.innerHTML = `
      <div class="who"><div class="site"></div><div class="muted small user"></div></div>
      <code class="secret">••••••••••••</code>
      <div class="row-actions">
        <button class="link-btn" data-do="show">Show</button>
        <button class="link-btn" data-do="copy">Copy</button>
        <button class="link-btn danger" data-do="delete">Delete</button>
      </div>`;
    el.querySelector('.site').textContent = entry.site;
    el.querySelector('.user').textContent = [entry.username || 'no username', entry.label, `saved ${new Date(entry.updatedAt).toLocaleDateString()}`]
      .filter(Boolean)
      .join(' · ');
    const secret = el.querySelector('.secret');
    el.onclick = async (e) => {
      const act = e.target.dataset.do;
      if (act === 'show') {
        const shown = secret.textContent === entry.password;
        secret.textContent = shown ? '••••••••••••' : entry.password;
        e.target.textContent = shown ? 'Show' : 'Hide';
      } else if (act === 'copy') {
        await navigator.clipboard.writeText(entry.password);
        say(`Copied the password for ${entry.site}.`, 'ok');
      } else if (act === 'delete') {
        if (!confirm(`Delete the saved password for ${entry.site}${entry.username ? ` (${entry.username})` : ''}?`)) return;
        await J.vault.remove(entry.site, entry.username);
        say(`Deleted the password for ${entry.site}.`);
        render();
      }
    };
    return el;
  }

  async function render() {
    const status = await J.vault.status();
    $('.vault-setup').hidden = status !== 'none';
    $('.vault-unlock').hidden = status !== 'locked';
    $('.vault-open').hidden = status !== 'unlocked';
    if (status !== 'unlocked') return;
    const entries = await J.vault.entries();
    $('.vault-list').replaceChildren(...entries.map(row));
    $('.vault-empty').hidden = entries.length > 0;
  }

  const fields = (form) => Object.fromEntries(new FormData(form));

  async function attempt(form, work) {
    const button = form.querySelector('button:not([type=button])');
    button.disabled = true;
    try {
      say(await work(fields(form)), 'ok');
      form.reset();
      await render();
    } catch (err) {
      say(err.message, 'warn');
    } finally {
      button.disabled = false;
    }
  }

  const BACK = 'Go back to the job site and press the Jobu button again.';

  $('.vault-setup').onsubmit = (e) => {
    e.preventDefault();
    attempt(e.target, async ({ pass, again }) => {
      if (pass !== again) throw new Error('The two passphrases don’t match.');
      await J.vault.create(pass);
      return `Saved passwords are on. ${BACK}`;
    });
  };

  $('.vault-unlock').onsubmit = (e) => {
    e.preventDefault();
    attempt(e.target, async ({ pass }) => {
      await J.vault.unlock(pass);
      return `Unlocked until you close the browser. ${BACK}`;
    });
  };

  $('.vault-add').onsubmit = (e) => {
    e.preventDefault();
    attempt(e.target, async ({ site, username, password }) => {
      const host = site.trim().replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      await J.vault.save({ site: host, username: username.trim(), password });
      return `Saved the password for ${host}.`;
    });
  };

  $('.vault-change').onsubmit = (e) => {
    e.preventDefault();
    attempt(e.target, async ({ pass, again }) => {
      if (pass !== again) throw new Error('The two passphrases don’t match.');
      await J.vault.changePassphrase(pass);
      return 'Passphrase changed.';
    });
  };

  card.addEventListener('click', async (e) => {
    const act = e.target.dataset.vault;
    if (act === 'lock') {
      await J.vault.lock();
      say('Locked.');
    } else if (act === 'reset') {
      if (!confirm('Delete all saved passwords? They can’t be recovered without the passphrase.')) return;
      await J.vault.reset();
      say('Deleted all saved passwords. Choose a new passphrase to start again.');
    } else return;
    render();
  });

  render().then(() => {
    if (location.hash !== '#passwords') return;
    card.scrollIntoView();
    card.querySelector('form:not([hidden]) input')?.focus();
  });
  document.addEventListener('visibilitychange', () => document.hidden || render());
})();
