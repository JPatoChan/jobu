// Shared profile schema, defaults and storage helpers.
// Loaded as a classic script by content scripts, the popup and the options page.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const YES_NO = ['Yes', 'No'];
  const DECLINE = 'Decline to self-identify';

  // Options-page layout. `path` is a dot path into the profile object.
  J.SCHEMA = [
    {
      id: 'personal',
      title: 'Personal',
      fields: [
        { path: 'firstName', label: 'First name', required: true },
        { path: 'middleName', label: 'Middle name' },
        { path: 'lastName', label: 'Last name', required: true },
        { path: 'preferredName', label: 'Preferred name' },
        { path: 'pronouns', label: 'Pronouns', placeholder: 'she/her, he/him, they/them' },
        { path: 'email', label: 'Email', type: 'email', required: true },
        { path: 'phone', label: 'Phone', type: 'tel', required: true },
      ],
    },
    {
      id: 'address',
      title: 'Address',
      fields: [
        { path: 'address.line1', label: 'Street address' },
        { path: 'address.line2', label: 'Apt / suite' },
        { path: 'address.city', label: 'City', required: true },
        { path: 'address.state', label: 'State / province', required: true },
        { path: 'address.postalCode', label: 'ZIP / postal code' },
        { path: 'address.country', label: 'Country', required: true },
      ],
    },
    {
      id: 'links',
      title: 'Links',
      fields: [
        { path: 'links.linkedin', label: 'LinkedIn URL', type: 'url', required: true },
        { path: 'links.github', label: 'GitHub URL', type: 'url' },
        { path: 'links.portfolio', label: 'Portfolio / website', type: 'url' },
        { path: 'links.twitter', label: 'X / Twitter URL', type: 'url' },
      ],
    },
    {
      id: 'work',
      title: 'Experience & education',
      fields: [
        { path: 'work.currentTitle', label: 'Current job title' },
        { path: 'work.currentCompany', label: 'Current company' },
        { path: 'work.yearsExperience', label: 'Years of experience', type: 'number' },
        { path: 'education.school', label: 'School / university' },
        { path: 'education.degree', label: 'Degree', placeholder: "Bachelor's" },
        { path: 'education.major', label: 'Field of study' },
        { path: 'education.gpa', label: 'GPA' },
        { path: 'education.graduationYear', label: 'Graduation year' },
      ],
    },
    {
      id: 'answers',
      title: 'Common application questions',
      fields: [
        { path: 'authorization.workAuthorized', label: 'Legally authorized to work in your country?', options: YES_NO },
        { path: 'authorization.requireSponsorship', label: 'Will you require visa sponsorship?', options: YES_NO },
        { path: 'authorization.over18', label: 'Are you 18 or older?', options: YES_NO },
        { path: 'preferences.willingToRelocate', label: 'Willing to relocate?', options: YES_NO },
        { path: 'preferences.salary', label: 'Desired salary', placeholder: '120000' },
        { path: 'preferences.startDate', label: 'Earliest start / notice period', placeholder: '2 weeks' },
        { path: 'howHeard', label: 'How did you hear about us?', placeholder: 'LinkedIn' },
        { path: 'coverLetter', label: 'Default cover letter', type: 'textarea' },
      ],
    },
    {
      id: 'eeo',
      title: 'Voluntary self-identification (EEO)',
      note: 'Optional. "Decline" picks the "prefer not to say" style option on each form.',
      fields: [
        { path: 'eeo.gender', label: 'Gender', options: ['Male', 'Female', 'Non-binary', DECLINE] },
        { path: 'eeo.hispanic', label: 'Hispanic or Latino?', options: ['Yes', 'No', DECLINE] },
        {
          path: 'eeo.race',
          label: 'Race',
          options: [
            'American Indian or Alaska Native',
            'Asian',
            'Black or African American',
            'Native Hawaiian or Other Pacific Islander',
            'White',
            'Two or More Races',
            DECLINE,
          ],
        },
        { path: 'eeo.veteran', label: 'Veteran status', options: ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', DECLINE] },
        { path: 'eeo.disability', label: 'Disability status', options: ['No, I do not have a disability', 'Yes, I have a disability', DECLINE] },
      ],
    },
  ];

  J.DEFAULT_PROFILE = {
    firstName: '', middleName: '', lastName: '', preferredName: '', pronouns: '',
    email: '', phone: '',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'United States' },
    links: { linkedin: '', github: '', portfolio: '', twitter: '' },
    work: { currentTitle: '', currentCompany: '', yearsExperience: '' },
    education: { school: '', degree: '', major: '', gpa: '', graduationYear: '' },
    authorization: { workAuthorized: 'Yes', requireSponsorship: 'No', over18: 'Yes' },
    preferences: { willingToRelocate: 'Yes', salary: '', startDate: '' },
    howHeard: 'LinkedIn',
    coverLetter: '',
    eeo: { gender: DECLINE, hispanic: DECLINE, race: DECLINE, veteran: DECLINE, disability: DECLINE },
    customAnswers: [], // [{ q: 'Why do you want to work here?', a: '...' }]
  };

  J.DEFAULT_SETTINGS = {
    showButton: true, // floating Jobu button on detected application forms
    highlight: true, // outline filled / needs-attention fields
    overwrite: false, // replace values already present in the form
    autofillOnNext: true, // fill each new page after Jobu clicks Next
    confirmSubmit: true, // ask in the panel before Jobu clicks Submit
  };

  J.getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  J.setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
    o[keys[keys.length - 1]] = value;
  };

  // Copies base, so editing the result (a profile) never edits J.DEFAULT_PROFILE.
  function deepMerge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base.map((v) => deepMerge(v));
    if (!base || typeof base !== 'object') return over === undefined ? base : over;
    const out = {};
    for (const k of Object.keys(base)) out[k] = deepMerge(base[k], over?.[k]);
    for (const k of Object.keys(over || {})) if (!(k in base)) out[k] = over[k];
    return out;
  }
  J.deepMerge = deepMerge;

  // Storage keys: profile, resume, coverLetterFile, settings, jobs, tailored
  // (resumes made on the tailor page), vault and vaultIndex (shared/vault.js),
  // anthropicKey (only if the user asks to remember it).
  J.store = {
    async load() {
      const s = await chrome.storage.local.get(['profile', 'resume', 'coverLetterFile', 'settings']);
      return {
        profile: deepMerge(J.DEFAULT_PROFILE, s.profile || {}),
        resume: s.resume || null, // { name, type, size, dataUrl }
        coverLetterFile: s.coverLetterFile || null,
        settings: { ...J.DEFAULT_SETTINGS, ...(s.settings || {}) },
      };
    },
    saveProfile: (profile) => chrome.storage.local.set({ profile }),
    saveSettings: (settings) => chrome.storage.local.set({ settings }),
    async jobs() {
      return (await chrome.storage.local.get('jobs')).jobs || [];
    },
  };

  J.profileCompleteness = (profile, resume) => {
    const req = J.SCHEMA.flatMap((s) => s.fields).filter((f) => f.required);
    const done = req.filter((f) => String(J.getPath(profile, f.path) || '').trim()).length + (resume ? 1 : 0);
    return Math.round((done / (req.length + 1)) * 100);
  };
})(globalThis);
