import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './helpers.mjs';
import { makeDocx, makePdf } from './resume-files.mjs';
import { extractText, toLines, wordXmlText } from '../extension/src/options/resume-text.mjs';

const J = loadPure();
const now = new Date('2026-10-01');
const parse = (text) => ({ ...J.parseResume(text, { now }) });

test('parses a classic one-column resume', () => {
  const text = `Ada Lovelace
1 Analytical Way, San Francisco, CA 94105 | (555) 010-2000 | ada@example.com
linkedin.com/in/ada-lovelace | github.com/ada | ada.dev
SUMMARY
Senior engineer with 8+ years of software engineering experience building data systems.
EXPERIENCE
Senior Software Engineer\tJan 2020 – Present
Engines Ltd\tSan Francisco, CA
• Led the analytical engine team; built amazon.com integrations.
Software Engineer\tJun 2016 – Dec 2019
Babbage & Co.\tLondon, UK
• Wrote programs.
EDUCATION
University of London\tLondon, UK
Bachelor of Science in Mathematics, Minor in Physics\t2012 – 2016
GPA: 3.9/4.0
SKILLS
Python, Node.js, ASP.NET`;
  assert.deepEqual(parse(text), {
    email: 'ada@example.com',
    phone: '(555) 010-2000',
    'links.linkedin': 'https://linkedin.com/in/ada-lovelace',
    'links.github': 'https://github.com/ada',
    'links.portfolio': 'https://ada.dev', // not amazon.com from a bullet
    firstName: 'Ada',
    lastName: 'Lovelace',
    'address.line1': '1 Analytical Way',
    'address.city': 'San Francisco',
    'address.state': 'CA',
    'address.postalCode': '94105',
    'address.country': 'United States',
    'work.currentTitle': 'Senior Software Engineer',
    'work.currentCompany': 'Engines Ltd',
    'work.yearsExperience': '8', // the stated 8+ wins over the 10 the dates add up to
    'education.school': 'University of London',
    'education.degree': "Bachelor's",
    'education.major': 'Mathematics',
    'education.graduationYear': '2016',
    'education.gpa': '3.9',
  });
});

test('parses an all-caps name, spaced-out headings and numeric dates', () => {
  const text = `JOHN Q. PUBLIC
Software Developer
Austin, Texas · john.public@mail.com · +1 512-555-0199
W O R K   E X P E R I E N C E
Globex Corporation — Austin, TX
Data Analyst, 03/2019 - 08/2024
- Built dashboards
Initech, Inc.
Junior Analyst | 2017 - 2019
E D U C A T I O N
The University of Texas at Austin
B.A. Economics | May 2017`;
  assert.deepEqual(parse(text), {
    email: 'john.public@mail.com',
    phone: '+1 512-555-0199',
    firstName: 'John',
    middleName: 'Q.',
    lastName: 'Public',
    'address.city': 'Austin',
    'address.state': 'Texas',
    'address.country': 'United States',
    'work.currentTitle': 'Data Analyst',
    'work.currentCompany': 'Globex Corporation',
    'work.yearsExperience': '7',
    'education.school': 'The University of Texas at Austin',
    'education.degree': "Bachelor's",
    'education.major': 'Economics',
    'education.graduationYear': '2017',
  });
});

test('parses "Title at Company", name particles and a location outside the US', () => {
  const text = `Maria de la Cruz
Toronto, ON, Canada | maria@cruz.ca | linkedin.com/in/mdlc
Professional Experience
Product Manager at Shopify
2021 - Present
Associate Product Manager, Wealthsimple
2019 - 2021
Education
McGill University — Montréal
Master of Business Administration (MBA), 2019
B.Eng. in Mechanical Engineering, 2016`;
  assert.deepEqual(parse(text), {
    email: 'maria@cruz.ca',
    'links.linkedin': 'https://linkedin.com/in/mdlc',
    firstName: 'Maria',
    lastName: 'de la Cruz',
    'address.city': 'Toronto',
    'address.state': 'ON',
    'address.country': 'Canada',
    'work.currentTitle': 'Product Manager',
    'work.currentCompany': 'Shopify',
    'work.yearsExperience': '7',
    'education.school': 'McGill University',
    'education.degree': "Master's",
    'education.graduationYear': '2019',
  });
});

test('parses a company line above the title and a short school name', () => {
  const text = `Sam Lee
sam@lee.io  •  (415) 555-0100  •  Oakland, CA
Experience
Stripe
Staff Engineer — Payments\tAug 2018 – Present
Education
UC Berkeley\t2010 – 2014
BS, Electrical Engineering and Computer Science`;
  assert.deepEqual(parse(text), {
    email: 'sam@lee.io',
    phone: '(415) 555-0100',
    firstName: 'Sam',
    lastName: 'Lee',
    'address.city': 'Oakland',
    'address.state': 'CA',
    'address.country': 'United States',
    'work.currentTitle': 'Staff Engineer',
    'work.currentCompany': 'Stripe',
    'work.yearsExperience': '8',
    'education.school': 'UC Berkeley',
    'education.degree': "Bachelor's",
    'education.major': 'Electrical Engineering and Computer Science',
    'education.graduationYear': '2014',
  });
});

