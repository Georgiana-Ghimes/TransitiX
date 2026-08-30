import jwt from 'jsonwebtoken';

export function signAccessToken(user, extras = {}) {
  const payload = {
    sub: user.id,
    company_id: user.company_id,
    role: user.role,
    email: user.email,
  };
  if (extras.impersonator_id) {
    payload.impersonator_id = extras.impersonator_id;
    payload.impersonator_email = extras.impersonator_email || null;
  }
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

/**
 * A refresh token carries a `jti` so the session behind it can be revoked.
 *
 * Without one, signing out is only the client forgetting its copy — the token keeps working
 * until it expires, and there is nothing to point at to take it away.
 */
export function signRefreshToken(user, jti) {
  return jwt.sign(
    { sub: user.id, company_id: user.company_id, type: 'refresh', jti },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

function userFromPayload(payload) {
  return {
    id: payload.sub,
    company_id: payload.company_id,
    role: payload.role,
    email: payload.email,
    impersonator_id: payload.impersonator_id || null,
    impersonator_email: payload.impersonator_email || null,
  };
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === 'refresh') {
      return res.status(401).json({ message: 'Token de acces invalid. Conectează-te din nou.' });
    }
    req.user = userFromPayload(payload);
    next();
  } catch {
    return res.status(401).json({ message: 'Sesiunea a expirat. Conectează-te din nou.' });
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== 'refresh') {
        req.user = userFromPayload(payload);
      }
    } catch {
      // ignore
    }
  }
  next();
}

const OFFICE_ROLES = new Set(['admin', 'dispatcher', 'finance']);

/** Office inbox / dispatcher tools — drivers stay on the driver app. */
export function officeRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  if (req.user.role === 'platform_admin') {
    return res.status(403).json({
      message: 'Contul de platformă nu folosește instrumentele de birou ale unui client. Deschide /platform.',
    });
  }
  if (!OFFICE_ROLES.has(req.user.role)) {
    return res.status(403).json({ message: 'Această secțiune este doar pentru personalul de birou.' });
  }
  next();
}

/** Company settings and other admin-only writes (customer tenant — not GOD). */
export function adminRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Această acțiune este permisă doar administratorului.' });
  }
  next();
}

/** Transitix operators — list tenants, feature flags, future leads. Not company admin. */
export function platformAdminRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  if (req.user.role !== 'platform_admin') {
    return res.status(403).json({ message: 'Doar administratorii de platformă pot accesa această zonă.' });
  }
  next();
}
