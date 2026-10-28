// Turns service-worker results (autofill, next, submit, fill-all) into the
// one-line summaries shown in the page panel, toasts and the popup.
(function (root) {
  const J = (root.JOBU = root.JOBU || {});

  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  const needs = (k) => `${n(k, 'required field')} need${k === 1 ? 's' : ''} you`;

  function filled(r) {
    const left = [r.attention && `${needs(r.attention)} (amber)`, r.empty && `${n(r.empty, 'optional field')} left empty (dashed)`];
    const rest = left.filter(Boolean).join(', ');
    return `Filled ${n(r.filled, 'field')}.${rest ? ` ${rest[0].toUpperCase()}${rest.slice(1)}.` : ''}`;
  }

  // Returns { text, tone } where tone is '' | 'ok' | 'warn'.
  J.describeResult = (r) => {
    if (!r) return { text: '', tone: '' };
    if (r.error) return { text: r.error, tone: 'warn' };
    if (r.needsProfile) return { text: 'Set up your Jobu profile first. Opening it now.', tone: 'warn' };
    switch (r.action) {
      case 'autofill':
        return { text: `${filled(r)} Review before you submit.`, tone: r.attention ? 'warn' : 'ok' };
      case 'next':
        if (r.stuck) return { text: `Clicked “${r.label}”, but the page didn't change. The site may be flagging a field.`, tone: 'warn' };
        return {
          text: `Moved on with “${r.label}”.${r.fill?.filled || r.fill?.attention ? ` ${filled(r.fill)}` : ''}`,
          tone: r.fill?.attention ? 'warn' : 'ok',
        };
      case 'submit':
        if (r.blocked) return { text: `${needs(r.missing)} before you submit.`, tone: 'warn' };
        if (r.submitted) return { text: 'Application submitted. Marked as applied in your tracker.', tone: 'ok' };
        if (r.outcome === 'errors') return { text: `Clicked “${r.label}”, but the site flagged some fields. Fix them and submit again.`, tone: 'warn' };
        return { text: `Clicked “${r.label}”, but Jobu couldn't confirm it went through. Check the page.`, tone: 'warn' };
      case 'flow': {
        const done = `Filled ${n(r.filled, 'field')} across ${n(r.pages, 'page')}.`;
        if (r.stopped === 'submit') {
          const todo = r.missing ? ` ${needs(r.missing)}, then submit.` : ' Review this last page, then submit.';
          return { text: `${done}${todo}`, tone: r.missing ? 'warn' : 'ok' };
        }
        if (r.stopped === 'missing') return { text: `${done} Stopped: ${needs(r.missing)} on this page. Answer them, then run Fill all pages again.`, tone: 'warn' };
        if (r.stopped === 'disabled') return { text: `${done} Stopped: “${r.label}” is disabled. Something on this page still needs you.`, tone: 'warn' };
        if (r.stopped === 'stuck') return { text: `${done} Stopped: clicked “${r.label}” but the page didn't change.`, tone: 'warn' };
        if (r.stopped === 'no-next') return { text: `${done} No Next or Submit button here. You may need to sign in or pick an option.`, tone: 'warn' };
        if (r.stopped === 'user') return { text: `${done} Stopped.`, tone: '' };
        return { text: `${done} Stopped after ${n(r.pages, 'page')}.`, tone: 'warn' };
      }
      case 'attach':
        if (r.needsResume) return { text: 'Add your resume to your Jobu profile first.', tone: 'warn' };
        if (!r.attached) return { text: "Couldn't find a resume upload on this page. Use the site's upload button and pick your file.", tone: 'warn' };
        if (r.drop) return { text: `Dropped ${r.name} onto the upload area. Check that the site shows it.`, tone: 'ok' };
        return { text: `Attached ${r.name}${r.question ? ` to “${r.question.replace(/\s*\*\s*$/, '')}”` : ''}.`, tone: 'ok' };
      case 'password': {
        if (r.vault === 'none') return { text: 'Turn on saved passwords in your Jobu profile first. Opening it now.', tone: 'warn' };
        if (r.vault === 'locked') return { text: 'Unlock your saved passwords first. Opening your Jobu profile now.', tone: 'warn' };
        if (r.noForm) return { text: 'No password box on this page.', tone: 'warn' };
        if (r.none) return { text: `No saved password for ${r.username || r.site}.`, tone: 'warn' };
        const who = r.username ? ` (${r.username})` : '';
        if (r.op === 'create') return { text: `Made a strong password for ${r.site}${who} and saved it. Finish creating the account on the page.`, tone: 'ok' };
        if (r.op === 'fill') return { text: `Filled your saved password for ${r.site}${who}.`, tone: 'ok' };
        return { text: `Saved your password for ${r.site}${who}.`, tone: 'ok' };
      }
      default:
        return { text: '', tone: '' };
    }
  };
})(globalThis);
