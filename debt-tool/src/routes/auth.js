import express from 'express';
import { authenticate, startSession, endSession, setPassword } from '../services/users.js';
import { recordAudit } from '../services/audit.js';
import { config } from '../config.js';
import { SESSION_COOKIE, setCookie, clearCookie, requireAuth, asyncRoute } from '../web/middleware.js';

export const authRouter = express.Router();

authRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect('/clients');
  return res.render('login', { title: 'Sign in', error: null, next: safeNext(req.query.next), email: '' });
});

authRouter.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const user = authenticate(email, password);

  if (!user) {
    recordAudit({ action: 'auth.login.failed', entityType: 'user', detail: { email: String(email || '').slice(0, 120) }, req });
    // One message for a wrong password, an unknown address and a disabled
    // account, so the form cannot be used to work out who has an account here.
    return res.status(401).render('login', {
      title: 'Sign in',
      error: 'Those details do not match an active account.',
      next: safeNext(req.body.next),
      email: String(email || ''),
    });
  }

  const { token } = startSession(user.id, { ip: req.ip, userAgent: req.get('user-agent') });
  setCookie(res, SESSION_COOKIE, token, { maxAgeSeconds: config.sessionTtlHours * 3600 });
  recordAudit({ actor: user, action: 'auth.login.succeeded', entityType: 'user', entityId: user.id, req });

  if (user.must_reset) return res.redirect('/account/password');
  return res.redirect(safeNext(req.body.next) || '/clients');
}));

authRouter.post('/logout', (req, res) => {
  if (req.user) recordAudit({ actor: req.user, action: 'auth.logout', entityType: 'user', entityId: req.user.id, req });
  endSession(req.cookies?.[SESSION_COOKIE]);
  clearCookie(res, SESSION_COOKIE);
  res.redirect('/login');
});

authRouter.get('/account/password', requireAuth, (req, res) => {
  res.render('password', { title: 'Change password', error: null, done: false });
});

authRouter.post('/account/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  const fail = (error) => res.status(400).render('password', { title: 'Change password', error, done: false });

  if (!authenticate(req.user.email, currentPassword)) return fail('Your current password is not correct.');
  if (String(newPassword || '').length < 12) return fail('Choose a password of at least 12 characters.');
  if (newPassword !== confirmPassword) return fail('The two new passwords do not match.');

  setPassword(req.user.id, newPassword);
  recordAudit({ actor: req.user, action: 'auth.password.changed', entityType: 'user', entityId: req.user.id, req });
  return res.render('password', { title: 'Change password', error: null, done: true });
});

/**
 * Only ever redirect within this application. An open redirect on the login form
 * is a ready-made phishing tool against exactly the staff who hold client data.
 */
function safeNext(value) {
  const text = String(value || '');
  if (!text.startsWith('/') || text.startsWith('//')) return '';
  return text;
}
