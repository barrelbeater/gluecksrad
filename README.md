# Glücksrad mit Abstimmungsfaktor

Eine responsive Web-App für lokale und geräteübergreifende Online-Abstimmungen. Die Stimmen bestimmen die Größe und Gewinnwahrscheinlichkeit der Felder auf einem animierten Glücksrad.

## Funktionen

- Eigene Abstimmungsfrage und 2–8 Antwortoptionen
- Anonyme Raumabstimmung durch Weiterreichen eines Geräts
- Neutraler Übergabebildschirm zwischen zwei Stimmen
- Online-Abstimmungen mit sechsstelligen Raumcodes
- Anonyme Teilnahme auf eigenen Smartphones oder Computern
- Live-Aktualisierung der Stimmen für die Moderation
- Synchronisiertes Gewinnergebnis auf allen Geräten
- Gewichtetes, animiertes Glücksrad
- Ergebnisübersicht mit Stimmen und Wahrscheinlichkeiten
- Automatische lokale Speicherung im Browser
- Supabase-Datenbank mit Row Level Security für den Online-Modus
- Kein Build-Prozess und kein eigenes Server-Backend notwendig
- Für Smartphone, Tablet und Desktop optimiert

## Lokal starten

Die App kann direkt über `index.html` geöffnet werden. Zuverlässiger ist ein kleiner lokaler Webserver:

```bash
python3 -m http.server 8000
```

Danach im Browser `http://localhost:8000` öffnen.

## Supabase einrichten

1. Ein Supabase-Projekt erstellen.
2. Unter **Authentication → Sign In / Providers** die Option **Allow anonymous sign-ins** aktivieren.
3. Im **SQL Editor** den vollständigen Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und ausführen.
4. Project URL und Publishable Key in [`js/config.js`](js/config.js) eintragen.

Im Frontend darf ausschließlich ein Publishable Key (`sb_publishable_...`) stehen. Secret- und `service_role`-Keys dürfen niemals im Repository oder Browser verwendet werden.

Das SQL-Skript legt die Tabellen `polls`, `poll_options` und `votes` an. Datenbankregeln sorgen dafür, dass nur die Moderation eine Abstimmung verwalten kann, nur bei offenen Abstimmungen gewählt werden kann und jede anonyme Nutzer-ID pro Abstimmung höchstens eine Stimme abgibt.

## Veröffentlichung mit GitHub Pages

1. Das Projekt zu GitHub pushen.
2. Im Repository **Settings → Pages** öffnen.
3. Unter **Build and deployment** die Quelle **Deploy from a branch** wählen.
4. Branch **main** und Ordner **/(root)** auswählen und speichern.
5. Nach kurzer Zeit zeigt GitHub dort die öffentliche URL an.

## Level 2: Abstimmung ohne Datenbank

Es werden keine Daten an einen Server gesendet. Frage, Optionen und Stimmen bleiben im `localStorage` des verwendeten Browsers. Damit mehrere Personen ohne Datenbank abstimmen können, wird ein gemeinsames Gerät im Raum weitergereicht. Zwischen den Stimmen verdeckt ein Übergabebildschirm die vorherige Auswahl. Erst nach der letzten Stimme kann die Moderation die Auswertung öffnen.

## Level 3: Online-Abstimmung

Die Moderation erstellt einen Online-Raum und teilt Code oder Einladungslink. Teilnehmer:innen werden von Supabase anonym authentifiziert und geben auf ihren eigenen Geräten jeweils eine Stimme ab. Zwischenergebnisse sind nur für die Moderation sichtbar. Nach dem Beenden wird die Auswertung für alle Geräte freigegeben; das von der Moderation gedrehte Gewinnergebnis wird synchronisiert.

Für einen Test mit mehreren Personen sollten unterschiedliche Browser oder ein privates Browserfenster verwendet werden. Mehrere normale Tabs desselben Browsers teilen sich dieselbe anonyme Supabase-Identität und zählen deshalb als eine Person.
