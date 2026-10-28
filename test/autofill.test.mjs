import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, PROFILE, RESUME } from './helpers.mjs';

const html = readFileSync(new URL('./fixtures/application.html', import.meta.url), 'utf8');

test('autofills a mixed Greenhouse/Lever/Workday style form', async () => {
  const { document: d, J } = loadPage(html, { storage: { profile: PROFILE, resume: RESUME } });
  const changes = [];
  d.getElementById('first_name').addEventListener('change', (e) => changes.push(e.target.value));

  const r = await J.autofill();
  const v = (id) => d.getElementById(id).value;

  assert.equal(v('first_name'), 'Ada');
  assert.deepEqual(changes, ['Ada'], 'frameworks get a change event');
  assert.equal(v('last_name'), 'Lovelace');
  assert.equal(v('email'), 'ada@example.com');
  assert.equal(v('phone'), '555-010-2000');
  assert.equal(v('lever_li'), 'https://linkedin.com/in/ada');
  assert.equal(v('org'), 'Engines Ltd');
  assert.equal(v('wd_city'), 'San Francisco');
  assert.equal(v('state'), 'CA');
  assert.equal(d.querySelector('input[name=auth]:checked')?.value, '1');
  assert.equal(d.querySelector('input[name=sponsor]:checked')?.value, '0');
  assert.equal(v('gender'), 'Female');
  assert.equal(v('veteran'), 'I am not a protected veteran');
  assert.equal(v('why'), 'Because Acme builds engines.');
  assert.equal(d.getElementById('resume').files[0]?.name, 'ada.pdf');
  assert.equal(v('fav'), '');
  assert.equal(d.getElementById('consent').checked, false);
  assert.equal(v('website'), 'https://keep.me');

  assert.equal(r.attention, 1, 'the unknown required question is flagged');
  assert.equal(r.prefilled, 1);
  assert.equal(r.filled, 14);
  assert.ok(J.looksLikeApplication());
});

test('learns answers the user typed for unknown questions', async () => {
  const { document: d, J, store } = loadPage(html, { storage: { profile: PROFILE } });
  d.getElementById('fav').value = 'Dijkstra';
  const r = await J.learnAnswers();
  const saved = store.profile.customAnswers.find((a) => /favourite algorithm/.test(a.q));
  assert.equal(saved?.a, 'Dijkstra');
  assert.ok(r.learned >= 1);
});

test('extracts the job posting from JSON-LD', () => {
  const { J } = loadPage(html);
  const job = J.extractJob();
  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.company, 'Acme');
  assert.equal(job.location, 'San Francisco, CA');
  assert.equal(job.ats, 'Greenhouse');
  assert.match(job.salary, /USD 150,000–200,000 \/ year/);
});

test('does not treat a search box as an application', () => {
  const { J } = loadPage('<form><input name="q" type="search"><button>Go</button></form>');
  assert.equal(J.looksLikeApplication(), false);
});
