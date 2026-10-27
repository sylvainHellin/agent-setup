# German reader-facing copy

Language rules for German copy in any asset (slides, letters, board labels, handouts).
Register, staccato, and persistence rules for an asset live in the `documents/authoring` skill under "Reader-facing copy"; this file covers the German-specific failure modes, mostly LLM-typical Denglisch and calques.
Distilled from proofread passes on German workshop decks.

## No Denglisch for everyday nouns

If a German native speaker would not say the word in English in a meeting, it does not belong in the copy.
This hits abstract nouns LLMs habitually leave untranslated.

| Don't | Do |
|---|---|
| das Pain, der Schmerzpunkt-"Pain" | der Schmerzpunkt, das Problem, der Reibungspunkt |
| das Learning, die Insights | die Erkenntnis, die Ergebnisse |
| die Journey, ein Deep Dive | der Ablauf, ein tiefer Einstieg |
| das Alignment, der Approach | die Abstimmung, der Ansatz |
| das Setup, die Challenge | der Aufbau, die Herausforderung |
| der Loop (generisch) | die Schleife |

## Established Fachbegriffe stay English, deliberately

Fixed technical or method terms with no natural German equivalent keep their English form:
Use Case, Roadmap, Backlog, Build/Buy/Wait, Chatbot, Agent, Skill, Prompt, Token, Embedding, Few-Shot, Computer Use, Data Residency, State of AI, Low-Hanging-Fruit, Miro-Board.

The boundary test: a term with a specific technical meaning and no idiomatic German word stays English; a general noun with an obvious German word gets translated.
When unsure, translate.

## Compounds get German orthography (Durchkopplung)

An English noun used in German takes a German article, genus, and hyphenated compounds: "das Use-Case-Board", "der 3-Jahres-ROI", "die Erfolgs-Kennzahl".
No space-separated compounds after the English pattern ("Use Case Board", "ROI Wert"), except where the term itself is a two-word unit ("Use Case" standalone).

## No calques

No English sentence patterns shining through the German:

- "die Plattform serviert den Workflow" -> describe natively what happens
- "wir adressieren das Problem" -> "wir gehen das Problem an"
- "am Ende des Tages" -> "letztlich", "unterm Strich"
- "es macht Sinn" -> "es ist sinnvoll", "es ergibt Sinn"
- "in 2026" -> "2026"
- "realisieren" (for "erkennen") -> "erkennen"

## No two-beat AI subtitle formulas

The pseudo-profound two-part subtitle is a telltale of generated copy: "Wo Sprachmodelle brechen, und was das für den Einsatz bedeutet.", "Was X ist, und warum es Y verändert.".
The same applies to the English pattern it calques ("What X means for Y").
A subtitle states the content directly ("Halluzination, Kontextzerfall und die Grenzen der Selbsteinschätzung."); if it only gestures at significance, delete it.

## Titles and labels as noun phrases, consistently

Slide titles, agenda entries, and overview labels are neutral noun phrases ("Bewertung der Use Cases", not "Use Cases bewerten"), and an overview label matches its slide title verbatim.
Direct-address titles ("Woher weißt du, dass ...") break both the register and the convention; rewrite as a noun phrase ("Die fehlende Evaluation").

## Humans in human-vs-AI contrasts are "Nutzer", not "der Mensch"

In copy contrasting what the tool does with what the person does, "der Mensch" reads like AI-safety prose.
Write from the working relationship instead: "der Nutzer", "die Anwenderin", or the concrete role ("die Projektleitung führt die Verhandlung").

## One term per concept

Once a term is chosen (including the English/German decision above), it holds across the whole asset.
Not "Use Case" on one slide, "Anwendungsfall" on the next, "UC" in the table.
