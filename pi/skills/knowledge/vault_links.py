# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml"]
# ///
"""Wikilink maintenance for an Obsidian vault. Run with `VAULT_DIR=<vault> uv run vault_links.py <cmd>`
(VAULT_DIR defaults to the current directory).

    unresolved     list link targets that match no file, grouped by target
    orphans        list notes no other note links to
    dead-ends      list notes that link out to too few others (meetings must reach the graph)
    fix-aliases    rewrite unresolved [[alias]] links to [[Real Name|alias]] (add --apply)

Frontmatter aliases only feed Obsidian's autocomplete; they are never resolvable link
targets, so a hand-typed [[alias]] is a broken link that spawns a stub note when clicked.
"""

import argparse
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import yaml

VAULT = Path(os.environ.get("VAULT_DIR", ".")).expanduser().resolve()
SKIP_DIRS = {".obsidian", ".trash", ".git", ".agents", ".pi", ".pi-subagents", ".fastembed_cache"}
LINK_RE = re.compile(r"(!?)\[\[([^\]\n]+)\]\]")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
# aliases whose declaration is wrong, or whose word is too generic for an automatic remap
EXCLUDE: set[str] = set()


def norm(s):
    """casefold + strip diacritics, to decide a display text is redundant."""
    return "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c)).strip()


def md_files():
    for p in sorted(VAULT.rglob("*.md")):
        if not any(part in SKIP_DIRS for part in p.relative_to(VAULT).parts):
            yield p


def frontmatter(text):
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    try:
        data = yaml.safe_load(text[4:end])
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def index():
    """(texts, names, alias_map): every linkable name and every alias -> owning note."""
    texts, names, alias_map = {}, set(), defaultdict(set)
    for p in md_files():
        texts[p] = p.read_text(encoding="utf-8")
        al = frontmatter(texts[p]).get("aliases") or []
        for a in [al] if isinstance(al, str) else al:
            if isinstance(a, str) and a.strip():
                alias_map[a.strip().lower()].add(p.stem)
    for p in VAULT.rglob("*"):
        if p.is_file() and not any(part in SKIP_DIRS for part in p.relative_to(VAULT).parts):
            names.update({p.name.lower(), p.stem.lower()})
    return texts, names, alias_map


def links(text):
    """Yield (lineno, match, target, heading, display) for wikilinks outside fenced code."""
    infence = False
    for i, line in enumerate(text.split("\n")):
        if FENCE_RE.match(line):
            infence = not infence
            continue
        if infence:
            continue
        for m in LINK_RE.finditer(line):
            target, sep, display = m.group(2).partition("|")
            base, _, heading = target.partition("#")
            yield i, m, base.strip(), heading, (display if sep else None)


def cmd_unresolved(args):
    texts, names, alias_map = index()
    broken = defaultdict(list)
    for p, text in texts.items():
        for _, _, base, _, _ in links(text):
            key = base.lower()
            if key and "/" not in base and key not in names:
                broken[base].append(p.relative_to(VAULT))
    for base in sorted(broken, key=lambda b: (-len(broken[b]), b.lower())):
        hint = f"  (alias of {sorted(alias_map[base.lower()])})" if base.lower() in alias_map else ""
        print(f"{len(broken[base]):4}  [[{base}]]{hint}")
        if args.verbose:
            for f in broken[base]:
                print(f"        {f}")
    print(f"\n{sum(len(v) for v in broken.values())} unresolved links, {len(broken)} distinct targets")


# scratch and generated notes: nothing links to them by design
NEVER_LINKED: set[str] = set()  # vault-relative paths, e.g. {"03-resources/Scratch.md"}


