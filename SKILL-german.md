---
name: trainings
description: >
  Interaktive Schulung, Lektion oder Kursmodul als eine einzige offline lauffähige HTML-Datei
  erstellen — mit cineastischen KI-Videos (Higgsfield/Seedance 2.0), beat-synchronen
  Erklär-Animationen (HyperFrames), Voiceover in beliebiger Sprache (ElevenLabs über
  Higgsfield), KI-Bildern, Gamification und Quiz-Interaktionen. Für Unternehmen
  (Mitarbeiterschulung, Compliance, Onboarding), Coaches (Kursmodule, Klientenmaterial),
  Lehrkräfte (Unterrichtseinheiten) und Kursanbieter (E-Learning, Selbstlernkurse).
  Nutzen bei: "interaktive Schulung", "Schulungsvideo", "E-Learning", etc.
---

# /trainings — Interaktive Lerneinheit mit Higgsfield + HyperFrames + Claude

Erstellt eine story-getriebene, interaktive Lernreise als **eine einzige HTML-Datei**:
Level-Struktur, Videos mit Voiceover, Erklär-Animationen synchron zur Stimme, Spiele und
Entscheidungsszenarien, Wissenscheck, Fortschritt in localStorage. Läuft offline per
Doppelklick, teilbar per Mail/Drive/LMS.

**Voraussetzungen:** Higgsfield MCP verbunden (Credits!), HyperFrames-Skills installiert
(`npx skills add heygen-com/hyperframes`), ffmpeg, Node 22+, Whisper (`pip install openai-whisper`).

## Der Ablauf hat zwei Teile — niemals vermischen

| | **TEIL 1 — Curriculum** | **TEIL 2 — Produktion** |
|---|---|---|
| Ergebnis | `curriculum.md` — der komplette Inhalt als Text | die fertige HTML-Datei |
| Kosten | 0 Credits | ~110–1000 Credits |
| Dauer | Minuten | ~1 Stunde |
| Dazwischen | **Freigabe-Gate: explizites „Go" des Users abwarten** | |

**Warum getrennt:** Eine Textänderung in Teil 1 ist gratis — dieselbe Änderung nach der
Produktion kostet neues Voiceover, neuen Render und ggf. einen neuen Film (bei 9 Credits pro
Videosekunde schnell dreistellig). Außerdem muss der Inhalt oft von Dritten freigegeben werden
(Recht, Compliance, Kunde, Fachabteilung) — die lesen ein Dokument, kein fertiges Video.

**Bringt der User bereits Material mit** (Skript, Kurskonzept, Foliensatz, Richtlinie), wird
Teil 1 zum Prüfen und Umbauen: Inhalt auf Level-Struktur mappen, Lücken benennen, Medienplan
und Interaktionen ergänzen. Nicht neu erfinden, was schon da ist.

---

# TEIL 1 — CURRICULUM (keine Credits)

## Phase 0 — Briefing (per AskUserQuestion, alle vier Fragen auf einmal)

Ohne diese Angaben nicht starten — sie bestimmen Umfang, Ton und Produktionskosten.

1. **Thema & Lernziele** — Worum geht es, und was sollen die Lernenden danach können bzw.
   anders machen? Gibt es vorhandenes Material als Grundlage?
2. **Zielgruppe & Vorwissen** — Mitarbeitende / Coaching-Klienten / Schüler:innen /
   Studierende / Kurskäufer; Einsteiger, Fortgeschrittene oder gemischt?
3. **Sprache** — Sprache aller Texte, Stimmen und Bildschirmtexte. Keine Annahme treffen.
4. **Dauer** — bestimmt die Level-Anzahl (Tabelle unten).

**„State, don't ask" (nennen, nicht fragen):** Ansprache leitet sich aus der Zielgruppe ab —
locker/duzend für Coaching, Kurse und Schulungen; formell/siezend für Compliance und
regulierte Branchen. Ebenso: 16:9-Videos, dunkles Design mit Akzentfarbe, XP + Level-Badges.
Im Curriculum sichtbar machen, damit der User widersprechen kann.

### Dauer → Struktur (Level = 1 Video/Animation + 1 Interaktion)

