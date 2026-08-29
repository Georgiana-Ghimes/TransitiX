import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import KpiCard from '@/components/KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { Truck, Users, Route, AlertTriangle, TrendingUp, Clock, Coins, MapPinned } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { notifyError } from '@/lib/notify';
import { collectExpiringDocuments, expiryHorizonDays } from '@/lib/documentExpiry';

function fmtPct(v) {
  if (v == null) return '—';
  return `${Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%`;
}

function fmtNum(v, suffix = '') {
  if (v == null) return '—';
  return `${Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 1 })}${suffix}`;
}

export default function Dashboard() {
  const [stats, setStats] = useState({ vehicles: 0, drivers: 0, activeTrips: 0, alerts: 0 });
  const [cockpit, setCockpit] = useState(null);
  const [recentTrips, setRecentTrips] = useState([]);
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [vehicles, drivers, trips, cockpitRes, company] = await Promise.all([
        api.entities.Vehicle.list(),
        api.entities.Driver.list(),
        api.entities.Trip.list('-created_date', 50),
        api.analytics.cockpit().catch(() => null),
        api.company.get().catch(() => null),
      ]);
      setCockpit(cockpitRes);

      const activeTrips = trips.filter(t => !['livrata', 'anulata'].includes(t.status));
      setStats({
        vehicles: vehicles.length,
        drivers: drivers.filter(d => d.is_active).length,
        activeTrips: activeTrips.length,
        alerts: 0,
      });
      setRecentTrips(trips.slice(0, 6));

      const expiring = collectExpiringDocuments({
        vehicles,
        drivers,
        horizonDays: expiryHorizonDays(company),
      }).map((doc) => ({ ...doc, id: doc.entityId, name: doc.entity }));
      setExpiringDocs(expiring);
      setStats(s => ({ ...s, alerts: expiring.length }));

      // Chart data: always show full status axis so a single bar doesn't stretch.
      const statusOrder = ['planificata', 'alocata', 'incarcata', 'in_tranzit', 'livrata', 'problema', 'anulata'];
      const statusLabels = {
        planificata: 'Planif.',
        alocata: 'Alocată',
        incarcata: 'Încărcată',
        in_tranzit: 'Tranzit',
        livrata: 'Livrată',
        problema: 'Problemă',
        anulata: 'Anulată',
      };
      const statusCounts = Object.fromEntries(statusOrder.map((k) => [k, 0]));
      trips.forEach((t) => {
        if (t.status in statusCounts) statusCounts[t.status] += 1;
        else statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      });
      setChartData(
        Object.entries(statusCounts).map(([k, v]) => ({
          name: statusLabels[k] || k,
          count: v,
        }))
      );
    } catch (e) {
      console.error(e);
      notifyError('Dashboard-ul nu s-a încărcat', e);
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
    <div data-tour-dashboard className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[#0A2B4E] tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Vedere de ansamblu asupra activității de transport</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Truck} label="Vehicule" value={stats.vehicles} subtitle="Total în flotă" accent="primary" to="/vehicles" />
        <KpiCard icon={Users} label="Șoferi" value={stats.drivers} subtitle="Activi" accent="secondary" to="/drivers" />
        <KpiCard icon={Route} label="Curse active" value={stats.activeTrips} subtitle="În desfășurare" accent="accent" to="/trips" />
        <KpiCard icon={AlertTriangle} label="Alerte" value={stats.alerts} subtitle="Documente expirate" accent={stats.alerts > 0 ? 'danger' : 'success'} to="/documents" />
      </div>

      {cockpit?.kpis && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-[#0A2B4E]">Cockpit operațional</h2>
            <p className="text-xs text-slate-400">
              {cockpit.from} → {cockpit.to}
              {cockpit.kpis.routes != null ? ` · ${cockpit.kpis.routes} rute` : ''}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Clock}
              label="Punctualitate"
              value={fmtPct(cockpit.kpis.punctuality_pct)}
              subtitle={
                cockpit.kpis.punctuality_sample
                  ? `${cockpit.kpis.punctuality_sample} opriri măsurate`
                  : 'Fără sosiri reale încă'
              }
              accent="success"
            />
            <KpiCard
              icon={MapPinned}
              label="Km plan vs real"
              value={fmtNum(cockpit.kpis.actual_km, ' km')}
              subtitle={`Plan ${fmtNum(cockpit.kpis.planned_km)} · Δ ${fmtNum(cockpit.kpis.delta_km)}`}
              accent="primary"
              to="/dispatch"
            />
            <KpiCard
              icon={Coins}
              label="Cost estimat"
              value={cockpit.kpis.cost_total != null ? `${fmtNum(cockpit.kpis.cost_total)} lei` : '—'}
              subtitle={
                cockpit.kpis.cost_per_route != null
                  ? `~${fmtNum(cockpit.kpis.cost_per_route)} lei / rută`
                  : 'Completează costurile pe vehicul'
              }
              accent="accent"
              to="/vehicles"
            />
            <KpiCard
              icon={TrendingUp}
              label="Comenzi"
              value={cockpit.kpis.orders_delivered ?? 0}
              subtitle={`${cockpit.kpis.orders_open ?? 0} deschise în perioadă`}
              accent="secondary"
              to="/dispatch"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-4 sm:p-6 shadow-sm min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#0A2B4E]">Curse după status</h2>
            <TrendingUp className="w-4 h-4 text-slate-400" />
          </div>
          {chartData.length > 0 ? (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[280px] h-[240px] sm:h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="18%" margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Bar dataKey="count" fill="#1D4E89" radius={[6, 6, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="h-[240px] sm:h-[280px] flex items-center justify-center text-slate-400 text-sm">Nu există date</div>
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
          <>
            <div className="md:hidden divide-y divide-slate-100">
              {recentTrips.map((trip) => (
                <Link key={trip.id} to={`/trips/${trip.id}`} className="flex items-start justify-between gap-3 p-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="font-medium text-[#0A2B4E] truncate">{trip.cmr_number || '-'}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{trip.shipper_name} → {trip.consignee_name}</p>
                    <p className="text-xs text-slate-400 mt-1">{[trip.driver_name, trip.vehicle_plate].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <StatusBadge status={trip.status} />
                </Link>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
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
                      <td className="px-6 py-3 font-medium text-[#0A2B4E]"><Link to={`/trips/${trip.id}`} className="hover:underline">{trip.cmr_number || '-'}</Link></td>
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
          </>
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