import { createApp } from './app.js';
import { config, assertProductionConfig } from './config.js';
import { purgeExpiredSessions } from './services/users.js';
import { ensureBootstrapAdmin } from './db/bootstrap.js';
import { getDb, closeDb } from './db/index.js';

assertProductionConfig();

const app = createApp();
// Only does anything on a database with no users, so a hosted instance can be
// signed into without shell access on its first boot.
ensureBootstrapAdmin(getDb());
purgeExpiredSessions(getDb());

const server = app.listen(config.port, () => {
  console.log(`Mlinjana debt tool listening on http://localhost:${config.port} (${config.env})`);
  if (config.bureau.allowMock) {
    console.log('Simulated bureau is ENABLED — any data it returns is fictional and is badged as such in the UI.');
  }
});

// Hourly sweep so the sessions table does not accumulate dead rows.
const sweep = setInterval(() => purgeExpiredSessions(getDb()), 3600_000);
sweep.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
