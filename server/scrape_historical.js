import { scrapeDateRange } from './scraper.js';

console.log('Starting historical scrape from 2026-01-01 to 2026-05-31...');
scrapeDateRange('2026-01-01', '2026-05-31')
  .then((inserted) => {
    console.log(`Scrape finished. Inserted ${inserted} records.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Scrape failed:', err);
    process.exit(1);
  });
