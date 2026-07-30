import express from 'express';
import { getDb } from '../db/index.js';
import {
  createClient, updateClient, getClientById, searchClients, ValidationError,
} from '../services/clients.js';
import { buildClientView } from '../services/clientView.js';
import { runBureauEnquiry, setAccountExclusion } from '../services/snapshots.js';
import { recordConsent, revokeConsent, CONSENT_METHODS } from '../services/consent.js';
import { recordAudit } from '../services/audit.js';
import { listAvailableProviders, defaultProviderId } from '../bureaus/index.js';
import { EXPENSE_CATEGORIES } from '../services/affordability.js';
import { ACCOUNT_TYPES } from '../bureaus/normalise.js';
import { parseRandsToCents } from '../lib/money.js';
import { requireAuth, requireRole, asyncRoute } from '../web/middleware.js';

export const clientsRouter = express.Router();

clientsRouter.use(requireAuth);

// ── List & search ───────────────────────────────────────────────────────────
clientsRouter.get('/clients', (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page ?? '1', 10) || 1);
  const perPage = 25;
  const { rows, total } = searchClients({
    query: req.query.q ?? '',
    status: req.query.status || null,
    limit: perPage,
    offset: (page - 1) * perPage,
  });

  if (req.query.q) {
    recordAudit({ actor: req.user, action: 'client.search', detail: { query: String(req.query.q).slice(0, 100) }, req });
  }

  res.render('clients/index', {
    title: 'Clients',
    clients: rows,
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    query: req.query.q ?? '',
    status: req.query.status ?? '',
  });
});

// ── New client ──────────────────────────────────────────────────────────────
clientsRouter.get('/clients/new', requireRole('consultant'), (req, res) => {
  res.render('clients/new', { title: 'Add client', error: null, values: {} });
});

clientsRouter.post('/clients', requireRole('consultant'), (req, res) => {
  try {
    const client = createClient({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      idNumber: req.body.idNumber,
      email: req.body.email,
      phone: req.body.phone,
      employmentStatus: req.body.employmentStatus,
      maritalStatus: req.body.maritalStatus,
      dependants: req.body.dependants,
      notes: req.body.notes,
    }, { actorId: req.user.id });

    recordAudit({ actor: req.user, action: 'client.created', entityType: 'client', entityId: client.id, req });
    res.redirect(`/clients/${client.id}`);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).render('clients/new', { title: 'Add client', error: err.message, values: req.body });
    }
    throw err;
  }
});

// ── Dashboard ───────────────────────────────────────────────────────────────
clientsRouter.get('/clients/:id', (req, res, next) => {
  const view = buildClientView(req.params.id, { snapshotId: req.query.snapshot ?? null });
  if (!view) return next();

  recordAudit({
    actor: req.user,
    action: 'client.viewed',
    entityType: 'client',
    entityId: view.client.id,
    detail: { snapshotId: view.snapshot?.id ?? null },
    req,
  });

  return res.render('clients/show', {
    title: `${view.client.first_name} ${view.client.last_name}`,
    view,
    accountTypes: ACCOUNT_TYPES,
    providers: listAvailableProviders(),
    defaultProvider: defaultProviderId(),
    consentMethods: CONSENT_METHODS,
    expenseCategories: EXPENSE_CATEGORIES,
    flash: req.query.flash ?? null,
  });
});

// ── Edit ────────────────────────────────────────────────────────────────────
clientsRouter.get('/clients/:id/edit', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();
  return res.render('clients/edit', { title: 'Edit client', client, error: null });
});

clientsRouter.post('/clients/:id/edit', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();
  updateClient(client.id, req.body);
  recordAudit({ actor: req.user, action: 'client.updated', entityType: 'client', entityId: client.id, req });
  return res.redirect(`/clients/${client.id}`);
});

