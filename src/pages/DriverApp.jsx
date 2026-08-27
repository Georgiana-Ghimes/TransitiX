import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import DriverProfile from '@/components/driver/DriverProfile';
import DriverUploadDocuments from '@/components/driver/DriverUploadDocuments';
import { findDriverForUser } from '@/lib/utils';
import { Upload, User } from 'lucide-react';

/** Shared column: phone → tablet → fold / Surface without looking like a thin strip. */
const SHELL =
  'w-full max-w-[28rem] sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl mx-auto';

/**
 * Slim driver shell: upload road documents + profile.
 * Sized for Chrome device presets (iPhone SE → iPad Pro / Fold / Surface).
 */
export default function DriverApp() {
  const { user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [driver, setDriver] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('upload');

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    setLoading(true);
    try {
      const me = authUser || await api.auth.me();
      setUser(me);
      const drivers = await api.entities.Driver.list().catch(() => []);
      const myDriver = findDriverForUser(drivers, me);
      setDriver(myDriver);

      if (myDriver) {
        const scoped = await api.entities.Trip.filter(
          { driver_id: myDriver.id },
          '-created_date',
          50
        ).catch(() => []);
        setTrips(Array.isArray(scoped) ? scoped : []);
      } else {
        setTrips([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
      </div>
    );
  }

  const initials =
    (user?.full_name || user?.name || 'Ș')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const title = tab === 'profile' ? 'Profil' : 'Încarcă documente';

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-[#F8F9FA]">
      <header
        className="sticky top-0 z-20 border-b border-white/10 bg-[#0A2B4E] text-white"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div
          className={`${SHELL} flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4`}
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div className="min-w-0">
            <p className="text-[11px] sm:text-xs text-white/60">Aplicație Șofer</p>
            <p className="font-bold text-base sm:text-lg truncate">{title}</p>
          </div>
          <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-full bg-[#F5A623] text-[#0A2B4E] flex items-center justify-center font-semibold text-sm">
            {initials}
          </div>
        </div>
      </header>

      <main
        className={`${SHELL} w-full flex-1 px-4 pt-4 sm:px-5 sm:pt-5`}
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
          paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {tab === 'profile' ? (
          <DriverProfile driver={driver} trips={trips} />
        ) : (
          <DriverUploadDocuments user={user} />
        )}
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className={`${SHELL} grid grid-cols-2`}
          style={{
            paddingLeft: 'max(0px, env(safe-area-inset-left))',
            paddingRight: 'max(0px, env(safe-area-inset-right))',
          }}
        >
          {[
            { key: 'upload', icon: Upload, label: 'Încarcă documente' },
            { key: 'profile', icon: User, label: 'Profil' },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 py-2 sm:min-h-[3.5rem] ${
                  active ? 'text-[#0A2B4E]' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0 sm:h-[1.35rem] sm:w-[1.35rem]" strokeWidth={active ? 2.25 : 2} />
                <span className="max-w-[9.5rem] truncate px-1 text-[10px] font-medium leading-tight sm:max-w-none sm:text-[11px]">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
