import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import { isDocumentsProfile } from '@/lib/appProfile';
import { isPlatformAdmin, postLoginPath } from '@/lib/roles';
import {
  RESERVED_SLUGS,
  detectSlugFromPath,
  normalizeSlug,
  tenantPath,
} from '@/lib/tenantPath';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Trips from '@/pages/Trips';
import Vehicles from '@/pages/Vehicles';
import Drivers from '@/pages/Drivers';
import Clients from '@/pages/Clients';
import Settings from '@/pages/Settings';
import Warehouse from '@/pages/Warehouse';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import RequestAccess from '@/pages/RequestAccess';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

const TripDetail = lazy(() => import('@/pages/TripDetail'));
const GPSMap = lazy(() => import('@/pages/GPSMap'));
const Locations = lazy(() => import('@/pages/Locations'));
const Territories = lazy(() => import('@/pages/Territories'));
const Dispatch = lazy(() => import('@/pages/Dispatch'));
const LoadPlanner = lazy(() => import('@/pages/LoadPlanner'));
const LoadPlanner2D = lazy(() => import('@/loadplanner/LoadPlannerPage'));
const PlanningAI = lazy(() => import('@/pages/PlanningAI'));
const Finance = lazy(() => import('@/pages/Finance'));
const Documents = lazy(() => import('@/pages/Documents'));
const AvizeReports = lazy(() => import('@/pages/AvizeReports'));
const Reports = lazy(() => import('@/pages/Reports'));
const Checks = lazy(() => import('@/pages/Checks'));
const Commercial = lazy(() => import('@/pages/Commercial'));
const Audit = lazy(() => import('@/pages/Audit'));
const Users = lazy(() => import('@/pages/Users'));
const PlatformAdmin = lazy(() => import('@/pages/PlatformAdmin'));
const PlatformCompanies = lazy(() => import('@/pages/PlatformCompanies'));
const PlatformLeads = lazy(() => import('@/pages/PlatformLeads'));
const PlatformUsers = lazy(() => import('@/pages/PlatformUsers'));
const PlatformCompanyPage = lazy(() => import('@/pages/PlatformCompanyPage'));
const DriverApp = lazy(() => import('@/pages/DriverApp'));
const DriverAppDocuments = lazy(() => import('@/pages/DriverAppDocuments'));
const SharpnessCalibration = import.meta.env.DEV
  ? lazy(() => import('@/pages/dev/SharpnessCalibration'))
  : null;
const ClientPortal = lazy(() => import('@/pages/ClientPortal'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-[#0A2B4E] rounded-full animate-spin" />
    </div>
  );
}

function LoginRedirect() {
  const location = useLocation();
  // With a tenant basename, location.pathname is already unprefixed (/avize).
  // Prefer the real browser path so returnTo keeps /{slug}/….
  const returnTo = typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}`
    : `${location.pathname}${location.search}`;
  const q = returnTo && returnTo !== '/'
    ? `?returnTo=${encodeURIComponent(returnTo)}`
    : '';
  return <Navigate to={`/login${q}`} replace />;
}

function TenantDriverApp() {
  const { user } = useAuth();
  const docs = user?.company?.feature_flags?.app_profile === 'documents' || isDocumentsProfile();
  return docs ? <DriverAppDocuments /> : <DriverApp />;
}

function OfficeRoutes() {
  // Single host: full TMS catalog is always registered; modules + Layout hide what's off.
  return (
    <>
      <Route path="/" element={<Dashboard />} />
      <Route path="/platform" element={<PlatformAdmin />} />
      <Route path="/platform/companies" element={<PlatformCompanies />} />
      <Route path="/platform/leads" element={<PlatformLeads />} />
      <Route path="/platform/users" element={<PlatformUsers />} />
      <Route path="/platform/companies/:id" element={<PlatformCompanyPage />} />
      <Route path="/trips" element={<Trips />} />
      <Route path="/trips/:id" element={<TripDetail />} />
      <Route path="/vehicles" element={<Vehicles />} />
      <Route path="/drivers" element={<Drivers />} />
      <Route path="/gps" element={<GPSMap />} />
      <Route path="/locations" element={<Locations />} />
      <Route path="/territories" element={<Territories />} />
      <Route path="/dispatch" element={<Dispatch />} />
      <Route path="/loading" element={<LoadPlanner />} />
      <Route path="/load-planner" element={<LoadPlanner2D />} />
      <Route path="/planning" element={<PlanningAI />} />
      <Route path="/clients" element={<Clients />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/warehouse" element={<Warehouse />} />
      <Route path="/documents" element={<Documents />} />
      <Route path="/avize" element={<AvizeReports />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/checks" element={<Checks />} />
      <Route path="/commercial" element={<Commercial />} />
      <Route path="/audit" element={<Audit />} />
      <Route path="/users" element={<Users />} />
      <Route path="/driver-app" element={<TenantDriverApp />} />
      <Route path="/settings" element={<Settings />} />
    </>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary label="app">
      <Suspense fallback={<PageLoader />}>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/confirm/:token" element={<ClientPortal />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<LoginRedirect />} />}>
          <Route element={<Layout />}>
            {OfficeRoutes()}
            {SharpnessCalibration && (
              <Route path="/dev/sharpness" element={<SharpnessCalibration />} />
            )}
          </Route>
        </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

/**
 * Tenant URLs are /{slug}/avize. Basename comes only from the browser path so
 * Router never mounts with /{slug} while the URL is still "/".
 * Platform GOD and auth pages use basename "".
 */
function TenantAwareRouter({ children }) {
  const { user, isLoadingAuth } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const fromUrl = useMemo(
    () => (typeof window !== 'undefined' ? detectSlugFromPath(window.location.pathname) : null),
    // Re-evaluate when auth settles (impersonation / login may change session without remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.company?.slug, isLoadingAuth],
  );

  const basename = fromUrl ? `/${fromUrl}` : '';

  useEffect(() => {
    if (isLoadingAuth || typeof window === 'undefined') return;
    if (isPlatformAdmin(user)) return;
    const slug = user?.company?.slug;
    if (!slug || fromUrl) return;

    const path = window.location.pathname || '/';
    const search = window.location.search || '';
    const first = path.split('/').filter(Boolean)[0] || '';
    const reserved = Boolean(first) && RESERVED_SLUGS.has(normalizeSlug(first));
    if (reserved) return;

    // Bare `/` or unprefixed app path (/avize) while logged into a tenant.
    const target = first
      ? tenantPath(slug, path) + search
      : postLoginPath(user) + search;
    if (target === path + search) return;
    setRedirecting(true);
    window.location.replace(target);
  }, [user, isLoadingAuth, fromUrl]);

  if (redirecting) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Router basename={basename} key={basename || 'root'}>
      {children}
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <TenantAwareRouter>
          <ScrollToTop />
          <AuthenticatedApp />
        </TenantAwareRouter>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
