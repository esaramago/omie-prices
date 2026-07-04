import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, 'omie_prices.db');

console.log(`Connecting to SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

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
`);

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
