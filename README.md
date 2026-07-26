# Haus-App Stetten

Kehrwoche- und Müllabfuhr-Planer für Familie Gharbi und Nachbarn: wöchentliche Treppenhaus-Rotation, Müll-Kalender, Cloud-Pinnwand (Firebase) für Nachrichten, Namens-Identität pro Familie, Push-Benachrichtigungen, WhatsApp- und ICS-Kalender-Export sowie KI-gestützter PDF/Foto-Import (Google Gemini) für neue Müll-Termine.

## Nutzung

Einfach `index.html` im Browser öffnen, oder über GitHub Pages hosten:

1. Repo auf GitHub pushen
2. Unter Settings → Pages die Quelle auf den `main`-Branch (Root) stellen
3. Die App ist dann unter `https://<benutzername>.github.io/<repo-name>/` erreichbar

## Features

- Wöchentliche Kehrwoche-Rotation über 8 Parteien, DST-sicher berechnet
- Müllabfuhr-Kalender mit Farbcode (Rest/Bio/Papier/Gelb)
- Cloud-Pinnwand für Nachrichten zwischen Nachbarn (Firebase Firestore)
- Namens-Identität pro Familie mit Sperr-Mechanismus (niemand kann sich als jemand anderes ausgeben)
- Push-Benachrichtigungen für Kehrwoche- und Müll-Erinnerungen
- Admin-Bereich (PIN-geschützt) für Müll-Termine-Verwaltung und KI-Import
- WhatsApp-Teilen und ICS-Kalender-Export
