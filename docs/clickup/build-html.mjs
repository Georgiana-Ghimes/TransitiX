/**
 * Build ClickUp "HTML with page splitting" from the markdown pack.
 * Each file's first H1 becomes a ClickUp nested page.
 *
 * node docs/clickup/build-html.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = [
  '00-import-without-deleting.md',
  '01-spec-mvp-transitix-2026.md',
  '02-design-system.md',
  '03-design-office-pages.md',
  '04-design-avize-rapoarte.md',
  '05-plan-avize-next.md',
];

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(' ').trim();
    if (text) html.push(`<p>${inline(text)}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushPara();
      const lang = trimmed.slice(3).trim();
      i += 1;
      const body = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(escapeHtml(lines[i]));
        i += 1;
      }
      html.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${body.join('\n')}</code></pre>`);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1].trim())) {
      flushPara();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      const parseRow = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
      const header = parseRow(rows[0]);
      const bodyRows = rows.slice(2).map(parseRow);
      html.push('<table><thead><tr>');
      header.forEach((c) => html.push(`<th>${inline(c)}</th>`));
      html.push('</tr></thead><tbody>');
      bodyRows.forEach((r) => {
        html.push('<tr>');
        r.forEach((c) => html.push(`<td>${inline(c)}</td>`));
        html.push('</tr>');
      });
      html.push('</tbody></table>');
      continue;
    }

    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (trimmed === '---') {
      flushPara();
      html.push('<hr />');
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      html.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        html.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      html.push('</ul>');
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      html.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        html.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      html.push('</ol>');
      continue;
    }

    if (!trimmed) {
      flushPara();
      i += 1;
      continue;
    }

    para.push(trimmed);
    i += 1;
  }
  flushPara();
  return html.join('\n');
}

const pages = files.map((name) => {
  const md = fs.readFileSync(path.join(dir, name), 'utf8');
  return mdToHtml(md);
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Transitix ClickUp pack — 19 Aug 2026</title>
</head>
<body>
${pages.join('\n')}
</body>
</html>
`;

const out = path.join(dir, 'transitix-clickup-import.html');
fs.writeFileSync(out, html, 'utf8');
console.log('Wrote', out);

const singlePages = [
  { src: 'spec-mvp-v2-ro.md', dest: 'spec-mvp-v2-ro.html', title: 'Spec MVP - Transitix V2' },
  { src: 'avize-stare-si-plan-ro.md', dest: 'avize-stare-si-plan-ro.html', title: 'Avize - Stare curentă și plan de dezvoltare' },
];

for (const page of singlePages) {
  const md = fs.readFileSync(path.join(dir, page.src), 'utf8');
  const inner = mdToHtml(md);
  const doc = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <title>${page.title}</title>
</head>
<body>
${inner}
</body>
</html>
`;
  const dest = path.join(dir, page.dest);
  fs.writeFileSync(dest, doc, 'utf8');
  console.log('Wrote', dest);
}
