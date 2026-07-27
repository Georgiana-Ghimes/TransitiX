import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bell, CheckCircle, Truck, AlertTriangle, Info, CheckCheck, Loader2 } from 'lucide-react';

const TYPE_CONFIG = {
  trip_assigned: { icon: Truck, color: 'bg-blue-50 text-blue-600', label: 'Cursă nouă' },
  status_update: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600', label: 'Status' },
  system: { icon: Info, color: 'bg-slate-50 text-slate-500', label: 'Sistem' },
  warning: { icon: AlertTriangle, color: 'bg-amber-50 text-amber-600', label: 'Atenție' },
};

export default function DriverNotifications({ onRead }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifications(); }, []);

  const loadNotifications = async () => {
    try {
      const data = await base44.entities.DriverNotification.list('-created_date', 50);
      setNotifications(data);
      // Seed initial notifications if empty
      if (data.length === 0) {
        await base44.entities.DriverNotification.bulkCreate([
          { title: 'Curse noi disponibile', message: 'Ați primit 3 curse noi pentru săptămâna aceasta. Verificați fila Curse.', type: 'trip_assigned', is_read: false },
          { title: 'Document expirare', message: 'Permisul de conducere expiră în 30 de zile. Vă rugăm să îl reînnoiți.', type: 'warning', is_read: false },
          { title: 'Card tahograf', message: 'Cardul tahograf expiră pe 15 august 2026. Programați o vizită pentru reînnoire.', type: 'warning', is_read: true },
        ]);
        const fresh = await base44.entities.DriverNotification.list('-created_date', 50);
        setNotifications(fresh);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const markAsRead = async (id) => {
    await base44.entities.DriverNotification.update(id, { is_read: true });
    loadNotifications();
    if (onRead) onRead();
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.is_read);
    if (unread.length === 0) return;
    await base44.entities.DriverNotification.bulkUpdate(unread.map(n => ({ id: n.id, is_read: true })));
    loadNotifications();
    if (onRead) onRead();
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>;

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-[#0A2B4E] text-lg">Notificări {unreadCount > 0 && <span className="text-xs font-medium text-white bg-red-500 rounded-full px-2 py-0.5 ml-1">{unreadCount}</span>}</h2>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-[#1D4E89] hover:underline">
            <CheckCheck className="w-3.5 h-3.5" /> Marchează tot
          </button>
        )}
      </div>

      {notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map(n => {
            const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.system;
            const Icon = cfg.icon;
            return (
              <button
                key={n.id}
                onClick={() => !n.is_read && markAsRead(n.id)}
                className={`w-full text-left flex items-start gap-3 p-4 rounded-xl border shadow-sm transition-all ${n.is_read ? 'bg-white border-slate-200' : 'bg-blue-50/50 border-blue-200'}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-800 text-sm">{n.title}</p>
                    {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>
                  {n.cmr_number && <p className="text-xs text-[#1D4E89] mt-1">CMR: {n.cmr_number}</p>}
                  <p className="text-xs text-slate-400 mt-1">{n.created_date ? new Date(n.created_date).toLocaleString('ro-RO') : ''}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 shadow-sm">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nu aveți notificări.</p>
        </div>
      )}
    </div>
  );
}