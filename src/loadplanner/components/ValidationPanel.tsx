import type { ValidationResult } from '../domain/types';

export type ValidationPanelProps = {
  result: ValidationResult;
  onHighlight?: (placementIds: string[]) => void;
};

export function ValidationPanel({ result, onHighlight }: ValidationPanelProps) {
  const findings = [...result.errors, ...result.warnings];

  if (!findings.length) {
    return (
      <p className="px-3 py-4 text-xs text-emerald-600">
        Planul respectă toate limitele verificate.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {findings.map((finding, index) => (
        <li key={`${finding.code}-${index}`}>
          <button
            type="button"
            onClick={() => onHighlight?.(finding.placementIds)}
            disabled={!finding.placementIds.length || !onHighlight}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 disabled:hover:bg-transparent"
          >
            <span className="flex items-start gap-2">
              <span
                className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                  finding.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
              <span
                className={`text-[11px] ${finding.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}
              >
                {finding.message}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
