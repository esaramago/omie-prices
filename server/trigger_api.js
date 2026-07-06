const SCRAPE_API_KEY = 'vkaY21jptfjj3R754ynCs4wpgpHjAZUKk2e6bsnS72pm4uHrgGU6WGvTCFAzFzKE';
const BASE_URL = 'http://localhost:3000';

const ranges = [
  { start: '2026-01-01', end: '2026-01-31' },
  { start: '2026-02-01', end: '2026-02-28' },
  { start: '2026-03-01', end: '2026-03-31' },
  { start: '2026-04-01', end: '2026-04-30' },
  { start: '2026-05-01', end: '2026-05-31' }
];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function triggerScrape(range) {
  console.log(`Triggering scrape for ${range.start} to ${range.end}...`);
  try {
    const response = await fetch(`${BASE_URL}/api/scrape/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': SCRAPE_API_KEY
      },
      body: JSON.stringify({
        start: range.start,
        end: range.end,
        force: false
      })
    });
    const data = await response.json();
    console.log('Response:', response.status, data);
    return response.ok;
  } catch (error) {
    console.error('Fetch error:', error);
    return false;
  }
}

async function run() {
  for (let i = 0; i < ranges.length; i++) {
    const ok = await triggerScrape(ranges[i]);
    if (!ok) {
      console.error('Failed to trigger range. Stopping.');
      break;
    }
    if (i < ranges.length - 1) {
      console.log('Waiting 20 seconds for scraper to run...');
      await delay(20000);
    }
  }
  console.log('Finished triggering all scrapes!');
}

run();