test('finds nothing in text that is not a resume', () => {
  assert.deepEqual(parse(''), {});
  assert.deepEqual(parse('Lorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor.'), {});
});

test('groups PDF text runs into lines and marks wide gaps with a tab', () => {
  const run = (str, x, y, width = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
  const lines = toLines([
    run('Engines Ltd', 72, 655),
    run('Senior', 72, 670),
    run(' ', 102, 670), // pdf.js inserts space runs; they must not hide the gap
    run('Software Engineer', 106, 670),
    run('Jan 2020 – Present', 450, 670.4),
  ]);
  assert.deepEqual(lines, ['Senior Software Engineer\tJan 2020 – Present', 'Engines Ltd']);
});

test('reads paragraphs, tabs and entities from Word XML', () => {
  const xml =
    '<w:body><w:p><w:r><w:t>Engines Ltd &amp; Co</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">Engineer </w:t></w:r><w:r><w:tab/><w:t>2020</w:t></w:r></w:p>' +
    '<w:p><mc:AlternateContent><mc:Choice><w:t>Box</w:t></mc:Choice><mc:Fallback><w:t>Box</w:t></mc:Fallback></mc:AlternateContent></w:p></w:body>';
  assert.equal(wordXmlText(xml), 'Engines Ltd & Co\nEngineer \t2020\nBox');
});

test('extracts a PDF resume, including link targets, and fills the profile from it', async () => {
  const pdf = makePdf(
    [
      { text: 'Ada Lovelace', x: 72, y: 740, size: 20 },
      { text: 'San Francisco, CA  |  ada@example.com  |  (555) 010-2000  |  LinkedIn', x: 72, y: 718 },
      { text: 'EXPERIENCE', x: 72, y: 690, size: 13 },
      { text: 'Senior Software Engineer', x: 72, y: 670 },
      { text: 'Jan 2020 – Present', x: 450, y: 670 },
      { text: 'Engines Ltd', x: 72, y: 655 },
      { text: '• Led the analytical engine team', x: 80, y: 640 },
    ],
    [{ url: 'https://www.linkedin.com/in/ada-lovelace', rect: [380, 714, 430, 730] }],
  );
  const text = await extractText(new File([pdf], 'ada.pdf', { type: 'application/pdf' }));
  assert.equal(
    text,
    [
      'Ada Lovelace',
      'San Francisco, CA | ada@example.com | (555) 010-2000 | LinkedIn',
      'EXPERIENCE',
      'Senior Software Engineer\tJan 2020 – Present',
      'Engines Ltd',
      '• Led the analytical engine team',
      'https://www.linkedin.com/in/ada-lovelace',
    ].join('\n'),
  );
  const found = parse(text);
  assert.equal(found.firstName, 'Ada');
  assert.equal(found['links.linkedin'], 'https://www.linkedin.com/in/ada-lovelace');
  assert.equal(found['work.currentTitle'], 'Senior Software Engineer');
  assert.equal(found['work.currentCompany'], 'Engines Ltd');
  assert.equal(found['work.yearsExperience'], '6');
});

test('extracts a DOCX resume with its header first and hyperlinks last', async () => {
  const docx = makeDocx([['Experience'], ['Senior Software Engineer', '\t', 'Jan 2020 – Present'], ['Engines Ltd & Co'], ['Education']], {
    header: [['Ada Lovelace'], ['ada@example.com']],
    links: [{ text: 'LinkedIn', url: 'https://linkedin.com/in/ada' }],
  });
  // No extension and no type: recognized by its ZIP signature.
  const text = await extractText(new File([docx], 'resume'));
  assert.equal(
    text,
    'Ada Lovelace\nada@example.com\nExperience\nSenior Software Engineer\tJan 2020 – Present\nEngines Ltd & Co\nEducation\nLinkedIn\nhttps://linkedin.com/in/ada',
  );
});

test('extracts RTF and plain text, and explains old .doc files', async () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Ada Lovelace\par ada@example.com\par Caf\'e9\tab 2020\par}`;
  assert.equal(await extractText(new File([rtf], 'ada.rtf')), 'Ada Lovelace\nada@example.com\nCafé\t2020');
  assert.equal(await extractText(new File(['Ada Lovelace\nada@example.com'], 'ada.txt')), 'Ada Lovelace\nada@example.com');
  await assert.rejects(extractText(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'ada.doc')), {
    name: 'ResumeError',
    message: /Old \.doc files/,
  });
});
