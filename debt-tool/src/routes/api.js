import express from 'express';
import { buildClientView, serialiseClientView } from '../services/clientView.js';
import { searchClients, getClientById } from '../services/clients.js';
import { runBureauEnquiry } from '../services/snapshots.js';
import { recordAudit } from '../services/audit.js';
import { listProviders, defaultProviderId } from '../bureaus/index.js';
import { requireAuth, requireRole, asyncRoute } from '../web/middleware.js';

/**
 * JSON mirror of the staff UI, for reporting scripts and any future front end.
 * It authenticates with the same session cookie — there are no API keys, so a
 * leaked token cannot outlive a consultant's session.
 */
export const apiRouter = express.Router();

apiRouter.use(requireAuth);

apiRouter.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

apiRouter.get('/api/providers', (req, res) => {
  res.json({ providers: listProviders(), default: defaultProviderId() });
});

apiRouter.get('/api/clients', (req, res) => {
  const { rows, total } = searchClients({
    query: req.query.q ?? '',
    status: req.query.status || null,
    limit: Math.min(200, Number.parseInt(req.query.limit ?? '50', 10) || 50),
    offset: Number.parseInt(req.query.offset ?? '0', 10) || 0,
  });

  res.json({
    total,
    clients: rows.map((c) => ({
      id: c.id,
      reference: c.reference,
      firstName: c.first_name,
      lastName: c.last_name,
      idNumberLast4: c.id_number_last4,
      status: c.status,
      totalOwedCents: c.total_owed_cents ?? 0,
      lastPullAt: c.last_pull_at ?? null,
    })),
  });
});

apiRouter.get('/api/clients/:id', (req, res) => {
  const view = buildClientView(req.params.id, { snapshotId: req.query.snapshot ?? null });
  if (!view) return res.status(404).json({ error: 'Client not found' });

  recordAudit({
    actor: req.user,
    action: 'client.viewed.api',
    entityType: 'client',
    entityId: view.client.id,
    req,
  });

  return res.json(serialiseClientView(view));
});

apiRouter.post('/api/clients/:id/pull', requireRole('consultant'), asyncRoute(async (req, res) => {
  const client = getClientById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const providerId = req.body?.provider || defaultProviderId();
  if (!providerId) return res.status(503).json({ error: 'No credit bureau is configured on this instance.' });

  const result = await runBureauEnquiry({ client, providerId, actor: req.user, req });
  const view = buildClientView(client.id);

  return res.status(201).json({
    snapshotId: result.snapshotId,
    simulated: result.simulated,
    ...serialiseClientView(view),
  });
}));
