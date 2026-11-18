// Run the CRM on your own computer: npm start, then open http://localhost:3000
// (On Vercel, api/index.js serves the same routes.)
import { createServer } from 'node:http';
import { config, metaReady } from './lib/config.js';
import { handle } from './lib/app.js';
import { syncRecent } from './lib/meta.js';
import { logEvent } from './lib/db.js';

createServer(handle).listen(config.port, () => {
  console.log(`ZUFA CRM running on http://localhost:${config.port}`);
  console.log(config.databaseUrl ? 'Database: Postgres (DATABASE_URL)' : `Database: local PGlite in ${config.dataDir}`);
  console.log(metaReady() ? `Meta: connected to Page ${config.pageId} (Graph API ${config.graphVersion})` : 'Meta: not connected yet (fill in crm/.env)');
});

// On Vercel this is a cron job; locally a timer does the same.
if (config.syncIntervalMin > 0) {
  setInterval(() => { if (metaReady()) syncRecent(2).catch(e => logEvent('sync', false, `Automatic check failed: ${e.message}`)); }, config.syncIntervalMin * 60e3).unref();
}
