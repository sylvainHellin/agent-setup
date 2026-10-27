#!/usr/bin/env python3
"""
TUM-styled matplotlib chart recipe.

Drop-in style for charts that should sit naturally on a TUM Typst slide
(slide-text-chart, slide-image, etc.). Run with `uv`:

    uv pip install matplotlib pillow
    uv run python tum-chart-style.py

The script saves a sample bar chart to `chart-ndcg.png`. Adapt `make_sample()`
or import the constants and `apply_tum_style()` helper in your own scripts.

Conventions
- Helvetica Neue (system font on macOS)
- TUM blue gradient (light -> darker) as ordinal palette for categorical data
- No top/right spines, light TUM-gray-20 grid, transparent background
- Value labels in tum-blue-darker, semibold, just above each bar
- dpi >= 160 so the chart stays crisp when the PDF is exported and zoomed
"""

import matplotlib as mpl
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
# TUM brand palette (subset of the official TUM colour list)
# ---------------------------------------------------------------------------
TUM_BLUE        = "#0065BD"   # PMS 300, signature
TUM_BLUE_DARK   = "#005293"   # PMS 301
TUM_BLUE_DARKER = "#003359"   # PMS 540
TUM_BLUE_MED    = "#64A0C8"   # PMS 542
TUM_BLUE_LIGHT  = "#98C6EA"   # PMS 283
TUM_ORANGE      = "#E37222"   # PMS 158, accent
TUM_GREEN       = "#A2AD00"   # PMS 383, accent
TUM_GRAY_50     = "#808080"
TUM_GRAY_20     = "#CCCCCC"
TUM_BLACK       = "#1A1A1A"

# Ordinal palette for categorical bar/line charts (light to darker)
TUM_ORDINAL = [TUM_BLUE_LIGHT, TUM_BLUE, TUM_BLUE_DARK, TUM_BLUE_DARKER]

# 10-color qualitative palette from the official ASE swatchbook (matches the
# `chart-colors` constant in tum-presentation.typ). Use when an ordinal blue
# gradient is not enough (e.g. unrelated categories, scatter clusters).
TUM_QUALITATIVE = [
    "#0F1B5F", "#69085A", "#9C0D16", "#C4071B", "#D64C13",
    "#F9BA00", "#FFDC00", "#679A1D", "#007C30", "#00778A",
]


def apply_tum_style() -> None:
    """Set matplotlib rcParams to the TUM CI style. Call once at script start."""
    mpl.rcParams.update({
        "font.family": "Helvetica Neue",
        "font.size": 11,
        "axes.edgecolor": TUM_GRAY_20,
        "axes.linewidth": 0.5,
        "axes.labelcolor": TUM_BLACK,
        "xtick.color": TUM_BLACK,
        "ytick.color": TUM_BLACK,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.color": TUM_GRAY_20,
        "grid.linewidth": 0.4,
        "axes.axisbelow": True,
    })


def label_bars(ax, bars, fmt: str = "{:.3f}") -> None:
    """Add semibold tum-blue-darker value labels above each bar."""
    for bar in bars:
        h = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2, h + 0.012, fmt.format(h),
            ha="center", va="bottom",
            fontsize=10, color=TUM_BLUE_DARKER, weight="semibold",
        )


def make_sample(out_path: str = "chart-ndcg.png") -> None:
    """Render the demo nDCG@10 bar chart used by the TUM template."""
    apply_tum_style()

    methods = ["BM25", "Dense\n(E5-small)", "Hybrid\n(BM25 + Dense + RRF)", "Cross-encoder\nrerank"]
    ndcg    = [0.612, 0.681, 0.756, 0.781]

    fig, ax = plt.subplots(figsize=(6.4, 5.6), dpi=160)
    bars = ax.bar(methods, ndcg, color=TUM_ORDINAL, width=0.65, edgecolor="none")
    label_bars(ax, bars)

    ax.set_ylabel("nDCG@10", color=TUM_BLUE_DARKER)
    ax.set_ylim(0, 0.9)
    ax.set_yticks([0.0, 0.2, 0.4, 0.6, 0.8])
    ax.tick_params(axis="x", length=0, pad=6)
    ax.tick_params(axis="y", length=0)

    plt.tight_layout()
    plt.savefig(out_path, dpi=160, transparent=True)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    make_sample()