| Gewünschte Dauer | Level | Voiceover je Szene |
|---|---|---|
| ~10–15 Min (Kompakt-Lektion) | 3–4 | ~25–35 s |
| ~20–30 Min (Standard-Modul) | 5–6 | ~30–40 s |
| ~30–45 Min (volle Schulung) | 7–8 | ~35–45 s |
| 60+ Min (Kurs) | in Module à 6–8 Level teilen, je eine HTML-Datei | — |

Faustregel: Ein Level kostet die Lernenden ~4–6 Minuten. Bei 60+ Min NICHT eine Riesendatei
bauen — mehrere Modul-Dateien plus Startscreen mit Modulübersicht.

### Sprachregeln (bei jeder Sprache gleich)

- **Lernenden-Texte** (Voiceover, Bildschirmtexte, Quiz, Feedback) in der Zielsprache.
- **Bild- und Video-Prompts IMMER auf Englisch** — die Modelle sind darauf trainiert. Dazu
  „no readable text, no captions" im Prompt, damit kein falschsprachiger Text im Bild landet.
- **Stimme muss zur Sprache passen:** `list_voices` → Preset-Stimme der Zielsprache wählen,
  Test-Sample generieren und mit Whisper in dieser Sprache transkribieren (`--language <code>`).
- **Layout je Sprache prüfen:** Deutsch/Finnisch haben lange Komposita, die Titel sprengen;
  Spanisch/Französisch brauchen mehr Zeilen.

## Phase 1 — Recherche & Stoffsammlung

- Bei Fach-, Rechts- und Compliance-Themen: **aktuellen Stand recherchieren** (WebSearch).
  Gesetze und Standards ändern sich; Quellen mit Datum notieren.
- Vorhandenes Material des Users sichten und als Primärquelle behandeln.
- Aussortieren: Was ist wirklich handlungsrelevant für diese Zielgruppe? Lieber 5 Dinge, die
  sitzen, als 15 zum Vergessen.

## Phase 2 — Curriculum-Dokument schreiben

Als `curriculum.md` im Projektordner anlegen — es ist ein eigenständiges Dokument, das auch
ohne die spätere HTML-Datei Sinn ergibt und weitergereicht werden kann.

**Story-Rahmen mit Guide-Figur:** ein abstraktes Objekt wählen (leuchtender Orb, Kristall,
Roboterwürfel) — NIEMALS ein Mensch, weil abstrakte Objekte über alle KI-Generationen hinweg
konsistent bleiben. Die Figur spricht die Lernenden direkt an.

### Aufbau von `curriculum.md`

1. **Steckbrief** — Thema, Zielgruppe, Sprache, Dauer, Ansprache, Guide-Figur, Stand/Datum
2. **Lernziele** — übergeordnet plus eines pro Level, formuliert als „Die Lernenden können …"
3. **Level-Übersicht** als Tabelle: Level | Lernziel | Merksatz | Medium | Interaktion
4. **Pro Level ausführlich:**
   - Lernziel und **Merksatz** (der eine Satz, der hängenbleiben soll)
   - **Lehrtext** — die eigentliche fachliche Substanz in Prosa. Das ist der Kern des
     Dokuments und die Grundlage für Voiceover und Bildschirmtexte.
   - **Voiceover-Skript** in der Zielsprache (Wortzahl zur Zieldauer: ~2,5 Wörter/Sekunde)
   - **Medienplan** — genau eine Festlegung pro Level:
     - `FILM` → Seedance-Prompt (Englisch) + geplante Shot-Längen
     - `ANIMATION` → HyperFrames-Beat-Plan (welches Element erscheint zu welcher Aussage)
     - optional `BILD` → GPT-Image-2-Prompt (Englisch) für den Interaktions-Screen
   - **Interaktion vollständig ausformuliert** — Fragen, Optionen, Auflösungen, Feedbacktexte, XP
5. **Abschluss-Check** — alle Fragen mit richtiger Antwort und Ablenkern
6. **Zusammenfassung / Merkblatt** — alle Merksätze für den Abschluss-Screen
7. **Quellen & Stand** — bei Fachthemen Pflicht
8. **Produktionsschätzung** — Credits nach der Tabelle unten

