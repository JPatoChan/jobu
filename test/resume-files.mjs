// Builds small but real PDF and DOCX resumes in memory, so the text
// extraction tests run against actual file formats without binary fixtures.
import { crc32, deflateRawSync } from 'node:zlib';

// rows: [{ text, x, y, size? }] in PDF points (origin bottom-left, page 612x792).
// links: [{ url, rect: [x1, y1, x2, y2] }] become clickable Link annotations.
export function makePdf(rows, links = []) {
  const esc = (s) =>
    s.replace(/[\\()]/g, '\\$&').replace(/[–•]/g, (c) => ({ '–': '\\226', '•': '\\225' })[c]);
  const content = rows.map(({ text, x, y, size = 11 }) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`).join('\n');
  const annots = links.map(
    ({ url, rect }) => `<< /Type /Annot /Subtype /Link /Rect [${rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${esc(url)}) >> >>`,
  );
  const first = 6; // object number of the first annotation
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [${annots.map((_, i) => `${first + i} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    ...annots,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

// A ZIP archive with deflated entries: { 'path/in/zip': 'text' }.
export function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, data);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, ...central, end]));
}

// A minimal .docx: paragraphs are arrays of runs; '\t' runs become tabs.
// links: { text, url } paragraphs whose text links to url.
export function makeDocx(paragraphs, { header = [], links = [] } = {}) {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (t) => (t === '\t' ? '<w:r><w:tab/></w:r>' : `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`);
  const para = (runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>${[].concat(runs).map(run).join('')}</w:p>`;
  const linkParas = links.map((l, i) => `<w:p><w:hyperlink r:id="rIdL${i}">${run(l.text)}</w:hyperlink></w:p>`);
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${[...paragraphs.map(para), ...linkParas].join('')}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links
      .map((l, i) => `<Relationship Id="rIdL${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`)
      .join('')}</Relationships>`,
  };
  if (header.length) files['word/header1.xml'] = `<?xml version="1.0"?><w:hdr ${NS}>${header.map(para).join('')}</w:hdr>`;
  return makeZip(files);
}
