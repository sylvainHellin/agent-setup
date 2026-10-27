#!/usr/bin/env python3
"""Inline report.css, any theme-*.css and report.js into a report page, for sharing it.

    python3 bundle.py page.html -o page.standalone.html

The page links the shared files by file:// or relative path; the bundled copy carries them
inline and opens anywhere. Standard library only.
"""

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent
LINK = re.compile(r'<link\b[^>]*\bhref="([^"]*?((?:report|theme-[\w-]+)\.css))"[^>]*>', re.I)
SCRIPT = re.compile(r'<script\b[^>]*\bsrc="([^"]*report\.js)"[^>]*>\s*</script>', re.I)
COMMENT = re.compile(r"<!--.*?-->", re.S)


def source(ref: str, page: Path, name: str) -> Path:
    """Resolve a linked asset: the referenced file if it exists, else the copy next to this script."""
    url = urlparse(ref)
    if url.scheme == "file":
        cand = Path(unquote(url.path))
    elif not url.scheme:
        cand = (page.parent / unquote(ref)).resolve()
    else:
        cand = None
    if cand is not None and cand.is_file():
        return cand
    return HERE / name


def bundle(page: Path) -> str:
    html = page.read_text(encoding="utf-8")
    # Drop commented-out asset links (the skeleton's theme switch), so they are not inlined.
    html = COMMENT.sub(lambda m: "" if LINK.search(m.group(0)) or SCRIPT.search(m.group(0)) else m.group(0), html)
    has_css = any(m.group(2).lower() == "report.css" for m in LINK.finditer(html))
    js_m = SCRIPT.search(html)
    if not has_css or not js_m:
        missing = [n for n, ok in (("report.css link", has_css), ("report.js script", js_m)) if not ok]
        sys.exit(f"{page}: no {' and no '.join(missing)} found")

    def inline_css(m: re.Match) -> str:
        css = source(m.group(1), page, m.group(2)).read_text(encoding="utf-8")
        return "<style>\n" + re.sub(r"</(style)", r"<\\/\1", css, flags=re.I) + "</style>"

    js = source(js_m.group(1), page, "report.js").read_text(encoding="utf-8")
    js = re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)
    html = LINK.sub(inline_css, html)
    return SCRIPT.sub(lambda _: "<script>\n" + js + "</script>", html, count=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("page", type=Path, help="report page that links report.css and report.js")
    ap.add_argument("-o", "--output", type=Path, help="output file (default: <page>.standalone.html)")
    args = ap.parse_args()
    out = args.output or args.page.with_name(args.page.stem + ".standalone.html")
    if out.resolve() == args.page.resolve():
        sys.exit("refusing to overwrite the source page")
    out.write_text(bundle(args.page), encoding="utf-8")
    print(f"{out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
