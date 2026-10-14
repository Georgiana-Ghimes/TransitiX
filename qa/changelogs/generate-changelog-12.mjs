/**
 * Changelog #12 — merge TPO / Unește UX (experiment MISTRAL).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(dir, 'changelog-12-temp.html');
const pdfPath = join(
  dir,
  'ChangeLog-MISTRAL-experimenting-rai-documents-12-merge-tpo.pdf',
);

const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<title>Changelog #12 — merge TPO</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.45; }
  .banner { background: #0A2B4E; color: #fff; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
  h1 { margin: 0 0 6px; font-size: 16pt; }
  .sub { margin: 0; opacity: 0.9; font-size: 10pt; }
  h2 { font-size: 12pt; color: #0A2B4E; margin: 16px 0 8px; }
  ul { margin: 0 0 10px; padding-left: 18px; }
  li { margin: 0 0 6px; }
  .tag { display: inline-block; background: #e2e8f0; border-radius: 999px; padding: 2px 10px; font-size: 9pt; font-weight: 600; margin-right: 6px; }
</style>
</head>
<body>
  <div class="banner">
    <h1>Changelog #12 — Unește celulele TPO</h1>
    <p class="sub">Branch <strong>MISTRAL-experimenting-rai-documents</strong> · v1.26.6 / build <strong>112</strong></p>
  </div>

  <p>
    <span class="tag">Ce este nou?</span>
    <span class="tag">Avize</span>
    <span class="tag">Anexa XLSX</span>
  </p>

  <h2>Ce vede biroul</h2>
  <ul>
    <li>Șablon: bifă <strong>Unește celulele TPO</strong> — în Excel cursele aceluiași TPO stau împreună, Număr TPO sudat.</li>
    <li>La Unește / Confirmă: carousel pe documentele incomplete (preview + câmpuri, salvare sticky).</li>
    <li>Preview: pagini adiacente cu același TPO lipite când bifă e ON.</li>
    <li>PDF multi-aviz: continuările pe același PSL/TRO rămân un fișier (pag. A–B în nume).</li>
  </ul>

  <h2>Smoke pe experiment</h2>
  <ul>
    <li>Confirmă navbar: <code>v1.26.6 - build 112</code>.</li>
    <li>Meniu → <strong>Ce este nou?</strong> — titlu despre Anexa Baumit / TPO (fără textul vechi „Noutățile apar în aplicație”).</li>
    <li>Încarcă <code>baumit-merge-tpo-scatter.pdf</code> → Unește cu șablon merge ON → XLSX cu TPO-urile grupate.</li>
  </ul>
</body>
</html>
`;

mkdirSync(dir, { recursive: true });
writeFileSync(htmlPath, html, 'utf8');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const printed = spawnSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`,
  pathToFileURL(htmlPath).href,
], { encoding: 'utf8' });

rmSync(htmlPath, { force: true });
if (printed.status !== 0) {
  console.error(printed.stderr || printed.error);
  process.exit(printed.status || 1);
}
console.log(JSON.stringify({ pdf: pdfPath, build: 112 }, null, 2));
