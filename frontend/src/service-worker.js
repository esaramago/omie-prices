/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;

// Ficheiros estáticos gerados pelo Vite e os ficheiros da pasta static
const ASSETS = [
  ...build,
  ...files,
  '/',
  '/index.html'
];

self.addEventListener('install', (event) => {
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    // Fazemos o cache individualmente para evitar que erros em 404 quebrem a instalação
    for (const asset of ASSETS) {
      try {
        await cache.add(asset);
      } catch (err) {
        console.warn(`[Service Worker] Falha ao pré-carregar: ${asset}`, err);
      }
    }
  }

  event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key !== CACHE) {
        await caches.delete(key);
      }
    }
  }

  event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  async function respond() {
    const url = new URL(event.request.url);
    const cache = await caches.open(CACHE);

    // 1. Recursos estáticos (assets gerados ou estáticos do SvelteKit) -> Cache-First
    const isStaticAsset = ASSETS.includes(url.pathname) || url.pathname.startsWith('/_app/');

    if (isStaticAsset) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }

    // 2. Pedidos dinâmicos (API, navegações de página, etc.) -> Network-First com fallback para Cache
    try {
      const response = await fetch(event.request);
      
      const isHttp = url.protocol.startsWith('http');
      // Apenas guardamos em cache se a resposta for bem sucedida (status 200)
      if (isHttp && response.status === 200) {
        cache.put(event.request, response.clone());
      }
      
      return response;
    } catch (err) {
      // Offline fallback: tenta obter da cache
      const cached = await cache.match(event.request);
      if (cached) return cached;

      // Se falhar e for navegação de página, devolve o index.html da cache
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('/index.html') || await cache.match('/');
        if (fallback) return fallback;
      }
      
      throw err;
    }
  }

  event.respondWith(respond());
});