def cmd_orphans(args):
    texts, _, _ = index()
    linked = set()
    for p, text in texts.items():
        for _, _, base, _, _ in links(text):
            target = base.rsplit("/", 1)[-1].removesuffix(".md").lower()
            if target and target != p.stem.lower():  # a self-link does not make a note reachable
                linked.add(target)
    orphans = [p for p in texts if p.stem.lower() not in linked
               and str(p.relative_to(VAULT)) not in NEVER_LINKED]
    if not args.all:
        orphans = [p for p in orphans if not str(p.relative_to(VAULT)).startswith("04-archive/daily notes")]
    by_folder = defaultdict(list)
    for p in orphans:
        by_folder[p.relative_to(VAULT).parent].append(p.name)
    for folder in sorted(by_folder, key=str):
        print(f"\n{folder}/  ({len(by_folder[folder])})")
        for name in sorted(by_folder[folder]):
            print(f"    {name}")
    print(f"\n{len(orphans)} notes with no inbound link, of {len(texts)} total"
          f"{'' if args.all else ' (archived daily notes excluded, --all to include)'}")


def cmd_dead_ends(args):
    texts, _, _ = index()
    counts = {}
    for p, text in texts.items():
        targets = {base.rsplit("/", 1)[-1].removesuffix(".md").lower() for _, _, base, _, _ in links(text) if base}
        targets.discard(p.stem.lower())
        counts[p] = len(targets)
    hits = [p for p, n in counts.items() if n <= args.max]
    if args.folder:
        hits = [p for p in hits if str(p.relative_to(VAULT)).startswith(args.folder)]
    for p in sorted(hits, key=lambda p: (counts[p], str(p))):
        print(f"{counts[p]:3}  {p.relative_to(VAULT)}")
    print(f"\n{len(hits)} notes linking out to {args.max} or fewer distinct notes"
          f"{f' under {args.folder}' if args.folder else ''}")


def cmd_fix_aliases(args):
    texts, names, alias_map = index()
    rewrites, ambiguous = [], []
    for p, text in texts.items():
        lines, changed = text.split("\n"), False
        for i, m, base, heading, display in links(text):
            key = base.lower()
            if not key or "/" in base or key in names or key in EXCLUDE:
                continue
            hits = alias_map.get(key)
            if not hits:
                continue
            if len(hits) > 1:
                ambiguous.append((p, m.group(0), sorted(hits)))
                continue
            real = next(iter(hits))
            shown = display if display is not None else base
            anchor = f"#{heading}" if heading else ""
            # only an explicit display text is worth carrying over a heading or an embed;
            # inventing one there would hide the anchor or do nothing at all
            if display is None and (heading or m.group(1)):
                new = f"{m.group(1)}[[{real}{anchor}]]"
            elif not heading and norm(shown) == norm(real):
                new = f"{m.group(1)}[[{real}]]"
            else:
                new = f"{m.group(1)}[[{real}{anchor}|{shown}]]"
            lines[i] = lines[i].replace(m.group(0), new)
            rewrites.append((p, m.group(0), new))
            changed = True
        if changed and args.apply:
            p.write_text("\n".join(lines), encoding="utf-8")

    for p, old, new in sorted(rewrites, key=lambda r: (r[1].lower(), str(r[0]))):
        print(f"{old}  ->  {new}   [{p.relative_to(VAULT)}]")
    print(f"\n{len(rewrites)} rewrites in {len({r[0] for r in rewrites})} files"
          f" ({'APPLIED' if args.apply else 'dry run, pass --apply to write'})")
    if ambiguous:
        print(f"\n{len(ambiguous)} ambiguous, left untouched:")
        for p, old, hits in ambiguous:
            print(f"  {old} -> {hits}   [{p.relative_to(VAULT)}]")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("unresolved", help="list link targets matching no file")
    u.add_argument("-v", "--verbose", action="store_true", help="list the notes holding each broken link")
    u.set_defaults(func=cmd_unresolved)
    o = sub.add_parser("orphans", help="list notes no other note links to")
    o.add_argument("--all", action="store_true", help="include archived daily notes")
    o.set_defaults(func=cmd_orphans)
    d = sub.add_parser("dead-ends", help="list notes with too few outgoing links")
    d.add_argument("--max", type=int, default=0, help="threshold of distinct outgoing links (default 0)")
    d.add_argument("--folder", help="restrict to a vault subfolder, e.g. meetings")
    d.set_defaults(func=cmd_dead_ends)
    f = sub.add_parser("fix-aliases", help="rewrite [[alias]] to [[Real Name|alias]]")
    f.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    f.set_defaults(func=cmd_fix_aliases)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
