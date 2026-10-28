// Attaching a resume (file input or drop area, original or tailored) and
// opening the tailor page with the job's description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, loadBackground, PROFILE, RESUME } from './helpers.mjs';

const application = readFileSync(new URL('./fixtures/application.html', import.meta.url), 'utf8');
const URL_ = 'https://boards.greenhouse.io/acme/jobs/1';
const TAILORED = {
  id: 't1',
  job: { title: 'Senior Engineer', company: 'Acme', url: URL_ },
  createdAt: '2026-10-01T00:00:00.000Z',
  file: { name: 'Ada Lovelace Resume.pdf', type: 'application/pdf', size: 4, dataUrl: RESUME.dataUrl },
};

test('attaches the resume to the upload field', () => {
  const { document: d, J } = loadPage(application, { storage: { profile: PROFILE } });
  assert.equal(J.resumeTargetScore(), 3);
  const r = J.attachResume(RESUME);
  assert.equal(r.attached, true);
  assert.equal(d.getElementById('resume').files[0].name, 'ada.pdf');
});

test('drops the resume onto a drag-and-drop area when there is no file input', () => {
  const html = `<form><h2>Apply</h2><label>Name <input name="name"></label>
    <section><h3>Resume/CV</h3><div id="dz">Drag and drop your file here</div></section></form>
    <script>dz.addEventListener('drop', (e) => { e.preventDefault(); dz.dataset.got = e.dataTransfer.files[0].name; });</script>`;
  const { document: d, J } = loadPage(html, { pageScripts: true });
  assert.equal(J.resumeTargetScore(), 1);
  assert.deepEqual({ ...J.attachResume(RESUME) }, { attached: true, drop: true });
  assert.equal(d.getElementById('dz').dataset.got, 'ada.pdf');
});

test('attaches the resume tailored for this job first, or the one picked', async () => {
  const page = loadPage(application, { storage: { profile: PROFILE, resume: RESUME, tailored: [TAILORED] }, url: URL_ });
  const bg = loadBackground(page);
  const scan = await bg.call({ type: 'SCAN_TAB' });
  assert.deepEqual(scan.resumes.map((r) => r.id), ['t1', 'original']);
  assert.equal(scan.resumes[0].label, 'Tailored: Senior Engineer at Acme');

  assert.deepEqual(await bg.call({ type: 'ATTACH_RESUME' }), { action: 'attach', name: 'Ada Lovelace Resume.pdf', attached: true, question: 'Resume/CV' });
  assert.equal(page.document.getElementById('resume').files[0].name, 'Ada Lovelace Resume.pdf');
  await bg.call({ type: 'ATTACH_RESUME', resume: 'original' });
  assert.equal(page.document.getElementById('resume').files[0].name, 'ada.pdf');
});

test('an attach from the tailor page also reports to the job page', async () => {
  const page = loadPage(application, { storage: { profile: PROFILE, resume: RESUME, tailored: [TAILORED] }, url: URL_ });
  const bg = loadBackground(page);
  const reported = bg.nextReport();
  const r = await bg.call({ type: 'ATTACH_RESUME', tabId: 1, resume: 't1' }, { tab: { id: 2 } });
  assert.equal(r.attached, true);
  assert.equal((await reported).name, 'Ada Lovelace Resume.pdf');
});

test('says so when there is no resume to attach', async () => {
  const bg = loadBackground(loadPage(application, { storage: { profile: PROFILE } }));
  assert.deepEqual(await bg.call({ type: 'ATTACH_RESUME' }), { action: 'attach', needsResume: true });
});

const POSTING = (description) => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Backend Engineer',
  hiringOrganization: { name: 'Globex' },
  description,
})}</script></head><body><h1>Backend Engineer</h1></body></html>`;

test('opens the tailor page beside the job, with the description as text', async () => {
  // Some boards escape the description's HTML twice.
  const html = POSTING('&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL &amp;amp; dbt&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Nice to have:&lt;br&gt;Kafka&lt;/p&gt;');
  const page = loadPage(html, { storage: { profile: PROFILE }, url: 'https://jobs.globex.com/backend' });
  const bg = loadBackground(page);
  assert.deepEqual(await bg.call({ type: 'TAILOR_RESUME' }), { opened: true });
  assert.equal(bg.created[0].url, 'chrome-extension://jobu/src/tailor/tailor.html?tab=1');
  const job = bg.session['tailor:1'];
  assert.equal(job.title, 'Backend Engineer');
  assert.equal(job.description, 'Requirements\n• Python\n• SQL & dbt\n\nNice to have:\nKafka');

  // The panel's scan and the tracker don't carry the long description.
  const scan = await bg.call({ type: 'SCAN_TAB' });
  assert.equal(scan.job.title, 'Backend Engineer');
  assert.ok(!('description' in scan.job));
  await bg.call({ type: 'SAVE_JOB', job });
  assert.ok(!('description' in page.store.jobs[0]));
});

test('finds a description on boards without JSON-LD only when asked', () => {
  const text = 'Responsibilities: build services. '.repeat(10);
  const { J } = loadPage(`<h1>Engineer</h1><div class="job-description"><p>${text}</p></div>`, { url: 'https://careers.initech.com/jobs/7' });
  assert.equal(J.extractJob().description, '');
  assert.equal(J.extractJob({ full: true }).description, text.trim());
});
