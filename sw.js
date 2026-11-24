// SGO_RA no celular: guarda as peças do aplicativo para abrir sem internet. Os DADOS não passam por aqui
// (ficam criptografados no armazém do aparelho). Ao publicar uma versão nova, trocar VERSAO.
const VERSAO = 'sgora-celular-v1';
const PECAS = ['./', 'index.html', 'nucleo.js', 'armazem.js', 'drive.js', 'maos.png', 'icone.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(PECAS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;   // Google: sempre pela internet
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
