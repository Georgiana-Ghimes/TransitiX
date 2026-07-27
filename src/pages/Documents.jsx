import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, FileText, Truck, Users } from 'lucide-react';

export default function Documents() {
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [vehicles, drivers] = await Promise.all([
        base44.entities.Vehicle.list(),
        base44.entities.Driver.list(),
      ]);
      const now = new Date();
      const in30Days = new Date(); in30Days.setDate(now.getDate() + 30);
      const list = [];

      vehicles.forEach(v => {
        const docs = [
          { type: 'ITP', number: v.itp_number, date: v.itp_expiry },
          { type: 'RCA', number: v.rca_number, date: v.rca_expiry },
          { type: 'Rovinietă', number: v.rovinieta_number, date: v.rovinieta_expiry },
          { type: 'CASCO', number: v.casco_number, date: v.casco_expiry },
        ];
        docs.forEach(d => {
          if (d.date && new Date(d.date) <= in30Days) {
            list.push({ entity: `${v.brand} ${v.model} (${v.plate})`, entityType: 'vehicle', ...d, expired: new Date(d.date) < now });
          }
        });
      });

      drivers.forEach(d => {
        const docs = [
          { type: 'Permis', number: d.license_number, date: d.license_expiry },
          { type: 'Medical', number: d.medical_certificate_number, date: d.medical_certificate_expiry },
          { type: 'Tahograf', number: d.tachograph_card_number, date: d.tachograph_card_expiry },
        ];
        docs.forEach(doc => {
          if (doc.date && new Date(doc.date) <= in30Days) {
            list.push({ entity: d.name, entityType: 'driver', ...doc, expired: new Date(doc.date) < now });
          }
        });
      });

      list.sort((a, b) => new Date(a.date) - new Date(b.date));
      setExpiring(list);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" /></div>;

  const expired = expiring.filter(d => d.expired);
  const upcoming = expiring.filter(d => !d.expired);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Documente</h1>
        <p className="text-sm text-slate-500 mt-1">{expired.length} expirate · {upcoming.length} expiră în 30 zile</p>
      </div>

      {expired.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-red-700">Documente expirate</h2>
          </div>
          <div className="space-y-2">
            {expired.map((d, i) => (
              <div key={i} className="flex items-center gap-3 bg-white rounded-lg p-3">
                {d.entityType === 'vehicle' ? <Truck className="w-4 h-4 text-slate-400" /> : <Users className="w-4 h-4 text-slate-400" />}
                <div className="flex-1"><p className="text-sm font-medium text-slate-700">{d.entity}</p><p className="text-xs text-slate-500">{d.type} · {d.number || 'fără număr'}</p></div>
                <span className="text-xs font-medium text-red-600">Expirat: {new Date(d.date).toLocaleDateString('ro-RO')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-[#0A2B4E]">Expiră în 30 zile</h2>
          </div>
        </div>
        {upcoming.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {upcoming.map((d, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50">
                {d.entityType === 'vehicle' ? <Truck className="w-4 h-4 text-slate-400" /> : <Users className="w-4 h-4 text-slate-400" />}
                <div className="flex-1"><p className="text-sm font-medium text-slate-700">{d.entity}</p><p className="text-xs text-slate-500">{d.type} · {d.number || 'fără număr'}</p></div>
                <span className="text-xs font-medium text-amber-600">Expiră: {new Date(d.date).toLocaleDateString('ro-RO')}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400"><p className="text-sm">Nu există documente care expiră în curând.</p></div>
        )}
      </div>
    </div>
  );
}