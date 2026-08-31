import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Inbox, Loader2 } from 'lucide-react';
import { friendlyErrorMessage, notifyError, notifySuccess } from '@/lib/notify';

const LEAD_STATUS_LABEL = {
  new: 'Nouă',
  contacted: 'Contactat',
  converted: 'Convertit',
  dismissed: 'Respins',
};

export default function PlatformLeads() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.platform.leads({
        status: statusFilter || undefined,
      });
      setItems(data.items || []);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  const setLeadStatus = async (lead, status) => {
    try {
      await api.platform.patchLead(lead.id, { status });
      notifySuccess('Lead actualizat', LEAD_STATUS_LABEL[status] || status);
      await load();
    } catch (err) {
      notifyError('Actualizare eșuată', friendlyErrorMessage(err));
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2B4E]">Solicitări acces</h1>
          <p className="text-sm text-slate-500 mt-1">
            Din formularul public <code className="text-xs bg-slate-100 px-1 rounded">/request-access</code>.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-2"
        >
          <option value="">Toate</option>
          <option value="new">Noi</option>
          <option value="contacted">Contactate</option>
          <option value="converted">Convertite</option>
          <option value="dismissed">Respinse</option>
        </select>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
          <Inbox className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          Nicio cerere{statusFilter ? ' cu acest status' : ''}.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((lead) => (
            <li
              key={lead.id}
              className="bg-white rounded-xl border border-slate-200/80 px-4 py-3 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#0A2B4E]">{lead.company_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lead.contact_name} · {lead.email}
                  {lead.phone ? ` · ${lead.phone}` : ''}
                  {' · '}
                  {lead.preferred_profile === 'documents' ? 'Documente' : 'TMS full'}
                  {' · '}
                  <span className="uppercase tracking-wide text-[10px]">{LEAD_STATUS_LABEL[lead.status] || lead.status}</span>
                </p>
                {lead.message ? (
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">{lead.message}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lead.status === 'new' || lead.status === 'contacted' ? (
                  <Link
                    to={`/platform/companies?lead=${encodeURIComponent(lead.id)}`}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg bg-[#0A2B4E] text-white"
                  >
                    Convertește
                  </Link>
                ) : null}
                {lead.status === 'new' ? (
                  <button
                    type="button"
                    onClick={() => setLeadStatus(lead, 'contacted')}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200"
                  >
                    Marchează contactat
                  </button>
                ) : null}
                {lead.status !== 'dismissed' && lead.status !== 'converted' ? (
                  <button
                    type="button"
                    onClick={() => setLeadStatus(lead, 'dismissed')}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500"
                  >
                    Respinge
                  </button>
                ) : null}
                {lead.converted_company_id ? (
                  <Link
                    to={`/platform/companies/${lead.converted_company_id}`}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200"
                  >
                    Deschide firma
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
