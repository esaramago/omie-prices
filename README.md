# OMIE Energy Monitor & Dashboard

Aplicação integrada de contêiner único contendo um Scraper de preços de energia da OMIE (Ibérico), uma API em Node.js (Express + SQLite) e um painel interativo em SvelteKit (Svelte 5 + CSS Vanilla + ApexCharts).

## 🚀 Como Executar Localmente

### Pré-requisitos
- Node.js (versão 22.12.0 ou superior recomendada)
- NPM

### 1. Servidor Backend & Scraper
O backend Express gere a base de dados SQLite e realiza a sincronização diária com o portal da OMIE.

```bash
cd server
npm install
npm start
```

- A API estará disponível em `http://localhost:3000`.
- Na primeira execução, o scraper irá descarregar automaticamente os dados históricos desde `01/06/2026` até ao dia atual (este processo pode demorar alguns segundos).
- Um cron job interno está configurado para obter novos preços automaticamente de hora a hora.

### 2. Painel Frontend (SvelteKit)
O frontend consome a API local e disponibiliza um dashboard interativo moderno.

#### Modo de Desenvolvimento (Hot Reload):
```bash
cd frontend
npm install
npm run dev
```
Acesse `http://localhost:5173`. Configure a API para apontar para `http://localhost:3000` (através de proxy do Vite ou requisições relativas).

#### Compilar para Produção (SPA Estático):
Para que o Express sirva a interface compilada (contêiner único):
```bash
cd frontend
npm run build
```
O SvelteKit irá compilar a aplicação SPA para o diretório `frontend/build`, que é a pasta pública servida pelo servidor Express do backend.

---

## 🐳 Produção & Deploy com Docker (Coolify)

Este projeto está pronto a ser implantado de forma simples em qualquer servidor Coolify (ou Docker):

1. O Dockerfile na raiz realiza um build multi-stage:
   - **Stage 1:** Instala e compila o frontend SvelteKit estático.
   - **Stage 2:** Instala dependências do backend Express, copia os ficheiros compilados do frontend para servir na porta `3000` e configura o ambiente.
2. **Volumes Persistentes (Crucial):**
   - O banco de dados SQLite é persistido em `/data/omie_prices.db` dentro do contêiner.
   - Configure um volume montando `/data` no Coolify (ex: `omie-data:/data`) para garantir que os dados não sejam limpos durante reinstalações ou reinicializações do contêiner.

Para testar o build Docker localmente:
```bash
docker build -t omie-dashboard .
docker run -p 3000:3000 -v $(pwd)/data:/data omie-dashboard
```
