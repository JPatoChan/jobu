// Highlighting the fields autofill left empty, and the panel's guide that
// steps through them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, loadBackground, PROFILE } from './helpers.mjs';

const html = `<!doctype html><html><body><form>
  <label for="first">First name *</label><input id="first" required>
  <label for="email">Email</label><input id="email" type="email">
  <label for="fav">What's your favourite algorithm? *</label><input id="fav" required>
  <fieldset><legend>Which shift do you prefer? *</legend>
    <label><input type="radio" name="shift" value="day" required> Day</label>
    <label><input type="radio" name="shift" value="night"> Night</label>
  </fieldset>
  <label for="color">Favourite colour</label><input id="color">
  <label for="state">State</label><select id="state"><option value="">Select</option><option>Texas</option><option>Ohio</option></select>
  <label><input type="checkbox" id="news"> Send me job alerts</label>
  <label><input type="checkbox" id="certify" required> I certify that this is true *</label>
</form></body></html>`;

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${fn}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('outlines what autofill left empty: required solid, optional dashed', async () => {
  const { document: d, J } = loadPage(html, { storage: { profile: PROFILE } });
  const $ = (s) => d.querySelector(s);
  const mark = (s) => J.fieldBox($(s)).dataset.jobuMark;

  const r = await J.autofill();
  assert.deepEqual({ filled: r.filled, attention: r.attention, empty: r.empty }, { filled: 2, attention: 3, empty: 2 });
  assert.equal(mark('#first'), 'filled');
  assert.equal(mark('#fav'), 'attention');
  assert.equal(J.fieldBox($('[name=shift]')), $('fieldset'), 'a radio group is outlined as a whole');
  assert.equal(mark('[name=shift]'), 'attention');
  assert.equal(mark('#certify'), 'attention', 'a required checkbox needs the user');
  assert.equal(mark('#color'), 'empty');
  assert.match(J.fieldBox($('#color')).style.outline, /dashed/);
  assert.equal(mark('#state'), 'empty', "the select had no option matching the profile's state");
  assert.equal(mark('#news'), undefined, 'optional checkboxes are left alone');

  // The scan no longer calls the state "ready": Jobu already tried it.
  const scan = await J.scanPage();
  const state = scan.fields.find((f) => f.question === 'State');
  assert.equal(state.status, 'skipped');
  assert.equal(state.missed, 'CA');

  // Answering a field drops its outline.
  $('#fav').value = 'Dijkstra';
  J.markAnswered($('#fav'));
  assert.equal(mark('#fav'), undefined);
  assert.equal($('#fav').style.outline, '');
  $('#color').value = 'Teal';
  await J.scanPage();
  assert.equal(mark('#color'), undefined, 'the scan clears outlines of fields answered since');
});

test('focusing a field for the guide outlines it until the guide moves on', async () => {
  const { document: d, J } = loadPage(html, { storage: { profile: PROFILE } });
  const $ = (s) => d.querySelector(s);
  await J.autofill();
  J.focusField(J.tag($('#fav')), { current: true });
  assert.equal(d.activeElement, $('#fav'));
  assert.ok('jobuCurrent' in $('#fav').dataset);
  assert.match($('#fav').style.outline, /3px solid/);

  J.focusField(J.tag($('#color')), { current: true });
  assert.ok(!('jobuCurrent' in $('#fav').dataset));
  assert.match($('#fav').style.outline, /2px solid/, 'back to its amber outline');
  J.setCurrent(null);
  assert.match($('#color').style.outline, /dashed/);
});

test('the panel steps through the empty fields in page order', async () => {
  const page = loadPage(html, { storage: { profile: PROFILE } });
  const { document: d, J } = page;
  const bg = loadBackground(page);
  page.window.chrome.runtime = { sendMessage: (msg) => bg.call(msg) };
  page.window.eval(readFileSync(new URL('../extension/src/content/ui.js', import.meta.url), 'utf8'));

  await bg.call({ type: 'AUTOFILL_TAB' });
  await J.openPanel();
  const ui = d.querySelector('[data-jobu-ui]').shadowRoot;
  const text = (s) => ui.querySelector(s).textContent;
  const click = (act) => ui.querySelector(`[data-act="${act}"]`).click();
  const current = () => [...d.querySelectorAll('[data-jobu-current]')];
  const rescan = async () => {
    const before = ui.querySelector('.fields').firstChild;
    click('rescan');
    await until(() => ui.querySelector('.fields').firstChild !== before);
  };

  assert.equal(ui.querySelector('.guide').hidden, false);
  assert.equal(text('.g-q'), '3 required fields and 2 optional');
  assert.equal(text('[data-act="guideNext"]'), 'Show me →');

  click('guideNext');
  await until(() => current().length === 1);
  assert.equal(d.activeElement, d.getElementById('fav'));
  assert.equal(text('.g-tag'), 'Required');
  assert.equal(text('.g-pos'), '1 of 5');
  assert.equal(text('.g-q'), "What's your favourite algorithm?");
  assert.equal(ui.querySelector('.field.current .q').textContent, "What's your favourite algorithm? *", 'the list shows where the guide is');

  click('guideNext');
  await until(() => current()[0] === d.querySelector('fieldset'));
  assert.equal(text('.g-pos'), '2 of 5');
  assert.equal(text('.g-q'), 'Which shift do you prefer?');

  // The user answers it: the guide says so and counts what's left.
  d.querySelector('[value=day]').checked = true;
  await rescan();
  assert.equal(text('.g-tag'), '✓ Answered');
  assert.equal(text('.g-pos'), '4 left');

  click('guideNext');
  await until(() => current()[0] === d.getElementById('certify').labels[0]);
  assert.equal(text('.g-pos'), '2 of 4');
  assert.equal(text('.g-hint'), 'Tick this box if it applies to you.');

  click('guideNext');
  await until(() => d.activeElement === d.getElementById('color'));
  assert.equal(text('.g-tag'), 'Optional');
  click('guideNext');
  await until(() => d.activeElement === d.getElementById('state'));
  assert.match(text('.g-hint'), /didn't take Jobu's answer, “CA”/);
  click('guideNext');
  await until(() => d.activeElement === d.getElementById('fav'));
  assert.equal(text('.g-pos'), '1 of 4', 'it wraps around');
  click('guidePrev');
  await until(() => d.activeElement === d.getElementById('state'));

  click('guideEnd');
  await until(() => current().length === 0);
  assert.equal(text('.g-q'), '2 required fields and 2 optional');

  // Clicking an empty field in the list starts the guide there.
  [...ui.querySelectorAll('.field')].find((b) => b.textContent.startsWith('Favourite colour')).click();
  await until(() => d.activeElement === d.getElementById('color'));
  assert.equal(text('.g-pos'), '3 of 4');

  // The keyboard shortcut goes on to the next one.
  await bg.run('ACTIONS.guide(1)');
  await until(() => d.activeElement === d.getElementById('state'));
});
