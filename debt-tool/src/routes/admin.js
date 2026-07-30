import express from 'express';
import { listAudit, countAudit, recordAudit } from '../services/audit.js';
import { listUsers, createUser, ROLES } from '../services/users.js';
import { listProviders, defaultProviderId } from '../bureaus/index.js';
import { config } from '../config.js';
import { requireRole } from '../web/middleware.js';

/**
 * Mounted at /admin in app.js. The mount path matters: this router gates every
 * request that reaches it on the admin role, so mounting it at the root would
 * make every unmatched URL answer 403 instead of 404.
 */
export const adminRouter = express.Router();

adminRouter.use(requireRole('admin'));

adminRouter.get('/audit', (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page ?? '1', 10) || 1);
  const perPage = 100;
  const entries = listAudit({
    limit: perPage,
    offset: (page - 1) * perPage,
    entityType: req.query.entityType || null,
    entityId: req.query.entityId || null,
  });
  const total = countAudit({ entityType: req.query.entityType || null, entityId: req.query.entityId || null });

  res.render('admin/audit', {
    title: 'Audit log',
    entries,
    page,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    total,
    filters: { entityType: req.query.entityType ?? '', entityId: req.query.entityId ?? '' },
  });
});

adminRouter.get('/users', (req, res) => {
  res.render('admin/users', { title: 'Staff users', users: listUsers(), roles: ROLES, error: null, created: null });
});

adminRouter.post('/users', (req, res) => {
  const { email, fullName, role, password } = req.body;
  const render = (extra) => res.render('admin/users', {
    title: 'Staff users', users: listUsers(), roles: ROLES, error: null, created: null, ...extra,
  });

  if (String(password || '').length < 12) {
    return res.status(400).render('admin/users', {
      title: 'Staff users', users: listUsers(), roles: ROLES, created: null,
      error: 'Set an initial password of at least 12 characters.',
    });
  }

  try {
    const user = createUser({ email, fullName, role, password, mustReset: true });
    recordAudit({
      actor: req.user, action: 'user.created', entityType: 'user', entityId: user.id,
      detail: { email: user.email, role: user.role }, req,
    });
    return render({ created: user.email });
  } catch (err) {
    return res.status(400).render('admin/users', {
      title: 'Staff users', users: listUsers(), roles: ROLES, created: null,
      error: /UNIQUE/.test(err.message) ? 'That email address already has an account.' : err.message,
    });
  }
});

adminRouter.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    providers: listProviders(),
    defaultProvider: defaultProviderId(),
    config: {
      env: config.env,
      databaseFile: config.databaseFile,
      snapshotStaleDays: config.snapshotStaleDays,
      sessionTtlHours: config.sessionTtlHours,
      allowMock: config.bureau.allowMock,
      cookieSecure: config.cookieSecure,
    },
  });
});
