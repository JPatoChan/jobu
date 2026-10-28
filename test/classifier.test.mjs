import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './helpers.mjs';

const J = loadPure();
const c = (label, attrs = '', autocomplete = '') => J.classify({ label, attrs, autocomplete });

test('classifies common labels', () => {
  const cases = {
    'First Name *': 'firstName',
    'Legal last name': 'lastName',
    Name: 'fullName',
    'Full name': 'fullName',
    'Email address': 'email',
    'Phone number': 'phone',
    'LinkedIn Profile': 'linkedin',
    'GitHub URL': 'github',
    'Portfolio / Website': 'portfolio',
    'Current Company': 'currentCompany',
    'Current location': 'location',
    'Are you legally authorized to work in the United States?': 'workAuthorized',
    'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?': 'sponsorship',
    'Are you willing to relocate?': 'relocate',
    'How did you hear about this job?': 'howHeard',
    Gender: 'gender',
    'Are you Hispanic/Latino?': 'hispanic',
    'Please identify your race': 'race',
    'Veteran Status': 'veteran',
    'Disability Status': 'disability',
    'Resume/CV': 'resume',
    'Cover Letter': 'coverLetter',
    'ZIP code': 'postalCode',
    State: 'state',
    Country: 'country',
    City: 'city',
    'Desired salary': 'salary',
    'Years of professional experience': 'yearsExperience',
    School: 'school',
    Degree: 'degree',
    'Are you at least 18 years of age?': 'over18',
  };
  for (const [label, key] of Object.entries(cases)) assert.equal(c(label), key, label);
});

test('rejects false positives', () => {
  assert.equal(c('Company name'), 'currentCompany');
  assert.equal(c('Emergency contact first name'), null);
  assert.equal(c('Opt in to marketing emails'), null);
  assert.equal(c('Company website'), null);
  assert.equal(c('Why do you want to work here?'), null);
});

test('falls back to attributes and autocomplete', () => {
  assert.equal(c('', 'legalNameSection_firstName'), 'firstName');
  assert.equal(c('', 'addressSection_postalCode'), 'postalCode');
  assert.equal(c('', 'phone-number'), 'phone');
  assert.equal(c('Something', '', 'family-name'), 'lastName');
});

test('bestOption picks the right option', () => {
  const pick = (opts, a) => J.bestOption(opts.map((text) => ({ text })), a)?.text;
  assert.equal(pick(['Select...', 'Yes', 'No'], 'No'), 'No');
  assert.equal(pick(['Male', 'Female', 'Decline To Self Identify'], 'Female'), 'Female');
  assert.equal(pick(['Male', 'Female', 'Decline To Self Identify'], 'Male'), 'Male');
  assert.equal(pick(['Male', 'Female', "I don't wish to answer"], 'Decline to self-identify'), "I don't wish to answer");
  assert.equal(pick(['Alabama', 'California', 'Colorado'], 'CA'), 'California');
  assert.equal(pick(['Canada', 'United States of America'], 'United States'), 'United States of America');
  assert.equal(pick(['Yes, I have a disability', 'No, I do not have a disability'], 'No'), 'No, I do not have a disability');
  assert.equal(pick(['Red', 'Blue'], 'Green'), undefined);
});

test('matches saved custom answers', () => {
  const answers = [
    { q: 'Why do you want to work at Acme?', a: 'A' },
    { q: 'Describe a hard bug you fixed', a: 'B' },
  ];
  assert.equal(J.matchCustomAnswer('Why do you want to work at Acme?*', answers)?.a, 'A');
  assert.equal(J.matchCustomAnswer('Tell us about your hobbies', answers), null);
});

test('a merged profile does not share objects with the default profile', () => {
  const profile = J.deepMerge(J.DEFAULT_PROFILE, { firstName: 'Ada', address: { city: 'London' } });
  assert.equal(profile.firstName, 'Ada');
  assert.equal(profile.address.city, 'London');
  assert.equal(profile.address.country, 'United States');
  const fresh = J.deepMerge(J.DEFAULT_PROFILE, {});
  fresh.address.city = 'Tacoma';
  fresh.customAnswers.push({ q: 'Why us?', a: 'Because.' });
  assert.equal(J.DEFAULT_PROFILE.address.city, '');
  assert.deepEqual(J.DEFAULT_PROFILE.customAnswers, []);
});
