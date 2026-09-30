import React, { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import DriverProfile from '@/components/driver/DriverProfile';
import DriverUploadDocuments from '@/components/driver/DriverUploadDocuments';
import { findDriverForUser } from '@/lib/utils';
import { HelpCircle, Upload, User } from 'lucide-react';
import GuideView from '@/components/GuideView';
import { DRIVER_GUIDE } from '@/lib/guide';
import {
  DRIVER_MAIN_PAD_BOTTOM,
  DRIVER_SHELL,
  driverNavBtn,
  driverNavIcon,
  driverNavLabel,
} from '@/lib/driverUi';

/**
 * The driver shell for the documents companion: send paperwork, see your profile.
 *
 * Deliberately not the full driver app, the companion's job is the document queue, and a
 * driver on it has no routes to execute. `DriverApp.jsx` remains the Transitix one.
 * Sized for Chrome device presets and large system text / display (~150–200%).
 */
export default function DriverAppDocuments() {
  const { user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [driver, setDriver] = useState(null);
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
      // No trip list here: the companion does not dispatch trips, and the profile no longer
      // shows trip counts. Fetching 50 rows over a cab's connection to render nothing is a
      // cost the driver pays for us.
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

  const TITLES = { profile: 'Profil', ghid: 'Ghid', upload: 'Documente' };
  const title = TITLES[tab] || TITLES.upload;

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-[#F8F9FA]">
      <header
        className="sticky top-0 z-20 border-b border-white/10 bg-[#0A2B4E] text-white"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div
          className={`${DRIVER_SHELL} flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5 sm:py-4`}
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div className="min-w-0">
            <p className="text-sm text-white/70">Aplicație Șofer</p>
            <p className="font-bold text-lg sm:text-xl leading-snug break-words">{title}</p>
          </div>
          <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full bg-[#F5A623] text-[#0A2B4E] flex items-center justify-center font-semibold text-base">
            {initials}
          </div>
        </div>
      </header>

      <main
        className={`${DRIVER_SHELL} w-full flex-1 px-4 pt-4 sm:px-5 sm:pt-5`}
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
          paddingBottom: DRIVER_MAIN_PAD_BOTTOM,
        }}
      >
        {tab === 'profile' && <DriverProfile driver={driver} />}
        {tab === 'ghid' && <GuideView guide={DRIVER_GUIDE} />}
        {tab === 'upload' && <DriverUploadDocuments user={user} />}
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className={`${DRIVER_SHELL} grid grid-cols-3`}
          style={{
            paddingLeft: 'max(0px, env(safe-area-inset-left))',
            paddingRight: 'max(0px, env(safe-area-inset-right))',
          }}
        >
          {[
            { key: 'upload', icon: Upload, label: 'Documente' },
            { key: 'ghid', icon: HelpCircle, label: 'Ghid' },
            { key: 'profile', icon: User, label: 'Profil' },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`${driverNavBtn} ${
                  active ? 'text-[#0A2B4E]' : 'text-slate-400'
                }`}
              >
                <Icon className={driverNavIcon} strokeWidth={active ? 2.25 : 2} />
                <span className={driverNavLabel}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
