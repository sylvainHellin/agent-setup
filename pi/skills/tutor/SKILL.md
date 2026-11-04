---
name: tutor
description: Teach the user a concept, a method or an unfamiliar codebase until they understand it, through an HTML lesson page with figures, recall questions and a comment round trip. Use when the user wants to learn or understand something, or says explain, teach me, tutor me, get me up to speed.
---

# Tutor

The goal is the user's understanding, not an answer: after the lesson they explain the topic without the page.
Never do the work the lesson is about (solving their exercise, writing their code) unless they ask for it after the lesson.
`SKILL_DIR` below is the absolute path of the folder holding this file.

## 1. Ask first

- Before explaining, ask at most three short questions in the chat: what they already know about the topic, what they need it for, and how deep to go.
- Thinking before reading is part of the lesson; if they answer "just go", assume a technical reader new to the topic.
- List the building blocks: the two to four concepts the big idea rests on, and which of them the user already has.
  The curse of knowledge hides the blocks that feel obvious to you, so start from their answers, not from what seems basic.

## 2. Gather the sources

- A codebase: read the README and the entry points, then trace one real path through the code (a request, a command, a data flow) and note file paths with line numbers.
- A concept: the user's own files and course material first, then the web; never take numbers, APIs or dates from memory; keep the sources for the end of the page.

## 3. Write the lesson page

- Copy `SKILL_DIR/assets/lesson.html` to `YYYY-MM-DD_<slug>.html` in the user's working folder, and replace `ASSETS_URL` with the `file://` URL of `SKILL_DIR/assets` and the other capitalised placeholders.
- Keep the first page readable in ten minutes: at most five sections and three figures; depth comes in the later rounds.
- Write only inside `<main>`; the classes (callouts, figures, `details`, question cards) are listed in `SKILL_DIR/assets/components.md`.
- Teach in the style of the FastAPI tutorial:
  - open with a question or a puzzle from the user's world that the topic answers, so they are curious before the first definition;
  - give intuition, a practical takeaway or an analogy first, and the formal definition only once the idea has landed;
  - carry one running example through the whole page, taken from the user's world when possible (their project, their repo, their field);
  - build the big idea block by block, like a tower: one building block per section, each resting on the previous one, and the big idea only once its blocks are in place;
  - give each new block a name, one metaphor that shows its shape and one strong example, and use no term before it is introduced;
  - before a surprising result, ask the user to predict it, then fill the gap between their guess and the result;
  - when the idea contradicts something the user believes, name the belief and show where it breaks before building the new one;
  - plain words first, then the technical term;
  - short paragraphs, one idea each;
  - for code, a runnable snippet per step with its expected output;
  - for a codebase, a map of the main parts and how data flows first, then the one real path through the code;
  - close the last section with what the idea changes: what the user now sees or does differently in their own work.
- One figure per step that agrees with the text, drawn as described in step 4.
- Before the sources, a `Recall` section with three `data-type="text"` question cards that ask the user to explain, predict or apply, never to repeat a definition; the page holds no answers.
- End with a short `Go further` list of sources.

## 4. Figures

- Write each figure as TikZ with the tex-fig styles in `figures/<name>.tex` next to the page, holding only the `tikzpicture`; the style reference is `SKILL_DIR/figures/texfig.md`.
- Render it with `uv run SKILL_DIR/figures/render_fig.py figures/<name>.tex --png` (or `pip install pymupdf` once, then `python`), look at the PNG, fix and render again until it reads well.
- Embed the SVG: `<figure class="fig"><img src="figures/<name>.svg" alt="..."><figcaption>...</figcaption></figure>`.
- Without a local `tectonic` or `pdflatex` the script sends the figure source to latex.ytotech.com; say so once.
- If a figure still fails after two fixes, draw it as inline SVG with a `viewBox` instead.

## 5. Hand over and the round trip

- Give the absolute path of the page and tell the user how to use it:
  - open it in the browser;
  - select any unclear passage and comment on it;
  - answer the recall questions without scrolling back;
  - press Export and paste the result into the chat.
- When the export comes back:
  - grade each recall answer in the chat as right, partly right or wrong, with one sentence on what was missing;
  - revise the same page in place: rewrite the sections behind wrong answers and comments, replace the answered recall cards with two new ones on the weakest point, and hand the path back.
- Stop once the answers are right, and offer a short summary the user can keep in their own notes.
