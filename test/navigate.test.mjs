import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, PROFILE, RESUME } from './helpers.mjs';

const single = readFileSync(new URL('./fixtures/application.html', import.meta.url), 'utf8');
const multi = readFileSync(new URL('./fixtures/multistep.html', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('scan lists every field and what Jobu would fill, without filling', async () => {
  const { document: d, J } = loadPage(single, { storage: { profile: PROFILE, resume: RESUME } });
  const scan = await J.scanPage();
  const field = (q) => scan.fields.find((f) => f.question.startsWith(q));

  assert.deepEqual([field('First Name').status, field('First Name').value], ['ready', 'Ada']);
  assert.deepEqual([field('Resume').status, field('Resume').value], ['ready', 'ada.pdf']);
  assert.deepEqual([field('Website').status, field('Website').value], ['filled', 'https://keep.me']);
  assert.equal(field("What's your favourite").status, 'missing');
  assert.equal(field('I agree').status, 'skipped', 'consent boxes are left to the user');
  assert.equal(d.getElementById('first_name').value, '', 'scanning changes nothing');
  assert.equal(scan.isApplication, true);
  assert.equal(scan.nav.submit.label, 'Submit application');
  assert.equal(scan.nav.next, null);

  await J.autofill();
  const after = await J.scanPage();
  assert.equal(after.fields.find((f) => f.question.startsWith('First Name')).status, 'filled');
  assert.equal(after.fields.filter((f) => f.status === 'missing').length, 1);
});

test('finds Next and ignores Back, cookie banners and "Apply with LinkedIn"', () => {
  const { J } = loadPage(multi, { pageScripts: true });
  const nav = J.findNav();
  assert.equal(nav.next.label, 'Save and Continue');
  assert.equal(nav.submit, null, 'submit is hidden until the last step');
  assert.deepEqual({ ...J.stepInfo() }, { current: 1, total: 3, label: 'My information' });
});

test('clickNav clicks the button; a rejected step shows errors, a valid one advances', async () => {
  const { document: d, J } = loadPage(multi, { pageScripts: true, storage: { profile: PROFILE } });
  assert.equal(J.clickNav(J.findNav().next.id), true);
  assert.deepEqual([...J.pageErrors()], ['Please complete 3 required fields.']);

  await J.autofill();
  J.clickNav(J.findNav().next.id);
  await sleep(400);
  assert.equal(J.stepInfo().current, 2);
  assert.equal(d.getElementById('why').closest('section').hidden, false);
});

test('the last step offers Submit and a review page still counts as the application', async () => {
  const { document: d, J } = loadPage(multi, { pageScripts: true });
  d.getElementById('submit').hidden = false;
  d.getElementById('next').hidden = true;
  d.querySelectorAll('[data-step]').forEach((s) => (s.hidden = s.dataset.step !== '3'));
  const scan = await J.scanPage();
  assert.equal(scan.nav.submit.label, 'Submit application');
  assert.equal(scan.isApplication, true);
  assert.deepEqual([...scan.fields.map((f) => f.status)], ['missing'], 'only the certify box, which needs the user');
});

test('a job posting\'s Apply button counts as Next, but not on a list of jobs', () => {
  const posting = loadPage('<h1>Engineer</h1><p>About the role</p><a href="/apply" class="btn">Apply now</a>');
  assert.equal(posting.J.findNav().next.label, 'Apply now');
  const list = loadPage(`<ul>${'<li>Engineer <a href="/a">Apply</a></li>'.repeat(4)}</ul>`);
  assert.equal(list.J.findNav().next, null);
});

test('"Apply" submits a form, "Submit and continue" moves on', () => {
  const apply = loadPage('<form><label>First name <input name="first"></label><label>Email <input type="email"></label><button>Apply</button></form>');
  assert.equal(apply.J.findNav().submit.label, 'Apply');
  const step = loadPage('<form><input name="a"><button type="button">Submit and continue</button><button type="button" disabled>Submit</button></form>');
  const nav = step.J.findNav({ hasForm: true });
  assert.equal(nav.next.label, 'Submit and continue');
  assert.equal(nav.submit.disabled, true);
});

test('confirmation text means a real submission, not "thanks for your interest"', () => {
  assert.equal(loadPage('<p>Thank you for your interest in Acme.</p>').J.confirmationText(), '');
  assert.equal(loadPage('<h2>Thank you for applying!</h2>').J.confirmationText(), 'Thank you for applying');
  assert.equal(loadPage('<p>Your application has been submitted.</p>').J.confirmationText(), 'application has been submitted');
});

test('describes results in plain words', () => {
  const { J } = loadPage('');
  assert.equal(J.describeResult({ action: 'autofill', filled: 1, attention: 2 }).text, 'Filled 1 field. 2 required fields need you (amber). Review before you submit.');
  assert.equal(J.describeResult({ action: 'flow', pages: 3, filled: 9, stopped: 'submit', missing: 1 }).text, 'Filled 9 fields across 3 pages. 1 required field needs you, then submit.');
  assert.equal(J.describeResult({ action: 'submit', blocked: true, missing: 2 }).tone, 'warn');
});
