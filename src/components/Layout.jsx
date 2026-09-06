import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import {
  LayoutDashboard, Truck, Users, Route, FileText, Wallet,
  UserCircle, LogOut, Menu, X, Building2, MapPin, Brain, Package,
  ChevronsLeft, ChevronsRight, Boxes, ClipboardList, FileSpreadsheet, HelpCircle, LayoutGrid,
  MapPinned, Network, Layers, Receipt, ShieldCheck, History, UserCog, Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatAppVersion } from '@/lib/appVersion';
import { homePathForRole, isDriverRole, isPlatformAdmin } from '@/lib/roles';
import { isModuleEnabled, isPathAllowedForCompany } from '@/lib/companyModules';
import {
  companionTagline,
  isCompanionOfficePath,
  isDocumentsProfile,
} from '@/lib/appProfile';
import { detectSlugFromPath, tenantPath } from '@/lib/tenantPath';
import {
  clampTourStep,
  hasSeenOfficeTour,
  markOfficeTourSeen,
  officeTourStepsForUser,
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
  { label: 'Dispecerat', path: '/dispatch', icon: Network, module: 'dispatch' },
  { label: 'Încărcare', path: '/loading', icon: Boxes, module: 'loading' },
  { label: 'Plan 2D', path: '/load-planner', icon: LayoutGrid, module: 'loading' },
  { label: 'Curse', path: '/trips', icon: Route, module: 'trips' },
  { label: 'Flotă', path: '/vehicles', icon: Truck, module: 'fleet' },
  { label: 'Șoferi', path: '/drivers', icon: Users, module: 'fleet' },
  { label: 'Locații', path: '/locations', icon: MapPinned, module: 'locations' },
  { label: 'Teritorii', path: '/territories', icon: Layers, module: 'territories' },
  { label: 'Tracking GPS', path: '/gps', icon: MapPin, module: 'gps' },
  { label: 'Planning AI', path: '/planning', icon: Brain, module: 'planning' },
  { label: 'Clienți', path: '/clients', icon: Building2, module: 'trips' },
  { label: 'Financiar', path: '/finance', icon: Wallet, module: 'finance' },
  { label: 'Depozit', path: '/warehouse', icon: Package, module: 'warehouse' },
  { label: 'Documente', path: '/documents', icon: FileText, module: 'documents_expiry' },
  { label: 'Avize / Rapoarte', path: '/avize', icon: ClipboardList, module: 'avize' },
  { label: 'Rapoarte', path: '/reports', icon: FileSpreadsheet, module: 'reports' },
  { label: 'Verificări date', path: '/checks', icon: ShieldCheck, module: 'avize' },
  { label: 'Config. comercială', path: '/commercial', icon: Receipt, module: 'commercial' },
  // Admin-only: the searchable log answers "what has this person been doing", which is an
  // owner's question. The per-record trail behind it stays open to the whole office.
  { label: 'Utilizatori', path: '/users', icon: UserCog, roles: ['admin'], module: 'users_admin' },
  { label: 'Jurnal modificări', path: '/audit', icon: History, roles: ['admin'], module: 'audit' },
];

