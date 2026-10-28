// Field classification and option matching. Pure functions (no DOM), so they
// can be unit-tested in Node.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  // Turns "legalNameSection_firstName*" into "legal name section first name".
  J.normalize = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/\(required\)|\brequired\b|\*/g, ' ')
      .replace(/[_\-\[\]\.:;,?!()'"/\\|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Ordered: the first rule that matches wins, so specific rules come first.
  // `key` names a value resolved by resolveValue(); `not` rejects false positives.
  const RULES = [
    { key: 'sponsorship', re: [/sponsor/, /visa status/, /\bh ?1 ?b\b/, /immigration (support|status)/] },
    { key: 'workAuthorized', re: [/(authori[sz]ed|eligible|permitted|entitled|able) to (legally )?work/, /work authori[sz]ation/, /right to work/, /legally (able|allowed) to work/] },
    { key: 'over18', re: [/\b(18|eighteen) years/, /at least 18/, /\bover 18\b/, /legal (working )?age/] },
    { key: 'relocate', re: [/relocat/] },
    { key: 'hispanic', re: [/hispanic/, /latin[oax]/] },
    { key: 'race', re: [/\brace\b/, /ethnicit/] },
    { key: 'gender', re: [/\bgender\b/, /^sex$/, /\bsex\b/], not: [/orientation/, /transgender/] },
    { key: 'veteran', re: [/veteran/, /military service/, /armed forces/] },
    { key: 'disability', re: [/disabilit/] },
    { key: 'pronouns', re: [/pronoun/] },
    { key: 'firstName', re: [/\bfirst name\b/, /\bgiven name\b/, /\bfname\b/, /^first$/, /\bforename\b/], not: [/preferred/, /emergency|reference|referr|manager/] },
    { key: 'lastName', re: [/\blast name\b/, /\bfamily name\b/, /\bsurname\b/, /\blname\b/, /^last$/], not: [/emergency|reference|referr|manager/] },
    { key: 'middleName', re: [/\bmiddle (name|initial)\b/] },
    { key: 'preferredName', re: [/preferred (first )?name/, /nick ?name/, /name you (prefer|go by)/] },
    { key: 'email', re: [/e ?mail/], not: [/\bopt (in|out)\b|subscribe|newsletter|marketing|referr/] },
    { key: 'phone', re: [/phone/, /mobile/, /\bcell\b/, /telephone/], not: [/extension|\bext\b|device type|phone type|country code|interview/] },
    { key: 'linkedin', re: [/linked ?in/] },
    { key: 'github', re: [/git ?hub/] },
    { key: 'twitter', re: [/twitter/, /\bx com\b/, /\bx profile\b/] },
    { key: 'portfolio', re: [/portfolio/, /personal (web ?)?site/, /\bwebsite\b/, /\bblog\b/, /^(url|link)s?$/, /other (url|link|website)/], not: [/company website/, /linked ?in|git ?hub/] },
    { key: 'fullName', re: [/^(your )?(full |legal |complete )?name$/, /\b(full|legal|complete) name\b/, /^name (first and last|as it appears)/, /^candidate name/], not: [/company|employer|school|reference|manager|recruiter|referr|emergency|signature/] },
    { key: 'addressLine2', re: [/address (line )?2/, /\bapt\b|apartment|\bsuite\b|\bunit\b/] },
    { key: 'postalCode', re: [/\bzip\b/, /postal/, /post ?code/] },
    { key: 'country', re: [/\bcountry\b/, /country region/], not: [/phone|code|citizen|dial/] },
    { key: 'city', re: [/\bcity\b/, /\btown\b/], not: [/ethnicit/] },
    { key: 'state', re: [/\bstate\b/, /province/, /^region$/, /\bstate region\b/], not: [/statement/] },
    { key: 'addressLine1', re: [/street/, /address (line )?1/, /^(home |mailing |current |residential )?address$/, /address section address line 1/], not: [/e ?mail|web|url|\bip\b/] },
    { key: 'location', re: [/\blocation\b/, /where are you (currently )?(based|located)/, /current (city|residence)/, /city and state/], not: [/preferred|relocat|office|willing|desired|work location preference/] },
    { key: 'yearsExperience', re: [/years (of )?(professional |relevant |related |total |work |industry )?experience/, /how many years/] },
    { key: 'currentTitle', re: [/current (job )?title/, /^(job )?title$/, /current (position|role)/, /most recent (job )?title/] },
    { key: 'currentCompany', re: [/current (company|employer)/, /^(company|employer)( name)?$/, /most recent (company|employer)/] },
    { key: 'school', re: [/\bschool\b/, /universit/, /college/, /institution/], not: [/high school diploma|graduat(e|ed) from high/] },
    { key: 'degree', re: [/\bdegree\b/], not: [/to what degree/] },
    { key: 'major', re: [/\bmajor\b/, /field of study/, /discipline/, /concentration/, /area of study/] },
    { key: 'gpa', re: [/\bgpa\b/, /grade point/] },
    { key: 'graduationYear', re: [/graduat(ion|e|ed)? (date|year)/, /year of graduation/, /class of/, /expected graduation/] },
    { key: 'salary', re: [/salary/, /compensation/, /pay (expectation|requirement)/, /desired pay/, /expected pay/] },
    { key: 'startDate', re: [/start date/, /available to start/, /earliest (start|availability)/, /when (can|could) you start/, /notice period/, /availability date/] },
    { key: 'howHeard', re: [/how did you (hear|find|learn|discover)/, /where did you (hear|find|learn)/, /referral source/, /source of (application|referral)/, /^source$/, /how did you come across/] },
    { key: 'coverLetter', re: [/cover ?letter/] },
    { key: 'resume', re: [/resume/, /\bcv\b/, /curriculum vitae/, /file upload input/, /attach/] },
  ];

  // Strong hints from the HTML autocomplete attribute.
  const AUTOCOMPLETE = {
    'given-name': 'firstName', 'family-name': 'lastName', 'additional-name': 'middleName', name: 'fullName',
    nickname: 'preferredName', email: 'email', tel: 'phone', 'tel-national': 'phone',
    'address-line1': 'addressLine1', 'street-address': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode',
    country: 'country', 'country-name': 'country', organization: 'currentCompany', 'organization-title': 'currentTitle', url: 'portfolio',
  };

  // signals: { label, attrs, autocomplete } where label is the human question
  // text and attrs is the name/id/automation-id text. Label wins over attrs.
  J.classify = (signals) => {
    const ac = String(signals.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
    for (const text of [signals.label, signals.attrs]) {
      const t = J.normalize(text);
      if (!t) continue;
      for (const rule of RULES) {
        if (rule.re.some((r) => r.test(t)) && !(rule.not || []).some((r) => r.test(t))) return rule.key;
      }
    }
    return null;
  };

  // Maps a classifier key to the profile value to type or pick.
  J.resolveValue = (key, p) => {
    const a = p.address || {};
    const map = {
      firstName: p.firstName,
      middleName: p.middleName,
      lastName: p.lastName,
      preferredName: p.preferredName || p.firstName,
      fullName: [p.firstName, p.lastName].filter(Boolean).join(' '),
      pronouns: p.pronouns,
      email: p.email,
      phone: p.phone,
      addressLine1: a.line1,
      addressLine2: a.line2,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      country: a.country,
      location: [a.city, a.state].filter(Boolean).join(', '),
      linkedin: p.links?.linkedin,
      github: p.links?.github,
      portfolio: p.links?.portfolio,
      twitter: p.links?.twitter,
      currentTitle: p.work?.currentTitle,
      currentCompany: p.work?.currentCompany,
      yearsExperience: p.work?.yearsExperience,
      school: p.education?.school,
      degree: p.education?.degree,
      major: p.education?.major,
      gpa: p.education?.gpa,
      graduationYear: p.education?.graduationYear,
      salary: p.preferences?.salary,
      startDate: p.preferences?.startDate,
      relocate: p.preferences?.willingToRelocate,
      workAuthorized: p.authorization?.workAuthorized,
      sponsorship: p.authorization?.requireSponsorship,
      over18: p.authorization?.over18,
      howHeard: p.howHeard,
      coverLetter: p.coverLetter,
      gender: p.eeo?.gender,
      hispanic: p.eeo?.hispanic,
      race: p.eeo?.race,
      veteran: p.eeo?.veteran,
      disability: p.eeo?.disability,
    };
    const v = map[key];
    return v == null ? '' : String(v);
  };

  // ---- Option matching (selects, radios, custom dropdowns) ----

  const DECLINE_RE = /decline|prefer not|do not (wish|want)|don ?t (wish|want)|not (to )?(say|disclose|answer|self ?identify|specified)|choose not|rather not|i do not wish/;
  const US_STATES = {
    al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
    de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
    in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
    ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
    ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
    nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
    ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
    vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
  };
  J.US_STATES = US_STATES;
  const ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america'],
    ['united kingdom', 'uk', 'u k', 'great britain', 'england'],
    ['yes', 'y', 'true'],
    ['no', 'n', 'false'],
  ];

  function variants(answer) {
    const n = J.normalize(answer);
    const out = new Set([n]);
    for (const group of ALIASES) if (group.includes(n)) group.forEach((g) => out.add(g));
    if (US_STATES[n]) out.add(US_STATES[n]);
    for (const [abbr, name] of Object.entries(US_STATES)) if (name === n) out.add(abbr);
    return [...out].filter(Boolean);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PLACEHOLDER_RE = /^(select|choose|please select|please choose|pick|none selected|--+|)( an? (option|one|answer))?( \.\.\.)?$/;

  // options: [{ text, ... }]. Returns the best-matching option or null.
  J.bestOption = (options, answer) => {
    const ans = J.normalize(answer);
    if (!ans) return null;
    const isDecline = DECLINE_RE.test(ans);
    const vs = variants(answer);
    let best = null;
    let bestScore = 0;
    for (const opt of options) {
      const t = J.normalize(opt.text);
      if (PLACEHOLDER_RE.test(t)) continue;
      let score = 0;
      if (isDecline) {
        score = DECLINE_RE.test(t) ? 90 : 0;
      } else if (vs.includes(t)) {
        score = 100;
      } else {
        for (const v of vs) {
          const wordRe = new RegExp(`\\b${escapeRe(v)}\\b`);
          if (t.startsWith(v + ' ') || v.startsWith(t + ' ')) score = Math.max(score, 80);
          else if (wordRe.test(t)) score = Math.max(score, v.length >= 3 ? 60 : 50);
          else if (t.length >= 3 && new RegExp(`\\b${escapeRe(t)}\\b`).test(v)) score = Math.max(score, 40);
        }
        // "No" must not match "No, I do not have..." when the answer is "Yes", etc.
        if (/^(yes|no)$/.test(ans) && /^(yes|no)\b/.test(t) && !t.startsWith(ans)) score = 0;
      }
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    return best;
  };

  // ---- Learned answers for custom questions ----

  const STOP = new Set('a an the to of for and or in on at you your are is do did what why how with this that we our us be have has please'.split(' '));
  const tokens = (s) => new Set(J.normalize(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));

  J.matchCustomAnswer = (question, answers) => {
    const q = tokens(question);
    if (!q.size) return null;
    let best = null;
    let bestScore = 0;
    for (const item of answers || []) {
      const t = tokens(item.q);
      if (!t.size || !item.a) continue;
      const inter = [...q].filter((w) => t.has(w)).length;
      const score = inter / (q.size + t.size - inter); // Jaccard similarity
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return bestScore >= 0.6 ? best : null;
  };
})(globalThis);
