import React, { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import {
  LayoutDashboard, Truck, Users, Route, FileText, Wallet,
  UserCircle, LogOut, Menu, X, Building2, MapPin, Brain, Package,
  ChevronsLeft, ChevronsRight, Boxes, ClipboardList, FileSpreadsheet, HelpCircle, LayoutGrid,
  MapPinned, Network, Layers, Receipt, ShieldCheck, History, UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAppVersion } from '@/lib/appVersion';
import { homePathForRole, isDriverRole } from '@/lib/roles';
import {
  companionTagline,
  isCompanionOfficePath,
  isDocumentsProfile,
} from '@/lib/appProfile';
import {
  OFFICE_TOUR_STEPS,
  clampTourStep,
  hasSeenOfficeTour,
  markOfficeTourSeen,
  tourNavHighlightPath,
  tourMobileHighlightMenuButton,
} from '@/lib/officeTour';
import NotificationBell from '@/components/NotificationBell';
import GlobalSearch from '@/components/GlobalSearch';
import OfficeTour from '@/components/OfficeTour';
import ErrorBoundary from '@/components/ErrorBoundary';
import BrandLogo from '@/components/BrandLogo';

const NAV = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Dispecerat', path: '/dispatch', icon: Network },
  { label: 'Încărcare', path: '/loading', icon: Boxes },
  { label: 'Plan 2D', path: '/load-planner', icon: LayoutGrid },
  { label: 'Curse', path: '/trips', icon: Route },
  { label: 'Flotă', path: '/vehicles', icon: Truck },
  { label: 'Șoferi', path: '/drivers', icon: Users },
  { label: 'Locații', path: '/locations', icon: MapPinned },
  { label: 'Teritorii', path: '/territories', icon: Layers },
  { label: 'Tracking GPS', path: '/gps', icon: MapPin },
  { label: 'Planning AI', path: '/planning', icon: Brain },
  { label: 'Clienți', path: '/clients', icon: Building2 },
  { label: 'Financiar', path: '/finance', icon: Wallet },
  { label: 'Depozit', path: '/warehouse', icon: Package },
  { label: 'Documente', path: '/documents', icon: FileText },
  { label: 'Avize / Rapoarte', path: '/avize', icon: ClipboardList },
  { label: 'Rapoarte', path: '/reports', icon: FileSpreadsheet },
  { label: 'Verificări date', path: '/checks', icon: ShieldCheck },
  { label: 'Config. comercială', path: '/commercial', icon: Receipt },
  // Admin-only: the searchable log answers "what has this person been doing", which is an
  // owner's question. The per-record trail behind it stays open to the whole office.
  { label: 'Utilizatori', path: '/users', icon: UserCog, roles: ['admin'] },
  { label: 'Jurnal modificări', path: '/audit', icon: History, roles: ['admin'] },
];

const COMPANION_OFFICE_NAV = [
  { label: 'Avize / Rapoarte', path: '/avize', icon: ClipboardList },
  { label: 'Rapoarte', path: '/reports', icon: FileSpreadsheet },
];

const SIDEBAR_COLLAPSED_KEY = 'transitix_sidebar_collapsed';
const SIDEBAR_EXPANDED = 256;
const SIDEBAR_RAIL = 72;

const TOUR_NAV_HIGHLIGHT = 'ring-2 ring-[#F5A623] ring-offset-2 ring-offset-[#0A2B4E] bg-white/10 text-white relative z-10';

function useDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return desktop;
}

