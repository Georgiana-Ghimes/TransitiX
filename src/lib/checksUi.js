/**
 * Display logic for the data-quality screen.
 *
 * The server decides what is wrong and why; this file decides how the list reads. The ordering
 * rule it shares with the server is that errors — the ones that change an invoice — come first.
 */

export const SEVERITY_META = {
  error: {
    label: 'Blochează facturarea',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    order: 0,
  },
  warning: {
    label: 'De verificat',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    order: 1,
  },
};

export function severityMeta(severity) {
  return SEVERITY_META[severity] ?? {
    label: severity, badge: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400', order: 9,
  };
}

export const WINDOW_OPTIONS = [
  { value: 30, label: 'Ultimele 30 de zile' },
  { value: 90, label: 'Ultimele 90 de zile' },
  { value: 180, label: 'Ultimele 6 luni' },
  { value: 365, label: 'Ultimul an' },
];

/**
 * Findings grouped by rule, errors first.
 *
 * Twenty separate rows saying "no valid tariff" is a wall; one row saying it twenty times is a
 * task. The grouping is what makes the screen usable at month end.
 */
export function groupByRule(findings = [], rules = []) {
  const catalog = new Map(rules.map((rule) => [rule.id, rule]));
  const groups = new Map();
  for (const item of findings) {
    if (!groups.has(item.rule)) {
      groups.set(item.rule, {
        rule: item.rule,
        severity: item.severity,
        meta: catalog.get(item.rule) ?? null,
        items: [],
      });
    }
    groups.get(item.rule).items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    const bySeverity = severityMeta(a.severity).order - severityMeta(b.severity).order;
    if (bySeverity !== 0) return bySeverity;
    return b.items.length - a.items.length || a.rule.localeCompare(b.rule);
  });
}

/**
 * Recounts the header after a dismissal, without a round trip.
 *
 * The header has to follow the list. Leaving it at the server's original count would have it
 * claiming a problem that is no longer on screen — the screen contradicting itself.
 */
export function summarise(findings = []) {
  const bySeverity = { error: 0, warning: 0 };
  const byRule = {};
  for (const item of findings) {
    if (bySeverity[item.severity] !== undefined) bySeverity[item.severity] += 1;
    byRule[item.rule] = (byRule[item.rule] ?? 0) + 1;
  }
  return { total: findings.length, by_rule: byRule, by_severity: bySeverity };
}

/** One sentence for the header — what the operator is actually facing. */
export function headline(summary) {
  const errors = summary?.by_severity?.error ?? 0;
  const warnings = summary?.by_severity?.warning ?? 0;
  if (!errors && !warnings) return 'Nimic de corectat în perioada aleasă.';
  const parts = [];
  if (errors) parts.push(`${errors} ${errors === 1 ? 'problemă care afectează facturarea' : 'probleme care afectează facturarea'}`);
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'de verificat' : 'de verificat'}`);
  return parts.join(' · ');
}

/** The label for a finding's subject, so a row says what it is about before why. */
export function subjectLabel(subject) {
  if (!subject) return '—';
  const kind = { trip: 'Cursă', document: 'Document', tpo: 'TPO' }[subject.type] ?? '';
  return kind ? `${kind} ${subject.label}` : subject.label;
}
