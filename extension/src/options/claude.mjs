// The profile page's Claude Code card: whether Claude Code is connected, and
// the command that connects it (scripts/connect-claude.sh with this copy of
// Jobu's extension id). Jobu's AI features stay off until it is. Phones can't
// run Claude Code, so there the card stays hidden.
import { claudeCodeStatus } from '../shared/claude-code.mjs';

const card = document.getElementById('claude');
const $ = (s) => card.querySelector(s);
const COMMAND = `sh scripts/connect-claude.sh ${chrome.runtime.id}`;
const FROM = 'In a terminal, in the folder you loaded Jobu from (the one with extension/ in it), run:';

const NOT_CONNECTED = {
  'not-connected': `Not connected, so Jobu’s AI features are off. To turn them on, install Claude Code and sign in. ${FROM}`,
  'other-extension': `Claude Code is connected to a different copy of Jobu. To connect it to this one: ${FROM}`,
  'no-claude': `Jobu can’t find Claude Code where it was when you connected it. To connect it again: ${FROM}`,
};

async function check() {
  $('.claude-status').textContent = 'Checking for Claude Code…';
  const s = await claudeCodeStatus();
  $('.claude-connect').hidden = s.connected;
  $('.claude-status').textContent = s.connected
    ? `Connected to ${s.version}. The tailor page offers rewrite options from Claude. They send your resume and the job description to Claude through Claude Code, only when you ask.`
    : NOT_CONNECTED[s.reason] || `Jobu couldn’t talk to Claude Code. To connect it again: ${FROM}`;
}

$('.claude-command').textContent = COMMAND;
$('[data-claude="check"]').onclick = check;
$('[data-claude="copy"]').onclick = async (e) => {
  const copied = await navigator.clipboard.writeText(COMMAND).then(() => true, () => false);
  e.target.textContent = copied ? 'Copied' : 'Couldn’t copy';
  setTimeout(() => (e.target.textContent = 'Copy'), 1500);
};
const { os } = await Promise.resolve()
  .then(() => chrome.runtime.getPlatformInfo())
  .catch(() => ({}));
if (os !== 'android' && os !== 'ios') {
  card.hidden = false;
  check();
}
