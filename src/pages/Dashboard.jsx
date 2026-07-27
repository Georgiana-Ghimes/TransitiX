import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import KpiCard from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { Truck, Users, Route, AlertTriangle, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [stats, setStats] = useState({ vehicles: 0, drivers: 0, activeTrips: 0, alerts: 0 });
  const [recentTrips, setRecentTrips] = useState([]);
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [vehicles, drivers, trips] = await Promise.all([
        api.entities.Vehicle.list(),
        api.entities.Driver.list(),
        api.entities.Trip.list('-created_date', 50),
      ]);

      const activeTrips = trips.filter(t => !['livrata', 'anulata'].includes(t.status));
      setStats({
        vehicles: vehicles.length,
        drivers: drivers.filter(d => d.is_active).length,
        activeTrips: activeTrips.length,
        alerts: 0,
      });
      setRecentTrips(trips.slice(0, 6));

      // Check expiring documents (30 days)
      const now = new Date();
      const in30Days = new Date(); in30Days.setDate(now.getDate() + 30);
      const checkExpiry = (dateStr, type, name, id) => {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (d <= in30Days) return { type, name, date: dateStr, id, expired: d < now };
        return null;
      };

      const expiring = [];
      vehicles.forEach(v => {
        ['itp', 'rca', 'rovinieta', 'casco'].forEach(doc => {
          const dateField = `${doc}_expiry`;
          const e = checkExpiry(v[dateField], doc.toUpperCase(), `${v.brand} ${v.model} (${v.plate})`, v.id);
          if (e) expiring.push(e);
        });
      });
      drivers.forEach(d => {
        ['license', 'medical_certificate', 'tachograph_card'].forEach(doc => {
          const dateField = `${doc}_expiry`;
          const e = checkExpiry(d[dateField], doc === 'license' ? 'Permis' : doc === 'medical_certificate_expiry' ? 'Medical' : 'Tahograf', d.name, d.id);
          if (e) expiring.push(e);
        });
      });
      setExpiringDocs(expiring);
      setStats(s => ({ ...s, alerts: expiring.length }));

      // Chart data: trips by status
      const statusCounts = {};
      trips.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });
      const statusLabels = { planificata: 'Planif.', alocata: 'Alocată', incarcata: 'Încărcată', in_tranzit: 'Tranzit', livrata: 'Livrată', problema: 'Problemă', anulata: 'Anulată' };
      setChartData(Object.entries(statusCounts).map(([k, v]) => ({ name: statusLabels[k] || k, count: v })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Vedere de ansamblu asupra activității de transport</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Truck} label="Vehicule" value={stats.vehicles} subtitle="Total în flotă" accent="primary" />
        <KpiCard icon={Users} label="Șoferi" value={stats.drivers} subtitle="Activi" accent="secondary" />
        <KpiCard icon={Route} label="Curse active" value={stats.activeTrips} subtitle="În desfășurare" accent="accent" />
        <KpiCard icon={AlertTriangle} label="Alerte" value={stats.alerts} subtitle="Documente expirate" accent={stats.alerts > 0 ? 'danger' : 'success'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#0A2B4E]">Curse după status</h2>
            <TrendingUp className="w-4 h-4 text-slate-400" />
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Bar dataKey="count" fill="#1D4E89" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">Nu există date</div>
          )}
        </div>

        {/* Expiring documents */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#0A2B4E]">Documente expirate</h2>
            <Link to="/documents" className="text-xs text-[#1D4E89] hover:underline">Vezi toate</Link>
          </div>
          {expiringDocs.length > 0 ? (
            <div className="space-y-3 max-h-[280px] overflow-y-auto">
              {expiringDocs.slice(0, 8).map((doc, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${doc.expired ? 'bg-red-100' : 'bg-amber-100'}`}>
                    <AlertTriangle className={`w-4 h-4 ${doc.expired ? 'text-red-600' : 'text-amber-600'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{doc.name}</p>
                    <p className="text-xs text-slate-500">{doc.type} · expiră {doc.date ? new Date(doc.date).toLocaleDateString('ro-RO') : '-'}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm text-center">
              <div>
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-2">
                  <Truck className="w-5 h-5 text-emerald-500" />
                </div>
                Toate documentele sunt valide
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent trips */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="font-semibold text-[#0A2B4E]">Curse recente</h2>
          <Link to="/trips" className="text-xs text-[#1D4E89] hover:underline">Vezi toate cursele</Link>
        </div>
        {recentTrips.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="text-left font-medium px-6 py-3">CMR</th>
                  <th className="text-left font-medium px-6 py-3">Șofer</th>
                  <th className="text-left font-medium px-6 py-3">Vehicul</th>
                  <th className="text-left font-medium px-6 py-3">Traseu</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentTrips.map(trip => (
                  <tr key={trip.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-medium text-[#0A2B4E]">{trip.cmr_number || '-'}</td>
                    <td className="px-6 py-3 text-slate-600">{trip.driver_name || '-'}</td>
                    <td className="px-6 py-3 text-slate-600">{trip.vehicle_plate || '-'}</td>
                    <td className="px-6 py-3 text-slate-600 max-w-xs truncate">
                      <span className="line-clamp-1">{trip.shipper_name} → {trip.consignee_name}</span>
                    </td>
                    <td className="px-6 py-3"><StatusBadge status={trip.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400">
            <Route className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nu există curse. <Link to="/trips" className="text-[#1D4E89] hover:underline">Creează prima cursă</Link></p>
          </div>
        )}
      </div>
    </div>
  );
}