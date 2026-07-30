import crypto from 'node:crypto';
import { config } from '../config.js';
import { resolveSession, hasRole } from '../services/users.js';

export const SESSION_COOKIE = 'mfg_session';
export const CSRF_COOKIE = 'mfg_csrf';

/** Minimal cookie parser — avoids a dependency for the two cookies this app sets. */
export function cookieParser(req, res, next) {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      try {
        req.cookies[key] = decodeURIComponent(value);
      } catch {
        req.cookies[key] = value;
      }
    }
  }
  next();
}

export function setCookie(res, name, value, { maxAgeSeconds, httpOnly = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (config.cookieSecure) parts.push('Secure');
  if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}

export function clearCookie(res, name) {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}`);
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, [value]);
  else res.setHeader(name, [...(Array.isArray(existing) ? existing : [existing]), value]);
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function attachUser(req, res, next) {
  req.user = resolveSession(req.cookies?.[SESSION_COOKIE]) ?? null;
  res.locals.currentUser = req.user;
  next();
}

/** Gate for page routes: bounces to the login form, remembering where they were going. */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const returnTo = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${returnTo}`);
}

export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (!hasRole(req.user, minimum)) {
      return next(Object.assign(new Error('You do not have permission to do that.'), { statusCode: 403 }));
    }
    return next();
  };
}

/**
 * CSRF protection using the double-submit cookie pattern: a random token is set
 * in a readable cookie and must be echoed in the form body. Without this, a
 * malicious page could make a logged-in consultant's browser run a bureau
 * enquiry — which costs money and creates an unlawful enquiry on a client's record.
 */
export function csrf(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    setCookie(res, CSRF_COOKIE, token, { httpOnly: false, maxAgeSeconds: 60 * 60 * 12 });
    req.cookies = { ...req.cookies, [CSRF_COOKIE]: token };
  }
  res.locals.csrfToken = token;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // On a multipart upload the _csrf field lives inside the file-upload body,
  // which only multer can parse — and multer runs later, in the route. Checking
  // here would reject every upload. Those routes are listed explicitly below and
  // must call verifyDeferredCsrf() straight after multer; anything else
  // multipart is still rejected here, so a forgotten route fails closed.
  if (isMultipart(req) && MULTIPART_CSRF_ROUTES.some((pattern) => pattern.test(req.path))) {
    req.csrfDeferred = true;
    return next();
  }

  const supplied = req.body?._csrf || req.get('x-csrf-token');
  if (!supplied || !safeEqual(String(supplied), String(token))) {
    return next(Object.assign(new Error('Your session expired or the form was stale. Please try again.'), { statusCode: 403 }));
  }
  return next();
}

/** Routes that accept file uploads and therefore verify CSRF after multer. */
const MULTIPART_CSRF_ROUTES = [
  /^\/clients\/\d+\/import$/,
];

function isMultipart(req) {
  return String(req.get('content-type') || '').toLowerCase().startsWith('multipart/form-data');
}

/**
 * The second half of the deferred check. Mount immediately after multer on any
 * upload route — the body is parsed by then, so the token is finally readable.
 */
export function verifyDeferredCsrf(req, res, next) {
  const token = req.cookies?.[CSRF_COOKIE];
  const supplied = req.body?._csrf || req.get('x-csrf-token');
  if (!token || !supplied || !safeEqual(String(supplied), String(token))) {
    return next(Object.assign(new Error('Your session expired or the form was stale. Please try again.'), { statusCode: 403 }));
  }
  req.csrfDeferred = false;
  return next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Baseline security headers. */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Client credit data must never be cached by an intermediary or left in a
  // shared browser's back-forward cache.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
  next();
}

/** Wraps an async route so a rejected promise reaches the error handler. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
