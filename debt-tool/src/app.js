import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { formatCents, formatPercent } from './lib/money.js';
import { formatDate } from './lib/dates.js';
import {
  cookieParser, attachUser, csrf, securityHeaders,
} from './web/middleware.js';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { ingestRouter } from './routes/ingest.js';
import { adminRouter } from './routes/admin.js';
import { apiRouter } from './routes/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  getDb();

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(here, 'views'));
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use('/static', express.static(path.join(here, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser);
  app.use(attachUser);

  // Template helpers are set before the CSRF check, not after: a request rejected
  // by that check still has to render the error page, and the shared header needs
  // these locals to do it.
  app.use((req, res, next) => {
    res.locals.money = formatCents;
    res.locals.percent = formatPercent;
    res.locals.formatDate = formatDate;
    res.locals.currentPath = req.path;
    res.locals.appName = 'Mlinjana Financial Group';
    res.locals.env = config.env;
    res.locals.pullError = null;
    res.locals.csrfToken = '';
    next();
  });

  app.use(csrf);

  app.get('/', (req, res) => res.redirect(req.user ? '/clients' : '/login'));

  app.use(authRouter);
  app.use(apiRouter);
  app.use(clientsRouter);
  app.use(ingestRouter);
  app.use('/admin', adminRouter);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    return res.status(404).render('error', { title: 'Not found', status: 404, message: 'That page does not exist.' });
  });

  app.use(errorHandler);

  return app;
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
function errorHandler(err, req, res, next) {
  let status = err.statusCode ?? err.status ?? 500;
  let message = err.message;

  // multer reports a rejected upload as a server error by default, but an
  // oversized or wrong-typed file is the uploader's mistake and should say so.
  if (err.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is larger than this instance accepts. Ask the client for a smaller PDF, or raise MAX_UPLOAD_BYTES.'
      : `That upload could not be accepted (${err.code}).`;
  }

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: status >= 500 ? 'Internal error' : message });
  }

  return res.status(status).render('error', {
    title: 'Something went wrong',
    status,
    // A 500 can carry a stack trace or a database path in its message; only
    // deliberate 4xx messages are safe to show.
    message: status >= 500 ? 'Something went wrong on our side. The error has been logged.' : message,
  });
}
