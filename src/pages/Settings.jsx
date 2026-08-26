import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { notifyError, notifySuccess } from '@/lib/notify';
import { Building2, Bell, Save, Loader2 } from 'lucide-react';

const EXPIRY_OPTIONS = [30, 15, 7, 1];
const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[#1D4E89] transition-colors';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';


/**
 * The devices currently signed in, and a way to cut them all off.
 *
 * Logging out ends the session on the device doing it. This is the other case: a phone left in a
 * cab or an employee who has gone. Without it, revocation exists in the API and nowhere a person
 * can reach.
 */
function SessionsCard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.auth.sessions();
      setSessions(res.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const revokeAll = async () => {
    if (!window.confirm(
      'Închizi toate sesiunile?\n\nVei fi delogat și pe dispozitivul acesta, și pe orice '
      + 'telefon sau calculator unde ești autentificat.'
    )) return;
    setRevoking(true);
    try {
      await api.auth.revokeAllSessions();
      // The current session is gone too — that is the point — so go to the login screen.
      await api.auth.logout();
    } catch (err) {
      notifyError('Sesiunile nu au putut fi închise', err);
      setRevoking(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#0A2B4E]">Sesiuni active</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Dispozitivele pe care ești autentificat acum.
          </p>
        </div>
        <button
          type="button"
          onClick={revokeAll}
          disabled={revoking || loading}
          className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1.5 min-h-[38px] shrink-0"
        >
          {revoking ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Închide toate
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Se încarcă…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">Nicio sesiune înregistrată.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sessions.map((session) => (
            <li key={session.jti} className="py-2 text-sm">
              <p className="text-slate-700 break-words">{session.user_agent || 'Dispozitiv necunoscut'}</p>
              <p className="text-xs text-slate-400">
                autentificat {new Date(session.issued_at).toLocaleString('ro-RO')}
                {session.last_used_at
                  ? ` · folosit ultima dată ${new Date(session.last_used_at).toLocaleString('ro-RO')}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const canSave = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    cui: '',
    address: '',
    phone: '',
    email: '',
    vat_regime: 'platitor',
    default_currency: 'RON',
    document_expiry_days: [30, 15, 7, 1],
  });

  useEffect(() => {
    (async () => {
      try {
        const company = await api.company.get();
        const days = company.settings?.document_expiry_days;
        setForm({
          name: company.name || '',
          cui: company.cui || '',
          address: company.address || '',
          phone: company.phone || '',
          email: company.email || '',
          vat_regime: company.vat_regime || 'platitor',
          default_currency: company.default_currency || 'RON',
          document_expiry_days: Array.isArray(days) ? days : [30, 15, 7, 1],
        });
      } catch (e) {
        notifyError('Nu am putut încărca setările', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleDay = (day) => {
    setForm((prev) => {
      const has = prev.document_expiry_days.includes(day);
      const next = has
        ? prev.document_expiry_days.filter((d) => d !== day)
        : [...prev.document_expiry_days, day].sort((a, b) => b - a);
      return { ...prev, document_expiry_days: next };
    });
  };

  const save = async () => {
    if (!canSave) {
      notifyError('Doar administratorul poate salva setările companiei.');
      return;
    }
    if (!form.name.trim()) {
      notifyError('Denumire obligatorie', 'Completează numele companiei.');
      return;
    }
    setSaving(true);
    try {
      await api.company.update({
        name: form.name.trim(),
        cui: form.cui.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        vat_regime: form.vat_regime,
        default_currency: form.default_currency,
        settings: { document_expiry_days: form.document_expiry_days },
      });
      notifySuccess('Setări salvate', 'Datele companiei au fost actualizate.');
    } catch (e) {
      notifyError('Salvare eșuată', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Setări</h1>
        <p className="text-sm text-slate-500 mt-1">Configurare companie și notificări</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Building2 className="w-5 h-5 text-[#1D4E89]" />
          <h2 className="font-semibold text-[#0A2B4E]">Date companie</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Denumire</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nume companie" />
            </div>
            <div>
              <label className={labelCls}>CUI</label>
              <input className={inputCls} value={form.cui} onChange={(e) => set('cui', e.target.value)} placeholder="Cod fiscal" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Adresă</label>
              <input className={inputCls} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Adresă sediu" />
            </div>
            <div>
              <label className={labelCls}>Telefon</label>
              <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Telefon" />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="email@companie.ro" />
            </div>
            <div>
              <label className={labelCls}>Regim TVA</label>
              <select className={inputCls} value={form.vat_regime} onChange={(e) => set('vat_regime', e.target.value)}>
                <option value="platitor">Plătitor TVA</option>
                <option value="neplatitor">Neplătitor TVA</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Monedă</label>
              <select className={inputCls} value={form.default_currency} onChange={(e) => set('default_currency', e.target.value)}>
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-5 border-b border-slate-100">
          <Bell className="w-5 h-5 text-[#F5A623]" />
          <h2 className="font-semibold text-[#0A2B4E]">Notificări expirare documente</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">Praguri alerte (zile înainte de expirare):</p>
          <div className="flex gap-3 flex-wrap">
            {EXPIRY_OPTIONS.map((days) => (
              <label key={days} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.document_expiry_days.includes(days)}
                  onChange={() => toggleDay(days)}
                />
                <span className="text-sm text-slate-700">{days} zile</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <SessionsCard />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
        {!canSave && (
          <p className="text-xs text-slate-500 sm:mr-auto">Doar administratorul poate salva setările.</p>
        )}
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={save}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#0A2B4E] rounded-lg hover:bg-[#1D4E89] transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvează setările
        </button>
      </div>
    </div>
  );
}
