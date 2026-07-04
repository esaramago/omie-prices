import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validação do DB_PATH para evitar path traversal
let dbPath = process.env.DB_PATH;
if (dbPath) {
  const normalized = path.normalize(dbPath);
  // Garante que o path é absoluto e está dentro de /data ou do diretório do projeto
  if (!normalized.startsWith('/data/') && !normalized.startsWith(path.join(__dirname, ''))) {
    console.warn(`[DB] Invalid DB_PATH: ${dbPath}. Falling back to default.`);
    dbPath = undefined;
  }
}
dbPath = dbPath || path.join(__dirname, 'omie_prices.db');

console.log(`[DB] Connecting to SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

// Enable WAL mode for better concurrency, set synchronous to NORMAL, and set busy_timeout to prevent SQLITE_BUSY
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('temp_store = MEMORY');

// Verificação de integridade da base de dados
try {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    console.error('[DB] Integrity check failed:', integrity);
    db.pragma('recover'); // Tenta recuperar (SQLite 3.38+)
  }
} catch (err) {
  console.error('[DB] Integrity check error:', err);
}

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS omie_prices (
    date TEXT,
    period INTEGER,
    country TEXT,
    price REAL,
    PRIMARY KEY (date, period, country)
  );
  CREATE INDEX IF NOT EXISTS idx_omie_prices_date ON omie_prices(date);
  CREATE INDEX IF NOT EXISTS idx_omie_prices_country ON omie_prices(country);
`);

/**
 * Valida se um registo é válido
 * @param {object} record 
 * @returns {boolean}
 */
function isValidRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return false;
  if (typeof record.period !== 'number' || record.period < 1 || record.period > 96) return false;
  if (!['PT', 'ES'].includes(record.country)) return false;
  if (typeof record.price !== 'number' || isNaN(record.price)) return false;
  return true;
}

/**
 * Inserts a list of price records in a single transaction.
 * @param {Array<{date: string, period: number, country: string, price: number}>} records 
 */
export function insertPrices(records) {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO omie_prices (date, period, country, price)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction((rows) => {
    let inserted = 0;
    for (const row of rows) {
      if (!isValidRecord(row)) {
        console.warn('[DB] Invalid record skipped:', row);
        continue;
      }
      const result = insertStmt.run(row.date, row.period, row.country, row.price);
      if (result.changes > 0) {
        inserted++;
      }
    }
    return inserted;
  });

  return transaction(records);
}

/**
 * Queries prices from the database with optional filters.
 * @param {object} filters 
 * @param {string} [filters.country] 'PT' or 'ES'
 * @param {string} [filters.start] YYYY-MM-DD
 * @param {string} [filters.end] YYYY-MM-DD
 */
export function getPrices({ country, start, end }) {
  let query = 'SELECT date, period, country, price FROM omie_prices WHERE 1=1';
  const params = [];

  if (country) {
    query += ' AND country = ?';
    params.push(country.toUpperCase());
  }

  if (start) {
    query += ' AND date >= ?';
    params.push(start);
  }

  if (end) {
    query += ' AND date <= ?';
    params.push(end);
  }

  query += ' ORDER BY date ASC, period ASC, country ASC';

  return db.prepare(query).all(...params);
}

/**
 * Checks how many records exist for a specific date.
 * @param {string} date YYYY-MM-DD
 * @returns {number}
 */
export function getRecordCountForDate(date) {
  const row = db.prepare('SELECT COUNT(*) as count FROM omie_prices WHERE date = ?').get(date);
  return row ? row.count : 0;
}

/**
 * Gets database stats for status API.
 */
export function getDbStats() {
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM omie_prices').get().count;
  const dates = db.prepare('SELECT MIN(date) as minDate, MAX(date) as maxDate FROM omie_prices').get();
  return {
    totalRecords: totalCount,
    minDate: dates.minDate || null,
    maxDate: dates.maxDate || null
  };
}

/**
 * Closes the SQLite database connection.
 */
export function closeDb() {
  if (db) {
    console.log('[Database] Closing SQLite database connection...');
    try {
      db.close();
    } catch (err) {
      console.error('[Database] Error closing database:', err);
    }
  }
}

// Handlers para fecho seguro em caso de crash
process.on('exit', () => closeDb());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
process.on('uncaughtException', (err) => {
  console.error('[Database] Uncaught Exception:', err);
  closeDb();
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[Database] Unhandled Rejection:', err);
  closeDb();
  process.exit(1);
});