**Medium richtig wählen** (bestimmt Kosten und Qualität):
| Inhalt | Medium |
|---|---|
| Story-Moment, Emotion, Menschen in Situationen | FILM (Seedance) — teuer, sparsam einsetzen |
| Konzepte, Listen, Modelle, Regeln, Prozesse, Zahlen | ANIMATION (HyperFrames) — gratis, scharfer Text |
| Kontext für einen Interaktions-Screen | BILD (GPT Image 2) — fast gratis |

Richtwert: 2–3 Filme pro Schulung, alles andere Animation.

### Interaktions-Baukasten (pro Level eine ANDERE Form — Abwechslung ist der Punkt)

| Interaktion | Wofür |
|---|---|
| Selbsteinschätzung (Slider) | Onboarding, Vorwissen abholen, Personalisierung |
| Vorhersage-Spiel mit Wahrscheinlichkeits-Balken | Aha-Momente, Intuition vs. Realität |
| Irrtum-oder-Fakt-Karten (Flip) | Fakten vs. verbreitete Irrtümer |
| „Finde die N Fehler" (Sätze/Elemente anklicken) | Kritisches Prüfen, Fehlersuche |
| Drag & Drop in Kategorien | Klassifizierungen, Hierarchien, Zuordnungen |
| Szenario-Quiz mit 2 Buttons | Binäre Unterscheidungen |
| Klickbare Zeitleiste | Abläufe, Daten, Meilensteine |
| Branching-Story (3 Optionen, Konsequenz-Feedback) | Alltagsentscheidungen, Verhalten |
| Rapid-Fire mit Timer | Do's & Don'ts, schnelles Urteil |
| Sortier-/Reihenfolge-Aufgabe | Prozesse, Schritt-für-Schritt-Abläufe |
| Abschluss-Check (8–10 Fragen, gemischt) | Wissenssicherung am Ende |

**Abschluss:** Zusammenfassungs-Screen mit den Merksätzen aller Level, erreichten XP und
Ergebnis des Abschluss-Checks — plus druckbarem Merkblatt (Print-CSS). (Ein Zertifikat ist
standardmäßig NICHT Teil der Schulung; nur bauen, wenn der User es ausdrücklich verlangt.)

## ⛔ Freigabe-Gate

`curriculum.md` an den User ausliefern und **auf ein explizites „Go" warten**. Vorher wird
kein einziger Credit ausgegeben. Beim Übergeben diese Punkte zur Prüfung nennen:

- Decken die Level die Lernziele ab — fehlt etwas Handlungsrelevantes?
- Stimmen Fakten und Rechtsstand (Quellen genannt)?
- Passen Ansprache und Beispiele zur Zielgruppe?
- Ist die geschätzte Dauer realistisch?
- Ist die Credit-Schätzung in Ordnung?

Änderungswünsche im Dokument einarbeiten und erneut vorlegen. Erst nach dem „Go" → Teil 2.

---

# TEIL 2 — PRODUKTION (verbraucht Credits)

Ab hier ist `curriculum.md` die verbindliche Quelle. Nicht improvisieren, nicht umformulieren —
was produziert wird, steht im Dokument. Fällt bei der Produktion doch ein inhaltlicher Fehler
auf: erst das Curriculum korrigieren, dann produzieren.

## Phase 3 — Referenzbild der Guide-Figur (Konsistenz-Anker!)

```
generate_image: model "gpt_image_2", 16:9, resolution "1k", quality "high", count 2
```
- Figur exakt beschreiben (Farben, Form, Details, Umgebung) + „no text, no captions".
- **Kandidaten ansehen und den OHNE eingebrannten Text wählen** — GPT Image 2 ist stark im
  Text-Rendering und schreibt deshalb besonders gern den Namen ins Bild; der würde über
  `image_references` in alle Videos durchbluten.
- Die **Job-ID** dieses Bilds als `image_references` in JEDEN Video-Call geben.

## Phase 4 — Voiceover (ElevenLabs ÜBER Higgsfield)

**Warum über Higgsfield:** Direkte ElevenLabs-Free-Accounts blockieren Library-Stimmen per API
und erlauben keine kommerzielle Nutzung. Higgsfields `text2speech_v2` mit `variant: "elevenlabs"`
ist derselbe Stack, läuft über Higgsfield-Credits (~0,3 Credits/Text) mit kommerzieller Lizenz.

