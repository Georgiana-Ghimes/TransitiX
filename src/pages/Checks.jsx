import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, ChevronDown, ChevronRight, EyeOff, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';
import { api } from '@/api/client';
import { notifyError } from '@/lib/notify';
import {
  WINDOW_OPTIONS,
  groupByRule,
  headline,
  severityMeta,
  subjectLabel,
  summarise,
} from '@/lib/checksUi';

function SeverityBadge({ severity }) {
  const meta = severityMeta(severity);
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

function FindingRow({ finding, onDismiss, dismissing }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2 border-t border-slate-100 hover:bg-slate-50">
      <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${severityMeta(finding.severity).dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {finding.link ? (
            <Link to={finding.link} className="text-sm font-medium text-blue-700 hover:underline">
              {subjectLabel(finding.subject)}
            </Link>
          ) : (
            <span className="text-sm font-medium text-slate-700">{subjectLabel(finding.subject)}</span>
          )}
        </div>
        <p className="text-[12px] text-slate-500 mt-0.5">{finding.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(finding)}
        disabled={dismissing === finding.key}
        title="Ascunde această constatare. Reapare dacă datele se schimbă din nou."
        className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-white shrink-0 inline-flex items-center gap-1 disabled:opacity-40"
      >
        {dismissing === finding.key
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <EyeOff className="w-3 h-3" />}
        Ascunde
      </button>
    </li>
  );
}

function RuleGroup({ group, onDismiss, dismissing }) {
  const [open, setOpen] = useState(group.severity === 'error');
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <Chevron className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">
              {group.meta?.label ?? group.rule}
            </span>
            <SeverityBadge severity={group.severity} />
            <span className="text-xs text-slate-500">{group.items.length}</span>
          </div>
          {group.meta ? (
            <p className="text-[12px] text-slate-500 mt-1">{group.meta.consequence}</p>
          ) : null}
        </div>
      </button>
      {open ? (
        <>
          {group.meta?.fix ? (
            <p className="px-4 py-2 text-[12px] text-slate-600 bg-slate-50 border-t border-slate-100">
              <span className="font-medium">Cum se rezolvă:</span> {group.meta.fix}
            </p>
          ) : null}
          <ul>
            {group.items.map((finding) => (
              <FindingRow
                key={finding.key}
                finding={finding}
                onDismiss={onDismiss}
                dismissing={dismissing}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export default function Checks() {
  const [rules, setRules] = useState([]);
  const [data, setData] = useState(null);
  const [windowDays, setWindowDays] = useState(90);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const found = await api.validation.findings({
        window_days: windowDays,
        include_dismissed: includeDismissed,
      });
      setData(found);
    } catch (err) {
      notifyError(err.message || 'Verificările au eșuat');
    } finally {
      setLoading(false);
    }
  }, [windowDays, includeDismissed]);

  useEffect(() => {
    api.validation.rules()
      .then((res) => setRules(res.rules))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDismiss(finding) {
    setDismissing(finding.key);
    try {
      await api.validation.dismiss(finding.key);
      setData((prev) => {
        if (!prev) return prev;
        const findings = prev.findings.filter((f) => f.key !== finding.key);
        return {
          ...prev,
          findings,
          summary: summarise(findings),
          dismissed_count: (prev.dismissed_count ?? 0) + 1,
        };
      });
    } catch (err) {
      notifyError(err.message || 'Constatarea nu a putut fi ascunsă');
    } finally {
      setDismissing(null);
    }
  }

  const groups = groupByRule(data?.findings ?? [], rules);
  const clean = !loading && groups.length === 0;

  return (
    <div className="p-6 space-y-4 max-w-[1100px] mx-auto">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-slate-800">Verificări date</h1>
          <p className="text-sm text-slate-500">
            Ce din datele curente ar duce la o factură greșită sau la un raport pe care clientul
            nu-l poate verifica.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Verifică din nou
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`inline-flex items-center gap-2 font-medium ${
          (data?.summary?.by_severity?.error ?? 0) > 0 ? 'text-red-700' : 'text-slate-700'
        }`}>
          {(data?.summary?.by_severity?.error ?? 0) > 0
            ? <ShieldAlert className="w-4 h-4" />
            : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          {headline(data?.summary)}
        </span>
        {data ? (
          <span className="text-xs text-slate-400">
            verificate {data.checked.trips} curse și {data.checked.documents} documente
          </span>
        ) : null}
        {data?.dismissed_count ? (
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(e) => setIncludeDismissed(e.target.checked)}
            />
            Arată și cele {data.dismissed_count} ascunse
          </label>
        ) : null}
      </div>

      {clean ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-slate-600">
            Nicio problemă în perioada aleasă. Cursele au tarif valabil, TPO-urile se potrivesc cu
            liniile lor, iar documentele confirmate au greutate și cursă.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <RuleGroup
              key={group.rule}
              group={group}
              onDismiss={handleDismiss}
              dismissing={dismissing}
            />
          ))}
        </div>
      )}
    </div>
  );
}
