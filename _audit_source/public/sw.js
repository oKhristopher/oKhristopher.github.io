'use strict';
const CACHE_NAME = 'palavra-shell-v3';
const SHELL = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.json','./icons/icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') { event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(c=>c.put('./index.html',copy));return response;}).catch(()=>caches.match('./index.html'))); return; }
  event.respondWith(caches.match(request).then(cached=>cached || fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(c=>c.put(request,copy));}return response;})));
});
