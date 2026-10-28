// Turns an uploaded resume (PDF, DOCX, TXT, RTF) into plain text, one line
// per visual line, for J.parseResume. Runs locally in the options page:
// PDFs go through the bundled pdf.js, DOCX files are unzipped with the
// browser's DecompressionStream. Link targets (a "LinkedIn" label linking to
// the profile URL) are appended at the end so their URLs can be found.

const PDFJS = '../../vendor/pdfjs/pdf.min.mjs';
const PDF_WORKER = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

// An error whose message the options page can show as-is.
const unreadable = (message) => Object.assign(new Error(message), { name: 'ResumeError' });

export async function extractText(file) {
  const name = (file.name || '').toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = String.fromCharCode(...bytes.slice(0, 5));
  if (magic === '%PDF-' || name.endsWith('.pdf')) return pdfText(bytes);
  if (magic.startsWith('PK') || name.endsWith('.docx')) return docxText(bytes.buffer);
  if (magic.startsWith('{\\rtf')) return rtfText(new TextDecoder().decode(bytes));
  if (name.endsWith('.doc')) throw unreadable('Old .doc files can’t be read. Save it as PDF or DOCX and upload that.');
  return new TextDecoder().decode(bytes);
}

// ---- PDF ----

async function pdfText(bytes) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  const links = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      lines.push(...toLines((await page.getTextContent()).items));
      for (const a of await page.getAnnotations()) if (a.url) links.push(a.url);
    }
  } finally {
    await doc.destroy();
  }
  return [...lines, ...links].join('\n');
}

// pdf.js returns positioned text runs. Group runs on the same baseline into a
// line, left to right. A wide gap (right-aligned dates, a second column)
// becomes a tab so the parser can tell the parts apart.
export function toLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str?.trim()) continue; // pdf.js adds space items that would hide gaps

    const [, , , d, x, y] = it.transform;
    const h = Math.abs(d) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.min(r.h, h) * 0.5);
    if (!row) rows.push((row = { y, h, runs: [] }));
    row.runs.push({ x, end: x + it.width, str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map(({ h, runs }) => {
      runs.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const r of runs) {
        const gap = end === null ? 0 : r.x - end;
        if (gap > h * 2) line += '\t';
        else if (gap > h * 0.15 && !/\s$/.test(line) && !/^\s/.test(r.str)) line += ' ';
        line += r.str;
        end = r.end;
      }
      return line.replace(/ +/g, ' ').trim();
    })
    .filter(Boolean);
}

// ---- DOCX ----

const decodeXml = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (m, e) =>
    ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ??
    String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );

// Text of a WordprocessingML part: one line per paragraph, tabs and breaks kept.
export function wordXmlText(xml) {
  const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, ''); // text boxes appear twice otherwise
  return body
    .split(/<\/w:p>/)
    .map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g)]
        .map((m) => (m[1] !== undefined ? decodeXml(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n'))
        .join('')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

async function docxText(buffer) {
  const files = await unzip(buffer, (n) => /^word\/((document|header\d*|footer\d*)\.xml|_rels\/document\.xml\.rels)$/.test(n));
  if (!files['word/document.xml']) throw unreadable('That file isn’t a Word document.');
  const xml = (n) => new TextDecoder().decode(files[n]);
  const parts = Object.keys(files).filter((n) => n.endsWith('.xml'));
  const order = (n) => (n.includes('header') ? 0 : n.includes('document') ? 1 : 2);
  const text = parts.sort((a, b) => order(a) - order(b)).map((n) => wordXmlText(xml(n)));
  const rels = files['word/_rels/document.xml.rels'] ? xml('word/_rels/document.xml.rels') : '';
  for (const m of rels.matchAll(/<Relationship\b[^>]*Type="[^"]*\/hyperlink"[^>]*>/g)) {
    const target = m[0].match(/Target="([^"]+)"/);
    if (target) text.push(decodeXml(target[1]));
  }
  return text.filter(Boolean).join('\n');
}

// Minimal ZIP reader: walks the central directory and inflates the entries
// `want` accepts.
async function unzip(buffer, want) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable('That file isn’t a Word document.');
  const out = {};
  let p = view.getUint32(eocd + 16, true);
  for (let n = view.getUint16(eocd + 10, true); n > 0 && view.getUint32(p, true) === 0x02014b50; n--) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, nameLen));
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    if (!want(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = new Uint8Array(buffer, start, size);
    out[name] = method === 8 ? await inflateRaw(data) : data;
  }
  return out;
}

const inflateRaw = async (bytes) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

// ---- RTF ----

function rtfText(rtf) {
  return rtf
    .replace(/\{\\\*[^{}]*\}/g, '') // destinations like {\*\generator ...}
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\s*\}/g, '')
    .replace(/\\par[d]?\b ?|\\line\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\'([\da-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + Number(n) : Number(n)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}