function tourAtPath(pathname, tourPath) {
  if (!tourPath) return false;
  if (tourPath === '/') return pathname === '/';
  return pathname === tourPath || pathname.startsWith(`${tourPath}/`);
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDriver = isDriverRole(user);
  const documentsCompanion = isDocumentsProfile();
  const navItems = documentsCompanion ? COMPANION_OFFICE_NAV : NAV;
  const isDesktop = useDesktop();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const tourCurrent = tourOpen ? OFFICE_TOUR_STEPS[clampTourStep(tourStep)] : null;
  const tourNavPath = tourOpen ? tourNavHighlightPath(tourCurrent) : null;
  const tourHighlightGhid = tourCurrent?.highlightTarget === 'ghid';
  const tourHighlightDashboard = tourCurrent?.highlightTarget === 'dashboard';

  // Office tour is for the full sidebar app only — never driver or documents companion.
  useEffect(() => {
    if (isDriver || documentsCompanion) {
      setTourOpen(false);
      return;
    }
    if (!hasSeenOfficeTour()) {
      setTourStep(0);
      setTourOpen(true);
    }
  }, [isDriver, documentsCompanion]);

  // Navigate when the tour *step* changes — not whenever the user leaves the step path.
  // Listening to `location.pathname` yanked every sidebar click back to the current step,
  // so the rest of the app looked broken (and racing lazy loads could surface ErrorBoundary).
  useEffect(() => {
    if (isDriver || !tourOpen) return;
    const current = OFFICE_TOUR_STEPS[clampTourStep(tourStep)];
    if (current.path && !tourAtPath(location.pathname, current.path)) {
      navigate(current.path);
    }
    // intentionally omit location.pathname — user may explore freely during the tour
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [isDriver, tourOpen, tourStep, navigate]);

  // Desktop: open drawer for nav steps; mobile keeps drawer closed (sheet explains ☰).
  useEffect(() => {
    if (isDriver || !tourOpen || !isDesktop) return;
    if (tourHighlightDashboard) setMobileOpen(false);
    else if (tourNavPath || tourHighlightGhid) setMobileOpen(true);
  }, [isDriver, tourOpen, tourStep, isDesktop, tourHighlightDashboard, tourNavPath, tourHighlightGhid]);

  useEffect(() => {
    if (isDriver || !tourOpen || isDesktop) return;
    setMobileOpen(false);
  }, [isDriver, tourOpen, tourStep, isDesktop]);

  // Desktop-only spotlight on sidebar nav or dashboard content.
  useEffect(() => {
    if (isDriver || !tourOpen || !isDesktop) return;
    const current = OFFICE_TOUR_STEPS[clampTourStep(tourStep)];
    const id = requestAnimationFrame(() => {
      document.querySelectorAll('[data-tour-dashboard]').forEach((el) => {
        el.classList.toggle('tour-content-highlight', current.highlightTarget === 'dashboard');
      });
      if (current.highlightTarget === 'ghid') {
        document.querySelector('[data-tour-ghid]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (current.highlightTarget === 'dashboard') {
        document.querySelector('[data-tour-dashboard]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else if (tourNavHighlightPath(current)) {
        document.querySelector(`[data-tour-nav="${current.path}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    return () => {
      cancelAnimationFrame(id);
      document.querySelectorAll('[data-tour-dashboard]').forEach((el) => {
        el.classList.remove('tour-content-highlight');
      });
    };
  }, [isDriver, tourOpen, tourStep, isDesktop]);

  // Mobile: ring the ☰ button when the step refers to the menu.
  useEffect(() => {
    if (isDriver || !tourOpen || isDesktop) return;
    const current = OFFICE_TOUR_STEPS[clampTourStep(tourStep)];
    const btn = document.querySelector('[data-tour-mobile-menu]');
    if (!btn) return;
    btn.classList.toggle('tour-mobile-menu-highlight', tourMobileHighlightMenuButton(current));
    return () => btn.classList.remove('tour-mobile-menu-highlight');
  }, [isDriver, tourOpen, tourStep, isDesktop]);

  const closeTour = () => {
    markOfficeTourSeen();
    setTourOpen(false);
  };

  const openTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  const handleLogout = async () => {
    await api.auth.logout();
  };

  const isActive = (path) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
  const displayName = user?.full_name || user?.name || user?.email || 'Utilizator';
  const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = { admin: 'Admin', dispatcher: 'Dispecer', driver: 'Șofer', finance: 'Finance' }[user?.role] || user?.role || '';

  const showIconsOnly = isDesktop && collapsed;
  const sidebarWidth = isDesktop
    ? (collapsed ? SIDEBAR_RAIL : SIDEBAR_EXPANDED)
    : SIDEBAR_EXPANDED;

  if (isDriver) {
    if (location.pathname !== '/driver-app') {
      return <Navigate to={homePathForRole(user)} replace />;
    }
    // The companion's slim shell draws its own padding and safe-areas; the full driver app
    // still expects the outer gutter it was built with.
    return (
      <div className="min-h-[100dvh] bg-[#F8F9FA]">
        {documentsCompanion ? (
          <ErrorBoundary label={location.pathname} resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        ) : (
          <main className="p-4 lg:p-6">
            <ErrorBoundary label={location.pathname} resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        )}
      </div>
    );
  }

  if (location.pathname === '/driver-app' || location.pathname.startsWith('/driver-app/')) {
    return <Navigate to={documentsCompanion ? '/avize' : '/'} replace />;
  }

  if (documentsCompanion) {
    if (location.pathname === '/') {
      return <Navigate to="/avize" replace />;
    }
    // Dev-only tooling is reachable in either profile; the route itself does not exist in a
    // production build, so this cannot open anything for a customer.
    const devTool = import.meta.env.DEV && location.pathname.startsWith('/dev/');
    if (!devTool && !isCompanionOfficePath(location.pathname)) {
      return <Navigate to="/avize" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {!isDesktop && mobileOpen && !tourOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setMobileOpen(false)} />
      )}

      {!isDesktop && tourOpen && mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-[114]" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'h-screen bg-[#0A2B4E] text-white flex flex-col shrink-0 overflow-hidden',
          'transition-[width,transform] duration-300 ease-in-out',
          tourOpen ? 'z-50' : 'z-40',
          isDesktop
            ? 'sticky top-0 translate-x-0'
            : cn(
                'fixed top-0 left-0',
                mobileOpen ? 'translate-x-0' : '-translate-x-full'
              )
        )}
      >
        <div
          className={cn(
            'flex items-center min-h-16 border-b border-white/10 shrink-0',
            'pt-[max(0.625rem,env(safe-area-inset-top))] pb-3',
            showIconsOnly ? 'justify-center px-2' : 'gap-2.5 px-4'
          )}
        >
          <Link
            to={documentsCompanion ? '/avize' : '/'}
            title={documentsCompanion ? 'Avize / Rapoarte' : 'Dashboard'}
            onClick={() => { if (!tourOpen) setMobileOpen(false); }}
            className={cn(
              'flex items-center min-w-0',
              showIconsOnly ? 'justify-center' : 'gap-2.5 flex-1'
            )}
          >
            {showIconsOnly ? (
              <span title={documentsCompanion ? `${companionTagline()} · ${formatAppVersion()}` : `Transitix · ${formatAppVersion()}`}>
                <BrandLogo variant="mark" />
              </span>
            ) : (
              <div className="min-w-0 flex flex-col gap-0.5">
                <BrandLogo imgClassName="h-7 max-w-[10.5rem]" />
                {documentsCompanion ? (
                  <>
                    <p className="text-[11px] text-white/70 leading-snug">{companionTagline()}</p>
                    <p className="text-[10px] text-white/45 tabular-nums">{formatAppVersion()}</p>
                  </>
                ) : (
                  <p className="text-[10px] text-white/50 pl-0.5">TMS Platform</p>
                )}
              </div>
            )}
          </Link>
          {!isDesktop && (
            <button type="button" className="shrink-0 ml-auto" onClick={() => setMobileOpen(false)} aria-label="Închide meniul">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className={cn('flex-1 py-3 overflow-y-auto overflow-x-hidden', showIconsOnly ? 'px-2' : 'px-3')}>
          <ul className="space-y-1">
            {navItems.filter((item) => !item.roles || item.roles.includes(user?.role)).map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              const highlighted = isDesktop && tourOpen && tourNavPath === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    data-tour-nav={item.path}
                    title={item.demo ? `${item.label} (demo)` : item.label}
                    onClick={() => { if (!tourOpen) setMobileOpen(false); }}
                    className={cn(
                      'flex items-center rounded-lg text-sm font-medium transition-colors',
                      showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5',
                      active
                        ? 'bg-[#1D4E89] text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/5',
                      highlighted && TOUR_NAV_HIGHLIGHT
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {!showIconsOnly && <span className="truncate flex-1">{item.label}</span>}
                    {!showIconsOnly && item.demo && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-300/90 shrink-0">demo</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn('py-3 border-t border-white/10 space-y-1', showIconsOnly ? 'px-2' : 'px-3')}>
          {!documentsCompanion && (
          <button
            type="button"
            data-tour-ghid
            title="Ghid platformă"
            onClick={openTour}
            className={cn(
              'flex items-center w-full rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors',
              showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5',
              tourHighlightGhid && isDesktop && TOUR_NAV_HIGHLIGHT
            )}
          >
            <HelpCircle className="w-5 h-5 shrink-0" />
            {!showIconsOnly && <span>Ghid</span>}
          </button>
          )}
          {!documentsCompanion && (
          <Link
            to="/settings"
            title="Setări"
            onClick={() => { if (!tourOpen) setMobileOpen(false); }}
            className={cn(
              'flex items-center rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors',
              showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5'
            )}
          >
            <UserCircle className="w-5 h-5 shrink-0" />
            {!showIconsOnly && <span>Setări</span>}
          </Link>
          )}
          {!documentsCompanion && (
          <p
            title={`Transitix ${formatAppVersion()}`}
            className={cn(
              'text-white/70 tabular-nums select-none',
              showIconsOnly ? 'text-center text-[10px] pt-1' : 'px-3 pt-2 text-xs'
            )}
          >
            {formatAppVersion()}
          </p>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {tourOpen && isDesktop && (
          <div
            className="absolute inset-0 z-30 bg-black/40 pointer-events-auto"
            aria-hidden="true"
            onClick={closeTour}
          />
        )}

        <header className={cn(
          'sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 h-16 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6',
          !isDesktop && tourOpen && 'z-[118]'
        )}>
          <div className="flex items-center justify-start min-w-0 shrink-0">
            {!isDesktop ? (
              <button
                type="button"
                data-tour-mobile-menu
                className="p-2 -ml-1 rounded-lg hover:bg-slate-100"
                onClick={() => setMobileOpen(true)}
                aria-label="Deschide meniul"
              >
                <Menu className="w-5 h-5 text-slate-600" />
              </button>
            ) : (
              <button
                type="button"
                className="p-2 -ml-1 rounded-lg hover:bg-slate-100 text-slate-600"
                onClick={() => setCollapsed((v) => !v)}
                title={collapsed ? 'Extinde meniul' : 'Restrânge la iconițe'}
                aria-label={collapsed ? 'Extinde meniul' : 'Restrânge la iconițe'}
                aria-pressed={collapsed}
              >
                {collapsed ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
              </button>
            )}
          </div>

          {!documentsCompanion && (
            <div className="hidden md:flex flex-1 justify-center min-w-0 px-2">
              <GlobalSearch className="max-w-xl w-full" />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0 ml-auto shrink-0">
            <NotificationBell />

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 p-1 pr-1 sm:pr-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-[#1D4E89] flex items-center justify-center text-white text-sm font-semibold">
                  {initials}
                </div>
                <div className="hidden sm:block text-left max-w-[10rem]">
                  <p className="text-sm font-medium text-slate-700 leading-tight truncate">{displayName}</p>
                  {roleLabel && <p className="text-[11px] text-slate-400 leading-tight truncate">{roleLabel}</p>}
                </div>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  {/*
                    Only Deconectare here. /settings is company configuration, not a personal
                    account page, so a second entry point under the avatar read as "contul meu"
                    and duplicated the sidebar link with no difference in behaviour.
                  */}
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-40">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <LogOut className="w-4 h-4" />
                      Deconectare
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {!isDesktop && !documentsCompanion && (
          <div className="px-3 sm:px-4 py-2 bg-white border-b border-slate-200">
            <GlobalSearch className="w-full max-w-none" />
          </div>
        )}

        <main className="flex-1 p-3 sm:p-4 lg:p-6 min-w-0 overflow-x-hidden">
          <ErrorBoundary label={location.pathname} resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>

        {tourOpen && (
          <OfficeTour
            isDesktop={isDesktop}
            step={tourStep}
            onStepChange={setTourStep}
            onClose={closeTour}
          />
        )}
      </div>
    </div>
  );
}