// ── Consent ─────────────────────────────────────────────────────────────────
clientsRouter.post('/clients/:id/consent', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();

  const consent = recordConsent({
    clientId: client.id,
    consentType: req.body.consentType || 'bureau_enquiry',
    method: req.body.method,
    expiresAt: req.body.expiresAt || null,
    evidenceRef: req.body.evidenceRef || null,
    capturedBy: req.user.id,
  });

  recordAudit({
    actor: req.user,
    action: 'consent.recorded',
    entityType: 'client',
    entityId: client.id,
    detail: { consentId: consent.id, type: consent.consent_type, method: consent.method },
    req,
  });
  return res.redirect(`/clients/${client.id}?flash=consent-recorded#consent`);
});

clientsRouter.post('/clients/:id/consent/:consentId/revoke', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();
  revokeConsent(Number(req.params.consentId));
  recordAudit({
    actor: req.user,
    action: 'consent.revoked',
    entityType: 'client',
    entityId: client.id,
    detail: { consentId: Number(req.params.consentId) },
    req,
  });
  return res.redirect(`/clients/${client.id}?flash=consent-revoked#consent`);
});

// ── Bureau enquiry ──────────────────────────────────────────────────────────
clientsRouter.post('/clients/:id/pull', requireRole('consultant'), asyncRoute(async (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();

  const providerId = req.body.provider || defaultProviderId();
  if (!providerId) {
    return next(Object.assign(new Error('No credit bureau is configured on this instance.'), { statusCode: 503 }));
  }

  try {
    await runBureauEnquiry({ client, providerId, actor: req.user, req });
    return res.redirect(`/clients/${client.id}?flash=pull-complete`);
  } catch (err) {
    // A failed enquiry is an expected outcome, not a crash: the bureau may be
    // down, consent may be missing, or the client may not be on file. Show the
    // consultant what happened on the page they are already on.
    const view = buildClientView(client.id);
    return res.status(err.statusCode ?? 502).render('clients/show', {
      title: `${client.first_name} ${client.last_name}`,
      view,
      accountTypes: ACCOUNT_TYPES,
      providers: listAvailableProviders(),
      defaultProvider: defaultProviderId(),
      consentMethods: CONSENT_METHODS,
      expenseCategories: EXPENSE_CATEGORIES,
      flash: null,
      pullError: err.message,
    });
  }
}));

// ── Affordability capture ───────────────────────────────────────────────────
clientsRouter.post('/clients/:id/financials', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();

  const expenses = {};
  for (const key of Object.keys(EXPENSE_CATEGORIES)) {
    const cents = parseRandsToCents(req.body[`expense_${key}`]);
    if (cents !== null && cents > 0) expenses[key] = cents;
  }

  getDb().prepare(`
    INSERT INTO financial_profiles (
      client_id, gross_monthly_income_cents, net_monthly_income_cents,
      other_income_cents, expenses_json, captured_by
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    client.id,
    parseRandsToCents(req.body.grossIncome) ?? 0,
    parseRandsToCents(req.body.netIncome) ?? 0,
    parseRandsToCents(req.body.otherIncome) ?? 0,
    JSON.stringify(expenses),
    req.user.id,
  );

  recordAudit({ actor: req.user, action: 'financials.captured', entityType: 'client', entityId: client.id, req });
  return res.redirect(`/clients/${client.id}?flash=financials-saved#affordability`);
});

// ── Account exclusion ───────────────────────────────────────────────────────
clientsRouter.post('/clients/:id/accounts/:accountId/exclude', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();

  const excluded = req.body.excluded === '1';
  setAccountExclusion(Number(req.params.accountId), { excluded, reason: req.body.reason || null });
  recordAudit({
    actor: req.user,
    action: excluded ? 'account.excluded' : 'account.included',
    entityType: 'client',
    entityId: client.id,
    detail: { accountId: Number(req.params.accountId), reason: req.body.reason || null },
    req,
  });
  return res.redirect(`/clients/${client.id}#accounts`);
});
