import { Navigate } from 'react-router-dom';

/** Public self-signup is closed — always send people to the lead form. */
export default function Register() {
  return <Navigate to="/request-access" replace />;
}
