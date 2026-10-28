// Copies the third-party libraries the extension pages use from node_modules
// into extension/vendor. Run after upgrading any of them: npm run vendor
//   pdf.js (legacy build: polyfills newer JS for older Chrome) reads PDF resumes.
//   pdf-lib writes tailored resumes as PDF.
//   The Anthropic SDK rewrites resumes with Claude when the user adds an API
//   key. Its ESM files import other packages by name, which extension pages
//   can't resolve, so it's bundled into one file with esbuild.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const modules = new URL('../node_modules/', import.meta.url);
const vendor = new URL('../extension/vendor/', import.meta.url);
const COPIES = {
  pdfjs: [
    ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
    ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
    ['pdfjs-dist/LICENSE', 'LICENSE'],
  ],
  'pdf-lib': [
    ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.mjs'],
    ['pdf-lib/LICENSE.md', 'LICENSE.md'],
  ],
  anthropic: [['@anthropic-ai/sdk/LICENSE', 'LICENSE']],
};
for (const [dir, files] of Object.entries(COPIES)) {
  const to = new URL(`${dir}/`, vendor);
  mkdirSync(to, { recursive: true });
  for (const [src, dest] of files) {
    if (!/\.m?js$/.test(dest)) {
      copyFileSync(new URL(src, modules), new URL(dest, to));
      continue;
    }
    // The source map isn't shipped, so drop the comment pointing at it.
    const code = readFileSync(new URL(src, modules), 'utf8').replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');
    writeFileSync(new URL(dest, to), code);
  }
  console.log(`${dir} copied to extension/vendor/${dir}`);
}

// platform 'browser' follows the SDK's "browser" field, which swaps out its
// Node-only modules.
await build({
  stdin: { contents: "export { default } from '@anthropic-ai/sdk'; export * from '@anthropic-ai/sdk';", resolveDir: fileURLToPath(modules) },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  outfile: fileURLToPath(new URL('anthropic/sdk.mjs', vendor)),
  logLevel: 'warning',
});
console.log('@anthropic-ai/sdk bundled to extension/vendor/anthropic/sdk.mjs');
