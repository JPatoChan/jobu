// Lays out a resume structure (see resume-model.js) as a one-column US Letter
// PDF with real text, so applicant tracking systems can read it. pdf-lib's
// standard Helvetica fonts only cover WinAnsi (Western European) characters.
import { PDFDocument, StandardFonts, rgb } from '../../vendor/pdf-lib/pdf-lib.esm.min.mjs';

const PAGE = { width: 612, height: 792, margin: 50 };
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.3, 0.32, 0.38);
const RULE = rgb(0.72, 0.74, 0.78);

// Close equivalents for characters the fonts lack. Others lose their accents
// ("ā" to "a") or are dropped.
const SWAP = { '→': '->', '←': '<-', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '—', '≥': '>=', '≤': '<=', '≈': '~', '✓': '', '✔': '', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', '\u200b': '', '\u2009': ' ', '\u202f': ' ' };
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const fits = (c) => {
  const n = c.codePointAt(0);
  return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || EXTRA.has(c);
};

export function winAnsi(text) {
  let dropped = 0;
  const out = [...String(text ?? '').replace(/\t+/g, '  ')]
    .map((c) => {
      if (c in SWAP) return SWAP[c];
      if (fits(c)) return c;
      const plain = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (plain && [...plain].every(fits)) return plain;
      dropped++;
      return '';
    })
    .join('');
  return { text: out, dropped };
}

// Returns { bytes, dropped }: dropped counts characters the PDF couldn't show.
export async function resumePdf(resume, { subject = '' } = {}) {
  const doc = await PDFDocument.create();
  const F = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const left = PAGE.margin;
  const width = PAGE.width - 2 * PAGE.margin;
  let page;
  let y;
  let dropped = 0;

  const clean = (s) => {
    const r = winAnsi(s);
    dropped += r.dropped;
    return r.text.replace(/\s+/g, ' ').trim();
  };
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
  };
  const room = (h) => y - h >= PAGE.margin || (newPage(), false);
  const widthOf = (t, f, size) => f.widthOfTextAtSize(t, size);

  // Splits text into lines no wider than max (the first one max - indent).
  // Words longer than a line (URLs) are broken.
  function wrap(text, f, size, max, indent = 0) {
    const lines = [];
    let line = '';
    const limit = () => max - (lines.length ? 0 : indent);
    const push = () => {
      lines.push(line);
      line = '';
    };
    for (const word of text.split(' ').filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (widthOf(next, f, size) <= limit()) {
        line = next;
        continue;
      }
      if (line) push();
      let rest = word;
      while (rest.length > 1 && widthOf(rest, f, size) > limit()) {
        let n = rest.length - 1;
        while (n > 1 && widthOf(rest.slice(0, n), f, size) > limit()) n--;
        line = rest.slice(0, n);
        push();
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  const text = (t, x, { f = F.regular, size = 10, color = INK } = {}) => page.drawText(t, { x, y: y - size, size, font: f, color });

  function paragraph(t, { f = F.regular, size = 10, lead = 13.2, x = left, max = width, color = INK } = {}) {
    for (const l of wrap(clean(t), f, size, max)) {
      room(lead);
      text(l, x, { f, size, color });
      y -= lead;
    }
  }

  // ---- Header ----
  newPage();
  const name = clean(resume.name);
  if (name) {
    text(name, left + (width - widthOf(name, F.bold, 20)) / 2, { f: F.bold, size: 20 });
    y -= 26;
  }
  const parts = resume.contact.map(clean).filter(Boolean);
  if (parts.length) {
    // Wrap by whole parts, centered.
    const sep = '  |  ';
    const rows = [];
    for (const p of parts) {
      const row = rows.at(-1);
      if (row && widthOf(row + sep + p, F.regular, 9.5) <= width) rows[rows.length - 1] = row + sep + p;
      else rows.push(p);
    }
    for (const r of rows.flatMap((r) => wrap(r, F.regular, 9.5, width))) {
      text(r, left + (width - widthOf(r, F.regular, 9.5)) / 2, { size: 9.5, color: MUTED });
      y -= 12.5;
    }
  }

  // ---- Sections ----
  for (const sec of resume.sections) {
    const body = sec.text?.trim() || sec.groups?.some((g) => g.items.length) || sec.entries?.some((e) => e.head.length || e.bullets.length);
    if (!body) continue;
    y -= 9;
    room(40);
    text(clean(sec.title).toUpperCase(), left, { f: F.bold, size: 10.5 });
    y -= 14;
    page.drawLine({ start: { x: left, y: y + 2 }, end: { x: left + width, y: y + 2 }, thickness: 0.6, color: RULE });
    y -= 4;

    if (sec.text != null) paragraph(sec.text);

    for (const g of sec.groups || []) {
      const items = g.items.map(clean).filter(Boolean).join(', ');
      if (!items) continue;
      const label = g.label ? `${clean(g.label)}: ` : '';
      const indent = label ? widthOf(label, F.bold, 10) : 0;
      wrap(items, F.regular, 10, width, indent).forEach((l, i) => {
        room(13.2);
        if (i === 0 && label) text(label, left, { f: F.bold });
        text(l, left + (i === 0 ? indent : 0));
        y -= 13.2;
      });
    }

    for (const e of sec.entries || []) {
      const titled = e.bullets.length > 0 || e.head.some((h) => /\t/.test(h) || /\b(19|20)\d{2}\b/.test(h));
      room(13.2 * Math.min(3, e.head.length + 1));
      e.head.forEach((h, i) => {
        const [l, ...rest] = h.split(/\t+/);
        const right = clean(rest.join('  '));
        const f = !titled ? F.regular : i === 0 ? F.bold : F.italic;
        const rw = right ? widthOf(right, F.regular, 10) : 0;
        const lines = wrap(clean(l), f, 10, width - (rw ? rw + 12 : 0));
        lines.forEach((line, j) => {
          room(13.2);
          text(line, left, { f, color: f === F.italic ? MUTED : INK });
          if (j === 0 && right) text(right, left + width - rw, { color: MUTED });
          y -= 13.2;
        });
      });
      for (const b of e.bullets) {
        const lines = wrap(clean(b), F.regular, 10, width - 14);
        lines.forEach((line, j) => {
          room(13.2);
          if (j === 0) text('•', left + 3);
          text(line, left + 14);
          y -= 13.2;
        });
      }
      y -= 4;
    }
  }

  doc.setTitle(name ? `${name} – Resume` : 'Resume');
  if (name) doc.setAuthor(name);
  if (subject) doc.setSubject(clean(subject));
  doc.setCreator('Jobu');
  doc.setProducer('Jobu');
  return { bytes: await doc.save(), dropped };
}
