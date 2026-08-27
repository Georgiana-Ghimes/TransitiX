import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { isActiveTripStatus } from '@/lib/utils';
import { formatAppVersion } from '@/lib/appVersion';
import { Truck, CheckCircle, Clock, Mail, Phone, LogOut } from 'lucide-react';

export default function DriverProfile({ driver: driverProp, trips: tripsProp }) {
  const { logout } = useAuth();
  const [user, setUser] = useState(null);
  const [trips, setTrips] = useState(tripsProp || []);
  const [loading, setLoading] = useState(!tripsProp);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    api.auth.me().then((u) => setUser(u)).catch(() => {});
    if (!tripsProp) {
      api.entities.Trip.list('-created_date', 100).then(setTrips).catch(() => {}).finally(() => setLoading(false));
    } else {
      setTrips(tripsProp);
      setLoading(false);
    }
  }, [tripsProp]);

  const stats = useMemo(() => ({
    total: trips.length,
    completed: trips.filter((t) => t.status === 'livrata').length,
    active: trips.filter((t) => isActiveTripStatus(t.status)).length,
  }), [trips]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      logout(true);
    } catch {
      await api.auth.logout('/login');
    }
  };

  const displayName = user?.full_name || user?.name || driverProp?.name || 'Șofer';
  const initials = displayName.split(' ').map((n) => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
    || user?.email?.[0]?.toUpperCase()
    || 'Ș';

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="bg-[#0A2B4E] rounded-xl shadow-sm p-4 sm:p-6 text-white">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 rounded-full bg-[#F5A623] flex items-center justify-center text-xl sm:text-2xl font-bold text-[#0A2B4E]">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-base sm:text-lg truncate">{displayName}</p>
            <p className="text-xs sm:text-sm text-white/60 truncate">{user?.email || ''}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-[11px] sm:text-xs font-medium bg-white/20 rounded-full">
              Rol: {user?.role || 'driver'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { icon: Truck, color: 'text-[#1D4E89]', value: stats.total, label: 'Total' },
          { icon: CheckCircle, color: 'text-emerald-500', value: stats.completed, label: 'Livrate' },
          { icon: Clock, color: 'text-amber-500', value: stats.active, label: 'Active' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-3 sm:p-4 text-center min-w-0"
            >
              <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${s.color} mx-auto mb-1`} />
              <p className="text-xl sm:text-2xl font-bold text-[#0A2B4E] tabular-nums">
                {loading ? '—' : s.value}
              </p>
              <p className="text-[10px] sm:text-xs text-slate-400 truncate">{s.label}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm divide-y divide-slate-100">
        <div className="flex items-center gap-3 p-3.5 sm:p-4 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center">
            <Mail className="w-4 h-4 text-slate-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">Email</p>
            <p className="text-xs text-slate-400 truncate">{user?.email || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3.5 sm:p-4 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center">
            <Phone className="w-4 h-4 text-slate-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">Telefon</p>
            <p className="text-xs text-slate-400 truncate">{driverProp?.phone || user?.phone || '—'}</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="flex items-center justify-center gap-2 w-full min-h-[48px] px-5 py-3 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-60"
      >
        <LogOut className="w-5 h-5 shrink-0" />
        {loggingOut ? 'Se deconectează…' : 'Deconectare'}
      </button>

      <p className="text-center text-[11px] sm:text-xs text-slate-400 pt-1 pb-1">
        Transitix Driver App {formatAppVersion()}
      </p>
    </div>
  );
}
