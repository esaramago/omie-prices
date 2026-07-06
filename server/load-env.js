import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const localEnv = path.join(__dirname, '.env');
const rootEnv = path.join(__dirname, '../.env');

// Try to load from CWD or server directory first, then fallback to root
const localResult = dotenv.config({ path: localEnv, override: true });
const rootResult = dotenv.config({ path: rootEnv, override: true });

console.log('[ENV] Loading environment variables...');
if (localResult.parsed) {
  console.log('[ENV] Loaded variables from server/.env');
}
if (rootResult.parsed) {
  console.log('[ENV] Loaded variables from root .env');
}

if (!process.env.SCRAPE_API_KEY) {
  console.error('[ENV ERROR] SCRAPE_API_KEY could not be loaded into process.env.');
} else {
  console.log('[ENV] SCRAPE_API_KEY successfully loaded. Length:', process.env.SCRAPE_API_KEY.length);
}
