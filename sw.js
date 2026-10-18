/* Rainbow Coloring Book - service worker
   Saves the whole book on the device so the app also works without internet.
   When you change any file, change VERSION so everyone gets the new files. */
const VERSION = 'rainbow-coloring-v2';
const CORE = ["./", "index.html", "style.css", "app.js", "pictures.js", "hero.jpg", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/favicon-48.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/icon.svg"];
const MORE = ["thumbs/airplane.png", "thumbs/ant.png", "thumbs/apple-house.png", "thumbs/apple.png", "thumbs/avocado.png", "thumbs/banana-house.png", "thumbs/banana.png", "thumbs/bee.png", "thumbs/blue-bird.png", "thumbs/bus.png", "thumbs/butterfly.png", "thumbs/capsicum.png", "thumbs/car.png", "thumbs/carrot.png", "thumbs/caterpillar.png", "thumbs/cauliflower.png", "thumbs/cherry.png", "thumbs/clownfish.png", "thumbs/daisy-house.png", "thumbs/eggplant.png", "thumbs/elephant.png", "thumbs/giraffe.png", "thumbs/goldfish.png", "thumbs/grape.png", "thumbs/horse.png", "thumbs/ladybug.png", "thumbs/lion-mouse.png", "thumbs/lion.png", "thumbs/mango.png", "thumbs/monkey.png", "thumbs/mosquito.png", "thumbs/mushroom-house.png", "thumbs/onion.png", "thumbs/orange-house.png", "thumbs/orange.png", "thumbs/owl.png", "thumbs/parrot.png", "thumbs/pear-house.png", "thumbs/pigeon.png", "thumbs/potato.png", "thumbs/pumpkin.png", "thumbs/rabbit.png", "thumbs/snail.png", "thumbs/strawberry.png", "thumbs/thirsty-crow.png", "thumbs/tomato.png", "thumbs/tortoise-hare.png", "thumbs/tortoise.png", "thumbs/toucan.png", "data/airplane.js", "data/ant.js", "data/apple-house.js", "data/apple.js", "data/avocado.js", "data/banana-house.js", "data/banana.js", "data/bee.js", "data/blue-bird.js", "data/bus.js", "data/butterfly.js", "data/capsicum.js", "data/car.js", "data/carrot.js", "data/caterpillar.js", "data/cauliflower.js", "data/cherry.js", "data/clownfish.js", "data/daisy-house.js", "data/eggplant.js", "data/elephant.js", "data/giraffe.js", "data/goldfish.js", "data/grape.js", "data/horse.js", "data/ladybug.js", "data/lion-mouse.js", "data/lion.js", "data/mango.js", "data/monkey.js", "data/mosquito.js", "data/mushroom-house.js", "data/onion.js", "data/orange-house.js", "data/orange.js", "data/owl.js", "data/parrot.js", "data/pear-house.js", "data/pigeon.js", "data/potato.js", "data/pumpkin.js", "data/rabbit.js", "data/snail.js", "data/strawberry.js", "data/thirsty-crow.js", "data/tomato.js", "data/tortoise-hare.js", "data/tortoise.js", "data/toucan.js"];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    // the pictures: save one by one so a single hiccup does not stop the install
    await Promise.all(MORE.map(url => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === location.origin) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const home = await cache.match('index.html');
        if (home) return home;
      }
      throw err;
    }
  })());
});
