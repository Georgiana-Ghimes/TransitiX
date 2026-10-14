/**
 * Changelog #12 — Unește celulele TPO / carousel Unește·Confirmă (experiment MISTRAL).
 *
 *   node qa/changelogs/generate-changelog-12.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(dir, 'changelog-12-temp.html');
const pdfPath = join(
  dir,
  'ChangeLog-MISTRAL-experimenting-rai-documents-12-merge-tpo.pdf',
);
const downloadsCopy = join(
  process.env.USERPROFILE || '',
  'Downloads',
  'ChangeLog-MISTRAL-12-merge-tpo-v1.26.6-build112.pdf',
);

const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<title>Changelog #12 — merge TPO</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  .banner {
    background: linear-gradient(135deg, #0A2B4E 0%, #1D4E89 70%, #2563eb 100%);
    color: #fff;
    border-radius: 12px;
    padding: 18px 20px 16px;
    margin-bottom: 14px;
  }
  .banner h1 { margin: 0 0 6px; font-size: 17pt; font-weight: 700; }
  .banner .sub { margin: 0; opacity: 0.92; font-size: 10pt; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .tag {
    display: inline-block;
    background: rgba(255,255,255,0.16);
    border: 1px solid rgba(255,255,255,0.28);
    color: #fff;
    font-size: 8.5pt;
    padding: 3px 9px;
    border-radius: 999px;
    font-weight: 600;
  }
  .meta { color: #64748b; font-size: 9.5pt; margin: 0 0 12px; }
  h2 {
    font-size: 12pt;
    color: #0A2B4E;
    margin: 16px 0 6px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 4px;
  }
  ul { margin: 4px 0 8px; padding-left: 1.2em; }
  li { margin: 0.28em 0; }
  .box {
    background: #f8fafc;
    border-left: 4px solid #1D4E89;
    padding: 10px 12px;
    margin: 10px 0 12px;
    border-radius: 0 8px 8px 0;
  }
  .go {
    background: #ecfdf5;
    border-left: 4px solid #059669;
    padding: 10px 12px;
    margin: 10px 0 12px;
    border-radius: 0 8px 8px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin: 8px 0 12px;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 7px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eff6ff; color: #0A2B4E; font-weight: 600; }
  code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 9pt;
    background: #f1f5f9;
    padding: 1px 5px;
    border-radius: 4px;
  }
  .foot {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    color: #64748b;
    font-size: 8.5pt;
  }
</style>
</head>
<body>
  <div class="banner">
    <h1>Changelog #12 · Unește celulele TPO</h1>
    <p class="sub">Branch <strong>MISTRAL-experimenting-rai-documents</strong> · v1.26.6 / build <strong>112</strong></p>
    <div class="tags">
      <span class="tag">Changelog #12</span>
      <span class="tag">Go pe testat</span>
      <span class="tag">Anexa XLSX</span>
      <span class="tag">Ce este nou?</span>
    </div>
  </div>

  <p class="meta">
    <strong>14 octombrie 2026</strong> ·
    Tip: <code>2dc746c</code> (după <code>9171bf0</code> / <code>72f7cfa</code>) ·
    Autor: LucanF ·
    După Changelog #11 (build 111)
  </p>

  <div class="go">
    <strong>Go pe testat (experiment).</strong>
    Build 112 e live pe tunnel: API + frontend raportează <code>v1.26.6 · build 112</code>.
    Nu e pe PROD (<code>TRANSITIX-RAI-PROD</code> n-a fost atins).
    <br /><br />
    Tunnel: <code>https://preferred-spider-womens-coleman.trycloudflare.com</code>
  </div>

  <div class="box">
    <strong>Pe scurt.</strong>
    Bifă pe șablon „Unește celulele TPO”: în Excel cursele aceluiași TPO sunt grupate și Număr TPO e sudat.
    La Unește / Confirmă, documentele incomplete trec printr-un carousel (preview + câmpuri).
    Preview lipește paginile adiacente cu același TPO. Textul meta „Noutățile apar în aplicație” a fost scos din Ce este nou?.
  </div>

  <h2>Ce vede biroul</h2>
  <ul>
    <li>Șablon XLSX: bifă <strong>Unește celulele TPO</strong> (grupare + merge pe coloana TPO).</li>
    <li>Unește în Anexă / Confirmă selectate: dacă lipsesc TPO, dată, auto sau rută, carousel cu preview, salvare sticky, apoi Unește / Confirmă.</li>
    <li>Cu bifă ON: preview lipit pentru curse adiacente cu același TPO.</li>
    <li>PDF multi-aviz: continuările pe același PSL/TRO rămân un fișier; în listă apare intervalul de pagini (ex. pag. 6/7).</li>
    <li>Meniu → <strong>Ce este nou?</strong>: titlu „Anexa Baumit: TPO-uri unite cum trebuie” (build 112).</li>
  </ul>

  <h2>Smoke checklist</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Pas</th><th>Rezultat așteptat</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>Deschide tunnelul / navbar</td>
        <td><code>v1.26.6 · build 112</code></td>
      </tr>
      <tr>
        <td>2</td>
        <td>Meniu → Ce este nou?</td>
        <td>Card build 112 (fără „Noutățile apar în aplicație”)</td>
      </tr>
      <tr>
        <td>3</td>
        <td>Șabloane → Editează șablonul Baumit</td>
        <td>Bifă „Unește celulele TPO” vizibilă / salvabilă</td>
      </tr>
      <tr>
        <td>4</td>
        <td>Încarcă <code>baumit-merge-tpo-scatter.pdf</code></td>
        <td>11 avize, TPO-uri <code>00991xx</code> citite</td>
      </tr>
      <tr>
        <td>5</td>
        <td>Selectează tot → Unește (șablon merge ON)</td>
        <td>XLSX: același TPO grupat și sudat (ex. 0099104 pe 3 rânduri)</td>
      </tr>
      <tr>
        <td>6</td>
        <td>Confirmă pe un rând incomplet</td>
        <td>Carousel cu preview + câmpuri obligatorii</td>
      </tr>
    </tbody>
  </table>

  <h2>Fișiere utile</h2>
  <ul>
    <li>PDF test: <code>qa/samples/merge-tpo/baumit-merge-tpo-scatter.pdf</code> (și în Downloads)</li>
    <li>Generator: <code>qa/samples/merge-tpo/generate-baumit-scatter.mjs</code></li>
    <li>Branch: <code>MISTRAL-experimenting-rai-documents</code> (doar experiment)</li>
  </ul>

  <p class="foot">
    Changelog #12 · TransitiX companion RAI · experiment Mistral · nu merge pe PROD fără OK explicit.
  </p>
</body>
</html>
`;

mkdirSync(dir, { recursive: true });
writeFileSync(htmlPath, html, 'utf8');

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

let printed = null;
let used = null;
for (const chrome of chromeCandidates) {
  printed = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8' });
  if (printed.status === 0) {
    used = chrome;
    break;
  }
}

rmSync(htmlPath, { force: true });
if (!used || printed.status !== 0) {
  console.error(printed?.stderr || printed?.error);
  process.exit(printed?.status || 1);
}

try {
  if (downloadsCopy.includes('Downloads')) copyFileSync(pdfPath, downloadsCopy);
} catch {
  // optional
}

console.log(JSON.stringify({
  pdf: pdfPath,
  downloads: downloadsCopy,
  browser: used,
  live: {
    tunnel: 'https://preferred-spider-womens-coleman.trycloudflare.com',
    companion: '1.26.6',
    build: 112,
  },
}, null, 2));
