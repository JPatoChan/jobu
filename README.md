# Jobu

Jobu is a Chrome extension (Manifest V3) that scans job applications, autofills them, steps through multi-page forms, submits them when you say so, and keeps track of the jobs you save and apply to.

## Features

- **Profile from your resume.** On first launch the profile page opens. Upload your resume (PDF, DOCX, TXT or RTF), or drop it on the upload box. Jobu reads it on your computer and fills in your profile:
  - name, email, phone, address, and LinkedIn, GitHub, X and portfolio links (including links behind a "LinkedIn" label)
  - current job title and company, and years of experience from the dates under Experience (a stated "8+ years" wins)
  - school, degree, field of study, graduation year and GPA from the first Education entry

  Filled fields are highlighted until you edit them. Jobu only fills empty fields. If the resume disagrees with something you typed, it lists those fields and offers *Use the resume's values*. *Fill my profile from this resume again* re-reads a saved resume. PDFs are read with a bundled copy of [pdf.js](https://mozilla.github.io/pdf.js/). Scanned (image-only) PDFs and old `.doc` files can't be read, and Jobu says so.
- **Page scan panel.** The floating **Jobu** button opens a panel that lists every field on the page, grouped by status: *needs you* (required, no saved answer), *ready to fill* (with the value Jobu will use), *filled*, and *optional*. Click a field to jump to it. The panel also shows the job, the ATS, the step ("Step 2 of 4") and any validation errors the site shows. It rescans as you edit the form.
- **Autofill applications.** Fills name, contact details, address, links, experience, education, work authorization, sponsorship, relocation, salary, start date, "how did you hear", cover letter, and EEO questions. It also attaches your resume to the file upload field.
  - Works with Greenhouse, Lever, Workday, Ashby, SmartRecruiters, iCIMS, Jobvite, Workable, BambooHR, Taleo and others, plus any career site with a regular HTML form. Application forms embedded in iframes (for example Greenhouse on a company site) are filled too.
  - Handles text fields, native selects, radio and checkbox groups, file uploads, react-select comboboxes, and Workday-style listbox buttons.
  - Sets values through the native setter and fires `input`/`change` events, so React and Vue forms register them.
  - Never ticks consent or certification boxes. Filled fields are outlined green.
- **Fields left empty.** After autofill, every field Jobu couldn't fill is outlined amber on the page: solid for required fields, dashed for optional ones. That includes questions it has no answer for and fields that wouldn't take its answer (say, a State list without your state). Unticked optional checkboxes like newsletter opt-ins aren't flagged. An outline disappears as soon as you answer the field.
- **Guide to empty fields.** The panel says how many fields are still empty. *Show me* scrolls to the first one, focuses it and outlines it in indigo. The panel shows the question, whether it's required, and what to do. *Next empty field* and *←* move through them, required fields first, each group in page order. Once you answer a field, the panel marks it answered and counts what's left. Click any empty field in the panel's list to start there. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> jumps to the next empty field from the page.
- **Next page.** Finds the step's *Next*, *Continue* or *Save and continue* button (or *Apply* on a job posting) and clicks it. It skips Back, Cancel, cookie banners and "Apply with LinkedIn". Then it waits for the next step to load, whether that's a full page load or an SPA re-render, and autofills it. If the site rejects the step, Jobu says so and lists the errors.
- **Fill all pages.** Autofill → Next → repeat until the page with the submit button. Jobu stops early on a page with required questions it can't answer. It never submits on its own.
- **Submit.** Clicks the application's submit button. By default the panel first shows which button it will click and for which job. If required fields are still empty, it asks you to confirm *Submit anyway*. Afterwards Jobu looks for the confirmation ("Thank you for applying", "application submitted"). It marks the job *applied* only when the submission went through. Confirmation can be turned off in settings.
- **Attach your resume.** *Attach resume* in the panel (or *Attach* in the popup) puts your resume into the application's upload field. On sites without a file field it drops the file onto the drag-and-drop area. If you've tailored a resume for this job, that one is attached by default; a picker lets you choose your original or another tailored version.
- **Tailored resumes.** *Tailor my resume to this job* opens a page beside the application that works like Jobright's resume tailoring, on your computer:
  - It reads the job description (from the posting's structured data or the page; paste it if Jobu can't find it) and pulls out the skills and tools it asks for. Requirements count most, nice-to-haves least.
  - It shows a keyword match score for your resume, which keywords you have, and which are missing.
  - It moves the bullets and skills that match the job to the top and adds a short summary if you have none. A missing skill is only added after you click *I have this*.
  - **Use the job's wording.** Where your resume names a skill differently from the job ("JS" for "JavaScript", "K8s" for "Kubernetes", "Postgres" for "PostgreSQL"), Jobu offers to write it the job's way. It only swaps names for the same thing, never related ones like Unix and Linux.
  - You can edit any line in place, or remove bullets. The score updates as you go.
  - *Use for this application* saves it as a PDF with real, selectable text and attaches it to the job's upload field. *Download PDF* saves a copy.
  - **Optional: rewrite options from Claude.** With your own Anthropic API key, Claude (`claude-opus-5-5`) suggests up to three ways to word your summary and each bullet for this job. Each option says what it brings out ("API design", "mentoring"). They appear under each part of the resume next to *Your wording*. Click one to use it, or *Use Claude's first option everywhere*. Jobu checks every option against your resume and hides any that add a number, a skill or a name your resume doesn't have, including skills you added with *I have this*. The options you pick are marked, and *Undo Claude's changes* puts your wording back.
