/**
 * Multi-page Baumit-like PDF for testing „Unește celulele TPO”.
 *
 * Layout (text layer readable by split + OCR):
 *   - each distinct PSL/TRO → separate aviz after upload split
 *   - adjacent same TPO → Excel merge + glued preview when checkbox ON
 *   - non-adjacent same TPO → Excel merge only if consecutive in annex order;
 *     preview glues only adjacent peers
 *   - same PSL on 2 pages → one multi-page file (pag. A–B)
 *
 *   node qa/samples/merge-tpo/generate-baumit-scatter.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(HERE, '_baumit-scatter.html');
const pdfPath = join(HERE, 'baumit-merge-tpo-scatter.pdf');
const downloadsCopy = join(
  process.env.USERPROFILE || '',
  'Downloads',
  'baumit-merge-tpo-scatter.pdf',
);

/**
 * Page plan — order matters for adjacency.
 * `cont` = continuation of previous page (same PSL, no new document key).
 */
/**
 * Numeric TPO only — OCR profiles match `TPO` + digits (`TPO-0033600`), not `TPO-TEST-…`.
 * Range 0099xxx stays clear of real Baumit production numbers.
 */
const PAGES = [
  {
    page: 1,
    of: null,
    doc: 'PSL-0910001',
    tpo: 'TPO-0099101',
    plate: 'B-11-AAA',
    date: '07.10.2026',
    route: 'Bolintin-Deal → Ciulnița, Str. Galați 1A',
    note: 'singleton (apare din nou la pag. 11)',
  },
  {
    page: 2,
    of: null,
    doc: 'PSL-0910002',
    tpo: 'TPO-0099102',
    plate: 'B-22-BBB',
    date: '07.10.2026',
    route: 'Bolintin-Deal → Pantelimon, Șos. Cernica 12',
    note: 'pereche adiacentă START → merge preview cu pag. 3',
  },
  {
    page: 3,
    of: null,
    doc: 'PSL-0910003',
    tpo: 'TPO-0099102',
    plate: 'B-22-BBB',
    date: '07.10.2026',
    route: 'Bolintin-Deal → Pantelimon, Șos. Cernica 14',
    note: 'pereche adiacentă END (același TPO ca pag. 2)',
  },
  {
    page: 4,
    of: null,
    doc: 'TRO-0019104',
    tpo: 'TPO-0099103',
    plate: 'B-33-CCC',
    date: '08.10.2026',
    route: 'Militari → București, Bd. Iuliu Maniu 600A',
    note: 'TPO diferit (TRO)',
  },
  {
    page: 5,
    of: null,
    doc: 'PSL-0910005',
    tpo: 'TPO-0099104',
    plate: 'B-44-DDD',
    date: '08.10.2026',
    route: 'Chiajna → Otopeni, Str. Aviatorilor 3',
    note: 'triplă adiacentă 1/3',
  },
  {
    page: 6,
    of: null,
    doc: 'PSL-0910006',
    tpo: 'TPO-0099104',
    plate: 'B-55-EEE',
    date: '08.10.2026',
    route: 'Chiajna → Otopeni, Str. Aviatorilor 5',
    note: 'triplă adiacentă 2/3',
  },
  {
    page: 7,
    of: null,
    doc: 'PSL-0910007',
    tpo: 'TPO-0099104',
    plate: 'B-66-FFF',
    date: '08.10.2026',
    route: 'Chiajna → Pipera, Bd. Pipera 40',
    note: 'triplă adiacentă 3/3',
  },
  {
    page: 8,
    of: null,
    doc: 'PSL-0910008',
    tpo: 'TPO-0099102',
    plate: 'B-77-GGG',
    date: '09.10.2026',
    route: 'Bolintin-Deal → Galați, Str. Domnească 9',
    note: 'același TPO ca 2–3, DAR nu adiacent → preview separat',
  },
  {
    page: 9,
    of: '1/2',
    doc: 'PSL-0910009',
    tpo: 'TPO-0099105',
    plate: 'B-88-HHH',
    date: '09.10.2026',
    route: 'Bolintin-Deal → Brașov, Str. Lungă 12',
    note: 'multi-pagină același PSL (rămâne 1 fișier · pag. 9–10)',
  },
  {
    page: 10,
    of: '2/2',
    doc: 'PSL-0910009',
    tpo: 'TPO-0099105',
    plate: 'B-88-HHH',
    date: '09.10.2026',
    route: 'Bolintin-Deal → Brașov, Str. Lungă 12 (continuare)',
    note: 'continuare PSL-0910009 — lipit la upload',
    cont: true,
  },
  {
    page: 11,
    of: null,
    doc: 'PSL-0910011',
    tpo: 'TPO-0099101',
    plate: 'B-99-III',
    date: '10.10.2026',
    route: 'Bolintin-Deal → Constanța, Bd. Aurel Vlaicu 54',
    note: 'același TPO ca pag. 1, nu adiacent',
  },
  {
    page: 12,
    of: null,
    doc: 'PSL-0910012',
    tpo: 'TPO-0099106',
    plate: 'B-12-JJJ',
    date: '10.10.2026',
    route: 'Chiajna → Timișoara, Calea Șagului 210',
    note: 'singleton final',
  },
];

