# Glücksrad mit Abstimmungsfaktor

Eine responsive Web-App für anonyme Abstimmungen in einem Raum. Die Stimmen werden lokal im Browser gesammelt und bestimmen anschließend die Größe und Gewinnwahrscheinlichkeit der Felder auf dem Glücksrad.

## Funktionen

- Eigene Abstimmungsfrage und 2–8 Antwortoptionen
- Anonyme Raumabstimmung durch Weiterreichen eines Geräts
- Neutraler Übergabebildschirm zwischen zwei Stimmen
- Gewichtetes, animiertes Glücksrad
- Ergebnisübersicht mit Stimmen und Wahrscheinlichkeiten
- Automatische lokale Speicherung im Browser
- Keine Datenbank, kein Build-Prozess und keine externen Abhängigkeiten
- Für Smartphone, Tablet und Desktop optimiert

## Lokal starten

Die App kann direkt über `index.html` geöffnet werden. Zuverlässiger ist ein kleiner lokaler Webserver:

```bash
python3 -m http.server 8000
```

Danach im Browser `http://localhost:8000` öffnen.

## Veröffentlichung mit GitHub Pages

1. Das Projekt zu GitHub pushen.
2. Im Repository **Settings → Pages** öffnen.
3. Unter **Build and deployment** die Quelle **Deploy from a branch** wählen.
4. Branch **main** und Ordner **/(root)** auswählen und speichern.
5. Nach kurzer Zeit zeigt GitHub dort die öffentliche URL an.

## Datenschutz und Level 2

Es werden keine Daten an einen Server gesendet. Frage, Optionen und Stimmen bleiben im `localStorage` des verwendeten Browsers. Damit mehrere Personen ohne Datenbank abstimmen können, wird ein gemeinsames Gerät im Raum weitergereicht. Zwischen den Stimmen verdeckt ein Übergabebildschirm die vorherige Auswahl. Erst nach der letzten Stimme kann die Moderation die Auswertung öffnen.
