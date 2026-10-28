// Reads profile fields out of resume text (see resume-text.mjs). Pure, so it
// can be unit-tested in Node. The contact header gives name, email, phone,
// links and location. The first entry under Experience gives the current
// title and company, and its dates give years of experience. The first entry
// under Education gives school, degree, major, graduation year and GPA.
// Needs classifier.js for J.US_STATES.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  // ---- Patterns ----

  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i;
  const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d[\d\s().-]{8,16}\d/;
  const TLDS = 'com|org|net|io|dev|me|co|ai|app|xyz|tech|site|page|info|us|uk|ca|de|in|au|eu|fr|nl|edu|design|codes|blog|online|work|so|sh|gg|ly|cc';
  const URL_RE = new RegExp(`(?:https?://)?(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:/[^\\s,;|)\\]]*)?`, 'gi');

  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)';
  const DATE = `(?:${MONTH}\\.?,?\\s*(?:'\\d{2}|(?:19|20)\\d{2})|\\d{1,2}\\s*[/.]\\s*(?:(?:19|20)\\d{2}|\\d{2})|(?:19|20)\\d{2})`;
  const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until|through)\\s*(${DATE}|present|current|now|today|ongoing)`, 'gi');
  const ANY_DATE = new RegExp(`(?:expected|anticipated|graduat(?:ed|ing|ion))?:?\\s*${DATE}`, 'gi');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const SEASONS = { spring: 3, summer: 6, fall: 9, autumn: 9, winter: 12 };

  const TITLE_WORDS = /\b(engineer|developer|programmer|architect|scientist|analyst|designer|manager|director|lead|head|vp|vice president|president|chief|cto|ceo|cfo|coo|founder|co-founder|consultant|specialist|coordinator|associate|assistant|administrator|officer|intern|researcher|technician|representative|accountant|auditor|nurse|teacher|instructor|professor|lecturer|writer|editor|strategist|producer|recruiter|advisor|adviser|owner|partner|principal|supervisor|agent|clerk|operator|marketer|tutor|fellow|attorney|lawyer|paralegal|pharmacist|physician|therapist|executive|sre|devops|qa|tester)\b/i;
  const SCHOOL_WORDS = /\b(universit(y|é|ät|à|ad)|college|institute|school|academy|polytechnic|conservatory|MIT|UCLA|NYU|USC|CMU|IIT|SUNY|CUNY|Caltech|UC [a-z]+)\b/i;
  const STREET = /^\d+[a-z]?\s+[\w .'-]*\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|terrace|ter|parkway|pkwy|circle|cir|highway|hwy|square|sq)\b\.?/i;
  const COMPANY_SUFFIX = /^(inc|llc|ltd|corp|co|gmbh|plc|pvt|limited|corporation|l\.l\.c|s\.a)\.?$/i;
  const COUNTRIES = {
    'united states': 'United States', usa: 'United States', 'u.s.a.': 'United States', us: 'United States',
    canada: 'Canada', 'united kingdom': 'United Kingdom', uk: 'United Kingdom', england: 'United Kingdom', scotland: 'United Kingdom',
    ireland: 'Ireland', germany: 'Germany', france: 'France', spain: 'Spain', italy: 'Italy', netherlands: 'Netherlands',
    india: 'India', australia: 'Australia', 'new zealand': 'New Zealand', singapore: 'Singapore', japan: 'Japan',
    brazil: 'Brazil', mexico: 'Mexico', sweden: 'Sweden', switzerland: 'Switzerland', israel: 'Israel', poland: 'Poland',
    portugal: 'Portugal', nigeria: 'Nigeria', kenya: 'Kenya', 'south africa': 'South Africa', philippines: 'Philippines',
    pakistan: 'Pakistan', 'south korea': 'South Korea', 'united arab emirates': 'United Arab Emirates', uae: 'United Arab Emirates',
  };

  const SECTIONS = [
    ['experience', /^(professional |work |relevant |employment |career |industry )?(experience|employment|work history|employment history|career history)$/],
    ['education', /^(education|academic background|academics|education (and|&) (training|certifications?))$/],
    ['skills', /^((technical |core |key )?skills|skills (and|&) [a-z]+|technologies|tech stack|tools)$/],
    ['projects', /^(personal |selected |key |academic )?projects$/],
    ['summary', /^(professional |career )?(summary|profile|objective|about( me)?)$/],
    ['other', /^(certifications?|licenses( (and|&) certifications)?|awards|honors( (and|&) awards)?|publications|volunteer(ing)?( experience| work)?|leadership( experience)?|activities|interests|languages|references|(relevant )?coursework|courses|achievements|contact( information)?)$/],
  ];

  // ---- Helpers ----

  const clean = (s) => String(s || '').replace(/[  ]+/g, ' ').trim();

  // Splits a line on tabs, pipes, bullets, long dashes and wide gaps.
  const parts = (line) =>
    line
      .split(/\t+|\s*[|•·◦▪∙]\s*|\s+[–—]\s+|\s+-\s+|\s{2,}/)
      .map(clean)
      .filter(Boolean);

  function headingOf(line) {
    let t = clean(line).replace(/[:：]$/, '');
    if (/^([A-Za-z] )+[A-Za-z](\s{2,}([A-Za-z] )+[A-Za-z])*$/.test(line.trim())) {
      t = line.trim().split(/\s{2,}/).map((w) => w.replace(/ /g, '')).join(' '); // "E X P E R I E N C E"
    }
    t = t.toLowerCase();
    if (!t || t.split(' ').length > 5) return null;
    for (const [name, re] of SECTIONS) if (re.test(t)) return name;
    return null;
  }

  // { header: [...], experience: [...], education: [...], ... }
  function splitSections(lines) {
    const out = { header: [] };
    let current = 'header';
    for (const line of lines) {
      const h = headingOf(line);
      if (h) {
        current = h;
        out[current] ||= [];
        continue;
      }
      (out[current] ||= []).push(line);
    }
    if (lines.length && out.header.length === lines.length) out.header = lines.slice(0, 8);
    return out;
  }

  const titleCase = (w) => w.toLowerCase().replace(/(^|[-'’])\p{L}/gu, (c) => c.toUpperCase());

  function dateOf(s, now) {
    const t = s.toLowerCase();
    if (/present|current|now|today|ongoing/.test(t)) return { y: now.getFullYear(), m: now.getMonth() + 1 };
    let y = +(t.match(/(?:19|20)\d{2}/) || [])[0] || 0;
    const short = t.match(/'(\d{2})|\/\s*(\d{2})$/);
    if (!y && short) y = 2000 + +(short[1] || short[2]);
    if (!y) return null;
    const name = t.match(new RegExp(MONTH));
    const num = t.match(/^(\d{1,2})\s*[/.]/);
    const m = name ? SEASONS[name[0]] || MONTHS.indexOf(name[0].slice(0, 3)) + 1 : num ? +num[1] : 1;
    return { y, m: m >= 1 && m <= 12 ? m : 1 };
  }

  const months = (d) => d.y * 12 + d.m;

  // ---- Fields ----

  const urlsIn = (s) =>
    (s.replace(new RegExp(EMAIL.source, 'gi'), ' ').match(URL_RE) || [])
      .map((u) => u.replace(/[.)]+$/, ''))
      .filter((u) => !/^(asp|ado|vb)\.net$/i.test(u));

  function contact(lines, header, out) {
    const text = lines.join('\n');
    out.email = (text.match(EMAIL) || [])[0];
    const phoneIn = (s) => (s.match(PHONE) || [])[0];
    const phone = phoneIn(header.join('\n')) || phoneIn(text);
    const digits = phone ? phone.replace(/\D/g, '').length : 0;
    if (digits >= 10 && digits <= 15) out.phone = clean(phone);

    const urls = urlsIn(text);
    const https = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const pick = (re) => urls.find((u) => re.test(u));
    const linkedin = pick(/linkedin\.com\/in\//i);
    const github = pick(/(^|\/\/|\.)github\.com\/[\w-]+/i);
    const twitter = pick(/(^|\/\/|\.)(twitter|x)\.com\/\w+/i);
    // A personal site only from the contact header or a line that is just a
    // link (link targets come last), not "built amazon.com checkout".
    const linkLines = lines.filter((l) => /^\S+$/.test(l.trim()) && urlsIn(l).length);
    const portfolio = urlsIn([...header, ...linkLines].join('\n')).find(
      (u) => !/linkedin\.com|github\.com|twitter\.com|(^|\/\/|\.)x\.com|google\.com|facebook\.com|instagram\.com/i.test(u),
    );
    if (linkedin) out['links.linkedin'] = https(linkedin);
    if (github) out['links.github'] = https(github);
    if (twitter) out['links.twitter'] = https(twitter);
    if (portfolio) out['links.portfolio'] = https(portfolio);
  }

  function name(header, out) {
    for (const line of header.slice(0, 5)) {
      for (const part of [...parts(line), clean(line)]) {
        const t = part.replace(/,\s*(ph\.?d|m\.?d|mba|cpa|pmp|pe|rn|jr|sr|ii|iii|iv)\.?$/i, '').trim();
        if (/[@\d/:]/.test(t) || TITLE_WORDS.test(t) || headingOf(t) || /resume|curriculum|vitae/i.test(t)) continue;
        let words = t.split(/\s+/);
        if (/^(jr|sr|ii|iii|iv)\.?$/i.test(words.at(-1))) words = words.slice(0, -1);
        if (words.length < 2 || words.length > 4) continue;
        const particle = (w) => /^(van|von|de|der|den|da|di|del|della|la|le|du|bin|al|ibn)$/i.test(w);
        const ok = words.every((w, i) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || (i > 0 && i < words.length - 1 && particle(w)));
        if (!ok) continue;
        if (words.every((w) => w.length < 2 || w === w.toUpperCase())) words = words.map(titleCase);
        const p = words.findIndex((w, i) => i > 0 && particle(w)); // "Ludwig van Beethoven"
        const split = p > 0 ? p : words.length - 1;
        out.firstName = words[0];
        out.middleName = words.slice(1, split).join(' ');
        out.lastName = words.slice(split).join(' ');
        return;
      }
    }
  }

  function location(header, out) {
    const states = J.US_STATES || {};
    const stateNames = Object.values(states).join('|');
    const US = new RegExp(`(?:^|,\\s*|\\s)([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*){0,3}),\\s*([A-Z]{2}\\b|${stateNames.replace(/\b\w/g, (c) => `[${c}${c.toUpperCase()}]`)})(?:,?\\s+(\\d{5})(?:-\\d{4})?)?`);
    const ABROAD = new RegExp(`(?:^|,\\s*)([A-Z][A-Za-z.' -]{1,30}?),\\s*(?:([A-Z]{2,3}),\\s*)?(${Object.keys(COUNTRIES).join('|').replace(/\./g, '\\.')})\\b`, 'i');
    for (const line of header.slice(0, 12)) {
      for (const part of parts(line)) {
        if (EMAIL.test(part) || /https?:|www\.|\.com\b/i.test(part)) continue;
        const us = part.match(US);
        const abbr = us && (us[2].length === 2 ? us[2].toLowerCase() : Object.keys(states).find((k) => states[k] === us[2].toLowerCase()));
        if (us && states[abbr]) {
          out['address.city'] = us[1];
          out['address.state'] = us[2].length === 2 ? us[2] : titleCase(us[2]);
          if (us[3]) out['address.postalCode'] = us[3];
          out['address.country'] = 'United States';
          const street = part.slice(0, us.index).replace(/,\s*$/, '').trim();
          if (STREET.test(street)) out['address.line1'] = street;
          return;
        }
        const ab = part.match(ABROAD);
        if (ab) {
          out['address.city'] = ab[1].trim();
          if (ab[2]) out['address.state'] = ab[2];
          out['address.country'] = COUNTRIES[ab[3].toLowerCase()];
          return;
        }
      }
    }
  }

  // The header lines of a section's first entry (before its bullet points).
  function firstEntry(lines, max = 3) {
    const head = [];
    for (const l of lines) {
      if (/^[•●▪◦∙‣*–-]\s*/.test(l) || l.length > 110) {
        if (head.length) break;
        continue;
      }
      head.push(l);
      if (head.length === max) break;
    }
    return head;
  }

  // Strips dates and "City, ST" so only names and titles are left.
  let cityState;
  const stripDetails = (s) => {
    const abbrs = Object.keys(J.US_STATES || {}).join('|').toUpperCase();
    cityState ||= new RegExp(`\\b[A-Z][a-zA-Z.]*(?: [A-Z][a-zA-Z.]*){0,2},\\s*(?:${abbrs})\\b(\\s+\\d{5})?`, 'g');
    return s
      .replace(RANGE, '\t')
      .replace(ANY_DATE, '\t')
      .replace(cityState, '\t')
      .replace(/\b(remote|hybrid|on-?site)\b/gi, '\t')
      .replace(/[()]/g, ' ');
  };

  function job(experience, out, now) {
    const frags = [];
    for (const line of firstEntry(experience)) {
      for (let p of parts(stripDetails(line))) {
        // "Senior Engineer at Acme", "Senior Engineer, Acme"
        const at = p.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i) || (TITLE_WORDS.test(p.split(',')[0]) && p.match(/^([^,]+),\s*(.+)$/));
        const pieces = at ? [at[1], at[2]] : [p];
        for (const piece of pieces.map(clean).filter((x) => /\p{L}{2}/u.test(x))) {
          if (COMPANY_SUFFIX.test(piece) && frags.length) frags[frags.length - 1] += `, ${piece}`;
          else frags.push(piece.replace(/[,;:]$/, ''));
        }
      }
    }
    const title = frags.find((f) => TITLE_WORDS.test(f));
    const company = frags.find((f) => f !== title);
    if (title) out['work.currentTitle'] = title;
    if (company) out['work.currentCompany'] = company;
    else if (!title && frags[0]) out['work.currentCompany'] = frags[0];

    // Years: from the earliest start to the latest end across all jobs.
    let start = null;
    let end = null;
    for (const line of experience) {
      for (const m of line.matchAll(RANGE)) {
        const a = dateOf(m[1], now);
        const b = dateOf(m[2], now);
        if (!a || !b || months(b) < months(a)) continue;
        if (!start || months(a) < months(start)) start = a;
        if (!end || months(b) > months(end)) end = b;
      }
    }
    const years = start && Math.floor((months(end) - months(start)) / 12);
    if (years >= 1) out['work.yearsExperience'] = String(years);
  }

  // Abbreviations end in \b then an optional dot, so "B.A." and "BA" both match.
  const DEGREES = [
    ['PhD', /\b(ph\.?\s?d|doctor(ate)? of|d\.?\s?phil|ed\.?\s?d)\b\.?/i],
    ["Master's", /\b(master'?s?|m\.?\s?sc?|m\.?\s?a|m\.?\s?eng|m\.?\s?b\.?\s?a|m\.?\s?f\.?\s?a|m\.?\s?p\.?\s?[ah])\b\.?/i],
    ["Bachelor's", /\b(bachelor'?s?|b\.?\s?sc?|b\.?\s?a|b\.?\s?eng|b\.?\s?tech|a\.b|b\.?\s?b\.?\s?a|b\.?\s?f\.?\s?a)\b\.?/i],
    ["Associate's", /\b(associate'?s?(?= degree| of)|a\.\s?[as]|a\.?a\.?s)\b\.?/i],
    ['High School', /\bhigh school( diploma)?\b|\bged\b/i],
  ];
  const FIELD_OF = /^\s*('s)?\s*((of|in)\s+(science|arts|engineering|business administration|fine arts|applied science|technology|laws|music|education|commerce|public health|public administration)\b)?\s*(degree\b)?/i;

  function school(education, out) {
    const lines = firstEntry(education, 4);
    const text = lines.join('\n');
    for (const line of lines) {
      const s = parts(stripDetails(line)).find((p) => SCHOOL_WORDS.test(p) && !/high school diploma/i.test(p));
      if (s) {
        out['education.school'] = s.replace(/,\s*$/, '');
        break;
      }
    }
    for (const [degree, re] of DEGREES) {
      const line = lines.find((l) => re.test(stripDetails(l)));
      if (!line) continue;
      out['education.degree'] = degree;
      const l = stripDetails(line);
      const m = l.match(re);
      let major = l
        .slice(m.index + m[0].length)
        .replace(FIELD_OF, '')
        .replace(/^\s*(in|,|:|-|–|—)\s*/i, '')
        .split(/[,|(•\t;]|\s[-–—]\s|\bminor\b|\bgpa\b|\bwith\b|\bsumma\b|\bmagna\b|\bcum laude\b|\bhonou?rs\b/i)[0]
        .trim();
      if (!major) {
        const before = l.slice(0, m.index).replace(/[,\s–—-]+$/, '').trim(); // "Mathematics, BA"
        if (before && !SCHOOL_WORDS.test(before) && before.length <= 60) major = before;
      }
      const isDegree = DEGREES.some(([, r]) => r.test(major));
      if (/^\p{L}[\p{L} &/'-]{1,59}$/u.test(major) && !SCHOOL_WORDS.test(major) && !isDegree) out['education.major'] = major;
      break;
    }
    // No "University"/"College" in the name: the entry's first line is usually the school.
    if (!out['education.school'] && lines[0]) {
      const first = parts(stripDetails(lines[0]))[0];
      if (first && !DEGREES.some(([, r]) => r.test(first)) && !/\d/.test(first)) out['education.school'] = first;
    }
    const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => +m[0]);
    if (years.length) out['education.graduationYear'] = String(Math.max(...years));
    const gpa = education.join('\n').match(/\bgpa\b[:\s]*(\d\.\d{1,2})|(\d\.\d{1,2})\s*(?:\/\s*\d\.\d{1,2}\s*)?gpa\b/i);
    if (gpa) out['education.gpa'] = gpa[1] || gpa[2];
  }

  // Non-empty lines with quotes and spaces normalized. Runs of spaces are
  // kept: they separate columns in plain-text resumes and words in
  // spaced-out headings ("W O R K   E X P E R I E N C E").
  J.resumeLines = (text) =>
    String(text || '')
      .replace(/[’‘]/g, "'")
      .replace(/ /g, ' ')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

  // experience | education | skills | projects | summary | other, or null.
  J.resumeHeading = headingOf;

  // True when the line holds a date range ("Jan 2020 – Present").
  J.hasDateRange = (line) => [...String(line).matchAll(RANGE)].length > 0;

  // Returns { 'profile.path': value } for every field it found.
  J.parseResume = (text, { now = new Date() } = {}) => {
    const lines = J.resumeLines(text);
    const sections = splitSections(lines);
    const out = {};
    contact(lines, sections.header, out);
    name(sections.header, out);
    location(sections.header, out);
    if (sections.experience) job(sections.experience, out, now);
    if (sections.education) school(sections.education, out);

    const intro = [...sections.header, ...(sections.summary || [])].join(' ');
    const stated = intro.match(/(\d{1,2})\+?\s*(?:years|yrs)\.?(?:\s+of)?(?:\s+[\w-]+){0,3}?\s+experience/i);
    if (stated) out['work.yearsExperience'] = stated[1];
    if (!out['work.currentTitle'] && sections.header[1] && TITLE_WORDS.test(sections.header[1]) && sections.header[1].length < 60) {
      out['work.currentTitle'] = parts(sections.header[1])[0]; // headline under the name
    }

    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out;
  };
})(globalThis);