function sheet(p, total) {
  const pagina = p.of || `1/1`;
  const kind = p.doc.startsWith('TRO') ? 'TRO' : 'PSL';
  return `<section class="page">
  <header>
    <div>
      <p class="kicker">Expeditor</p>
      <p class="site">Site: BOL Bolintin</p>
      <p class="addr">Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU</p>
    </div>
    <div class="pagina">
      <span>Pagină</span>
      <strong>${pagina}</strong>
    </div>
  </header>

  <h1>Aviz de expeditie: ${p.doc}</h1>
  <p class="meta">Data avizului de expediție <strong>${p.date}</strong></p>

  <div class="grid">
    <div>
      <p class="label">Adresă de livrare / Rută</p>
      <p class="value">${p.route}</p>
    </div>
    <div>
      <p class="label">Client</p>
      <p class="value">ARABESQUE TEST SRL</p>
    </div>
  </div>

  <div class="grid transport">
    <div>
      <p class="label">Termeni de livrare</p>
      <p class="value">livrat la locul convenit</p>
      <p class="label">Comandă de transport</p>
      <p class="tpo">Comanda de transport: ${p.tpo}</p>
    </div>
    <div>
      <p class="label">Transportator</p>
      <p class="value">RAI-SPEDITION SRL</p>
      <p class="label">Placuta de inmatriculare</p>
      <p class="value plate">${p.plate}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Nr</th><th>Descriere</th><th>Cantitatea</th><th>Pachet</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>11000034 DuoContat 25 kg (test ${kind})</td>
        <td>${40 + p.page}.00 sac</td>
        <td>2.00 pal</td>
      </tr>
    </tbody>
  </table>

  <p class="weights">Greutate netă: ${(2.4 + p.page * 0.1).toFixed(2)} t · Greutate brută: ${(2.5 + p.page * 0.1).toFixed(2)} t</p>

  <footer>
    <p class="hint">TEST merge-TPO · pag. ${p.page}/${total} · ${p.note}</p>
    <p class="brand">Baumit Romania Com SRL · document sintetic TransitiX</p>
  </footer>
</section>`;
}

const total = PAGES.length;
const sheets = PAGES.map((p) => sheet(p, total)).join('\n');

const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<title>Baumit merge-TPO scatter</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
  .page { break-after: page; page-break-after: always; min-height: 250mm; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
  .kicker { margin: 0; font-size: 11px; color: #444; }
  .site { margin: 2px 0; font-weight: 700; }
  .addr { margin: 0; color: #333; }
  .pagina { text-align: right; }
  .pagina span { display: block; font-size: 11px; color: #444; }
  .pagina strong { font-size: 16px; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .meta { margin: 0 0 14px; }
  .grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-bottom: 14px; }
  .label { margin: 0 0 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
  .value { margin: 0 0 10px; font-size: 13px; }
  .tpo { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.03em; }
  .plate { font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
  th, td { border: 1px solid #222; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; font-size: 11px; }
  .weights { margin: 0 0 18px; }
  footer { border-top: 1px solid #ccc; padding-top: 8px; }
  .hint { margin: 0 0 4px; font-size: 11px; color: #1d4e89; font-weight: 600; }
  .brand { margin: 0; font-size: 10px; color: #666; }
</style>
</head>
<body>
${sheets}
</body>
</html>
`;

mkdirSync(HERE, { recursive: true });
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
  console.error('Chrome/Edge headless print failed', printed?.stderr || printed?.error);
  process.exit(printed?.status || 1);
}

try {
  if (downloadsCopy && downloadsCopy.includes('Downloads')) {
    copyFileSync(pdfPath, downloadsCopy);
  }
} catch {
  // Downloads copy is optional
}

const tpoRuns = [];
let run = null;
for (const p of PAGES) {
  if (p.cont) continue;
  if (!run || run.tpo !== p.tpo) {
    run = { tpo: p.tpo, pages: [p.page] };
    tpoRuns.push(run);
  } else {
    run.pages.push(p.page);
  }
}

console.log(JSON.stringify({
  pdf: pdfPath,
  downloads: downloadsCopy,
  browser: used,
  pages: PAGES.length,
  expectedAvizeAfterSplit: PAGES.filter((p) => !p.cont).length,
  multipageSamePsl: ['pag. 9–10 → 1 fișier PSL-0910009'],
  adjacentTpoGroups: tpoRuns
    .filter((r) => r.pages.length > 1)
    .map((r) => `${r.tpo}: pag. ${r.pages.join(',')}`),
  nonAdjacentRepeats: [
    'TPO-0099102: pag. 2–3 apoi din nou pag. 8',
    'TPO-0099101: pag. 1 apoi pag. 11',
  ],
}, null, 2));