```
generate_audio: model "text2speech_v2", variant "elevenlabs",
                voice_type "preset", voice_id <aus list_voices>
```
- Bewährt für Deutsch: **„Ines"** (`023ebf5e-1970-40d8-825c-a5ef6a1dd4ff`) — ruhig, klar;
  „Elena" (`ca83ca7f-c186-493d-bd69-0d765fa861b2`) spricht von Haus aus schneller.
  Für andere Sprachen `list_voices` abfragen und per Test-Sample prüfen.
- **⚠ TEMPO-REGEL:** TTS-Erzählstimmen sind fürs Lernen zu langsam. IMMER nachbeschleunigen:
  ```bash
  ffmpeg -i vo.mp3 -filter:a "atempo=1.15" -b:a 128k vo_fast.mp3
  ```
  1,15x klingt natürlich (tonhöhen-neutral); Ziel ist normales Sprechtempo, nicht Hörbuch-Ruhe.
  Faktor am Test-Sample verifizieren — je nach Stimme und Sprache passen auch 1,1 oder 1,2.
- Danach die **beschleunigten** MP3s mit Whisper transkribieren (`--output_format json`) —
  die Segment-Timestamps sind die Choreografie-Grundlage für Phase 6 und legen die
  endgültigen Szenenlängen fest.

## Phase 5 — Cineastische Videos (Seedance 2.0) — nur für die `FILM`-Level

**Immer Seedance 2.0, immer 1080p, immer 16:9** — die Länge ist der einzige variable Parameter
und wird pro Shot passend gewählt.

```
generate_video: model "seedance_2_0", aspect_ratio "16:9", resolution "1080p",
                mode "std", duration <4–15 s>, generate_audio false,
                medias: [Referenzbild als image_references]
```
- `mode: "std"` ist Pflicht — 1080p und 4k funktionieren nicht mit `"fast"`.
- **Länge pro Shot bewusst wählen** (4–15 s erlaubt, kostet 9 Credits/Sekunde):

  | Shot-Typ | Dauer |
  |---|---|
  | Kurzer Beat, Übergang, Stimmungsbild | 4–6 s |
  | Standard-Szene mit einer Aktion | 8–10 s |
  | Ausdrucksvolle Szene mit Handlungsbogen | 12–15 s |

  Bei Sequenzen die Shot-Längen so planen, dass ihre **Summe knapp über der Voiceover-Länge**
  liegt — jede überschüssige Sekunde wird weggeschnitten und ist bezahlt. Beispiel: 38 s
  Voiceover → 15 + 15 + 9 s statt 15 + 15 + 15 s (spart 54 Credits).
