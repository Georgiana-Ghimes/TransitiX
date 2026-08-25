/**
 * The printed page, as HTML.
 *
 * Kept apart from the PDF writer so the layout can be tested without a browser, and so the
 * rasterizer only has one job. Styles are inline and deliberately plain — the renderer only
 * understands basic CSS, and nothing here may depend on the app's stylesheet.
 */

const COLORS = {
  ink: '#0A2B4E',
  muted: '#64748B',
  line: '#CBD5E1',
  head: '#E2E8F0',
  warn: '#B45309',
};

/** A4 landscape at 96dpi, the size the rasterizer works in. */
export const PAGE = { width: 1123, height: 794 };

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function headerHtml(sheet, pageIndex, pageCount) {
  const meta = sheet.meta
    .map((item) => `
      <div style="min-width:120px">
        <div style="font-size:9px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:.04em">${escapeHtml(item.label)}</div>
        <div style="font-size:13px;color:${COLORS.ink};font-weight:600">${escapeHtml(item.value)}</div>
      </div>`)
    .join('');

  const warnings = sheet.warnings?.length
    ? `<div style="margin-top:8px;padding:6px 10px;border:1px solid ${COLORS.warn};border-radius:4px;
                   font-size:10px;color:${COLORS.warn}">
         ${sheet.warnings.map((w) => escapeHtml(w)).join(' &middot; ')}
       </div>`
    : '';

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${COLORS.ink};padding-bottom:8px">
      <div>
        <div style="font-size:15px;font-weight:700;color:${COLORS.ink}">${escapeHtml(sheet.company)}</div>
        <div style="font-size:10px;color:${COLORS.muted}">${escapeHtml(sheet.companyDetails)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:19px;font-weight:700;letter-spacing:.06em;color:${COLORS.ink}">${escapeHtml(sheet.title)}</div>
        <div style="font-size:12px;color:${COLORS.ink}">
          Ruta <strong>${escapeHtml(sheet.routeCode)}</strong> &middot; ${escapeHtml(sheet.date)}
          ${pageCount > 1 ? `&middot; pagina ${pageIndex + 1}/${pageCount}` : ''}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px">${meta}</div>
    ${warnings}`;
}

function tableHtml(sheet, rows) {
  const head = sheet.columns
    .map((col) => `
      <th style="width:${col.width}%;padding:5px 6px;border:1px solid ${COLORS.line};background:${COLORS.head};
                 font-size:10px;color:${COLORS.ink};text-align:${col.align || 'left'};font-weight:600">
        ${escapeHtml(col.label)}
      </th>`)
    .join('');

  const body = rows.length
    ? rows.map((row) => `
        <tr>
          ${sheet.columns.map((col) => `
            <td style="padding:7px 6px;border:1px solid ${COLORS.line};font-size:11px;color:${COLORS.ink};
                       text-align:${col.align || 'left'};height:22px;vertical-align:top">
              ${escapeHtml(row[col.key])}
            </td>`).join('')}
        </tr>`).join('')
    : `<tr><td colspan="${sheet.columns.length}"
             style="padding:24px;border:1px solid ${COLORS.line};text-align:center;font-size:11px;color:${COLORS.muted}">
           Ruta nu are opriri planificate
         </td></tr>`;

  return `
    <table style="width:100%;border-collapse:collapse;margin-top:10px;table-layout:fixed">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function footerHtml(sheet) {
  const readings = (sheet.readings || [])
    .map((reading) => `
      <div style="flex:1">
        <div style="font-size:10px;color:${COLORS.muted}">${escapeHtml(reading.label)}</div>
        <div style="border-bottom:1px solid ${COLORS.line};height:22px"></div>
      </div>`)
    .join('');

  const signatures = (sheet.signatures || [])
    .map((signature) => `
      <div style="flex:1">
        <div style="font-size:10px;color:${COLORS.muted}">${escapeHtml(signature.label)} &mdash; ${escapeHtml(signature.hint)}</div>
        <div style="border-bottom:1px solid ${COLORS.line};height:36px"></div>
      </div>`)
    .join('');

  return `
    <div style="display:flex;gap:24px;margin-top:14px">${readings}</div>
    <div style="display:flex;gap:24px;margin-top:14px">${signatures}</div>`;
}

/** One printed page. The signature block only goes on the last one. */
export function sheetPageHtml(sheet, rows, pageIndex, pageCount) {
  const isLast = pageIndex === pageCount - 1;
  return `
    <div style="width:${PAGE.width}px;min-height:${PAGE.height}px;box-sizing:border-box;padding:28px 32px;
                background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${COLORS.ink}">
      ${headerHtml(sheet, pageIndex, pageCount)}
      ${tableHtml(sheet, rows)}
      ${isLast ? footerHtml(sheet) : ''}
    </div>`;
}
