import React, { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import {
  LayoutDashboard, Truck, Users, Route, FileText, Wallet,
  UserCircle, LogOut, Menu, X, Building2, Search, MapPin, Brain, Package,
  ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { homePathForRole, isDriverRole } from '@/lib/roles';
import NotificationBell from '@/components/NotificationBell';

const NAV = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Curse', path: '/trips', icon: Route },
  { label: 'Flotă', path: '/vehicles', icon: Truck },
  { label: 'Șoferi', path: '/drivers', icon: Users },
  { label: 'Tracking GPS', path: '/gps', icon: MapPin },
  { label: 'Planning AI', path: '/planning', icon: Brain },
  { label: 'Clienți', path: '/clients', icon: Building2 },
  { label: 'Financiar', path: '/finance', icon: Wallet },
  { label: 'Depozit', path: '/warehouse', icon: Package },
  { label: 'Documente', path: '/documents', icon: FileText },
];

const SIDEBAR_COLLAPSED_KEY = 'transitix_sidebar_collapsed';
const SIDEBAR_EXPANDED = 256;
const SIDEBAR_RAIL = 72;

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

export default function Layout() {
  const location = useLocation();
  const { user } = useAuth();
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

  // Icon-only rail only on desktop. Mobile drawer always shows labels.
  const showIconsOnly = isDesktop && collapsed;
  const sidebarWidth = isDesktop
    ? (collapsed ? SIDEBAR_RAIL : SIDEBAR_EXPANDED)
    : SIDEBAR_EXPANDED;

  // Drivers only get the driver app — no office sidebar / notifications.
  if (isDriverRole(user)) {
    if (location.pathname !== '/driver-app') {
      return <Navigate to={homePathForRole(user)} replace />;
    }
    return (
      <div className="min-h-screen bg-[#F8F9FA]">
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    );
  }

  // Office users should not access the driver app.
  if (location.pathname === '/driver-app' || location.pathname.startsWith('/driver-app/')) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {/* Mobile overlay */}
      {!isDesktop && mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar — desktop stays visible; only width changes on collapse */}
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'z-40 h-screen bg-[#0A2B4E] text-white flex flex-col shrink-0 overflow-hidden',
          'transition-[width,transform] duration-300 ease-in-out',
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
            'flex items-center h-16 border-b border-white/10 shrink-0',
            showIconsOnly ? 'justify-center px-2' : 'gap-2.5 px-4'
          )}
        >
          <div className="w-9 h-9 rounded-lg bg-[#F5A623] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5 text-[#0A2B4E]" />
          </div>
          {!showIconsOnly && (
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-lg tracking-tight leading-tight">Transitix</h1>
              <p className="text-[10px] text-white/50">TMS Platform</p>
            </div>
          )}
          {!isDesktop && (
            <button type="button" className="shrink-0 ml-auto" onClick={() => setMobileOpen(false)} aria-label="Închide meniul">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className={cn('flex-1 py-3 overflow-y-auto overflow-x-hidden', showIconsOnly ? 'px-2' : 'px-3')}>
          <ul className="space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    title={item.label}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center rounded-lg text-sm font-medium transition-colors',
                      showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5',
                      active
                        ? 'bg-[#1D4E89] text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {!showIconsOnly && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn('py-3 border-t border-white/10 space-y-1', showIconsOnly ? 'px-2' : 'px-3')}>
          <Link
            to="/settings"
            title="Setări"
            onClick={() => setMobileOpen(false)}
            className={cn(
              'flex items-center rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors',
              showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5'
            )}
          >
            <UserCircle className="w-5 h-5 shrink-0" />
            {!showIconsOnly && <span>Setări</span>}
          </Link>

          {isDesktop && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Extinde meniul' : 'Restrânge la iconițe'}
              aria-label={collapsed ? 'Extinde meniul' : 'Restrânge la iconițe'}
              aria-pressed={collapsed}
              className={cn(
                'flex w-full items-center rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors',
                showIconsOnly ? 'justify-center h-11 px-0' : 'gap-3 px-3 py-2.5'
              )}
            >
              {collapsed ? (
                <ChevronsRight className="w-5 h-5 shrink-0" />
              ) : (
                <>
                  <ChevronsLeft className="w-5 h-5 shrink-0" />
                  <span>Restrânge</span>
                </>
              )}
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 h-16 flex items-center px-4 lg:px-6 gap-3">
          {!isDesktop ? (
            <button
              type="button"
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

          <div className="relative hidden md:block flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Caută cursă, vehicul, șofer..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:outline-none focus:border-[#1D4E89] focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <NotificationBell />

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-[#1D4E89] flex items-center justify-center text-white text-sm font-semibold">
                  {initials}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-slate-700 leading-tight">{displayName}</p>
                  {roleLabel && <p className="text-[11px] text-slate-400 leading-tight">{roleLabel}</p>}
                </div>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-40">
                    <Link
                      to="/settings"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <UserCircle className="w-4 h-4" />
                      Setări
                    </Link>
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

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