- **Saved passwords for job-site accounts.** Workday, iCIMS and Taleo make you create an account to apply. On those pages the panel offers *Create password*: Jobu generates a strong 16-character password, fills it into both boxes, and saves it for that site. On the site's sign-in page it offers *Fill saved password*, and it can also save a password you typed. Turn this on in your profile with a passphrase of your choice:
  - Passwords are encrypted with AES-GCM, using a key derived from your passphrase (PBKDF2, 600,000 rounds).
  - The vault unlocks only on the profile page and locks when the browser closes.
  - A password is only filled into the site it was saved for: Jobu takes the site from the page itself, never from the panel.
  - The profile page lists your saved passwords (show, copy, delete) and lets you add one you already have.
- **Saved answers.** After you answer a company-specific question ("Why do you want to work here?"), use *Remember my answers* in the panel. The next form that asks a similar question gets filled automatically.
- **Job tracker.** Save a job from the panel, the popup or the right-click menu. Track its status: saved, applied, interview, offer, or rejected. Job details come from the page's `JobPosting` structured data or from ATS-specific selectors. In multi-step flows (Workday, iCIMS), Jobu remembers the posting from the first page, so the right job is marked applied.
- **Ways to trigger it:** the in-page panel, the toolbar popup, the right-click menu, or shortcuts: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> autofill, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> next page, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> panel, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> next empty field. *Submit* has no default key; you can assign one at `chrome://extensions/shortcuts`.
- **Private.** Your profile, resume, tailored resumes, encrypted passwords and tracker live in `chrome.storage.local`. Your resume is parsed and tailored in the extension. Nothing leaves your browser, with one exception you opt into: *Get rewrite options* sends your resume and the job description to Anthropic with your API key. Your name and contact details are left out. The key is stored in this browser only if you tick *Remember it*.

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. The profile page opens. Upload your resume, then check and complete the fields it fills in.
4. Open any job application and click **Autofill**.

To try it on the bundled sample forms, enable **Allow access to file URLs** for Jobu on `chrome://extensions`. Then open `test/fixtures/application.html` (single page) or `test/fixtures/multistep.html` (a three-step, Workday-style flow with validation and a confirmation page).

## Layout

