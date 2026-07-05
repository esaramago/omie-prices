# 📖 Documentação da API OMIE Energy Monitor

Esta é a documentação da API de preços de energia da OMIE (Ibérico). O servidor é desenvolvido em Node.js usando **Express** e persistência de dados em **SQLite** (através da biblioteca `better-sqlite3`).

A API expõe endpoints para consulta de dados históricos, estatísticas do banco de dados e ações administrativas de sincronização (scraping).

---

## ⚙️ Configuração e Inicialização

O servidor corre por padrão na porta `3000` (definida pela variável de ambiente `PORT`).

### Variáveis de Ambiente (`.env`)
- `PORT`: Porta onde o Express será executado (Padrão: `3000`).
- `SCRAPE_API_KEY`: Chave secreta necessária para autenticar operações administrativas. Deve ter pelo menos 32 caracteres.
- `DB_PATH`: Caminho absoluto ou relativo para a base de dados SQLite (Padrão: `server/omie_prices.db`).
- `ALLOWED_ORIGINS`: Lista de origens separadas por vírgula para regras de CORS (Padrão: `http://localhost:5173,http://localhost:3000`).
- `FRONTEND_BUILD_PATH`: Caminho para servir os arquivos estáticos do frontend (Padrão: `../frontend/build`).

---

## 🔒 Segurança e Limites (Rate Limiting)

Para proteger a integridade do servidor, são aplicados limites de requisições por IP:
- **Endpoints gerais (`/api/*`)**: Máximo de **100 requisições a cada 15 minutos** por IP.
- **Trigger de Scraper (`/api/scrape/trigger`)**: Máximo de **5 requisições por hora** por IP.

---

## 🚀 Endpoints da API

### 1. Obter Preços (`GET /api/prices`)
Retorna uma lista de preços de eletricidade da OMIE com filtros opcionais.

* **URL:** `/api/prices`
* **Método:** `GET`
* **Parâmetros de Consulta (Query Parameters):**
  * `country` (Opcional): Filtra por país. Valores aceitos: `PT` (Portugal) ou `ES` (Espanha) (não diferencia maiúsculas de minúsculas).
  * `start` (Opcional): Data de início no formato `YYYY-MM-DD`.
  * `end` (Opcional): Data de fim no formato `YYYY-MM-DD`.

* **Validações e Restrições:**
  * As datas `start` e `end` devem ser fisicamente válidas no formato `YYYY-MM-DD`.
  * A data de início (`start`) não pode ser posterior à data de fim (`end`).
  * O intervalo máximo de tempo entre `start` e `end` não pode exceder **90 dias** para evitar sobrecarga.
  * O parâmetro `country` deve ser estritamente `PT` ou `ES`.

* **Resposta de Sucesso (200 OK):**
  Retorna um array JSON de objetos ordenados por data, período e país.
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

* **Estrutura do Registro de Preço:**
  * `date` (String): Data correspondente (`YYYY-MM-DD`).
  * `period` (Integer): Período horários/tarifário do dia (tipicamente de `1` a `24`, mas suporta de `1` a `96`).
  * `country` (String): Sigla do país (`PT` ou `ES`).
  * `price` (Float): Preço marginal da eletricidade em **€/MWh** (Euros por Megawatt-hora).

* **Respostas de Erro:**
  * **400 Bad Request** (Parâmetros inválidos ou intervalo maior que 90 dias):
    ```json
    { "error": "Invalid start date. Must be a valid date in YYYY-MM-DD format." }
    ```
    ou
    ```json
    { "error": "Date range cannot exceed 90 days." }
    ```
  * **429 Too Many Requests** (Limite de rate limit atingido):
    ```json
    { "error": "Too many requests from this IP, please try again after 15 minutes." }
    ```

---

### 2. Estado do Servidor e Estatísticas (`GET /api/status`)
Fornece informações em tempo real sobre a API e o volume de dados armazenados na base de dados.

* **URL:** `/api/status`
* **Método:** `GET`
* **Parâmetros de Consulta:** Nenhum.

* **Resposta de Sucesso (200 OK):**
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

* **Estrutura da Resposta:**
  * `status` (String): Estado de atividade da API (sempre `"online"` se responder).
  * `timestamp` (String): Data e hora atuais do servidor em formato ISO.
  * `database` (Object):
    * `totalRecords` (Integer): Total de registos de preços armazenados na base de dados SQLite.
    * `minDate` (String|null): Primeira data disponível na base de dados.
    * `maxDate` (String|null): Última data disponível na base de dados.

---

### 3. Disparar Scrape Manual (`POST /api/scrape/trigger`)
Inicia de forma assíncrona um processo de importação de preços diretamente do site da OMIE para um intervalo de datas específico.

* **URL:** `/api/scrape/trigger`
* **Método:** `POST`
* **Cabeçalhos (Headers):**
  * `Content-Type: application/json`
  * `x-api-key`: Chave de API correspondente a `SCRAPE_API_KEY`. (Também aceita cabeçalho HTTP standard `Authorization: Bearer <API_KEY>`).

* **Corpo da Requisição (Body - JSON):**
  ```json
  {
    "start": "2026-07-01",
    "end": "2026-07-03",
    "force": false
  }
  ```
  * `start` (Obrigatorio): Data de início da extração (`YYYY-MM-DD`).
  * `end` (Obrigatorio): Data de fim da extração (`YYYY-MM-DD`).
  * `force` (Opcional, Padrão: `false`): Se for `true`, descarrega e substitui os dados existentes mesmo que já existam registos para essas datas na base de dados.

* **Validações e Restrições:**
  * É necessária autenticação com a chave de API correta.
  * O intervalo máximo do scrape manual não pode exceder **31 dias (1 mês)**.
  * O processo de scrape é executado em background para evitar bloqueio da resposta HTTP.

* **Resposta de Sucesso (200 OK):**
  ```json
  {
    "message": "Scraper started for range 2026-07-01 to 2026-07-03."
  }
  ```

* **Respostas de Erro:**
  * **401 Unauthorized** (Chave de API inválida ou em falta):
    ```json
    { "error": "Unauthorized. Invalid or missing API key." }
    ```
  * **400 Bad Request** (Parâmetros em falta ou intervalo maior que 31 dias):
    ```json
    { "error": "Manual scrape range cannot exceed 31 days (1 month)." }
    ```
  * **429 Too Many Requests** (Mais de 5 tentativas de scrape manual por hora):
    ```json
    { "error": "Too many manual scrape requests from this IP, please try again after an hour." }
    ```
