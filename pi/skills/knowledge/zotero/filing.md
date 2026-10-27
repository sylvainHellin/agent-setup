# Filing: collections and tags

A filing convention that keeps a research library findable.
The collection names below are one researcher's example (LLMs and construction informatics); keep the structure and replace the names with your own fields.

Every item gets filed on two axes.
The collection tree answers what this is about; tags answer everything the tree cannot express at once.

## The rule

1. Every added item gets at least one topical collection under `2 Library`. No exceptions for "I will sort it later": an unfiled item is invisible to every collection view and every export.
2. A paper cited by a specific manuscript gets a second collection under `1 References`. General reading stays at one.
3. Items in `3 Other documents` are terminal. Courses, student work, peer reviews, own papers and technical references need no `2 Library` home.
4. Never add a reading-state tag (`to-read`, `reading`, `read`) to an item: the user sets reading state themselves.
5. `zot unfiled --count` returns 0. Treat anything else as a defect to fix, not a backlog.

```bash
zot collections --flat                              # find the target, names and keys
zot add 10.xxxx/yyy --collection "Agents" --collection CONF-2026
zot edit KEY --add-collection "Retrieval & QA"
zot unfiled                                          # drift check
```

`--collection` is repeatable on `add`, and takes a key, an exact name, or a tree ID. An ambiguous name refuses rather than guessing.

## Collection structure

Three roots.
`1 References` holds one collection per manuscript, named `<venue>-<year>` for submitted work and a working slug while in progress.
`3 Other documents` holds everything that is not research literature.
`2 Library` is the topical tree, for example:

| Node | Holds |
|---|---|
| Language Models | The model itself: architectures, training and adaptation, evaluation, limitations, prompting, model reports |
| AI Document Understanding | Extracting structure and meaning from documents: layout analysis, document classification, vision-language models |
| Agents | Agent architectures: planning, control loops, multi-agent coordination, tool use |
| Retrieval & QA | Getting the right content in front of a model: RAG, GraphRAG, question answering, search and indexing, text-to-query |
| Knowledge Representation | Ontologies, knowledge graphs, RDF and linked data, schemas |
| Foundations | Classic AI/ML that predates or underpins the rest. Not a dumping ground; if a node fits, use the node |
| Domain node (here: BIM & Construction Informatics) | The application domain, with its own children |
| Research Methods | How research is done, not what it finds: design science research, evaluation design, case study and interview methods |

Two boundaries do the most work.

File by what the paper contributes, not what it uses.
A new retrieval or grounding mechanism goes to `Retrieval & QA` even when an agent drives it; a new agent architecture goes to `Agents` even when it retrieves.
A paper genuinely contributing both is filed under whichever it advances further and carries `method:agent` and `method:rag` together, which is how the pair is found from either side.
Intersections get no collection of their own: that is what the `method:` facet is for.

Anything in the application domain goes under the domain node.
A domain paper does not get pulled out into a method node because the method is interesting; it gets filed under the domain and tagged `method:`.

## Tag facets

Every tag belongs to exactly one facet.
Facets other than state and flags carry a `prefix:`, which keeps the namespace self-policing and groups it in Zotero's tag selector.

| Facet | Cardinality | Vocabulary |
|---|---|---|
| state | zero or one, set by the user only | `to-read`, `reading`, `read` |
| flag | zero or more | `urgent` |
| `kind:` | zero or one | `survey`, `benchmark`, `dataset`, `position`, `thesis` |
| `domain:` | zero or more | your application domains |
| `method:` | zero or more | `llm`, `vlm`, `agent`, `rag`, `kg`, `cv` |
| `concept:` | zero or more | open, but reuse an existing term before coining one (`zot tags`) |
| `course:` | zero or one | one per course you teach |

`domain:` and `method:` are the crosscutting axis a single tree cannot hold, and they deliberately overlap the tree.

## What is not a tag

- Anything a field already says. Item type covers book, thesis, preprint, dataset and standard, so `kind:` never restates one. `number` on a standard already reads `DIN EN ISO 12006-2:2020-07`, so `ISO 12006` is noise. `status` carries `withdrawn`.
- Anything a collection already says. A topic that is a node in the tree does not also become a free tag. Promote it to `domain:` or `method:`, or drop it.
- Automatic tags. Zotero imports publisher and arXiv subject headings as `type: 1` tags. They are self-duplicating and restate the tree badly. Uncheck Settings → General → "Automatically tag items with keywords and subject headings", or they refill.
- Manuscript membership. That is what `1 References` collections are for.

## Textbooks and reference material

Item type already distinguishes a book, so there is no `kind:textbook`.
File books by topic like any other item; a saved search on `Item Type is Book` gives the shelf view for free.

Craft and tool references that carry no research content (language books, tool manuals) are not literature and go to `3 Other documents / Technical Reference`.
Blog posts, predictions and opinion pieces go to `3 Other documents / Essays & Commentary`: they are worth keeping and worth not citing.

## Stray top-level attachments

A loose PDF saved without a parent item becomes a top-level `attachment`: invisible to citation, export and most searches.
`zot unfiled` lists them separately from unfiled papers.
Fix by creating the real item and using `zot attach`, or by deleting the duplicate.
