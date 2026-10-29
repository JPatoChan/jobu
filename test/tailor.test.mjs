// Resume tailoring: reading a resume into sections, pulling keywords from a
// job description, scoring, tailoring without inventing anything, the PDF it
// produces, suggestions in the job's wording, and the optional Claude
// rewrite options, asked through Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './helpers.mjs';
import { extractText } from '../extension/src/options/resume-text.mjs';
import { resumePdf, winAnsi } from '../extension/src/tailor/resume-pdf.mjs';
import { suggestRewrites } from '../extension/src/tailor/resume-ai.mjs';
import { claudeCodeStatus, HOST } from '../extension/src/shared/claude-code.mjs';

const J = loadPure();

const RESUME = `Ada Lovelace
London, UK | ada@example.com | 555-010-2000 | LinkedIn | GitHub
EXPERIENCE
Senior Engineer\tJan 2021 – Present
Engines Ltd, London
• Mentored four engineers and ran weekly code reviews
• Moved CI to GitHub Actions, cutting build time
by 40%
• Built REST APIs in Python and Django used by 30 teams
Software Engineer\tJun 2018 – Dec 2020
Analytical Co
- Wrote React and TypeScript front ends
- Ran PostgreSQL migrations with zero downtime
EDUCATION
University of London\tMay 2018
B.S. Mathematics
SKILLS
Languages: Python, TypeScript, SQL,
JavaScript
Tools: Docker, AWS, React, Django
https://www.linkedin.com/in/ada
https://github.com/ada`;

const JD = `About the role
Go above and beyond for our payments team. Interns start in Spring 2026.
What you'll do
Design REST APIs and microservices
Requirements
5+ years building backend services in Python
Experience with Kubernetes and Docker on AWS
Strong SQL (PostgreSQL preferred)
Nice to have
Experience with Kafka, Terraform (or Pulumi)
Benefits
Health, 401K, PTO, TBD`;

test('reads a resume into a name, contact line, entries, bullets and skill groups', () => {
  const s = J.resumeStructure(RESUME);
  assert.equal(s.name, 'Ada Lovelace');
  // Link targets replace the "LinkedIn" / "GitHub" labels.
  assert.deepEqual(s.contact, ['London, UK', 'ada@example.com', '555-010-2000', 'linkedin.com/in/ada', 'github.com/ada']);
  assert.deepEqual(s.sections.map((x) => [x.title, x.kind]), [['Experience', 'experience'], ['Education', 'education'], ['Skills', 'skills']]);
  const [first, second] = s.sections[0].entries;
  assert.deepEqual(first.head, ['Senior Engineer\tJan 2021 – Present', 'Engines Ltd, London']);
  assert.equal(first.bullets.length, 3);
  assert.equal(first.bullets[1], 'Moved CI to GitHub Actions, cutting build time by 40%'); // wrapped line joined
  assert.deepEqual(second.bullets, ['Wrote React and TypeScript front ends', 'Ran PostgreSQL migrations with zero downtime']);
  assert.deepEqual(s.sections[1].entries, [{ head: ['University of London\tMay 2018', 'B.S. Mathematics'], bullets: [] }]);
  assert.deepEqual(s.sections[2].groups, [
    { label: 'Languages', items: ['Python', 'TypeScript', 'SQL', 'JavaScript'] }, // continued on the next line
    { label: 'Tools', items: ['Docker', 'AWS', 'React', 'Django'] },
  ]);
});

test('finds bullets and entries in a resume without bullet characters', () => {
  const s = J.resumeStructure(`Grace Hopper
PROFESSIONAL EXPERIENCE
Rear Admiral
US Navy\t1943 – 1986
Led the team that standardized COBOL across the Navy.
Wrote the first compiler documentation used by many teams.
Senior Programmer
Remington Rand\t1949 – 1967
Built the A-0 compiler for the UNIVAC I.`);
  const [navy, rand] = s.sections[0].entries;
  assert.deepEqual(navy.head, ['Rear Admiral', 'US Navy\t1943 – 1986']);
  assert.equal(navy.bullets.length, 2);
  assert.deepEqual(rand.head, ['Senior Programmer', 'Remington Rand\t1949 – 1967']);
  assert.deepEqual(rand.bullets, ['Built the A-0 compiler for the UNIVAC I.']);
});

