import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { isActiveTripStatus } from '@/lib/utils';
import { Mail, Phone, LogOut, Truck, CheckCircle, Clock, Bell } from 'lucide-react';

export default function DriverProfile({ driver: driverProp, trips: tripsProp }) {
  const [user, setUser] = useState(null);
  const [trips, setTrips] = useState(tripsProp || []);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [loading, setLoading] = useState(!tripsProp);

  useEffect(() => {
    api.auth.me().then(u => setUser(u)).catch(() => {});
    if (!tripsProp) {
      api.entities.Trip.list('-created_date', 100).then(setTrips).catch(() => {}).finally(() => setLoading(false));
    } else {
      setTrips(tripsProp);
      setLoading(false);
    }
  }, [tripsProp]);

  const stats = useMemo(() => ({
    total: trips.length,
    completed: trips.filter(t => t.status === 'livrata').length,
    active: trips.filter(t => isActiveTripStatus(t.status)).length,
  }), [trips]);

  const handleLogout = async () => {
    await api.auth.logout('/login');
  };

  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    || user?.email?.[0]?.toUpperCase()
    || 'Ș';

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-[#0A2B4E] text-lg">Profil</h2>

      <div className="bg-[#0A2B4E] rounded-xl shadow-sm p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#F5A623] flex items-center justify-center text-2xl font-bold text-[#0A2B4E]">
            {initials}
          </div>
          <div>
            <p className="font-bold text-lg">{user?.full_name || driverProp?.name || 'Șofer'}</p>
            <p className="text-sm text-white/60">{user?.email || ''}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-white/20 rounded-full">
              Rol: {user?.role || 'driver'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <Truck className="w-5 h-5 text-[#1D4E89] mx-auto mb-1" />
          <p className="text-2xl font-bold text-[#0A2B4E]">{loading ? '—' : stats.total}</p>
          <p className="text-xs text-slate-400">Total curse</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-[#0A2B4E]">{loading ? '—' : stats.completed}</p>
          <p className="text-xs text-slate-400">Livrate</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <Clock className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-[#0A2B4E]">{loading ? '—' : stats.active}</p>
          <p className="text-xs text-slate-400">Active</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Bell className="w-4 h-4 text-slate-500" /></div>
            <div>
              <p className="text-sm font-medium text-slate-700">Notificări</p>
              <p className="text-xs text-slate-400">Alerte pentru curse noi</p>
            </div>
          </div>
          <button
            onClick={() => setNotifEnabled(!notifEnabled)}
            className={`relative w-11 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-[#27AE60]' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Mail className="w-4 h-4 text-slate-500" /></div>
          <div><p className="text-sm font-medium text-slate-700">Email</p><p className="text-xs text-slate-400">{user?.email || '-'}</p></div>
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Phone className="w-4 h-4 text-slate-500" /></div>
          <div><p className="text-sm font-medium text-slate-700">Telefon</p><p className="text-xs text-slate-400">{driverProp?.phone || user?.phone || '—'}</p></div>
        </div>
      </div>

      <button
        onClick={handleLogout}
        className="flex items-center justify-center gap-2 w-full px-5 py-3 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors"
      >
        <LogOut className="w-5 h-5" /> Deconectare
      </button>

      <p className="text-center text-xs text-slate-400 pt-2">Transitix Driver App v1.0</p>
    </div>
  );
}
