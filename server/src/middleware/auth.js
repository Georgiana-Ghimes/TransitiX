import jwt from 'jsonwebtoken';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      company_id: user.company_id,
      role: user.role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === 'refresh') {
      return res.status(401).json({ message: 'Invalid access token' });
    }
    req.user = {
      id: payload.sub,
      company_id: payload.company_id,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== 'refresh') {
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

/** Office inbox / dispatcher tools — drivers stay on the driver app. */
export function officeRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  if (!OFFICE_ROLES.has(req.user.role)) {
    return res.status(403).json({ message: 'Office access only' });
  }
  next();
}
