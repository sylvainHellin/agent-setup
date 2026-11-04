# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf"]
# ///
"""Render a tex-fig TikZ figure to SVG (and optionally PNG) for a lesson page.

    uv run render_fig.py figures/attention.tex            # -> figures/attention.svg
    uv run render_fig.py figures/attention.tex --png      # also a PNG to look at

The .tex file holds only the figure (a tikzpicture, optionally wrapped in
\\resizebox{\\tffigwidth}{!}{...}). The script wraps it in a standalone document
that loads texfig-plots, then compiles it with the first engine available:
a local `tectonic`, a local `pdflatex`, or the free LaTeX-on-HTTP service at
latex.ytotech.com (the figure source is sent there). PyMuPDF turns the PDF into
an SVG with the text drawn as paths, so the page needs no fonts.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STYLES = ("texfig.sty", "texfig-plots.sty")
ONLINE = "https://latex.ytotech.com/builds/sync"


def wrap(body: str, palette: str, font: str, width: str) -> str:
    return (
        "\\documentclass[border=4pt]{standalone}\n"
        f"\\usepackage[palette={palette}, font={font}]{{texfig-plots}}\n"
        f"\\providecommand{{\\tffigwidth}}{{{width}}}\n"
        "\\begin{document}\n"
        f"{body}\n"
        "\\end{document}\n"
    )


def compile_local(doc: str, engine: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in STYLES:
            shutil.copy(HERE / name, work / name)
        (work / "fig.tex").write_text(doc, encoding="utf-8")
        if engine == "tectonic":
            cmd = ["tectonic", "-c", "minimal", "fig.tex"]
        else:
            cmd = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "fig.tex"]
        run = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
        pdf = work / "fig.pdf"
        if run.returncode != 0 or not pdf.is_file():
            log = (work / "fig.log").read_text(errors="ignore") if (work / "fig.log").is_file() else run.stdout + run.stderr
            sys.exit(f"{engine} failed:\n{log[-3000:]}")
        return pdf.read_bytes()


def compile_online(doc: str) -> bytes:
    resources = [{"main": True, "content": doc}]
    resources += [{"path": name, "content": (HERE / name).read_text(encoding="utf-8")} for name in STYLES]
    payload = json.dumps({"compiler": "pdflatex", "resources": resources}).encode()
    req = urllib.request.Request(ONLINE, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="ignore")
        try:
            body = json.loads(body).get("logs", body)
        except ValueError:
            pass
        sys.exit(f"latex.ytotech.com returned {err.code}:\n{body[-3000:]}")
    except urllib.error.URLError as err:
        sys.exit(f"no local LaTeX and latex.ytotech.com unreachable: {err.reason}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("source", type=Path, help="figure file holding the tikzpicture")
    ap.add_argument("-o", "--output", type=Path, help="SVG path (default: next to the source)")
    ap.add_argument("--png", action="store_true", help="also write a PNG preview")
    ap.add_argument("--palette", default="tum", help="apple, tum or hines (default: tum)")
    ap.add_argument("--font", default="helvet", help="inherit, times, helvet, palatino or libertine")
    ap.add_argument("--width", default="16cm", help="value of \\tffigwidth (default: 16cm)")
    ap.add_argument("--engine", choices=["auto", "tectonic", "pdflatex", "online"], default="auto")
    args = ap.parse_args()

    import pymupdf  # imported late so --help works without it

    doc = wrap(args.source.read_text(encoding="utf-8"), args.palette, args.font, args.width)
    engine = args.engine
    if engine == "auto":
        engine = next((e for e in ("tectonic", "pdflatex") if shutil.which(e)), "online")
    pdf = compile_online(doc) if engine == "online" else compile_local(doc, engine)

    page = pymupdf.open(stream=pdf, filetype="pdf")[0]
    if not page.get_drawings() and not page.get_text().strip():
        sys.exit(f"{engine}: the figure compiled to an empty page; is there a tikzpicture in {args.source}?")
    svg = args.output or args.source.with_suffix(".svg")
    svg.write_text(page.get_svg_image(text_as_path=True), encoding="utf-8")
    print(f"{svg} ({engine})")
    if args.png:
        png = svg.with_suffix(".png")
        page.get_pixmap(dpi=150).save(png)
        print(png)


if __name__ == "__main__":
    main()
