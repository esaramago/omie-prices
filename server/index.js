import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrices, getDbStats, closeDb } from './db.js';
import { scrapeDateRange } from './scraper.js';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for rate limiting behind reverse proxies like Coolify/Traefik/Nginx)
app.set('trust proxy', 1);

// HTTP Security Headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Allowed for SvelteKit client-side hydration
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // Allowed for inline styles and Google Fonts
        fontSrc: ["'self'", "https://fonts.gstatic.com"], // Allowed for Google Fonts
        imgSrc: ["'self'", "data:"], // Allowed for self images and inline data URIs
        connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"] // Allowed for local API calls and Google Fonts CSS/fonts fetched via Service Worker
      }
    }
  })
);

app.use(express.json({ limit: '10kb' }));

// CORS restrito - apenas origens permitidas
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  optionsSuccessStatus: 200,
  credentials: false
};
app.use(cors(corsOptions));

// Rate Limiting Configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: 'draft-6', // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

const scrapeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5, // Limit each IP to 5 manual scrape requests per hour
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { error: 'Too many manual scrape requests from this IP, please try again after an hour.' }
});

// Apply general API rate limiter to all api routes
app.use('/api/', apiLimiter);

// Helper to validate if a string is a physically valid date (YYYY-MM-DD)
function isValidDate(dateStr) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;

  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

// API: Get prices
app.get('/api/prices', (req, res) => {
  try {
    const { country, start, end } = req.query;
    
    if (start && !isValidDate(start)) {
      return res.status(400).json({ error: 'Invalid start date. Must be a valid date in YYYY-MM-DD format.' });
    }
    if (end && !isValidDate(end)) {
      return res.status(400).json({ error: 'Invalid end date. Must be a valid date in YYYY-MM-DD format.' });
    }
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (startDate > endDate) {
        return res.status(400).json({ error: 'Start date cannot be after end date.' });
      }
      const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));
      // Limitar a 90 dias para evitar sobrecarga
      if (diffDays > 90) {
        return res.status(400).json({ error: 'Date range cannot exceed 90 days.' });
      }
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

// API Key Authentication Middleware for administrative actions
const SCRAPE_API_KEY = process.env.SCRAPE_API_KEY;

// Validação da API key - deve ter pelo menos 32 caracteres
if (!SCRAPE_API_KEY || SCRAPE_API_KEY.length < 32) {
  console.error('[SECURITY ERROR] SCRAPE_API_KEY is missing or invalid. Shutting down.');
  process.exit(1);
}

function authenticateScrape(req, res, next) {
  let apiKey = req.headers['x-api-key'];
  
  if (!apiKey && req.headers['authorization']) {
    const parts = req.headers['authorization'].split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      apiKey = parts[1];
    }
  }

  if (!apiKey || apiKey !== SCRAPE_API_KEY) {
    console.warn(`[SECURITY] Invalid API key attempt from ${req.ip} at ${new Date().toISOString()}`);
    return res.status(401).json({ error: 'Unauthorized. Invalid or missing API key.' });
  }

  next();
}

// API: Trigger Manual Scrape
app.post('/api/scrape/trigger', scrapeLimiter, authenticateScrape, async (req, res) => {
  try {
    const { start, end, force } = req.body;

    if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
      return res.status(400).json({ error: 'Invalid start or end date. Must be valid dates in YYYY-MM-DD format.' });
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (startDate > endDate) {
      return res.status(400).json({ error: 'Start date cannot be after end date.' });
    }
    const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 30) {
      return res.status(400).json({ error: 'Manual scrape range cannot exceed 31 days (1 month).' });
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
const frontendBuildPath = process.env.FRONTEND_BUILD_PATH || path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuildPath));

// Fallback all other routes to frontend SPA router
app.get(/.*/, (req, res) => {
  // If request is looking for an API endpoint that doesn't exist
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Global Error Handler Middleware (Must be defined after all other routes and middlewares)
app.use((err, req, res, next) => {
  console.error('[Global Error Handler] Unhandled error:', err);
  
  if (res.headersSent) {
    return next(err);
  }

  // Handle invalid JSON payload errors from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  // Em produção, não expor detalhes do erro
  const errorResponse = {
    error: 'Internal Server Error'
  };
  
  // Em desenvolvimento, incluir detalhes para debug
  if (process.env.NODE_ENV === 'development') {
    errorResponse.details = err.message;
  }

  res.status(err.status || 500).json(errorResponse);
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
const server = app.listen(PORT, async () => {
  console.log(`[Server] Server is running on port ${PORT}`);
  
  // Run initial sync
  await initializeData();
  
  // Schedule Cron: Run every hour at minute 5 (e.g. 13:05, 14:05)
  // Tomorrow's data is usually published between 12:00-13:00 Lisbon time.
  cron.schedule('5 * * * *', runScheduledScrape);
  console.log('[Scheduler] Hourly cron job registered (runs at minute 5 of every hour).');
});

// Graceful Shutdown Handler
function handleGracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    console.log('[Server] Express server closed.');
    
    // Close database connection
    try {
      closeDb();
    } catch (err) {
      console.error('[Server] Error closing database:', err);
    }
    
    console.log('[Server] Graceful shutdown complete. Exiting.');
    process.exit(0);
  });

  // Force exit after 10s if shutdown hangs
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcing shut down.');
    process.exit(1);
  }, 10000);
}

// Register listeners for terminal signals
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
