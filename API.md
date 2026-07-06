# 📖 Tarifa Spot API Documentation

This is the documentation for the OMIE (Iberian) energy price API. The server is developed in Node.js using **Express** and data persistence in **SQLite** (via the `better-sqlite3` library).

The API exposes endpoints to query historical data, database statistics, and administrative synchronization (scraping) actions.

---

## ⚙️ Configuration and Startup

The server runs by default on port `3000` (defined by the `PORT` environment variable).

### Environment Variables (`.env`)
- `PORT`: Port where Express will run (Default: `3000`).
- `SCRAPE_API_KEY`: Secret key required to authenticate administrative operations. Must have at least 32 characters.
- `DB_PATH`: Absolute or relative path to the SQLite database (Default: `server/omie_prices.db`).
- `ALLOWED_ORIGINS`: Comma-separated list of origins for CORS rules (Default: `http://localhost:5173,http://localhost:3000`).
- `FRONTEND_BUILD_PATH`: Path to serve static frontend files (Default: `../frontend/build`).

---

## 🔒 Security and Limits (Rate Limiting)

To protect server integrity, request limits per IP are applied:
- **General Endpoints (`/api/*`)**: Maximum of **100 requests every 15 minutes** per IP.
- **Scraper Trigger (`/api/scrape/trigger`)**: Maximum of **5 requests per hour** per IP.

---

## 🚀 API Endpoints

### 1. Get Prices (`GET /api/prices`)
Returns a list of OMIE electricity prices with optional filters.

* **URL:** `/api/prices`
* **Method:** `GET`
* **Query Parameters:**
  * `country` (Optional): Filters by country. Accepted values: `PT` (Portugal) or `ES` (Spain) (case-insensitive).
  * `start` (Optional): Start date in `YYYY-MM-DD` format.
  * `end` (Optional): End date in `YYYY-MM-DD` format.

* **Validations and Restrictions:**
  * The `start` and `end` dates must be physically valid in `YYYY-MM-DD` format.
  * The start date (`start`) cannot be after the end date (`end`).
  * The maximum time range between `start` and `end` cannot exceed **90 days** to avoid overload.
  * The `country` parameter must be strictly `PT` or `ES`.

* **Success Response (200 OK):**
  Returns a JSON array of objects ordered by date, period, and country.
  ```json
  [
    {
      "date": "2026-07-01",
      "period": 1,
      "country": "PT",
      "price": 54.20
    },
    {
      "date": "2026-07-01",
      "period": 1,
      "country": "ES",
      "price": 54.20
    }
  ]
  ```

* **Price Record Structure:**
  * `date` (String): Corresponding date (`YYYY-MM-DD`).
  * `period` (Integer): Hourly/tariff period of the day (typically `1` to `24`, but supports `1` to `96`).
  * `country` (String): Country abbreviation (`PT` or `ES`).
  * `price` (Float): Marginal price of electricity in **€/MWh** (Euros per Megawatt-hour).

* **Error Responses:**
  * **400 Bad Request** (Invalid parameters or range greater than 90 days):
    ```json
    { "error": "Invalid start date. Must be a valid date in YYYY-MM-DD format." }
    ```
    or
    ```json
    { "error": "Date range cannot exceed 90 days." }
    ```
  * **429 Too Many Requests** (Rate limit reached):
    ```json
    { "error": "Too many requests from this IP, please try again after 15 minutes." }
    ```

---

### 2. Server Status and Statistics (`GET /api/status`)
Provides real-time information about the API and the volume of data stored in the database.

* **URL:** `/api/status`
* **Method:** `GET`
* **Query Parameters:** None.

* **Success Response (200 OK):**
  ```json
  {
    "status": "online",
    "timestamp": "2026-07-05T15:20:00.000Z",
    "database": {
      "totalRecords": 7488,
      "minDate": "2026-06-01",
      "maxDate": "2026-07-06"
    }
  }
  ```

* **Response Structure:**
  * `status` (String): API activity status (always `"online"` if responding).
  * `timestamp` (String): Current server date and time in ISO format.
  * `database` (Object):
    * `totalRecords` (Integer): Total number of price records stored in the SQLite database.
    * `minDate` (String|null): First date available in the database.
    * `maxDate` (String|null): Last date available in the database.

---

### 3. Trigger Manual Scrape (`POST /api/scrape/trigger`)
Asynchronously starts a price import process directly from the OMIE website for a specific date range.

* **URL:** `/api/scrape/trigger`
* **Method:** `POST`
* **Headers:**
  * `Content-Type: application/json`
  * `x-api-key`: API key corresponding to `SCRAPE_API_KEY`. (Also accepts standard HTTP header `Authorization: Bearer <API_KEY>`).

* **Request Body (JSON):**
  ```json
  {
    "start": "2026-07-01",
    "end": "2026-07-03",
    "force": false
  }
  ```
  * `start` (Required): Extraction start date (`YYYY-MM-DD`).
  * `end` (Required): Extraction end date (`YYYY-MM-DD`).
  * `force` (Optional, Default: `false`): If `true`, downloads and replaces existing data even if there are already records for those dates in the database.

* **Validations and Restrictions:**
  * Authentication with the correct API key is required.
  * The maximum manual scrape range cannot exceed **31 days (1 month)**.
  * The scrape process runs in the background to avoid blocking the HTTP response.

* **Success Response (200 OK):**
  ```json
  {
    "message": "Scraper started for range 2026-07-01 to 2026-07-03."
  }
  ```

* **Error Responses:**
  * **401 Unauthorized** (Invalid or missing API key):
    ```json
    { "error": "Unauthorized. Invalid or missing API key." }
    ```
  * **400 Bad Request** (Missing parameters or range greater than 31 days):
    ```json
    { "error": "Manual scrape range cannot exceed 31 days (1 month)." }
    ```
  * **429 Too Many Requests** (More than 5 manual scrape attempts per hour):
    ```json
    { "error": "Too many manual scrape requests from this IP, please try again after an hour." }
    ```
