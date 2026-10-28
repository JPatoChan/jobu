// Detects the applicant tracking system and extracts the job posting on the page.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const ATS = [
    ['Greenhouse', /greenhouse\.io$/],
    ['Lever', /lever\.co$/],
    ['Workday', /myworkdayjobs\.com$|myworkdaysite\.com$|workday\.com$/],
    ['Ashby', /ashbyhq\.com$/],
    ['SmartRecruiters', /smartrecruiters\.com$/],
    ['iCIMS', /icims\.com$/],
    ['Jobvite', /jobvite\.com$/],
    ['Workable', /workable\.com$/],
    ['BambooHR', /bamboohr\.com$/],
    ['Taleo', /taleo\.net$/],
    ['SuccessFactors', /successfactors\.(com|eu)$|sapsf\.com$/],
    ['Rippling', /rippling\.com$|rippling-ats\.com$/],
    ['Breezy', /breezy\.hr$/],
    ['Recruitee', /recruitee\.com$/],
    ['Teamtailor', /teamtailor\.com$/],
    ['JazzHR', /applytojob\.com$/],
    ['Oracle Cloud', /oraclecloud\.com$/],
    ['LinkedIn', /linkedin\.com$/],
    ['Indeed', /indeed\.com$/],
  ];

  J.detectATS = (host = location.hostname) => {
    for (const [name, re] of ATS) if (re.test(host)) return name;
    if (document.querySelector('iframe[src*="greenhouse.io"], #grnhse_app')) return 'Greenhouse';
    if (document.querySelector('[data-automation-id="jobPostingHeader"]')) return 'Workday';
    return null;
  };

  const text = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';

  function fromJsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      const nodes = [].concat(data, data?.['@graph'] || []);
      const job = nodes.find((n) => n && [].concat(n['@type']).includes('JobPosting'));
      if (!job) continue;
      const loc = [].concat(job.jobLocation || [])[0]?.address || {};
      return {
        title: job.title,
        company: job.hiringOrganization?.name,
        location: [loc.addressLocality, loc.addressRegion, loc.addressCountry?.name || loc.addressCountry].filter(Boolean).join(', ') ||
          (job.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''),
        salary: salaryText(job.baseSalary),
        posted: job.datePosted,
        description: htmlText(job.description),
      };
    }
    return null;
  }

  function salaryText(b) {
    const v = b?.value;
    if (!v) return '';
    const fmt = (n) => (n ? Number(n).toLocaleString() : '');
    const range = v.minValue && v.maxValue ? `${fmt(v.minValue)}–${fmt(v.maxValue)}` : fmt(v.value || v.minValue);
    return range ? `${b.currency || ''} ${range}${v.unitText ? ' / ' + v.unitText.toLowerCase() : ''}`.trim() : '';
  }

  // JSON-LD descriptions are HTML, sometimes escaped twice. Lists and
  // paragraphs become lines, so the tailor page can find headings.
  function htmlText(html) {
    if (!html) return '';
    const parse = (s) => new DOMParser().parseFromString(s, 'text/html').body;
    if (/&lt;\w/.test(html)) html = parse(html).textContent;
    const breaks = html.replace(/<(br|\/p|\/li|\/h\d|\/div|\/ul|\/ol|\/tr)\b[^>]*>/gi, '$&\n').replace(/<li\b[^>]*>/gi, '$&• ');
    return tidy(parse(breaks).textContent);
  }

  const tidy = (t) =>
    String(t || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 20000);

  // Where boards without JSON-LD put the description. Last resort: the
  // largest block that reads like one.
  const DESCRIPTION = [
    '[data-automation-id="jobPostingDescription"]', '#jobDescriptionText', '.jobs-description__content', '.show-more-less-html__markup',
    '.job__description', '#content .content-intro, #content', '.posting-page [data-qa="job-description"], .posting-page .section-wrapper',
    '[class*="descriptionText"]', '.job-sections', '.job-description, #job-description, [class*="job-description" i], [class*="jobDescription"]',
  ];

  function descriptionFromPage() {
    for (const sel of DESCRIPTION) {
      const els = [...document.querySelectorAll(sel)];
      const t = tidy(els.map((el) => el.innerText).join('\n\n'));
      if (t.length > 200) return t;
    }
    const blocks = [...document.querySelectorAll('main, article, section, div')].filter((el) =>
      /responsibilit|requirement|qualification|what you('|’)?ll/i.test(el.textContent),
    );
    const best = blocks.sort((a, b) => a.textContent.length - b.textContent.length).find((el) => el.textContent.length > 400);
    return best ? tidy(best.innerText) : '';
  }

  // Site-specific selectors for boards that don't publish JSON-LD.
  function fromSelectors(ats) {
    const s = {
      Greenhouse: { title: '.app-title, h1.section-header, .job__title h1, h1', company: '.company-name', location: '.location, .job__location' },
      Lever: { title: '.posting-headline h2', company: '.main-header-logo img@alt', location: '.posting-categories .location, .sort-by-time' },
      Workday: { title: '[data-automation-id="jobPostingHeader"]', company: '', location: '[data-automation-id="locations"] dd' },
      Ashby: { title: 'h1', company: '', location: '[class*="location" i]' },
    }[ats] || { title: 'h1', company: '', location: '' };
    const pick = (sel) => {
      if (!sel) return '';
      const [css, attr] = sel.split('@');
      const el = document.querySelector(css);
      return attr ? el?.getAttribute(attr) || '' : text(css);
    };
    return { title: pick(s.title), company: pick(s.company), location: pick(s.location) };
  }

  function companyFromHost(ats) {
    const parts = location.pathname.split('/').filter(Boolean);
    if (ats === 'Greenhouse' || ats === 'Lever' || ats === 'Ashby') return parts[0] || '';
    if (ats === 'Workday') return location.hostname.split('.')[0];
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    return og || location.hostname.replace(/^(www|jobs|careers|boards)\./, '').split('.')[0];
  }

  J.isJobPosting = () => !!fromJsonLd();

  const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // full: also search the page for a description when there's no JSON-LD
  // (slower, so only the tailor page asks for it).
  J.extractJob = ({ full = false } = {}) => {
    const ats = J.detectATS();
    const ld = fromJsonLd() || {};
    const sel = fromSelectors(ats);
    const company = ld.company || sel.company || titleCase(companyFromHost(ats));
    return {
      url: location.href.split('#')[0],
      title: ld.title || sel.title || document.title,
      company,
      location: ld.location || sel.location || '',
      salary: ld.salary || '',
      posted: ld.posted || '',
      ats: ats || 'Other',
      description: ld.description || (full ? descriptionFromPage() : ''),
    };
  };
})(globalThis);