/** GOD operator nav — no per-tenant company rows in the rail. */
const PLATFORM_NAV = [
  { label: 'Acasă', path: '/platform', icon: ShieldCheck, end: true },
  { label: 'Companii', path: '/platform/companies', icon: Building2 },
  { label: 'Solicitări', path: '/platform/leads', icon: Inbox },
  { label: 'Utilizatori', path: '/platform/users', icon: UserCog },
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
  const isPlatform = isPlatformAdmin(user);
  const documentsCompanion = isDocumentsProfile();
  const companyProfile = user?.company?.feature_flags?.app_profile;
  const treatAsDocumentsEarly = companyProfile === 'documents'
    || (!companyProfile && documentsCompanion);
  // Full TMS catalog; hide Dashboard home for documents-profile companies.
  const tenantNav = treatAsDocumentsEarly
    ? NAV.filter((item) => item.path !== '/')
    : NAV;
  const navItems = isPlatform ? PLATFORM_NAV : tenantNav;
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

  // Prefer company app_profile (single-host multi-tenant) over Vite build profile.
  // Early: tour gate must match Layout redirect rules (documents bounce `/` → `/avize`).
  const treatAsDocuments = treatAsDocumentsEarly;
  const documentsShell = treatAsDocuments;
  const tourSteps = useMemo(
    () => officeTourStepsForUser(user, { treatAsDocuments }),
    [user, treatAsDocuments],
  );
  const tourEnabled = !isDriver && !isPlatform && tourSteps.length > 0;

  useEffect(() => {
    // Documents / limited tenants must not auto-run the full TMS script — Layout would
    // bounce `/`, `/trips`, … and fight navigate() (Maximum update depth).
    if (!tourEnabled || treatAsDocuments || documentsCompanion) {
      setTourOpen(false);
      return;
    }
    if (!hasSeenOfficeTour()) {
      setTourStep(0);
      setTourOpen(true);
    }
  }, [tourEnabled, treatAsDocuments, documentsCompanion]);

  const tourCurrent = tourOpen ? tourSteps[clampTourStep(tourStep, tourSteps.length)] : null;
  const tourNavPath = tourOpen ? tourNavHighlightPath(tourCurrent) : null;
  const tourHighlightGhid = tourCurrent?.highlightTarget === 'ghid';
  const tourHighlightDashboard = tourCurrent?.highlightTarget === 'dashboard';

  // Navigate when the tour *step* changes — not whenever the user leaves the step path.
  // Listening to `location.pathname` yanked every sidebar click back to the current step,
  // so the rest of the app looked broken (and racing lazy loads could surface ErrorBoundary).
  useEffect(() => {
    if (!tourOpen || !tourEnabled) return;
    const current = tourSteps[clampTourStep(tourStep, tourSteps.length)];
    if (
      current?.path
      && !tourAtPath(location.pathname, current.path)
      && isPathAllowedForCompany(user, current.path)
      && !(treatAsDocuments && (current.path === '/' || !isCompanionOfficePath(current.path, user)))
    ) {
      navigate(current.path);
    }
    // intentionally omit location.pathname — user may explore freely during the tour
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [tourOpen, tourEnabled, tourStep, tourSteps, treatAsDocuments, user, navigate]);

  // Desktop: open drawer for nav steps; mobile keeps drawer closed (sheet explains ☰).
  useEffect(() => {
    if (!tourOpen || !isDesktop) return;
    if (tourHighlightDashboard) setMobileOpen(false);
    else if (tourNavPath || tourHighlightGhid) setMobileOpen(true);
  }, [tourOpen, tourStep, isDesktop, tourHighlightDashboard, tourNavPath, tourHighlightGhid]);

  useEffect(() => {
    if (!tourOpen || isDesktop) return;
    setMobileOpen(false);
  }, [tourOpen, tourStep, isDesktop]);

  // Desktop-only spotlight on sidebar nav or dashboard content.
  useEffect(() => {
    if (!tourOpen || !isDesktop) return;
    const current = tourSteps[clampTourStep(tourStep, tourSteps.length)];
    if (!current) return;
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
  }, [tourOpen, tourStep, isDesktop, tourSteps]);

  // Mobile: ring the ☰ button when the step refers to the menu.
  useEffect(() => {
    if (!tourOpen || isDesktop) return;
    const current = tourSteps[clampTourStep(tourStep, tourSteps.length)];
    const btn = document.querySelector('[data-tour-mobile-menu]');
    if (!btn) return;
    btn.classList.toggle('tour-mobile-menu-highlight', tourMobileHighlightMenuButton(current));
    return () => btn.classList.remove('tour-mobile-menu-highlight');
  }, [tourOpen, tourStep, isDesktop, tourSteps]);

  const closeTour = () => {
    markOfficeTourSeen();
    setTourOpen(false);
  };

  const openTour = () => {
    if (!tourEnabled) return;
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

  const isActive = (path, end = false) => {
    if (path === '/' || end) return location.pathname === path;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };
  const displayName = user?.full_name || user?.name || user?.email || 'Utilizator';
  const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = {
    admin: 'Admin',
    dispatcher: 'Dispecer',
    driver: 'Șofer',
    finance: 'Finance',
    platform_admin: 'Platformă',
  }[user?.role] || user?.role || '';

  const showIconsOnly = isDesktop && collapsed;
  const sidebarWidth = isDesktop
    ? (collapsed ? SIDEBAR_RAIL : SIDEBAR_EXPANDED)
    : SIDEBAR_EXPANDED;

  const impersonating = Boolean(user?.impersonation?.active);

  if (isPlatform) {
    if (!location.pathname.startsWith('/platform')) {
      return <Navigate to="/platform" replace />;
    }
  }

  // Wrong tenant slug in the URL → jump to this company's prefix.
  if (!isPlatform && user?.company?.slug) {
    const urlSlug = detectSlugFromPath(typeof window !== 'undefined' ? window.location.pathname : '');
    if (urlSlug && urlSlug !== user.company.slug) {
      const target = tenantPath(user.company.slug, location.pathname);
      if (typeof window !== 'undefined') {
        window.location.replace(target);
        return null;
      }
    }
  }

  if (!isPlatform && !isDriverRole(user) && !isPathAllowedForCompany(user, location.pathname)) {
    return <Navigate to={homePathForRole(user)} replace />;
  }

  if (isDriver) {
    if (location.pathname !== '/driver-app') {
      return <Navigate to={homePathForRole(user)} replace />;
    }
    return (
      <div className="min-h-[100dvh] bg-[#F8F9FA]">
        {documentsShell ? (
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
    return <Navigate to={documentsShell ? '/avize' : '/'} replace />;
  }

  if (treatAsDocuments && !isPlatform) {
    if (location.pathname === '/') {
      return <Navigate to="/avize" replace />;
    }
    const devTool = import.meta.env.DEV && location.pathname.startsWith('/dev/');
    if (!devTool && !isCompanionOfficePath(location.pathname, user)) {
      return <Navigate to="/avize" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {impersonating && (
        <div className="shrink-0 z-50 bg-amber-500 text-[#0A2B4E] text-sm px-4 py-2 flex flex-wrap items-center justify-between gap-2 shadow">
          <span>
            Impersonare: <strong>{user?.company?.name || 'firmă'}</strong>
            {' '}ca <strong>{user?.email}</strong>
            {user?.impersonation?.actor_email ? (
              <> · GOD {user.impersonation.actor_email}</>
            ) : null}
          </span>
          <button
            type="button"
            className="shrink-0 px-3 py-1 rounded-md bg-[#0A2B4E] text-white text-xs font-medium hover:bg-[#1D4E89]"
            onClick={() => api.platform.exitImpersonation()}
          >
            Ieși din firmă
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
      {!isDesktop && mobileOpen && !tourOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setMobileOpen(false)} />
      )}

      {!isDesktop && tourOpen && mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-[114]" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'bg-[#0A2B4E] text-white flex flex-col shrink-0 overflow-hidden',
          'transition-[width,transform] duration-300 ease-in-out',
          tourOpen ? 'z-50' : 'z-40',
          isDesktop
            ? cn(
                'sticky top-0 translate-x-0',
                impersonating ? 'h-[calc(100dvh-2.75rem)]' : 'h-screen',
              )
            : cn(
                'fixed left-0 h-screen',
                impersonating ? 'top-[2.75rem]' : 'top-0',
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
            {navItems.filter((item) => {
              if (item.roles && !item.roles.includes(user?.role)) return false;
              if (item.module && !isModuleEnabled(user, item.module)) return false;
              return true;
            }).map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path, item.end);
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
          {tourEnabled && (
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
          {/*
            Company settings: real tenant admins only.
            Hide while GOD is impersonating — firm config belongs to the company's own admin,
            not the platform operator walking the portal as someone else.
          */}
          {!isPlatform && !impersonating && user?.role === 'admin' && (
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
            steps={tourSteps}
            onStepChange={setTourStep}
            onClose={closeTour}
          />
        )}
      </div>
      </div>
    </div>
  );
}
