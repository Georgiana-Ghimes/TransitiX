import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, checkUserAuth } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  // A temporary password set by an admin: nothing else opens until it is replaced. The server
  // refuses the calls anyway; this only saves the person a screen full of errors.
  if (user?.must_change_password) {
    const returnTo = `${location.pathname}${location.search}`;
    const q = returnTo && returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    return <Navigate to={`/change-password${q}`} replace />;
  }

  return <Outlet />;
}
