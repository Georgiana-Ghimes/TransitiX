import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import {
  Bell, CheckCheck, Loader2, Truck, FileText, CheckCircle,
  AlertTriangle, Info, UserX, Trash2,
} from 'lucide-react';

const TYPE_CONFIG = {
  trip_status: { icon: Truck, color: 'bg-emerald-50 text-emerald-600' },
  trip_problem: { icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
  trip_unassigned: { icon: UserX, color: 'bg-amber-50 text-amber-600' },
  cmr_pending: { icon: FileText, color: 'bg-blue-50 text-blue-600' },
  driver_upload: { icon: FileText, color: 'bg-sky-50 text-sky-700' },
  client_confirmed: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
  client_damage: { icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
  document_expiry: { icon: AlertTriangle, color: 'bg-amber-50 text-amber-600' },
  route_exception: { icon: AlertTriangle, color: 'bg-orange-50 text-orange-600' },
  // Only the errors from `/checks` reach the bell — the ones that end in a wrong invoice.
  data_issue: { icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
  system: { icon: Info, color: 'bg-slate-50 text-slate-500' },
};

/** Badge / list refresh while the office tab is open. Hidden tabs do not poll. */
const POLL_MS = 15_000;
/** Slightly faster while the dropdown is open so a new upload shows up in-list. */
const POLL_OPEN_MS = 8_000;

function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'acum';
  if (mins < 60) return `acum ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `acum ${hours} h`;
  return d.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readCount, setReadCount] = useState(0);

  const loadInbox = async () => {
    try {
      const data = await api.notifications.inbox();
      setItems(data.items || []);
      setUnreadCount(data.unread_count || 0);
      setReadCount(data.read_count || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Poll while the tab is visible; pause in background to spare the API.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      loadInbox();
    };
    tick();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(tick, open ? POLL_OPEN_MS : POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = async (item) => {
    if (!item.is_read) {
      try {
        await api.notifications.markRead(item.id);
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch (e) {
        console.error(e);
      }
    }
    setOpen(false);
    if (item.link) navigate(item.link);
    loadInbox();
  };

  const markAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      await loadInbox();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteRead = async () => {
    try {
      await api.notifications.deleteRead();
      await loadInbox();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors"
        aria-label="Notificări"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-3 right-3 top-[4.25rem] z-[60] max-h-[min(28rem,calc(100dvh-5rem))] overflow-hidden bg-white rounded-xl shadow-xl border border-slate-200 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(22rem,calc(100vw-2rem))] sm:max-h-96">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-[#0A2B4E] text-sm shrink-0">Notificări</h3>
            <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
              {readCount > 0 && (
                <button
                  type="button"
                  onClick={deleteRead}
                  className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Șterge citite
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs font-medium text-[#1D4E89] hover:underline"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Marchează tot
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto max-h-[min(22rem,calc(100dvh-9rem))] sm:max-h-80">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
              </div>
            ) : items.length > 0 ? (
              items.map((item) => {
                const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.system;
                const Icon = cfg.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleClick(item)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      !item.is_read ? 'bg-blue-50/40' : 'opacity-75'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium leading-snug ${item.is_read ? 'text-slate-500' : 'text-slate-800'}`}>
                          {item.title}
                        </p>
                        {!item.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.message}</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {formatWhen(item.created_at || item.created_date)}
                      </p>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="py-10 text-center text-slate-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nu aveți notificări.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