- Identischer Stil-Block in jedem Prompt (Look, Licht, „no readable text, no captions,
  no speech, nobody talking") — Seedance kann keinen sauberen Text rendern.
- `get_cost: true` als Preflight, bevor eine ganze Sequenz beauftragt wird.
- Schlägt der Server einen Preset vor: mit `declined_preset_id` wörtlich generieren.

**⚠ LÄNGE-REGEL: Voiceover länger als 15 s → Shots VERKETTEN, NIEMALS loopen.**
Boomerang-Loops (vor/zurück) sehen kaputt aus — die Figur verschwindet und taucht wieder auf.
Stattdessen nahtlose Sequenz:
1. Letzten Frame extrahieren: `ffmpeg -sseof -0.1 -i clip.mp4 -frames:v 1 last.jpg`
2. `media_upload` → curl PUT → `media_confirm`
3. Nächsten Shot mit `start_image: <media_id>` generieren, Prompt beginnt mit
   „SHOT: continuing seamlessly from the start frame — …" (Kamera/Handlung weiterführen)
4. Shots per ffmpeg concat (vorher auf einheitliche fps/Auflösung normalisieren), auf
   VO-Länge + 1 s trimmen; fehlt < 1,5 s: letzten Frame einfrieren (`tpad=stop_mode=clone`).
   So entsteht z. B. ein 38-s-Intro aus 3 Shots (15+15+9).
- Dramaturgie nutzen: Die Sequenz darf einen Bogen erzählen (Warnung → Zögern → Entwarnung).

## Phase 6 — Erklär-Animationen (HyperFrames) — für alle `ANIMATION`-Level

Konzepte, Listen, Modelle, Regeln, Prozesse: als HTML/CSS/GSAP-Komposition bauen und zu MP4
rendern — gestochen scharfer Text in JEDER Sprache (kann Seedance nicht), beat-genau zur Stimme.

- Pro Szene ein Ordner mit `index.html` nach dem HyperFrames-Kontrakt (`/hyperframes-core`):
  Root mit `data-composition-id/-width/-height/-duration` (**1920×1080**, damit die Animationen
  zu den 1080p-Seedance-Clips passen; Dauer = VO_fast + 1 s), mindestens ein `class="clip"`,
  EIN pausiertes GSAP-Timeline auf `window.__timelines["<id>"]`. Schriftgrößen und Abstände
  gegenüber einem 720p-Layout um Faktor 1,5 skalieren.
- **Design = Look der Schulung:** dunkler Hintergrund, eine Akzentfarbe, Guide-Figur als
  CSS-Element (Kreis mit radial-gradient + Glow + Ring) in jeder Szene → Markenklammer.
- **Beats aus den Whisper-Timestamps** der beschleunigten Voiceover: Wenn die Stimme Punkt 3
  nennt, erscheint GENAU DANN Punkt 3. Elemente per `tl.to/from` an die Segment-Startzeiten setzen.
- Stolperfallen (erspart Lint-Runden):
  - Initialzustände mit `gsap.set(...)` VOR der Timeline, nie `tl.set(..., 0)`
  - kein `repeat: -1` (endliche Wiederholungen), keine Uhr, kein Random
  - Titel einzeilig halten (`white-space: nowrap`) — Umbrüche kollidieren mit Inhalten
  - Elemente nicht überlappen lassen — `npx hyperframes check` prüft Layout + WCAG-Kontrast
- Loop: `npx hyperframes lint` → fixen → `npx hyperframes check` → `render --quality draft`
  (Frames extrahieren und ansehen!) → `render --quality high --output final.mp4`
- Ergebnis wiegt ~4–8 MB pro 40-s-Szene in 1080p und kostet keine Credits.

## Phase 7 — Bilder (GPT Image 2) für die interaktiven Screens

```
generate_image: model "gpt_image_2", 16:9, resolution "1k", quality "high"
```
Bilder machen die Quiz-Screens lebendig — gleiche Bildwelt wie die Videos:
- Startscreen-Hero (das Referenzbild wiederverwenden — kostenlos)
- eine Illustration PRO Entscheidungsszenario
- Vergleichs-Panels für Gegenüberstellungen
- Header-Bild für Suchspiele, Abschlussbild für den Zusammenfassungs-Screen
- Immer: Stil-Block der Videos + „no readable text, no faces" — bei GPT Image 2 besonders
  wichtig, sonst landen (oft falschsprachige) Beschriftungen im Bild
- `quality: "high"` für Hero- und Szenario-Bilder, `"medium"` reicht für Deko im Hintergrund
- Komprimieren: `ffmpeg -i in.png -vf "scale=1024:-2" -q:v 4 out.jpg` → ~80 KB/Bild

## Phase 8 — Muxing (ffmpeg)

- Animationen (exakt VO+1 s lang): Video kopieren, Audio padden:
  `-filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" -t <videodauer> -c:v copy -c:a aac -b:a 96k -ac 1 -movflags +faststart`
- Film-Sequenzen: concat → trim auf VO+1 s → `-c:v libx264 -crf 27 -pix_fmt yuv420p`
- **Größe managen:** Die 1080p-Master bleiben als Archiv erhalten (wiederverwendbar für
  Social, LMS, Präsentationen). Für das Einbetten in die HTML-Datei gilt: Der Player zeigt
  die Videos ~800–900 px breit — wird die Gesamtdatei größer als ~50 MB, die Embed-Kopien mit
  `-vf "scale=1280:-2"` herunterskalieren. Sichtbar ist kein Unterschied, die Datei halbiert sich.
- Ziel: ≤ 5 MB pro eingebettetem Clip, Gesamtdatei ≤ 50 MB.

## Phase 9 — Die HTML-Lerneinheit (eine Datei, Vanilla JS)

Template mit Platzhaltern (`{{VIDEO_V0}}`, `{{IMG_SZ1}}` …) bauen, am Ende per Python-Skript
alle Medien als Base64-Data-URIs einsetzen. Architektur:
- SPA mit Screens (`.screen.active`), Header mit Level-Badges + XP, Fortschrittsbalken
- Video-Screen wiederverwendbar (ein `<video>`-Element, src wird gewechselt; „Weiter"-Button
  pulsiert nach `ended`; Hinweis „Ton an!" in der Zielsprache)
- XP-Ökonomie: richtige Antwort volle Punkte, zweiter Versuch halbe, Level-Abschluss +25
- Level-Sperre: Interaktion muss abgeschlossen sein, Videos sind überspringbar
- Namenseingabe optional (nur zur Personalisierung des Feedbacks), nicht erzwingen
- Abschluss-Check: Fragen UND Antwortreihenfolge shuffeln, Auswertung mit Themen-Hinweisen
  zu falschen Antworten, Wiederholung möglich
- Zusammenfassungs-Screen: alle Merksätze aus dem Curriculum, XP-Stand, Print-CSS fürs Merkblatt
- localStorage: Fortschritt speichern, „Fortsetzen"-Button, Reset-Funktion
- `lang`-Attribut auf die Zielsprache setzen
- ⚠ In JS-Strings typografische Anführungszeichen der Zielsprache verwenden (deutsch „…“,
  englisch “…”) — gerade `"` zerbrechen die Strings

## Phase 10 — Browser-Test (Pflicht, vollständig)

Lokal serven (`python3 -m http.server`), dann komplett durchklicken:
1. Alle Videos dekodieren (Probe-Element je VIDEOS-Key, Dauer prüfen) + Bilder eingebettet
2. Jede Interaktion inkl. FEHLER-Pfaden (falsche Antworten, Timer ablaufen lassen)
3. Abschluss-Check absichtlich schlecht abschließen → Auswertung und Retry prüfen
4. Neu laden → „Fortsetzen" funktioniert; Konsole: null Fehler
5. Dateigröße prüfen; Server stoppen, Datei ausliefern

---

## Kosten-Richtwerte (Higgsfield-Credits)

| Posten | Credits |
|---|---|
| **Seedance-Video 1080p** | **9 Credits pro Sekunde** (5 s = 45, 10 s = 90, 15 s = 135) |
| Bild (gpt_image_2, 1k) | ~4 bei `high`, ~2 bei `medium` |
| Referenzbild (2 Kandidaten) | ~8 |
| Voiceover pro Szene | ~0,4 |
| HyperFrames-Renders | 0 (lokal) |

**Beispielrechnung:** Kompakt-Lektion (4 Level, 1 Story-Video à 10 s, 3 Animationen, 3 Bilder)
≈ 110 Credits · Volle Schulung (8 Level, 3 Story-Sequenzen mit zusammen ~105 s Filmmaterial,
5 Animationen, 7 Bilder) ≈ 980 Credits.

Die Videosekunden dominieren die Kosten zu über 95 % — Bilder, Stimmen und die
HyperFrames-Animationen fallen kaum ins Gewicht. Zwei Hebel: Konzepte konsequent als
(kostenlose) HyperFrames-Animation lösen statt als Film, und Shot-Längen exakt auf die
Voiceover zuschneiden. Die Schätzung gehört ins Curriculum, `balance` vor der Produktion prüfen.

## Beispiel-Prompt (das gibt der User dir)

> /trainings — Erstelle eine interaktive Lerneinheit zum Thema **[THEMA]** als eine einzige
> offline lauffähige HTML-Datei. Zielgruppe: **[z. B. neue Mitarbeitende / meine
> Coaching-Klienten / 10. Klasse]**, Sprache: **[z. B. Deutsch]**, Dauer: **[z. B. ~20 Min]**.
> Inhalte sollen abdecken: **[Stichpunkte oder vorhandenes Material]**.
> Erstelle zuerst das Curriculum als Dokument — erst nach meiner Freigabe produzieren.

Fehlt eine der vier Kernangaben (Thema, Zielgruppe, Sprache, Dauer) — nachfragen, nicht raten.
