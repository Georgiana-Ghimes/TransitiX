import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { User, Mail, Phone, LogOut, Truck, CheckCircle, Clock, Bell } from 'lucide-react';

export default function DriverProfile() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ total: 0, completed: 0, active: 0 });
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
    base44.entities.Trip.list('-created_date', 100).then(trips => {
      setStats({
        total: trips.length,
        completed: trips.filter(t => t.status === 'livrata').length,
        active: trips.filter(t => ['alocata', 'incarcata', 'in_tranzit'].includes(t.status)).length,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await base44.auth.logout('/login');
  };

  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || user?.email?.[0]?.toUpperCase() || 'Ș';

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-[#0A2B4E] text-lg">Profil</h2>

      {/* Profile card */}
      <div className="bg-[#0A2B4E] rounded-xl shadow-sm p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#F5A623] flex items-center justify-center text-2xl font-bold text-[#0A2B4E]">
            {initials}
          </div>
          <div>
            <p className="font-bold text-lg">{user?.full_name || 'Șofer'}</p>
            <p className="text-sm text-white/60">{user?.email || ''}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium bg-white/20 rounded-full">Rol: {user?.role || 'user'}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
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

      {/* Settings */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Bell className="w-4 h-4 text-slate-500" /></div>
            <div>
              <p className="text-sm font-medium text-slate-700">Notificări</p>
              <p className="text-xs text-slate-400">Primește alerte pentru curse noi</p>
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
          <div><p className="text-sm font-medium text-slate-700">Telefon</p><p className="text-xs text-slate-400">{user?.phone || '—'}</p></div>
        </div>
      </div>

      {/* Logout */}
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