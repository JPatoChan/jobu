// Optional: Claude rewrites the resume's summary and bullets in the job's
// language, with the user's own Anthropic API key. Only runs when the user
// asks on the tailor page; the resume and job description go to Anthropic.
// The page checks every rewrite against the resume (J.checkRewrite) and
// keeps the original wherever Claude added something that isn't there.
import Anthropic from '../../vendor/anthropic/sdk.mjs';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are an expert resume writer tailoring one person's resume to one job.

Rewrite the summary and the bullets so a recruiter and an applicant tracking system can see how this person's real experience fits the job.

Rules, in order of importance:
1. Never invent anything. Use only facts in the resume and the skills the person confirmed. Do not add employers, titles, dates, degrees, numbers, metrics, team sizes, tools, technologies or skills that aren't there. Keep every number exactly as written.
2. Where the resume already shows something the job asks for, describe it in the job's words (for example "REST APIs" instead of "web endpoints").
3. Keep each bullet to one idea, under about 200 characters. Start with a strong verb in the past tense, or the present tense for the current job. No first person, no filler like "responsible for" or "various".
4. The summary is two or three sentences, under 60 words, about this person for this job, built only from the resume.
5. Return every bullet id you were given exactly once. If a bullet can't be improved truthfully, return it unchanged.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'bullets'],
  additionalProperties: false,
};

// An error whose message the page can show as-is.
const problem = (message) => Object.assign(new Error(message), { name: 'RewriteError' });

// bullets: [{ id, entry, text }], entry naming the job or project it's under.
// Returns { summary, bullets: { id: text } }.
export async function rewriteResume({ apiKey, resumeText, summary, bullets, job, keywords, confirmed }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const prompt = [
    `<job title="${job.title || ''}" company="${job.company || ''}">\n${(job.description || '').slice(0, 15000)}\n</job>`,
    `<resume>\n${resumeText}\n</resume>`,
    `<keywords_from_the_job>${keywords.join(', ')}</keywords_from_the_job>`,
    `<skills_the_person_confirmed>${confirmed.join(', ') || 'none'}</skills_the_person_confirmed>`,
    `<current_summary>${summary || 'none: write one'}</current_summary>`,
    `<bullets>\n${JSON.stringify(bullets, null, 1)}\n</bullets>`,
    'Rewrite the summary and every bullet for this job, following the rules.',
  ].join('\n\n');

  let message;
  try {
    // Streams because long resumes take a while; fallbacks lets Anthropic
    // retry a declined request on another model instead of failing.
    message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
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

  if (message.stop_reason === 'refusal') throw problem('Claude declined to rewrite this resume. Your resume is unchanged.');
  if (message.stop_reason === 'max_tokens') throw problem('The rewrite was cut off because the resume is very long. Your resume is unchanged.');
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
  return { summary: out.summary, bullets: Object.fromEntries(out.bullets.map((b) => [b.id, b.text])) };
}
