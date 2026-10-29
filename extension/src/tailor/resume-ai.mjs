// Optional: Claude suggests ways to rewrite the resume's summary and bullets
// in the job's language, with the user's own Anthropic API key. Only runs
// when the user asks on the tailor page; the resume and job description go
// to Anthropic. The page checks every option against the resume
// (J.checkRewrite), drops any that add something that isn't there, and lets
// the user pick one or keep their own wording.
import Anthropic from '../../vendor/anthropic/sdk.mjs';

export const MODEL = 'claude-opus-5-5';
export const MAX_OPTIONS = 3;

const SYSTEM = `You are an expert resume writer helping one person tailor their resume to one job.

For the summary and for each bullet, suggest up to ${MAX_OPTIONS} different ways to write it, so a recruiter and an applicant tracking system can see how this person's real experience fits the job. The person picks one or keeps their own.

Rules, in order of importance:
1. Never add anything that isn't in the resume. Each option says the same facts as the original in different words. Do not add employers, titles, dates, degrees, numbers, metrics, team sizes, scope, results, tools, technologies, skills or names that aren't there, even if the job asks for them. Keep every number exactly as written.
2. Where the resume already shows something the job asks for, describe it in the job's words (for example "mentoring" where the job says "mentoring" and the resume says "coached", or "PostgreSQL" for "Postgres"). Never name a skill, tool or method the resume doesn't name, even if it's probably true: "web endpoints" does not become "REST APIs".
3. Make the options really different: each brings out a different thing the job asks for that the original supports, or leads with a different part of it. Give fewer options, or none, rather than repeat yourself or stretch the facts. If a bullet has nothing to do with the job, return no options for it.
4. Keep each bullet to one idea, under about 200 characters. Start with a strong verb in the past tense, or the present tense for the current job. No first person, no filler like "responsible for" or "various".
5. A summary is two or three sentences, under 60 words, about this person for this job, built only from the resume.
6. For each option, "focus" names in two to five words what it brings out for this job, such as "API design" or "mentoring".
7. Return every bullet id you were given exactly once.`;

const OPTIONS = {
  type: 'array',
  items: {
    type: 'object',
    properties: { text: { type: 'string' }, focus: { type: 'string' } },
    required: ['text', 'focus'],
    additionalProperties: false,
  },
};

const SCHEMA = {
  type: 'object',
  properties: {
    summary: OPTIONS,
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, options: OPTIONS },
        required: ['id', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'bullets'],
  additionalProperties: false,
};

// An error whose message the page can show as-is.
const problem = (message) => Object.assign(new Error(message), { name: 'RewriteError' });

const tidyOptions = (options) => (options || []).filter((o) => o.text?.trim()).slice(0, MAX_OPTIONS);

// bullets: [{ id, entry, text }], entry naming the job or project it's under.
// Returns { summary: [{ text, focus }], bullets: { id: [{ text, focus }] } }.
export async function suggestRewrites({ apiKey, resumeText, summary, bullets, job, keywords }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const prompt = [
    `<job title="${job.title || ''}" company="${job.company || ''}">\n${(job.description || '').slice(0, 15000)}\n</job>`,
    `<resume>\n${resumeText}\n</resume>`,
    `<keywords_from_the_job use="only the ones the resume already shows">${keywords.join(', ')}</keywords_from_the_job>`,
    `<current_summary>${summary || 'none: write one'}</current_summary>`,
    `<bullets>\n${JSON.stringify(bullets, null, 1)}\n</bullets>`,
    `Suggest up to ${MAX_OPTIONS} ways to write the summary and each bullet for this job, following the rules.`,
  ].join('\n\n');

  let message;
  try {
    // Streams because long resumes take a while; fallbacks lets Anthropic
    // retry a declined request on another model instead of failing.
    message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw problem('Anthropic didn’t accept that API key. Check it at console.anthropic.com and try again.');
    if (err instanceof Anthropic.PermissionDeniedError) throw problem('That API key can’t use this model. Check your Anthropic account.');
    if (err instanceof Anthropic.RateLimitError) throw problem('Anthropic is limiting requests on your key. Wait a minute and try again.');
    if (err instanceof Anthropic.BadRequestError) throw problem(`Anthropic couldn’t take this request: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw problem('Couldn’t reach Anthropic. Check your connection and try again.');
    if (err instanceof Anthropic.APIError) throw problem(`Anthropic had a problem (${err.status ?? 'no status'}). Try again in a moment.`);
    throw err;
  }

  if (message.stop_reason === 'refusal') throw problem('Claude declined to suggest rewrites for this resume. Your resume is unchanged.');
  if (message.stop_reason === 'max_tokens') throw problem('Claude’s suggestions were cut off because the resume is very long. Your resume is unchanged.');
  // After a fallback, only what follows the last switch is the answer.
  const start = message.content.findLastIndex((b) => b.type === 'fallback') + 1;
  const text = message.content
    .slice(start)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw problem('Claude’s answer couldn’t be read. Your resume is unchanged; try again.');
  }
  return { summary: tidyOptions(out.summary), bullets: Object.fromEntries(out.bullets.map((b) => [b.id, tidyOptions(b.options)])) };
}
