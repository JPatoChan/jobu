// Service-worker flows (scan, Next, Fill all pages, Submit) against the
// multi-step fixture, with chrome.scripting running inside the jsdom page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, loadBackground, PROFILE } from './helpers.mjs';

const html = readFileSync(new URL('./fixtures/multistep.html', import.meta.url), 'utf8');
const url = 'https://globex.wd5.myworkdayjobs.com/en-US/careers/job/Austin/Data-Analyst_R123/apply';
const WITH_ANSWER = { ...PROFILE, customAnswers: [...PROFILE.customAnswers, { q: 'Why do you want to join Globex?', a: 'Data at scale.' }] };

function setup(profile = WITH_ANSWER) {
  const page = loadPage(html, { storage: { profile }, pageScripts: true, url });
  const bg = loadBackground(page);
  bg.run('WAIT.poll = 40; WAIT.stuck = 900; WAIT.settle = 300; WAIT.timeout = 4000');
  return { page, bg, d: page.document };
}

async function runFlow(bg) {
  const report = bg.nextReport();
  assert.deepEqual(await bg.call({ type: 'APPLY_FLOW' }), { started: true });
  return report;
}

test('scan finds the fields, the step, the Next button and the job', async () => {
  const { bg } = setup();
  const scan = await bg.call({ type: 'SCAN_TAB' });
  assert.equal(scan.isApplication, true);
  assert.equal(scan.step.current, 1);
  assert.equal(scan.step.total, 3);
  assert.equal(scan.nav.next.label, 'Save and Continue');
  assert.equal(scan.nav.submit, null);
  assert.deepEqual(scan.counts, { total: 5, filled: 0, ready: 5, missing: 0, skipped: 0 });
  assert.equal(scan.fields[0].frameId, 0);
  assert.equal(scan.job.title, 'Data Analyst');
});

test('Next clicks "Save and Continue" and autofills the new step', async () => {
  const { bg, d } = setup();
  await bg.call({ type: 'AUTOFILL_TAB' });
  const report = bg.nextReport();
  const r = await bg.call({ type: 'NEXT_TAB' });
  assert.equal(r.advanced, true);
  assert.equal(r.label, 'Save and Continue');
  assert.equal(r.fill.filled, 4);
  assert.equal(d.querySelector('[name=auth]:checked')?.value, 'yes');
  assert.equal(d.getElementById('sponsor').value, 'No');
  assert.equal(d.getElementById('why').value, 'Data at scale.');
  assert.deepEqual(await report, r, 'the page panel hears about it');
});

test('Next says so when the site rejects the step', async () => {
  const { bg } = setup(PROFILE); // no saved answer for "Why Globex?"
  await bg.call({ type: 'AUTOFILL_TAB' });
  await bg.call({ type: 'NEXT_TAB' });
  const r = await bg.call({ type: 'NEXT_TAB' });
  assert.equal(r.stuck, true);
  const scan = await bg.call({ type: 'SCAN_TAB' });
  assert.equal(scan.counts.missing, 1);
  assert.deepEqual(scan.errors, ['Please complete 1 required field.']);
});

test('Fill all pages walks every step and stops at Submit for review', async () => {
  const { bg, d } = setup();
  const r = await runFlow(bg);
  assert.equal(r.stopped, 'submit');
  assert.equal(r.pages, 3);
  assert.equal(r.filled, 9);
  assert.equal(r.missing, 1, 'the certify box is left to the user');
  assert.equal(d.getElementById('certify').checked, false);
  assert.equal(d.getElementById('done').hidden, true, 'nothing was submitted');
});

test('Fill all pages stops on a step with a question it cannot answer', async () => {
  const { bg } = setup(PROFILE);
  const r = await runFlow(bg);
  assert.deepEqual([r.stopped, r.pages, r.missing], ['missing', 2, 1]);
});

test('Submit asks first, holds back with empty required fields, then submits and tracks the job', async () => {
  const { bg, d, page } = setup();
  await runFlow(bg);

  assert.deepEqual(await bg.call({ type: 'REQUEST_SUBMIT' }), { action: 'submit', asked: true });
  assert.equal(d.getElementById('done').hidden, true);

  const blocked = await bg.call({ type: 'SUBMIT_TAB' });
  assert.deepEqual([blocked.blocked, blocked.missing], [true, 1]);

  const rejected = await bg.call({ type: 'SUBMIT_TAB', force: true });
  assert.deepEqual([rejected.outcome, rejected.submitted], ['errors', false]);
  assert.equal(page.store.jobs, undefined, 'a rejected submission is not tracked');

  d.getElementById('certify').click();
  const r = await bg.call({ type: 'SUBMIT_TAB' });
  assert.deepEqual([r.outcome, r.submitted], ['confirmed', true]);
  assert.equal(d.getElementById('done').hidden, false);
  const [job] = page.store.jobs;
  assert.deepEqual([job.title, job.company, job.status], ['Data Analyst', 'Globex', 'applied']);
});

test('Submit goes straight through when confirmation is off', async () => {
  const { bg, page } = setup();
  page.store.settings = { confirmSubmit: false };
  await runFlow(bg);
  page.document.getElementById('certify').click();
  const report = bg.nextReport();
  await bg.call({ type: 'REQUEST_SUBMIT' });
  const r = await report;
  assert.equal(r.submitted, true);
});

test('an update deletes the Anthropic API key earlier versions saved', () => {
  const { bg, page } = setup();
  page.store.anthropicKey = 'sk-ant-old';
  bg.installed({ reason: 'install' });
  assert.equal(page.store.anthropicKey, 'sk-ant-old');
  bg.installed({ reason: 'update' });
  assert.equal('anthropicKey' in page.store, false);
});
