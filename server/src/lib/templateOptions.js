/**
 * Behaviour flags on `report_templates.options` (JSONB).
 * Keep unknown keys when round-tripping so future flags are not wiped.
 */

export function normalizeTemplateOptions(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...src,
    merge_tpo_cells: Boolean(src.merge_tpo_cells),
  };
}

export function wantsMergeTpoCells(template) {
  return Boolean(normalizeTemplateOptions(template?.options).merge_tpo_cells);
}