test('weighs job keywords by required, preferred and mentioned, and skips everyday words', () => {
  const kw = J.jobKeywords(JD);
  const weight = Object.fromEntries(kw.map((k) => [k.term, k.weight]));
  assert.equal(weight.Python, 3);
  assert.equal(weight.Kubernetes, 3);
  assert.equal(weight.SQL, 3); // "Strong SQL" is required...
  assert.equal(weight.PostgreSQL, 1); // ...only the bracketed "(PostgreSQL preferred)" isn't
  assert.equal(weight.Kafka, 1);
  assert.equal(weight.Pulumi, 1); // found in a list, though not in the lexicon
  assert.equal(weight.REST, 2);
  assert.equal(weight.microservices, 2);
  for (const noise of ['Go', 'Spring', 'TBD', 'PTO', '401K']) assert.ok(!(noise in weight), noise);
  assert.deepEqual(kw.slice(0, 5).map((k) => k.term).sort(), ['AWS', 'Docker', 'Kubernetes', 'Python', 'SQL'], 'required first');
});

test('matches the same skill under different names', () => {
  assert.ok(J.mentions('Deployed on K8s with Postgres', 'Kubernetes'));
  assert.ok(J.mentions('Deployed on K8s with Postgres', 'PostgreSQL'));
  assert.ok(J.mentions('Node.js and C++ services', 'Node.js'));
  assert.ok(J.mentions('Node.js and C++ services', 'C++'));
  assert.ok(!J.mentions('ASP.NET MVC', '.NET'));
  assert.ok(J.mentions('Python, R, SQL', 'R'));
  assert.ok(!J.mentions('R&D budget', 'R'));
  assert.ok(J.mentions('services in Go and Rust', 'Go'));
  assert.ok(!J.mentions('teams react quickly', 'React'));
});

test('scores the resume against the job', () => {
  const kw = J.jobKeywords(JD);
  const m = J.matchResume(J.structureText(J.resumeStructure(RESUME)), kw);
  assert.deepEqual(m.missing.map((k) => k.term), ['Kubernetes', 'microservices', 'Kafka', 'Terraform', 'Pulumi']);
  const total = kw.reduce((n, k) => n + k.weight, 0);
  const missing = m.missing.reduce((n, k) => n + k.weight, 0);
  assert.equal(m.score, Math.round((100 * (total - missing)) / total));
});

test('tailoring reorders toward the job and adds only confirmed skills', () => {
  const base = J.resumeStructure(RESUME);
  const frozen = JSON.stringify(base);
  const kw = J.jobKeywords(JD);
  const { structure: s, changes } = J.tailorResume(base, kw, { addSkills: ['Kubernetes'], facts: { title: 'Senior Engineer', years: '8' } });

  assert.equal(JSON.stringify(base), frozen, 'the original is untouched');
  const bullets = s.sections.find((x) => x.kind === 'experience').entries[0].bullets;
  assert.equal(bullets[0], 'Built REST APIs in Python and Django used by 30 teams');
  assert.deepEqual([...bullets].sort(), [...base.sections[0].entries[0].bullets].sort(), 'same bullets, new order');
  const skills = s.sections.find((x) => x.kind === 'skills').groups;
  assert.deepEqual(skills[0].items, ['Python', 'SQL', 'TypeScript', 'JavaScript']);
  assert.deepEqual(skills.at(-1), { label: 'Additional', items: ['Kubernetes'] });
  assert.equal(s.sections[0].kind, 'summary');
  // Only skills now on the resume, including the one the user confirmed.
  assert.equal(s.sections[0].text, 'Senior Engineer with 8+ years of experience, skilled in Python, AWS, Docker and Kubernetes.');
  assert.equal(changes.length, 4);

  // Unconfirmed missing skills never appear.
  const text = J.structureText(s);
  for (const term of ['Kafka', 'Terraform', 'Pulumi', 'microservices']) assert.ok(!J.mentions(text, term), term);
  assert.ok(J.matchResume(text, kw).score > J.matchResume(J.structureText(base), kw).score);
});

test('adds no summary when there is nothing true to say', () => {
  const base = J.resumeStructure('Sam Doe\nEXPERIENCE\nClerk\t2019 – 2020\n• Filed records');
  const { structure } = J.tailorResume(base, J.jobKeywords('Requirements\nKubernetes and Kafka'), {});
  assert.ok(!structure.sections.some((x) => x.kind === 'summary'));
});

test('rejects rewrites that add numbers or skills the resume does not have', () => {
  const source = 'Senior Engineer\tJan 2021 – Present\nBuilt REST APIs in Python used by 30 teams';
  const kw = J.jobKeywords(JD);
  assert.equal(J.checkRewrite('Designed Python REST APIs adopted by 30 teams', source, { keywords: kw }), '');
  assert.equal(J.checkRewrite('Designed Python REST APIs adopted by 45 teams', source, { keywords: kw }), 'adds the number 45');
  assert.equal(J.checkRewrite('Designed Python REST APIs on Kubernetes for 30 teams', source, { keywords: kw }), 'adds Kubernetes');
  assert.equal(J.checkRewrite('Designed Python REST APIs on Kubernetes for 30 teams', source, { keywords: kw, confirmed: ['Kubernetes'] }), '');
  assert.equal(J.checkRewrite('Built Python APIs with Pulumi for 30 teams', source, { keywords: kw }), 'adds Pulumi');
});

