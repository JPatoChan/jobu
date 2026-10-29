// Jobu's AI features run through Claude Code on the user's computer, and are
// off unless it's connected: scripts/connect-claude.sh registers a native
// messaging host (scripts/claude-host.sh) that runs the claude CLI with no
// tools. Until then, Jobu shows nothing that uses Claude.
export const HOST = 'com.jobu.claude';

// An error whose message a page can show as-is. `reason` is one of
// not-connected, other-extension, no-claude, failed.
const problem = (reason, message) => Object.assign(new Error(message), { name: 'ClaudeCodeError', reason });

const NOT_CONNECTED = 'Claude Code isn’t connected to Jobu. Connect it on your Jobu profile page.';

// Sends one message to the host and resolves to its reply.
async function send(message) {
  let r;
  try {
    r = await chrome.runtime.sendNativeMessage(HOST, message);
  } catch (err) {
    const text = String(err?.message || err);
    if (/forbidden/i.test(text)) throw problem('other-extension', 'Claude Code is connected to a different copy of Jobu. Connect it again from your Jobu profile page.');
    // No host registered, or no nativeMessaging permission.
    if (/not found|not a function|undefined/i.test(text)) throw problem('not-connected', NOT_CONNECTED);
    throw problem('failed', `Jobu couldn’t talk to Claude Code (${text}). Connect it again from your Jobu profile page.`);
  }
  if (r?.type === 'error' && r.error === 'no-claude') {
    throw problem('no-claude', `Claude Code isn’t at ${r.detail || 'the place Jobu found it'} any more. Connect it again from your Jobu profile page.`);
  }
  if (r?.type === 'error') throw problem('failed', `Claude Code didn’t answer${r.detail ? `: ${r.detail}` : ''}. Try again.`);
  return r;
}

// { connected: true, version } or { connected: false, reason, message }.
export async function claudeCodeStatus() {
  try {
    const r = await send({ type: 'status' });
    return { connected: true, version: r.version || 'Claude Code' };
  } catch (err) {
    return { connected: false, reason: err.reason || 'failed', message: err.message };
  }
}

// Sends one prompt to Claude through Claude Code. Resolves to Claude Code's
// result message ({ result, stop_reason, ... }), or rejects with a message
// the page can show.
export async function askClaude(prompt) {
  const r = await send({ type: 'user', message: { role: 'user', content: prompt } });
  if (r?.type !== 'result') throw problem('failed', 'Claude Code’s answer couldn’t be read. Try again.');
  if (r.is_error) throw problem('failed', `Claude Code couldn’t answer${r.result ? `: ${r.result}` : ` (${r.subtype || 'error'})`}.`);
  return r;
}
