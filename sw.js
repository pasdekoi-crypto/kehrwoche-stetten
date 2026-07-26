const CACHE_NAME = 'kehrwoche-cache-v1';
const APP_SHELL = [
    './icon-192.png',
    './icon-512.png',
    './manifest.json'
];

// --- Firebase Cloud Messaging: Push-Benachrichtigungen im Hintergrund anzeigen ---
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyAe6DEqtK9CBDEWO1KGnIva3ZzW1i5EDE4",
    authDomain: "kehrwoche-app.firebaseapp.com",
    projectId: "kehrwoche-app",
    storageBucket: "kehrwoche-app.firebasestorage.app",
    messagingSenderId: "1064172937181",
    appId: "1:1064172937181:web:61d9e75d57ff5d34a4a034"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    // Bewusst nur "data"-Felder (kein "notification"-Feld in der Cloud Function),
    // sonst zeigt das Betriebssystem die Nachricht automatisch UND dieser Handler
    // nochmal an -> doppelte Benachrichtigungen.
    const title = (payload.data && payload.data.title) || "Haus-App Stetten";
    const options = {
        body: (payload.data && payload.data.body) || "",
        icon: './icon-192.png'
    };
    self.registration.showNotification(title, options);
});

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Die HTML-Seite selbst: immer versuchen, die neueste Version zu laden,
    // damit Updates ankommen. Offline: letzte gespeicherte Version anzeigen.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Alles andere (Tailwind, Firebase-SDK-Module, Icons, Ping-Sound):
    // erst aus dem Cache, sonst nachladen und cachen.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            });
        })
    );
});