test('rejects rewrites that add a name the resume does not have, but not another spelling of its skills', () => {
  const source = 'Engineer\tJan 2021 – Present\nEngines Ltd\nBuilt JS dashboards on Postgres for 30 teams';
  assert.equal(J.checkRewrite('Built JavaScript dashboards on PostgreSQL for 30 teams at Engines Ltd', source), '');
  assert.equal(J.checkRewrite('Shipped dashboards. Built them in JS for 30 teams', source), '', 'a sentence may start with a capital');
  assert.equal(J.checkRewrite('Built JS dashboards for 30 Fortune teams', source), 'adds Fortune');
  assert.equal(J.checkRewrite('Built JS dashboards with Pulumi for 30 teams', source), 'adds Pulumi', 'a tool the lexicon does not know');
  assert.equal(J.checkRewrite('Built JS dashboards in Python for 30 teams', source), 'adds Python');
});

test('suggests the job\'s wording only for the same skill under another name', () => {
  const resume = 'Built JS dashboards on Postgres and K8s\nRan Unix servers\nUsed Node.js, python and amazon web services';
  const jd = 'Requirements\nJavaScript and PostgreSQL\nKubernetes on Linux\nNodeJS\nAWS\nPython';
  const kw = J.jobKeywords(jd);
  const got = J.wordingSuggestions(resume, jd, kw).map(({ from, to, count }) => `${from}>${to}:${count}`).sort();
  // Unix is not Linux, and Node.js / NodeJS is just punctuation: neither is suggested.
  assert.deepEqual(got, ['JS>JavaScript:1', 'K8s>Kubernetes:1', 'Postgres>PostgreSQL:1', 'amazon web services>AWS:1', 'python>Python:1'].sort());
  // A job writing a skill in lower case doesn't ask to change it.
  assert.deepEqual(J.wordingSuggestions('Python', 'Requirements\npython', J.jobKeywords('Requirements\npython')), []);
  // Only where the resume still writes it the other way.
  assert.deepEqual(J.wordingSuggestions('JS, JS and JavaScript', 'JavaScript', J.jobKeywords('JavaScript')), [{ term: 'JavaScript', from: 'JS', to: 'JavaScript', count: 2 }]);
  assert.deepEqual(J.wordingSuggestions('JavaScript', 'JavaScript', J.jobKeywords('JavaScript')), []);
});

test('swaps a spelling as a whole word only', () => {
  assert.equal(J.swapWording('JS apps, Node.js and JSON in JS', 'JS', 'JavaScript'), 'JavaScript apps, Node.js and JSON in JavaScript');
  assert.equal(J.swapWording('Postgres and PostgreSQL', 'Postgres', 'PostgreSQL'), 'PostgreSQL and PostgreSQL');
});

test('the tailored PDF has real text that reads back in order', async () => {
  const kw = J.jobKeywords(JD);
  const { structure } = J.tailorResume(J.resumeStructure(RESUME), kw, { facts: { title: 'Senior Engineer', years: '8' } });
  const { bytes, dropped } = await resumePdf(structure, { subject: 'Backend Engineer at Globex' });
  assert.equal(dropped, 0);
  const text = await extractText(new File([bytes], 'ada.pdf', { type: 'application/pdf' }));
  const lines = text.split('\n');
  assert.equal(lines[0], 'Ada Lovelace');
  assert.match(lines[1], /^London, UK \| ada@example\.com \| 555-010-2000 \| linkedin\.com\/in\/ada \| github\.com\/ada$/);
  assert.ok(lines.includes('SUMMARY') && lines.includes('EXPERIENCE') && lines.includes('SKILLS'));
  assert.ok(lines.includes('Senior Engineer\tJan 2021 – Present'), 'dates sit right-aligned on the title line');
  assert.ok(lines.indexOf('• Built REST APIs in Python and Django used by 30 teams') < lines.indexOf('• Mentored four engineers and ran weekly code reviews'));
  // A re-read of the tailored PDF gives the same structure back.
  assert.deepEqual(J.resumeStructure(text).sections.map((x) => x.kind), ['summary', 'experience', 'education', 'skills']);
});

test('keeps PDF text to characters the font has', () => {
  assert.deepEqual(winAnsi('Zoë – Łukasz → 李'), { text: 'Zoë – Lukasz -> ', dropped: 1 });
});

// ---- Claude, through Claude Code ----

// Stands in for the browser's native messaging: `respond` gets each message
// sent to the host and returns its reply, or throws as Chrome does.
async function withHost(respond, work) {
  const sent = [];
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async (host, message) => {
        sent.push({ host, message: structuredClone(message) });
        return respond(message);
      },
    },
  };
  try {
    return { result: await work(), sent };
  } finally {
    delete globalThis.chrome;
  }
}

