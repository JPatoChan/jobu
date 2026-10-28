// Tailors a resume to a job, the way Jobright does, on this computer.
//   J.resumeStructure: resume text into a name, contact line and sections of
//     entries (head lines + bullets), skill groups or a summary.
//   J.jobKeywords: the skills and tools a job description asks for, weighted
//     by whether they're required, preferred or just mentioned.
//   J.matchResume: how many of those the resume shows, as a 0-100 score.
//   J.tailorResume: moves the bullets and skills that match the job to the
//     top, and adds only the skills the user confirmed they have.
// Pure, so it runs in Node tests. Needs options/resume-parse.js.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  // ---- Job keywords ----

  // "Canonical|alias|=CaseSensitiveAlias". Soft skills start with "~".
  const LEXICON = [
    // Languages
    'JavaScript|JS|ECMAScript', 'TypeScript', 'Python', 'Java', 'C++|CPP', 'C#|C Sharp', '.NET|dotnet', 'ASP.NET',
    'Ruby', '=Ruby on Rails|=Rails|=RoR', 'PHP', 'Kotlin', '=Swift|SwiftUI', 'Objective-C', '=Rust', 'Scala', 'Perl', 'Elixir',
    'Haskell', '=Dart', 'Lua', 'MATLAB', 'Bash|shell scripting', 'PowerShell', 'SQL', 'NoSQL', 'GraphQL', 'HTML|HTML5', 'CSS|CSS3',
    'Sass|SCSS', 'VBA',
    // Web and mobile
    '=React|React.js|ReactJS', 'React Native', 'Angular|AngularJS', 'Vue|Vue.js|VueJS', 'Svelte', 'Next.js|NextJS', 'Node.js|NodeJS|=Node',
    '=Express|Express.js', 'Django', 'Flask', 'FastAPI', 'Laravel', 'jQuery', 'Redux', 'Tailwind|Tailwind CSS',
    'Webpack', 'Vite', '=Jest', '=Mocha', 'Cypress', 'Selenium', 'Playwright', 'JUnit', 'pytest', 'Storybook', 'iOS', 'Android',
    'Flutter', 'Xcode', 'responsive design', 'accessibility|WCAG|a11y',
    // Data and AI
    'PostgreSQL|Postgres', 'MySQL', 'SQL Server|MSSQL', '=Oracle', 'MongoDB|Mongo', 'Redis', 'Elasticsearch|OpenSearch', 'DynamoDB',
    'Cassandra', 'SQLite', '=Snowflake', 'BigQuery', 'Redshift', 'Databricks', '=Spark|Apache Spark|PySpark', 'Hadoop', 'Kafka',
    'Airflow', 'dbt', 'ETL|ELT', 'data pipelines', 'data modeling|data modelling', 'data warehousing|data warehouse', 'data analysis|data analytics',
    'data visualization|data visualisation', 'Tableau', '=Looker', 'Power BI|PowerBI', '=Excel|Microsoft Excel', 'Google Sheets', 'pandas',
    'NumPy', 'SciPy', 'scikit-learn|sklearn', 'TensorFlow', 'PyTorch', 'Keras', 'Jupyter', 'statistics|statistical analysis',
    'A/B testing|AB testing|split testing', 'experimentation', 'machine learning|=ML', 'deep learning', '=AI|artificial intelligence',
    'LLMs|=LLM|large language models', 'NLP|natural language processing', 'computer vision', 'generative AI|GenAI', 'prompt engineering',
    '=RAG|retrieval-augmented generation',
    // Cloud, infrastructure and security
    'AWS|Amazon Web Services', 'Azure', 'GCP|Google Cloud', 'Docker', 'Kubernetes|K8s', 'Terraform', 'Ansible', 'CloudFormation', '=Helm',
    'Jenkins', 'GitHub Actions', 'GitLab', 'CircleCI', 'CI/CD|continuous integration|continuous delivery|continuous deployment', '=Git',
    'Linux|Unix', 'serverless', '=Lambda', 'EC2', 'S3', 'microservices', 'distributed systems', '=REST|RESTful', 'APIs|=API', 'gRPC',
    'WebSockets', 'system design', 'Prometheus', 'Grafana', 'Datadog', 'Splunk', 'New Relic', 'observability', 'SRE|site reliability',
    'incident response', 'on-call', 'TCP/IP', 'DNS', 'OAuth', 'SSO|single sign-on', 'cybersecurity|cyber security', 'information security|InfoSec',
    'application security|AppSec', 'penetration testing|pen testing', 'SIEM', '=IAM', 'encryption', 'SOC 2|SOC2', 'ISO 27001', 'HIPAA', 'GDPR',
    'PCI DSS', 'unit testing|unit tests', 'TDD|test-driven development', 'test automation|automated testing', '=QA|quality assurance',
    'debugging', 'code review', 'object-oriented programming|OOP|object-oriented design', 'functional programming', 'data structures', 'algorithms',
    // Design
    '=UX|user experience', '=UI|user interface', 'user research|UX research', 'usability testing', 'wireframing|wireframes', 'prototyping',
    'design systems', 'interaction design', 'visual design', 'Figma', '=Sketch', 'Adobe XD', 'Adobe Creative Suite|Adobe Creative Cloud',
    'Photoshop', 'Illustrator', 'InDesign', 'After Effects', 'Premiere Pro', 'Canva',
    // Product and process
    'Agile', 'Scrum', 'Kanban', 'Jira', 'Confluence', 'Asana', 'project management', 'program management', 'product management',
    'product strategy', 'roadmaps|roadmap|roadmapping', 'requirements gathering', 'user stories', 'PMP', 'Six Sigma', '=Lean',
    'process improvement', 'change management', 'stakeholder management', 'KPIs|=KPI', 'OKRs|=OKR', 'go-to-market|=GTM', 'market research',
    'competitive analysis',
    // Marketing, sales and support
    'SEO|search engine optimization', '=SEM|search engine marketing', 'PPC|pay-per-click', 'Google Analytics|GA4', 'Google Ads|AdWords',
    'HubSpot', 'Salesforce|SFDC', 'Marketo', 'Mailchimp', 'CRM', 'content marketing', 'content strategy', 'email marketing',
    'social media', 'copywriting', 'brand strategy', 'demand generation', 'lead generation', 'marketing automation', 'B2B', 'B2C', 'SaaS',
    'account management', 'customer success', 'customer service|customer support', 'business development', 'cold calling', 'negotiation',
    'pipeline management', 'Zendesk', 'Intercom',
    // Finance, operations and people
    'financial modeling|financial modelling', 'financial analysis', 'forecasting', 'budgeting', 'FP&A', 'GAAP', 'IFRS', 'accounts receivable',
    'accounts payable', 'reconciliation|reconciliations', 'month-end close', 'QuickBooks', 'NetSuite', '=SAP', 'ERP', '=Workday',
    'internal audit', 'SOX|Sarbanes-Oxley', 'risk management', 'compliance', 'valuation', 'supply chain', 'logistics', 'inventory management',
    'procurement', 'vendor management', 'Microsoft Office|MS Office|Microsoft 365|Office 365', 'PowerPoint', 'EHR|EMR|electronic health records',
    '=Epic', 'patient care', 'CPR|BLS', 'medical terminology', 'recruiting|recruitment', 'talent acquisition', 'onboarding', 'HRIS', 'payroll',
    'employee relations', 'Spanish', 'French', 'German', 'Mandarin', 'Japanese', 'Portuguese', 'bilingual',
    // Soft skills
    '~communication|communication skills', '~leadership', '~mentoring|mentorship', '~collaboration', '~problem solving|problem-solving',
    '~attention to detail|detail-oriented', '~time management', '~public speaking', '~cross-functional', '~ownership', '~critical thinking',
  ];

  // Names that are also everyday words. Single letters only count in a list
  // ("Python, R, SQL") or named outright, and "Spring 2020" is a date.
  const SPECIAL = {
    R: [/(?<=[,/(]\s?)R(?=\s?[,/)])|\bR(?= programming| language)|\bRStudio\b/],
    C: [/(?<=[,/(]\s?)C(?=\s?[,/)])|\bC(?=\/C\+\+)|\bC(?= programming| language)/],
    Go: [/\bGo\b(?![-–]|\s+(?:to|above|beyond|through|live|out|ahead|back|further|for|after|get|with)\b)/, /\bgolang\b/i],
    Spring: [/\bSpring[\s-]?(?:Boot|Framework|MVC|Cloud)\b/i, /\bSpring\b(?!\s*(?:'?\d|semester|term|quarter|break|session))/],
  };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word edges that also work for C++, C#, .NET, Node.js and CI/CD. Words
  // may be split by a space or hyphen, and may be plural.
  const variantRe = (v) => {
    const cased = v.startsWith('=');
    const word = cased ? v.slice(1) : v;
    const body = esc(word).replace(/[ -]/g, '[\\s-]?');
    const plural = !cased && word.length > 2 && /[a-z]$/i.test(word) ? '(?:e?s)?' : '';
    return new RegExp(`(?<![\\w+#.])${body}${plural}(?![\\w+#]|\\.\\w)`, cased ? '' : 'i');
  };

  const TERMS = new Map(Object.entries(SPECIAL).map(([t, res]) => [t, { term: t, res, soft: false }]));
  for (const line of LEXICON) {
    const soft = line.startsWith('~');
    const variants = (soft ? line.slice(1) : line).split('|');
    const term = variants[0].replace(/^=/, '');
    TERMS.set(term, { term, res: variants.map(variantRe), soft });
  }
  const BY_LOWER = new Map([...TERMS.keys()].map((t) => [t.toLowerCase(), t]));

  // True when the text mentions the term or one of its aliases. Terms the
  // lexicon doesn't know (found in a job's lists) match as written.
  const OTHER = new Map();
  J.mentions = (text, term) => {
    const t = TERMS.get(term) || OTHER.get(term) || OTHER.set(term, { res: [variantRe(term)] }).get(term);
    return t.res.some((re) => re.test(text));
  };

  // Headings in job descriptions, and how much the terms under them count.
  const PREFERRED = /\b(preferred|nice[- ]to[- ]haves?|bonus|pluses|plus|desired|desirable|extra credit|ideally|ideal candidate)\b/i;
  const REQUIRED = /\b(requirements?|required|qualifications?|must[- ]haves?|what you('|’)?ll need|what we('|’)?re looking for|you have|you bring|who you are|about you|skills|experience)\b/i;
  const NEUTRAL = /\b(about (us|the (company|team|role))|benefits|perks|what we offer|compensation|salary|pay|responsibilities|what you('|’)?ll do|the role|your role|day[- ]to[- ]day|equal (employment )?opportunity|our team|who we are)\b/i;
  const WEIGHT = { req: 3, other: 2, pref: 1 };

  function jdHeading(line) {
    if (line.length > 60 || /[.!?;,]$/.test(line) || line.split(/\s+/).length > 6 || /^[\d•·*–-]/.test(line)) return null;
    if (PREFERRED.test(line)) return 'pref';
    if (REQUIRED.test(line)) return 'req';
    if (NEUTRAL.test(line) || /:$/.test(line)) return 'other';
    return null;
  }

  // Tools named in lists that the lexicon doesn't know ("such as Pulumi or CDK").
  const LIST = /\(([^()]{3,160})\)|\b(?:such as|including|e\.g\.,?|like)\s+([^.;:()]{3,160})/gi;
  const NOT_SKILLS = /^(the|a|an|our|your|we|you|this|that|these|those|etc|other|similar|related|equivalent|more|some|any|all|new|google|meta|amazon|apple|microsoft|netflix|facebook|startups?|fortune|u\.?s\.?|years?)$/i;
  const COMMON_ACRONYMS = new Set(
    'USA EEO EOE ADA PTO LLC INC CEO CTO CFO COO CMO CIO CPO SVP EVP AND THE YOU OUR FAQ NYC APAC EMEA LATAM UTC PST EST CST MST PDT EDT 401K FTE OTE DEI JD MBA PHD GED ASAP TBD ETA YOE H1B OPT STEM USD EUR GBP FMLA OSHA LGBTQ LGBTQIA HQ WFH NOTE'.split(' '),
  );

  function extraTerms(line) {
    const out = [];
    for (const m of line.matchAll(LIST)) {
      for (let item of (m[1] || m[2]).split(/,|\/|;|\bor\b|\band\b|\betc\b\.?/i)) {
        item = item.replace(/^\s*(e\.g\.,?|i\.e\.,?|tools like|experience with)\s*/i, '').trim();
        const words = item.split(/\s+/);
        if (item.length < 2 || item.length > 30 || words.length > 3) continue;
        if (!/^[A-Z]|[.+#\d]/.test(item) || words.every((w) => NOT_SKILLS.test(w)) || NOT_SKILLS.test(words[0])) continue;
        out.push(item);
      }
    }
    if (line === line.toUpperCase()) return out; // a heading in capitals
    for (const m of line.matchAll(/\b[A-Z][A-Z0-9]{2,6}\b/g)) if (!COMMON_ACRONYMS.has(m[0])) out.push(m[0]);
    return out;
  }

  // [{ term, weight, soft }], most important first. Weight 3: required,
  // 1: preferred, 2: anywhere else. A term named three or more times gets +1.
  J.jobKeywords = (jd, { max = 40 } = {}) => {
    const found = new Map();
    const note = (term, weight, soft, at) => {
      const k = found.get(term) || { term, weight: 0, soft, count: 0, at };
      k.weight = Math.max(k.weight, soft ? 1 : weight);
      k.count++;
      found.set(term, k);
    };
    let section = 'other';
    J.resumeLines(jd).forEach((line, at) => {
      const hits = [...TERMS.values()].filter((t) => t.res.some((re) => re.test(line)));
      // A line naming a skill is a requirement, not a heading ("Experience with Go").
      const heading = hits.some((t) => !t.soft) ? null : jdHeading(line);
      if (heading) section = heading;
      // "Strong SQL (PostgreSQL preferred)": only what's in the brackets is preferred.
      const outside = line.replace(/\([^()]*\)/g, ' ');
      const asides = [...line.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]).filter((a) => PREFERRED.test(a)).join(' ');
      const where = heading ? section : PREFERRED.test(outside) ? 'pref' : /\b(required|must have|must be)\b/i.test(line) ? 'req' : section;
      for (const t of hits) {
        const aside = asides && t.res.some((re) => re.test(asides)) && !t.res.some((re) => re.test(outside));
        note(t.term, WEIGHT[aside ? 'pref' : where], t.soft, at);
      }
      for (const item of extraTerms(line)) {
        if (BY_LOWER.has(item.toLowerCase()) || [...TERMS.values()].some((t) => t.res.some((re) => re.test(item)))) continue;
        note(item, WEIGHT[where], false, at);
      }
    });
    // Acronyms seen once are as likely noise ("TBD") as skills.
    for (const [term, k] of found) if (!TERMS.has(term) && /^[A-Z0-9]+$/.test(term) && k.count < 2) found.delete(term);
    return [...found.values()]
      .map((k) => ({ term: k.term, weight: Math.min(4, k.weight + (k.count >= 3 && !k.soft ? 1 : 0)), soft: k.soft, at: k.at }))
      .sort((a, b) => b.weight - a.weight || a.at - b.at)
      .slice(0, max)
      .map(({ at, ...k }) => k);
  };

  // { score, keywords, matched, missing }: score is the share of the job's
  // keyword weight that the resume shows, 0-100.
  J.matchResume = (resumeText, jdOrKeywords) => {
    const keywords = Array.isArray(jdOrKeywords) ? jdOrKeywords : J.jobKeywords(jdOrKeywords);
    const matched = [];
    const missing = [];
    for (const k of keywords) (J.mentions(resumeText, k.term) ? matched : missing).push(k);
    const sum = (ks) => ks.reduce((n, k) => n + k.weight, 0);
    const total = sum(keywords);
    return { score: total ? Math.round((100 * sum(matched)) / total) : 0, keywords, matched, missing };
  };

  // ---- Resume structure ----

  const BULLET = /^(?:[•·◦▪∙‣●○■□➢►▸✓✔*\uf0b7\uf0a7\uf076\uf0d8\uf0fc]|[-–—](?=\s)|\d{1,2}[.)](?=\s))\s*/;
  const URL_ONLY = /^(?:(?:https?:\/\/|mailto:|tel:|www\.)\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*)$/i;
  const CONNECTOR = /(?:[,&/(-]|\b(?:and|or|of|the|to|with|for|in|a|an|by|on|at|from|into|using|across|via|including))$/i;
  const PARTS = /\t+|\s*[|•·◦▪]\s*|\s{3,}/;

  const titleCase = (s) =>
    s.toLowerCase().replace(/(^|\s|&)(\p{L})/gu, (m, a, c) => a + c.toUpperCase()).replace(/\b(And|Of|The|For|In)\b/g, (w) => w.toLowerCase());

  function sectionTitle(line) {
    let t = line.trim().replace(/[:：]$/, '');
    if (/^([A-Za-z] )+[A-Za-z](\s{2,}([A-Za-z] )+[A-Za-z])*$/.test(t)) t = t.split(/\s{2,}/).map((w) => w.replace(/ /g, '')).join(' ');
    return t === t.toUpperCase() || t === t.toLowerCase() ? titleCase(t).replace(/^./, (c) => c.toUpperCase()) : t;
  }

  const bare = (u) => u.replace(/^(https?:\/\/)?(www\.)?/i, '').replace(/\/$/, '').toLowerCase();

  // Puts link targets (appended by resume-text.mjs) into the contact parts:
  // in place of a "LinkedIn" / "GitHub" / "Portfolio" label, or at the end.
  function addLinks(contact, links) {
    const text = contact.join(' ').toLowerCase();
    for (const link of links) {
      if (/^(mailto|tel):/i.test(link)) continue;
      const short = bare(link);
      if (text.includes(short)) continue;
      const label = /linkedin\.com/i.test(short) ? /^linkedin$/i : /github\.com/i.test(short) ? /^github$/i : /^(portfolio|website|web|blog)$/i;
      const i = contact.findIndex((p) => label.test(p));
      if (i >= 0) contact[i] = short;
      else contact.push(short);
    }
    return contact;
  }

  function skillGroups(lines) {
    const groups = [];
    let joinNext = false;
    for (const raw of lines) {
      const line = raw.replace(BULLET, '').trim();
      const m = line.match(/^([^:,]{2,40}):\s*(.*)$/);
      const items = (m ? m[2] : line).split(/\s*[,;|•·]\s*|\t+/).map((s) => s.trim()).filter(Boolean);
      if (joinNext && !m && groups.length) groups[groups.length - 1].items.push(...items);
      else groups.push({ label: m ? m[1].trim() : '', items });
      joinNext = /,\s*$/.test(line);
    }
    return groups.filter((g) => g.items.length || g.label);
  }

  const isShort = (l) => l.length <= 60 && !/[.!?]$/.test(l);

  function entriesOf(lines, kind) {
    const entries = [];
    let e = null;
    let lead = -1; // where the date sits in an entry's head (title above it?)
    const start = (head = []) => entries.push((e = { head, bullets: [] }));
    for (const raw of lines) {
      const marker = raw.match(BULLET);
      const line = marker ? raw.slice(marker[0].length).trim() : raw;
      if (!line) continue;
      if (marker) {
        if (!e) start();
        e.bullets.push(line);
        continue;
      }
      // A wrapped line continues the bullet (or long line) above it.
      const prev = e && (e.bullets.length ? e.bullets : e.head.at(-1)?.length > 60 ? e.head : null);
      if (prev && !J.hasDateRange(line) && (/^\p{Ll}/u.test(line) || CONNECTOR.test(prev.at(-1)))) {
        prev[prev.length - 1] += ` ${line}`;
        continue;
      }
      const dated = J.hasDateRange(line);
      if (!e || e.bullets.length) start();
      else if (dated && e.head.some(J.hasDateRange)) {
        // A second date: the next entry. Its title lines may already sit in
        // the previous entry, where the first entry put them above its date.
        const take = [];
        while (take.length < lead && e.head.length > 1 && isShort(e.head.at(-1)) && !J.hasDateRange(e.head.at(-1))) take.unshift(e.head.pop());
        start(take);
      }
      if (dated && lead < 0) lead = e.head.length;
      e.head.push(line);
    }
    // Lists without bullet characters (common in DOCX): sentence-like lines
    // after the title, company and dates are the bullets.
    if (kind === 'experience' || kind === 'projects') {
      for (const en of entries) {
        if (en.bullets.length || en.head.length < 3) continue;
        let n = Math.max(1, en.head.slice(0, 3).findIndex(J.hasDateRange) + 1);
        while (n < Math.min(3, en.head.length) && isShort(en.head[n])) n++;
        en.bullets = en.head.splice(n);
      }
    }
    return entries;
  }

  // { name, contact: [parts], sections: [{ title, kind, text | groups | entries }] }
  J.resumeStructure = (text) => {
    const lines = J.resumeLines(text);
    const links = [];
    while (lines.length && URL_ONLY.test(lines.at(-1))) links.unshift(lines.pop());
    const header = [];
    const sections = [];
    let current = null;
    for (const line of lines) {
      const kind = J.resumeHeading(line);
      if (kind) sections.push((current = { title: sectionTitle(line), kind, lines: [] }));
      else (current ? current.lines : header).push(line);
    }
    const [first = '', ...rest] = header;
    const [name, ...more] = first.split(PARTS).map((s) => s.trim()).filter(Boolean);
    const contact = addLinks([...more, ...rest.flatMap((l) => l.split(PARTS))].map((s) => s.trim()).filter(Boolean), links);
    return {
      name: name || '',
      contact,
      sections: sections.map(({ title, kind, lines: ls }) => {
        if (kind === 'summary') return { title, kind, text: ls.map((l) => l.replace(BULLET, '')).join(' ') };
        if (kind === 'skills') return { title, kind, groups: skillGroups(ls) };
        return { title, kind, entries: entriesOf(ls, kind) };
      }),
    };
  };

  // Plain text of a structure, for scoring and for the AI prompt.
  J.structureText = (s) =>
    [
      s.name,
      s.contact.join(' | '),
      ...s.sections.flatMap((sec) => [
        sec.title.toUpperCase(),
        ...(sec.text != null ? [sec.text] : []),
        ...(sec.groups || []).map((g) => (g.label ? `${g.label}: ` : '') + g.items.join(', ')),
        ...(sec.entries || []).flatMap((e) => [...e.head.map((h) => h.replace(/\t+/g, '  ')), ...e.bullets.map((b) => `• ${b}`)]),
      ]),
    ]
      .filter(Boolean)
      .join('\n');

  // ---- Checking rewrites ----

  // Hard skills from the lexicon that the text mentions.
  J.termsIn = (text) => [...TERMS.values()].filter((t) => !t.soft && t.res.some((re) => re.test(text))).map((t) => t.term);

  // "2M", "40%", "$1,200" but not the 2 in "EC2".
  const numbersIn = (text) => (String(text).match(/(?<![A-Za-z])\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, ''));

  // Why a rewrite can't be used, or '' if it only says what the source (the
  // bullet's entry, or the whole resume) says: no number and no skill that
  // isn't in the source, apart from skills the user confirmed.
  J.checkRewrite = (rewrite, source, { confirmed = [], keywords = [] } = {}) => {
    const numbers = new Set(numbersIn(source));
    const number = numbersIn(rewrite).find((n) => !numbers.has(n));
    if (number) return `adds the number ${number}`;
    const ok = (term) => J.mentions(source, term) || confirmed.some((c) => c === term || J.mentions(c, term));
    const skill = [...J.termsIn(rewrite), ...keywords.filter((k) => !k.soft).map((k) => k.term)].find((t) => J.mentions(rewrite, t) && !ok(t));
    return skill ? `adds ${skill}` : '';
  };

  // ---- Tailoring ----

  const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Returns { structure, changes }. Never invents experience: bullets and
  // skills are only reordered, the skills in addSkills (which the user
  // confirmed) are added, and a summary is added only when there's none,
  // built from the user's own title and years and skills already on the resume.
  J.tailorResume = (structure, keywords, { addSkills = [], facts = {} } = {}) => {
    const s = structuredClone(structure);
    const changes = [];
    const weightOf = (text) => keywords.reduce((n, k) => n + (J.mentions(text, k.term) ? k.weight : 0), 0);
    const stable = (xs, score) => xs.map((x, i) => ({ x, i, w: score(x) })).sort((a, b) => b.w - a.w || a.i - b.i);

    let moved = 0;
    for (const sec of s.sections) {
      if (sec.kind !== 'experience' && sec.kind !== 'projects') continue;
      for (const e of sec.entries) {
        const ranked = stable(e.bullets, weightOf);
        moved += ranked.filter((r, pos) => pos < r.i).length;
        e.bullets = ranked.map((r) => r.x);
      }
    }
    if (moved) changes.push(`Moved ${plural(moved, 'bullet')} that show this job’s skills higher up.`);

    let skills = s.sections.find((sec) => sec.kind === 'skills');
    if (skills) {
      const before = JSON.stringify(skills.groups);
      for (const g of skills.groups) g.items = stable(g.items, weightOf).map((r) => r.x);
      if (JSON.stringify(skills.groups) !== before) changes.push('Put the skills this job asks for first.');
    }

    const text = J.structureText(s);
    const add = [...new Set(addSkills)].filter((t) => !J.mentions(text, t));
    if (add.length) {
      if (!skills) {
        skills = { title: 'Skills', kind: 'skills', groups: [] };
        const at = s.sections.findIndex((sec) => sec.kind === 'summary') + 1;
        s.sections.splice(at, 0, skills);
      }
      let group = skills.groups.find((g) => !g.label);
      if (!group) skills.groups.push((group = { label: skills.groups.length ? 'Additional' : '', items: [] }));
      group.items.push(...add);
      changes.push(`Added ${listOf(add)} to your skills, as you confirmed.`);
    }

    if (!s.sections.some((sec) => sec.kind === 'summary')) {
      const shown = keywords.filter((k) => !k.soft && J.mentions(J.structureText(s), k.term)).slice(0, 4).map((k) => k.term);
      const title = String(facts.title || '').trim();
      const years = Number(facts.years) > 0 ? ` with ${Number(facts.years)}+ years of experience` : '';
      const skilled = shown.length ? `${title ? ', ' : ''}skilled in ${listOf(shown)}` : '';
      if (title || skilled) {
        const summary = `${title}${title ? years : ''}${title ? skilled : skilled.replace(/^s/, 'S')}.`;
        s.sections.unshift({ title: 'Summary', kind: 'summary', text: summary });
        changes.push('Added a short summary from your title, years of experience and matching skills.');
      }
    }
    return { structure: s, changes };
  };
})(globalThis);
