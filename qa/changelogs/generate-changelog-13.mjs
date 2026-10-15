/**
 * Changelog #13 — Acțiuni dropdown, zoom PDF, porți TPO/OCR (experiment MISTRAL).
 *
 *   node qa/changelogs/generate-changelog-13.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(dir, 'changelog-13-temp.html');
const pdfPath = join(
  dir,
  'ChangeLog-MISTRAL-experimenting-rai-documents-13-actiuni-zoom-gates.pdf',
);
const downloadsCopy = join(
  process.env.USERPROFILE || '',
  'Downloads',
  'ChangeLog-MISTRAL-13-actiuni-zoom-gates-v1.26.14-build120.pdf',
);

const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<title>Changelog #13 — Acțiuni, zoom, porți</title>
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
  .warn {
    background: #fff7ed;
    border-left: 4px solid #ea580c;
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
    <h1>Changelog #13 · Acțiuni, zoom PDF, porți TPO/OCR</h1>
    <p class="sub">Branch <strong>MISTRAL-experimenting-rai-documents</strong> · v1.26.14 / build <strong>120</strong></p>
    <div class="tags">
      <span class="tag">Changelog #13</span>
      <span class="tag">Go pe testat</span>
      <span class="tag">Ce este nou?</span>
      <span class="tag">Avize</span>
    </div>
  </div>

  <p class="meta">Pentru echipa de birou · companion Documente RAI · octombrie 2026</p>

  <div class="go">
    <strong>Ce e nou pe scurt (build 120)</strong>
    <ul>
      <li>Listă Avize: meniu <strong>Acțiuni</strong> compact (fără stivă de linkuri).</li>
      <li>Editează: <strong>zoom</strong> pe PDF/poză (− / % / +) și <strong>Descarcă</strong>.</li>
      <li>Cu „Unește celulele TPO”: fără Număr TPO nu Confirmă / nu Unește (excepție: „Doar document marfă”).</li>
      <li>OCR nesigur pe TPO: Confirmă pe server nu mai trece „oricum” fără Verifică / Salvează.</li>
    </ul>
  </div>

  <h2>1. Listă Avize — Acțiuni</h2>
  <ul>
    <li>Un buton <strong>Acțiuni</strong> pe card și pe coloana sticky din tabel.</li>
    <li>Aceleași reguli ca înainte: Editează; Verifică (dacă e de revizuit); Confirmă (dacă nu e Confirmat); Re-extrage; Șterge (roșu, după separator).</li>
    <li>Coloana Acțiuni e mai îngustă → mai mult spațiu pentru TPO / rută.</li>
  </ul>

  <h2>2. Editează — zoom + Descarcă</h2>
  <ul>
    <li>Pe bara Document: <strong>−</strong> / procent / <strong>+</strong> (75% … 200% față de lățimea panoului).</li>
    <li>PDF-ul se re-desenează clar (nu e blur CSS); la zoom &gt; 100% derulezi orizontal.</li>
    <li><strong>Descarcă</strong> salvează fișierul stocat (numele original). Lipsă pe avize manuale fără fișier.</li>
  </ul>

  <h2>3. Porți hard (merge TPO + OCR)</h2>
  <table>
    <thead>
      <tr>
        <th>Situație</th>
        <th>Confirmă</th>
        <th>Unește / Anexă</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>„Unește celulele TPO” ON + TPO gol (nu e „Doar document marfă”)</td>
        <td>Blocat</td>
        <td>Blocat (UI + server)</td>
      </tr>
      <tr>
        <td>OCR nesigur pe Număr TPO, neverificat</td>
        <td>Blocat (UI + server, inclusiv force)</td>
        <td>Blocat (UI + server)</td>
      </tr>
      <tr>
        <td>„Doar document marfă” + TRO/PSL complet</td>
        <td>OK fără TPO</td>
        <td>OK; rămân la coada Anexei</td>
      </tr>
    </tbody>
  </table>
  <div class="warn">
    <strong>Cum deblochezi OCR nesigur:</strong> Verifică → Marchează verificat, sau Salvează în carusel
    (chiar dacă nu schimbi valoarea). Textul rămâne <strong>roșu bold</strong> + eticheta „OCR nesigur” până atunci.
  </div>

  <h2>4. Builds anterioare din același val (deja în „Ce este nou?”)</h2>
  <ul>
    <li><strong>119</strong> — TRO / document marfă în carusel + bifă „Doar document marfă”.</li>
    <li><strong>118</strong> — OCR nesigur blochează Confirmă / Unește; server refuză anexa.</li>
    <li><strong>117</strong> — evidențiere OCR nesigur; TPO obligatoriu la Unește cu bifă merge.</li>
  </ul>

  <h2>5. Cum testezi rapid</h2>
  <div class="box">
    <ol style="margin:0; padding-left:1.2em;">
      <li>Deschide Avize → pe un rând: Acțiuni → Editează → zoom 125% + Descarcă.</li>
      <li>Șablon cu „Unește celulele TPO”: selectează un aviz fără TPO → Confirmă / Unește → trebuie „Completează TPO”.</li>
      <li>Rând cu OCR nesigur pe TPO → Confirmă → buton dezactivat până Verifică / Salvează.</li>
      <li>Pagina de transfer: bifă „Doar document marfă”, completează TRO → poate trece fără TPO.</li>
    </ol>
  </div>

  <p class="foot">
    Changelog #13 · TransitiX companion RAI · experiment Mistral · nu merge pe PROD fără OK explicit.
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
  companion: '1.26.14',
  build: 120,
}, null, 2));
