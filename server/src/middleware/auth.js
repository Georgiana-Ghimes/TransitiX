import jwt from 'jsonwebtoken';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      company_id: user.company_id,
      role: user.role,
      email: user.email,
      // Present only while a temporary password is still in use; see `authRequired`.
      ...(user.must_change_password ? { pcr: true } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

/**
 * A refresh token carries a `jti` so the session behind it can be revoked.
 *
 * Without one, signing out is only the client forgetting its copy, the token keeps working
 * until it expires, and there is nothing to point at to take it away.
 */
export function signRefreshToken(user, jti) {
  return jwt.sign(
    { sub: user.id, company_id: user.company_id, type: 'refresh', jti },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

/**
 * An account an admin created by hand carries a temporary password the admin knows. Until the
 * person chooses their own, the token opens `/api/auth` (to see who they are and change it) and
 * nothing else, hiding the rest of the app in the browser alone would be a suggestion, not a rule.
 */
function passwordChangeBlocks(payload, req) {
  if (!payload.pcr) return false;
  const url = String(req.originalUrl || req.url || '');
  return !url.startsWith('/api/auth/');
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
    if (passwordChangeBlocks(payload, req)) {
      return res.status(403).json({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Alege-ți o parolă nouă înainte să continui.',
      });
    }
    req.user = {
      id: payload.sub,
      company_id: payload.company_id,
      role: payload.role,
      email: payload.email,
    };
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
      if (payload.type !== 'refresh' && !passwordChangeBlocks(payload, req)) {
        req.user = {
          id: payload.sub,
          company_id: payload.company_id,
          role: payload.role,
          email: payload.email,
        };
      }
    } catch {
      // ignore
    }
  }
  next();
}

const OFFICE_ROLES = new Set(['admin', 'dispatcher', 'finance']);

/** Office inbox / dispatcher tools, drivers stay on the driver app. */
export function officeRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  if (!OFFICE_ROLES.has(req.user.role)) {
    return res.status(403).json({ message: 'Această secțiune este doar pentru personalul de birou.' });
  }
  next();
}

/** Company settings and other admin-only writes. */
export function adminRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Autentificare necesară. Conectează-te din nou.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Această acțiune este permisă doar administratorului.' });
  }
  next();
}
