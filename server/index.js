import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrices, getDbStats } from './db.js';
import { scrapeDateRange } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API: Get prices
app.get('/api/prices', (req, res) => {
  try {
    const { country, start, end } = req.query;
    
    // basic format validation (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (start && !dateRegex.test(start)) {
      return res.status(400).json({ error: 'Invalid start date format. Use YYYY-MM-DD' });
    }
    if (end && !dateRegex.test(end)) {
      return res.status(400).json({ error: 'Invalid end date format. Use YYYY-MM-DD' });
    }
    if (country && !['PT', 'ES'].includes(country.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid country. Must be PT or ES' });
    }

    const prices = getPrices({ country, start, end });
    res.json(prices);
  } catch (error) {
    console.error('API Error /api/prices:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API: Status and Statistics
app.get('/api/status', (req, res) => {
  try {
    const stats = getDbStats();
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      database: stats
    });
  } catch (error) {
    console.error('API Error /api/status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API: Trigger Manual Scrape
app.post('/api/scrape/trigger', async (req, res) => {
  try {
    const { start, end, force } = req.body;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!start || !end || !dateRegex.test(start) || !dateRegex.test(end)) {
      return res.status(400).json({ error: 'Invalid start or end date. Use YYYY-MM-DD' });
    }

    // Trigger asynchronously so API doesn't hang
    scrapeDateRange(start, end, !!force)
      .then((inserted) => {
        console.log(`[Manual Scrape] Completed. Inserted ${inserted} records.`);
      })
      .catch((err) => {
        console.error('[Manual Scrape] Failed:', err);
      });

    res.json({ message: `Scraper started for range ${start} to ${end}.` });
  } catch (error) {
    console.error('API Error /api/scrape/trigger:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Serve frontend static assets (built by SvelteKit static adapter)
const frontendBuildPath = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuildPath));

// Fallback all other routes to frontend SPA router
app.get('*', (req, res) => {
  // If request is looking for an API endpoint that doesn't exist
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Helper to run background scraping
async function runScheduledScrape() {
  const today = new Date().toISOString().split('T')[0];
  
  const tomorrowObj = new Date();
  tomorrowObj.setDate(tomorrowObj.getDate() + 1);
  const tomorrow = tomorrowObj.toISOString().split('T')[0];
  
  console.log(`[Scheduler] Running cron job to fetch prices for today (${today}) and tomorrow (${tomorrow})`);
  try {
    await scrapeDateRange(today, tomorrow);
  } catch (err) {
    console.error('[Scheduler] Scheduled scrape failed:', err);
  }
}

// Initial sync on startup (fetches since user-requested 2026-06-01)
async function initializeData() {
  const startSyncDate = '2026-06-01';
  
  const tomorrowObj = new Date();
  tomorrowObj.setDate(tomorrowObj.getDate() + 1);
  const tomorrow = tomorrowObj.toISOString().split('T')[0];
  
  console.log(`[Startup] Running initial data synchronization since ${startSyncDate} to ${tomorrow}`);
  try {
    await scrapeDateRange(startSyncDate, tomorrow);
    console.log('[Startup] Initial sync completed successfully.');
  } catch (err) {
    console.error('[Startup] Initial sync failed:', err);
  }
}

// Start Server
app.listen(PORT, async () => {
  console.log(`[Server] Server is running on port ${PORT}`);
  
  // Run initial sync
  await initializeData();
  
  // Schedule Cron: Run every hour at minute 5 (e.g. 13:05, 14:05)
  // Tomorrow's data is usually published between 12:00-13:00 Lisbon time.
  cron.schedule('5 * * * *', runScheduledScrape);
  console.log('[Scheduler] Hourly cron job registered (runs at minute 5 of every hour).');
});
