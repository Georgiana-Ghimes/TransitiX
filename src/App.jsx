import React, { lazy, Suspense } from 'react';
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
const DriverApp = lazy(() => import('@/pages/DriverApp'));
const DriverAppDocuments = lazy(() => import('@/pages/DriverAppDocuments'));
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
  const returnTo = `${location.pathname}${location.search}`;
  const q = returnTo && returnTo !== '/'
    ? `?returnTo=${encodeURIComponent(returnTo)}`
    : '';
  return <Navigate to={`/login${q}`} replace />;
}

function OfficeRoutes() {
  if (isDocumentsProfile()) {
    return (
      <>
        <Route path="/" element={<Navigate to="/avize" replace />} />
        <Route path="/avize" element={<AvizeReports />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/driver-app" element={<DriverAppDocuments />} />
        <Route path="*" element={<Navigate to="/avize" replace />} />
      </>
    );
  }

  return (
    <>
      <Route path="/" element={<Dashboard />} />
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
      <Route path="/driver-app" element={<DriverApp />} />
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
    // Last resort: a crash in the router, the layout or a provider still has to leave something
    // on screen rather than a blank page.
    <ErrorBoundary label="app">
      <Suspense fallback={<PageLoader />}>
        <Routes>
        <Route path="/login" element={<Login />} />
        {!isDocumentsProfile() && (
          <>
            <Route path="/register" element={<Register />} />
          </>
        )}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/confirm/:token" element={<ClientPortal />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<LoginRedirect />} />}>
          <Route element={<Layout />}>
            {OfficeRoutes()}
          </Route>
        </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