```
extension/
  manifest.json
  src/background.js          service worker: multi-frame scan/autofill, Next/Submit/Fill-all flows, tracker, menu, shortcuts
  src/shared/schema.js       profile schema, defaults, storage helpers
  src/shared/results.js      one-line summaries of action results (panel, toasts, popup)
  src/shared/vault.js        encrypted password vault (WebCrypto), password generator
  src/content/classifier.js  label → profile field rules, option matching, saved-answer matching (pure)
  src/content/dom.js         question/label discovery, framework-safe fill primitives, field focus, page errors, field outlines
  src/content/autofill.js    control collection, page scan, fill orchestration, answer learning
  src/content/navigate.js    Next/Submit button detection and clicking, step indicator, confirmation text
  src/content/job.js         ATS detection and job posting extraction, including the description
  src/content/account.js     sign-in / create-account forms: find them, fill username and password
  src/content/ui.js          floating button, scan panel, guide to empty fields, toasts (shadow DOM)
  src/content/main.js        content-script entry: form detection, live panel refresh, submit tracking
  src/popup/                 toolbar popup: scan summary, autofill, next, submit, fill all, tracker
  src/options/               profile editor, resume upload, saved answers, settings, import/export
  src/options/resume-text.mjs  resume file → text: PDF via pdf.js, DOCX unzipped in the page, RTF, TXT
  src/options/resume-parse.js  resume text → profile fields (pure)
  src/options/passwords.js   the profile page's saved-passwords card
  src/tailor/                the tailor page:
    resume-model.js          resume structure, job keywords, match score, tailoring, job wording, rewrite checks (pure)
    resume-pdf.mjs           resume structure → PDF with pdf-lib
    resume-ai.mjs            optional Claude rewrite options through the Anthropic SDK
    tailor.html/.css/.js     the page: score, keywords, editor, save / attach / download
  vendor/pdfjs/              pdf.js legacy build          ┐
  vendor/pdf-lib/            pdf-lib ESM build            ├ written by `npm run vendor`
  vendor/anthropic/          Anthropic SDK, one file      ┘
scripts/vendor.mjs           copies pdf.js and pdf-lib, bundles the Anthropic SDK with esbuild
test/                        node:test + jsdom tests, sample forms, and a sandboxed service worker
```

The tailoring tests (`test/tailor.test.mjs`) check that tailoring never adds a skill you didn't confirm, read the generated PDF back through pdf.js, and check the Claude request (model, structured output, fallbacks) against a mocked `fetch`. They also check that a rewrite can't add a number, skill or name, and that wording suggestions only swap spellings of the same skill. `test/attach.test.mjs` covers attaching and the tailor page's job hand-off, and `test/passwords.test.mjs` covers the vault and account pages.

The resume tests (`test/resume.test.mjs`) build real PDF and DOCX files in memory (`test/resume-files.mjs`) and run them through the same extraction code the options page uses.

To read a new resume layout, add a sample to `test/resume.test.mjs` and adjust the patterns at the top of `src/options/resume-parse.js` (section headings, title words, school words, degrees).

The service-worker tests (`test/flow.test.mjs`) run `background.js` in a `node:vm` sandbox. Its `chrome.scripting.executeScript` re-creates each injected function inside the jsdom page, so scan → next → fill-all → submit is exercised end to end on `multistep.html`.

To teach Jobu a new kind of button, edit `NEXT`, `SUBMIT`, `START` or `AVOID` in `src/content/navigate.js`. They match normalized button text.

## Development

```
npm install
npm test
```

`extension/vendor` ships with the source, so the extension loads without a build step. After upgrading `pdfjs-dist`, `pdf-lib` or `@anthropic-ai/sdk`, run `npm run vendor`. The SDK's ESM files import other packages by name, which extension pages can't resolve, so the script bundles it into `vendor/anthropic/sdk.mjs` with esbuild (`platform: 'browser'` uses the SDK's browser build, without its Node-only modules).

To recognize a new skill or tool in job descriptions, add it to `LEXICON` in `src/tailor/resume-model.js`. Aliases go after a `|`, and a leading `=` makes an alias case-sensitive (for names that are also everyday words, like `=Rust`). Names that need more context, like Go, R or Spring, have their own patterns in `SPECIAL`.

To support a new kind of question, add a rule to `RULES` in `src/content/classifier.js` (rules are checked in order and the first match wins). Then map its key to a profile value in `resolveValue`.