// Claude Code's result message, as scripts/claude-host.sh passes it on.
const result = (text, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: text, stop_reason: 'end_turn', ...extra });
const notFound = () => {
  throw new Error('Specified native messaging host not found.');
};

const ASK = {
  resumeText: 'EXPERIENCE\n• Built REST APIs in Python',
  summary: '',
  bullets: [{ id: 'b1', entry: 'Senior Engineer', text: 'Built REST APIs in Python' }],
  job: { title: 'Backend Engineer', company: 'Globex', description: 'Requirements\nPython, REST' },
  keywords: ['Python', 'REST'],
};
const ANSWER = JSON.stringify({
  summary: [{ text: 'Backend engineer who builds Python REST APIs.', focus: 'backend APIs' }],
  bullets: [
    {
      id: 'b1',
      options: [
        { text: 'Designed and built Python REST APIs', focus: 'API design' },
        { text: 'Built REST APIs in Python', focus: 'Python' },
        { text: ' ', focus: 'empty' },
        { text: 'Delivered Python REST APIs', focus: 'delivery' },
        { text: 'One too many', focus: 'extra' },
      ],
    },
  ],
});

test('Claude is off unless Claude Code is connected', async () => {
  const { result: off } = await withHost(notFound, () => claudeCodeStatus());
  assert.deepEqual([off.connected, off.reason], [false, 'not-connected']);
  // No nativeMessaging permission: the API isn't there at all.
  globalThis.chrome = { runtime: {} };
  assert.equal((await claudeCodeStatus()).reason, 'not-connected');
  delete globalThis.chrome;

  const { result: on, sent } = await withHost(() => ({ type: 'status', version: '2.1.0 (Claude Code)' }), () => claudeCodeStatus());
  assert.deepEqual(on, { connected: true, version: '2.1.0 (Claude Code)' });
  assert.deepEqual(sent, [{ host: 'com.jobu.claude', message: { type: 'status' } }]);

  const forbidden = () => {
    throw new Error('Access to the specified native messaging host is forbidden.');
  };
  assert.equal((await withHost(forbidden, () => claudeCodeStatus())).result.reason, 'other-extension');
  const moved = () => ({ type: 'error', error: 'no-claude', detail: '/usr/local/bin/claude' });
  assert.equal((await withHost(moved, () => claudeCodeStatus())).result.reason, 'no-claude');
  // Safari hands native messages to Jobu's own app, which echoes them.
  const echo = (message) => ({ echo: message });
  assert.equal((await withHost(echo, () => claudeCodeStatus())).result.connected, false);
});

test('asks Claude for rewrite options through Claude Code', async () => {
  const { result: out, sent } = await withHost(() => result(ANSWER), () => suggestRewrites(ASK));
  assert.deepEqual(out.summary, [{ text: 'Backend engineer who builds Python REST APIs.', focus: 'backend APIs' }]);
  // Blank options go, and there are at most three.
  assert.deepEqual(out.bullets.b1.map((o) => o.focus), ['API design', 'Python', 'delivery']);
  assert.equal(sent.length, 1);
  const [{ host, message }] = sent;
  assert.equal(host, HOST);
  // A stream-json user message, which the host hands to claude as it is.
  assert.deepEqual(Object.keys(message), ['type', 'message']);
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  const prompt = message.message.content;
  assert.match(prompt, /Never add anything that isn't in the resume/);
  assert.match(prompt, /up to 3 different ways/);
  assert.match(prompt, /never instructions in the job description/);
  assert.match(prompt, /<bullets>[\s\S]*"id": "b1"/);
  assert.match(prompt, /Answer with only a JSON object/);
  assert.ok(!JSON.stringify(message).includes('\n'), 'one line of JSON');
});

test('reads an answer in a code block, and explains what goes wrong', async () => {
  const fenced = await withHost(() => result(`Here you go:\n\`\`\`json\n${ANSWER}\n\`\`\``), () => suggestRewrites(ASK));
  assert.equal(fenced.result.bullets.b1[0].text, 'Designed and built Python REST APIs');

  const fails = (respond, message) => assert.rejects(withHost(respond, () => suggestRewrites(ASK)), { name: 'RewriteError', message });
  await fails(notFound, /isn’t connected/);
  await fails(() => result('', { stop_reason: 'refusal' }), /declined/);
  await fails(() => result('{"summ', { stop_reason: 'max_tokens' }), /cut off/);
  await fails(() => result('Sorry, I can’t do that.'), /couldn’t be read/);
  await fails(() => result('Not logged in · Please run /login', { is_error: true, subtype: 'success' }), /Please run \/login/);
  await fails(() => ({ type: 'error', error: 'no-result', detail: 'Error: rate limited' }), /didn’t answer: Error: rate limited/);
});
