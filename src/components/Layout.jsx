import React, { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import {
  LayoutDashboard, Truck, Users, Route, FileText, Wallet,
  UserCircle, Bell, LogOut, Menu, X, Building2, Search, MapPin, Brain, Package, Smartphone
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  { label: 'App Șofer', path: '/driver-app', icon: Smartphone },
];

export default function Layout() {
  const location = useLocation();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await api.auth.logout();
  };

  const isActive = (path) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
  const displayName = user?.full_name || user?.name || user?.email || 'Utilizator';
  const initials = displayName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = { admin: 'Admin', dispatcher: 'Dispecer', driver: 'Șofer', finance: 'Finance' }[user?.role] || user?.role || '';


  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-[#0A2B4E] text-white flex flex-col transition-transform duration-300',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="flex items-center gap-2.5 px-6 h-16 border-b border-white/10">
          <div className="w-9 h-9 rounded-lg bg-[#F5A623] flex items-center justify-center">
            <Truck className="w-5 h-5 text-[#0A2B4E]" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">Transitix</h1>
            <p className="text-[10px] text-white/50 -mt-0.5">TMS Platform</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(item.path)
                    ? 'bg-[#1D4E89] text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <Link to="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <UserCircle className="w-4.5 h-4.5" />
            Setări
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 h-16 flex items-center px-4 lg:px-6 gap-4">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5 text-slate-600" />
          </button>

          <div className="relative hidden md:block flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Caută cursă, vehicul, șofer..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:outline-none focus:border-[#1D4E89] focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors">
              <Bell className="w-5 h-5 text-slate-600" />
            </button>

            <div className="relative">
              <button
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
                    <button
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