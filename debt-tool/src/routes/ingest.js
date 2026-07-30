import express from 'express';
import multer from 'multer';
import { getDb, transaction } from '../db/index.js';
import { getClientById } from '../services/clients.js';
import { insertAccounts } from '../services/snapshots.js';
import { assertBureauConsent } from '../services/consent.js';
import { recordAudit } from '../services/audit.js';
import { parseReportPdf } from '../ingest/pdfReport.js';
import { ACCOUNT_TYPES } from '../bureaus/normalise.js';
import { parseRandsToCents } from '../lib/money.js';
import { config } from '../config.js';
import { requireRole, asyncRoute, verifyDeferredCsrf } from '../web/middleware.js';

export const ingestRouter = express.Router();

/**
 * Uploads are held in memory and never written to disk. A bureau report is one
 * of the most sensitive documents a client will ever hand over; the less time it
 * spends at rest, the less there is to leak. The parsed rows go into the database,
 * the PDF itself does not.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' && !/\.pdf$/i.test(file.originalname)) {
      return cb(Object.assign(new Error('Only PDF bureau reports can be uploaded.'), { statusCode: 400 }));
    }
    return cb(null, true);
  },
});

ingestRouter.get('/clients/:id/import', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();
  return res.render('clients/import', { title: 'Import bureau report', client, parsed: null, error: null });
});

ingestRouter.post(
  '/clients/:id/import',
  requireRole('consultant'),
  upload.single('report'),
  // multer has now parsed the body, so the CSRF token deferred by the global
  // middleware can finally be checked. This must stay directly after multer.
  verifyDeferredCsrf,
  asyncRoute(async (req, res, next) => {
    const client = getClientById(req.params.id);
    if (!client) return next();

    // A client handing over their own report still needs consent on file: the
    // document is their personal information and we are about to process it.
    assertBureauConsent(client.id);

    if (!req.file) {
      return res.status(400).render('clients/import', {
        title: 'Import bureau report', client, parsed: null, error: 'Choose a PDF report to upload.',
      });
    }

    let parsed;
    try {
      parsed = await parseReportPdf(req.file.buffer);
    } catch (err) {
      return res.status(400).render('clients/import', {
        title: 'Import bureau report',
        client,
        parsed: null,
        error: `That file could not be read as a PDF (${err.message}).`,
      });
    }

    recordAudit({
      actor: req.user,
      action: 'import.parsed',
      entityType: 'client',
      entityId: client.id,
      detail: { bureau: parsed.bureau, accountsFound: parsed.accountCount, pages: parsed.pageCount },
      req,
    });

    // Nothing is stored yet. The consultant confirms or corrects each row on the
    // next screen, because layout-based extraction gets things wrong and a wrong
    // balance on a debt file is not a cosmetic problem.
    return res.render('clients/import', {
      title: 'Import bureau report',
      client,
      parsed,
      accountTypes: ACCOUNT_TYPES,
      error: parsed.accountCount === 0
        ? 'No account rows could be read from that report. You can still capture the accounts manually below.'
        : null,
    });
  }),
);

/** Commits the rows the consultant confirmed on the review screen. */
ingestRouter.post('/clients/:id/import/confirm', requireRole('consultant'), (req, res, next) => {
  const client = getClientById(req.params.id);
  if (!client) return next();
  assertBureauConsent(client.id);

  const rows = collectRows(req.body);
  if (rows.length === 0) {
    return res.status(400).render('clients/import', {
      title: 'Import bureau report', client, parsed: null, error: 'No accounts were confirmed, so nothing was saved.',
    });
  }

  const snapshotId = transaction((db) => {
    const inserted = db.prepare(`
      INSERT INTO bureau_snapshots (
        client_id, provider, source_kind, is_simulated, status, reference, requested_by, completed_at
      ) VALUES (?, ?, 'pdf_import', 0, 'success', ?, ?, datetime('now'))
    `).run(
      client.id,
      req.body.bureau || 'pdf_import',
      req.body.reportReference || null,
      req.user.id,
    );
    const id = Number(inserted.lastInsertRowid);
    insertAccounts(db, client.id, id, rows);
    return id;
  });

  recordAudit({
    actor: req.user,
    action: 'import.committed',
    entityType: 'client',
    entityId: client.id,
    detail: { snapshotId, accountCount: rows.length, bureau: req.body.bureau || null },
    req,
  });

  return res.redirect(`/clients/${client.id}?flash=import-complete`);
});

/**
 * Reads the review form back into canonical accounts. Fields arrive as parallel
 * arrays (`creditorName[]`, `balance[]`, …); a row is only kept when its
 * `include[]` checkbox was ticked.
 */
function collectRows(body) {
  const names = toArray(body.creditorName);
  const included = new Set(toArray(body.include).map(String));

  const rows = [];
  for (let i = 0; i < names.length; i += 1) {
    if (!included.has(String(i))) continue;
    const creditorName = String(names[i] || '').trim();
    if (!creditorName) continue;

    const balance = parseRandsToCents(toArray(body.balance)[i]);
    const instalment = parseRandsToCents(toArray(body.instalment)[i]);
    const arrears = parseRandsToCents(toArray(body.arrears)[i]);
    const accountType = toArray(body.accountType)[i];
    const status = toArray(body.status)[i];
    const monthsInArrears = Number.parseInt(toArray(body.monthsInArrears)[i] ?? '0', 10);

    rows.push({
      creditorName,
      creditorNormalised: creditorName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      accountNumber: toArray(body.accountNumber)[i] || null,
      accountNumberMasked: maskFromForm(toArray(body.accountNumber)[i]),
      accountType: Object.hasOwn(ACCOUNT_TYPES, accountType) ? accountType : 'other',
      status: status || 'open',
      openedDate: toArray(body.openedDate)[i] || null,
      currentBalanceCents: balance ?? 0,
      originalAmountCents: null,
      monthlyInstalmentCents: instalment ?? 0,
      arrearsAmountCents: arrears ?? 0,
      creditLimitCents: null,
      monthsInArrears: Number.isFinite(monthsInArrears) && monthsInArrears > 0 ? monthsInArrears : 0,
      interestRateAnnual: null,
      lastPaymentDate: null,
      bureauUpdatedAt: null,
    });
  }
  return rows;
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function maskFromForm(value) {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (!text) return null;
  return text.length <= 4 ? `••••${text}` : `••••${text.slice(-4)}`;
}
