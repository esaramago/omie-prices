import { insertPrices, getRecordCountForDate } from './db.js';

/**
 * Parses a date string "YYYY-MM-DD" to "YYYYMMDD"
 * @param {string} dateStr 
 * @returns {string}
 */
function formatDateForUrl(dateStr) {
  return dateStr.replace(/-/g, '');
}

/**
 * Helper to generate an array of date strings between start and end dates (inclusive).
 * @param {string} start YYYY-MM-DD
 * @param {string} end YYYY-MM-DD
 * @returns {string[]}
 */
export function getDatesBetween(start, end) {
  const dates = [];
  let current = new Date(start);
  const stop = new Date(end);

  while (current <= stop) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Fetches and parses OMIE prices for a specific date.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Promise<Array<{date: string, period: number, country: string, price: number}>>}
 */
export async function fetchPricesForDate(dateStr) {
  const formattedDate = formatDateForUrl(dateStr);
  const url = `https://www.omie.es/es/file-download?parents%5B0%5D=marginalpdbc&filename=marginalpdbc_${formattedDate}.1`;
  
  console.log(`[Scraper] Fetching OMIE data for ${dateStr} from: ${url}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`[Scraper] File not found (404) for date ${dateStr}. It may not be published yet.`);
        return [];
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/);
    const records = [];

    // Skip header line (usually "MARGINALPDBC;")
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line === '*' || line.startsWith('*')) {
        continue;
      }

      const parts = line.split(';');
      // Expecting at least: Year;Month;Day;Period;Price_ES;Price_PT;
      if (parts.length < 6) {
        continue;
      }

      const year = parts[0];
      const month = parts[1];
      const day = parts[2];
      const period = parseInt(parts[3], 10);
      const priceEsRaw = parts[4];
      const pricePtRaw = parts[5];

      if (isNaN(period)) {
        continue;
      }

      const parsedDate = `${year}-${month}-${day}`;
      
      // Robust float parsing replacing commas with dots just in case
      const priceEs = parseFloat(priceEsRaw.replace(',', '.'));
      const pricePt = parseFloat(pricePtRaw.replace(',', '.'));

      if (!isNaN(priceEs)) {
        records.push({
          date: parsedDate,
          period,
          country: 'ES',
          price: priceEs
        });
      }

      if (!isNaN(pricePt)) {
        records.push({
          date: parsedDate,
          period,
          country: 'PT',
          price: pricePt
        });
      }
    }

    console.log(`[Scraper] Parsed ${records.length} records for ${dateStr}.`);
    return records;
  } catch (error) {
    console.error(`[Scraper] Failed to fetch/parse data for ${dateStr}:`, error);
    return [];
  }
}

/**
 * Runs the scraper for a range of dates, inserting new records.
 * @param {string} startDateStr YYYY-MM-DD
 * @param {string} endDateStr YYYY-MM-DD
 * @param {boolean} force If true, scrapes even if date is already in database
 */
export async function scrapeDateRange(startDateStr, endDateStr, force = false) {
  const dates = getDatesBetween(startDateStr, endDateStr);
  console.log(`[Scraper] Starting scrape for range ${startDateStr} to ${endDateStr} (${dates.length} days)...`);
  
  let totalInserted = 0;
  
  for (const date of dates) {
    // Check if we already have data for this date (expecting 192 records: 96 for ES + 96 for PT)
    // On clock change days it might be 92*2=184 or 100*2=200, so we check if count > 0 to see if we have ANY data.
    // If not force, and we have data, we skip.
    if (!force) {
      const existingCount = getRecordCountForDate(date);
      if (existingCount > 0) {
        console.log(`[Scraper] Date ${date} already has ${existingCount} records. Skipping.`);
        continue;
      }
    }

    // Delay slightly to prevent hammer-blocking
    await new Promise((resolve) => setTimeout(resolve, 500));

    const records = await fetchPricesForDate(date);
    if (records.length > 0) {
      const inserted = insertPrices(records);
      totalInserted += inserted;
      console.log(`[Scraper] Saved ${inserted} database entries for ${date}.`);
    }
  }

  console.log(`[Scraper] Finished date range scrape. Total entries inserted/updated: ${totalInserted}`);
  return totalInserted;
}
