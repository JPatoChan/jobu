// Saved passwords for job-site accounts (Workday, iCIMS, Taleo...), one per
// site and username. They're encrypted with AES-GCM under a key derived
// from a passphrase only the user knows (PBKDF2-SHA-256). While unlocked,
// the key sits in chrome.storage.session: memory only, out of reach of
// content scripts, and gone when the browser closes.
//
// chrome.storage.local holds { vault: { salt, iterations, box } } where box
// is the encrypted entry list, and vaultIndex: the sites and usernames with
// a saved password, so pages can offer them before the vault is unlocked.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const ITERATIONS = 600000;
  const KEY = 'vaultKey'; // chrome.storage.session
  const MIN_PASSPHRASE = 8;

  const bytesToB64 = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
  }

  async function seal(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
    return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(data)) };
  }

  // Throws if the key is wrong (AES-GCM checks integrity).
  async function open(key, box) {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
    return JSON.parse(new TextDecoder().decode(data));
  }

  async function sessionKey() {
    const raw = (await chrome.storage.session.get(KEY))[KEY];
    return raw ? crypto.subtle.importKey('raw', b64ToBytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']) : null;
  }

  async function remember(key) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    await chrome.storage.session.set({ [KEY]: bytesToB64(raw) });
  }

  async function stored() {
    return (await chrome.storage.local.get('vault')).vault || null;
  }

  async function write(key, entries) {
    const vault = await stored();
    const vaultIndex = entries.map(({ site, username, updatedAt }) => ({ site, username, updatedAt }));
    await chrome.storage.local.set({ vault: { ...vault, box: await seal(key, entries) }, vaultIndex });
  }

  // Unbiased random integer in [0, n).
  function randomBelow(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % n;
  }

  // Symbols most job sites accept; no look-alikes (0/O, 1/l/I).
  const SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_'];

  const unlockedKey = async () => {
    const key = await sessionKey();
    if (!key) throw new Error('locked');
    return key;
  };

  J.vault = {
    MIN_PASSPHRASE,

    // 'none' (not set up) | 'locked' | 'unlocked'
    async status() {
      if (!(await stored())) return 'none';
      return (await sessionKey()) ? 'unlocked' : 'locked';
    },

    async create(passphrase) {
      if (String(passphrase).length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
      if (await stored()) throw new Error('Saved passwords are already set up.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, salt, ITERATIONS);
      await chrome.storage.local.set({ vault: { v: 1, salt: bytesToB64(salt), iterations: ITERATIONS, box: await seal(key, []) }, vaultIndex: [] });
      await remember(key);
    },

    async unlock(passphrase) {
      const vault = await stored();
      if (!vault) throw new Error('Saved passwords aren’t set up yet.');
      const key = await deriveKey(passphrase, b64ToBytes(vault.salt), vault.iterations);
      try {
        await open(key, vault.box);
      } catch {
        throw new Error('That passphrase is wrong.');
      }
      await remember(key);
    },

    lock: () => chrome.storage.session.remove(KEY),

    // Sites and usernames only; readable while locked.
    async index() {
      return (await chrome.storage.local.get('vaultIndex')).vaultIndex || [];
    },

    async entries() {
      return open(await unlockedKey(), (await stored()).box);
    },

    // The entry for site: the given username's, else the most recent.
    async find(site, username = '') {
      const mine = (await J.vault.entries()).filter((e) => e.site === site);
      const same = (e) => e.username.toLowerCase() === username.toLowerCase();
      return mine.find(same) || (username ? null : mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]) || null;
    },

    // Adds or replaces the password for site + username, keeping the old one.
    async save({ site, username = '', password, label = '' }) {
      const key = await unlockedKey();
      const entries = await open(key, (await stored()).box);
      const now = new Date().toISOString();
      const i = entries.findIndex((e) => e.site === site && e.username.toLowerCase() === username.toLowerCase());
      const prev = i >= 0 ? entries[i] : null;
      const entry = {
        site,
        username,
        password,
        label: label || prev?.label || '',
        createdAt: prev?.createdAt || now,
        updatedAt: now,
        ...(prev && prev.password !== password ? { previous: prev.password } : {}),
      };
      if (i >= 0) entries[i] = entry;
      else entries.unshift(entry);
      await write(key, entries);
      return entry;
    },

    async remove(site, username) {
      const key = await unlockedKey();
      const entries = (await open(key, (await stored()).box)).filter((e) => !(e.site === site && e.username === username));
      await write(key, entries);
    },

    // Re-encrypts everything under a new passphrase. Needs the vault unlocked.
    async changePassphrase(passphrase) {
      if (String(passphrase).length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
      const entries = await J.vault.entries();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, salt, ITERATIONS);
      await chrome.storage.local.set({ vault: { v: 1, salt: bytesToB64(salt), iterations: ITERATIONS, box: await seal(key, entries) } });
      await remember(key);
    },

    // Deletes every saved password, for a forgotten passphrase.
    async reset() {
      await chrome.storage.local.remove(['vault', 'vaultIndex']);
      await J.vault.lock();
    },

    // A random password with at least one capital, small letter, digit and symbol.
    generate(length = 16) {
      const all = SETS.join('');
      const chars = SETS.map((s) => s[randomBelow(s.length)]);
      while (chars.length < length) chars.push(all[randomBelow(all.length)]);
      for (let i = chars.length - 1; i > 0; i--) {
        const j = randomBelow(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      return chars.join('');
    },
  };
})(globalThis);
