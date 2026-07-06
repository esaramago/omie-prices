# Tarifa Spot

Integrated single-container application containing an OMIE (Iberian) energy price Scraper, a Node.js API (Express + SQLite), and an interactive panel in SvelteKit (Svelte 5 + Vanilla CSS + ApexCharts).

## 🚀 How to Run Locally

### Prerequisites
- Node.js (version 22.12.0 or higher recommended)
- NPM

### 1. Backend Server & Scraper
The Express backend manages the SQLite database and performs daily synchronization with the OMIE portal.

```bash
cd server
npm install
npm start
```

- The API will be available at `http://localhost:3000`.
- On the first run, the scraper will automatically download historical data from `2026-01-01` to the current day (this process may take a few seconds).
- An internal cron job is configured to fetch new prices automatically every hour.

### 2. Frontend Panel (SvelteKit)
The frontend consumes the local API and provides a modern interactive dashboard.

#### Development Mode (Hot Reload):
```bash
cd frontend
npm install
npm run dev
```
Access `http://localhost:5173`. Configure the API to point to `http://localhost:3000` (via Vite proxy or relative requests).

#### Build for Production (Static SPA):
To let Express serve the compiled interface (single container):
```bash
cd frontend
npm run build
```
SvelteKit will compile the SPA application to the `frontend/build` directory, which is the public folder served by the backend Express server.

---

## 🔌 API Documentation

The integrated API exposes structured endpoints for querying OMIE electricity prices and data management:

- **`GET /api/prices`**: Returns the time series of prices filtered by date and country (`PT` / `ES`).
- **`GET /api/status`**: Returns the server status and data count statistics of the database.
- **`POST /api/scrape/trigger`**: Triggers a manual background routine to extract OMIE data for a date range.

For full details on data formats, admin authentication, restrictions, and rate limits (Rate Limiting), see the [API Documentation (API.md)](API.md).

---

## 🐳 Production & Deploy with Docker (Coolify)

This project is ready to be easily deployed on any Coolify (or Docker) server:

1. The Dockerfile in the root performs a multi-stage build:
   - **Stage 1:** Installs and compiles the static SvelteKit frontend.
   - **Stage 2:** Installs Express backend dependencies, copies the compiled frontend files to be served on port `3000`, and configures the environment.
2. **Persistent Volumes (Crucial):**
   - The SQLite database is persisted in `/data/omie_prices.db` inside the container.
   - Configure a volume mounting `/data` in Coolify (e.g., `omie-data:/data`) to ensure data is not lost during container reinstalls or restarts.

To test the Docker build locally:
```bash
docker build -t omie-dashboard .
docker run -p 3000:3000 -v $(pwd)/data:/data omie-dashboard
```

---

## 📄 License

This project is licensed under the GNU Affero General Public License v3 - see the [LICENSE](LICENSE) file for details.

