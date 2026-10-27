#!/usr/bin/env python3
"""Decode PDF text affected by font-encoding character shifts.

Some PDFs use non-standard font encoding where each character's Unicode
codepoint is shifted by a fixed offset. The PDF renders correctly (the font
maps glyphs visually), but text extraction / copy-paste / Zotero annotation
export produces garbled text.

Usage:
    # Auto-detect shift from a known word
    echo "garbled text" | python3 decode-pdf-text.py --probe "FYBNQMF=example"

    # Apply a known shift (e.g. -1 means each char's codepoint is 1 too high)
    echo "garbled text" | python3 decode-pdf-text.py --shift -1

    # Decode a file
    python3 decode-pdf-text.py --shift -1 < annotations.txt

The most common shift observed so far: -1 (each ASCII char is +1 from the
intended character). Example: "ESBXJOHT" -> "DRAWINGS" (shift -1).
"""

import sys
import argparse


def decode(text: str, shift: int) -> str:
    result = []
    for c in text:
        code = ord(c)
        if 33 <= code <= 126:  # printable non-space ASCII
            new_code = code + shift
            if 33 <= new_code <= 126:
                result.append(chr(new_code))
            else:
                result.append(c)  # out of range, keep original
        else:
            result.append(c)  # spaces, newlines, unicode: keep as-is
    return "".join(result)


def detect_shift(probe: str) -> int:
    """Detect shift from a probe like 'FYBNQMF=example' (garbled=expected)."""
    garbled, expected = probe.split("=", 1)
    if len(garbled) != len(expected):
        sys.exit(f"Probe mismatch: '{garbled}' ({len(garbled)} chars) vs '{expected}' ({len(expected)} chars)")
    shifts = [ord(e) - ord(g) for g, e in zip(garbled, expected) if 33 <= ord(g) <= 126]
    if not shifts:
        sys.exit("No printable ASCII characters in probe to detect shift")
    if len(set(shifts)) != 1:
        sys.exit(f"Inconsistent shifts detected: {set(shifts)}. Not a simple character shift.")
    return shifts[0]


def main():
    parser = argparse.ArgumentParser(description="Decode shifted PDF text")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--shift", type=int, help="Fixed shift to apply (e.g. -1)")
    group.add_argument("--probe", type=str, help="Auto-detect shift: 'garbled=expected'")
    parser.add_argument("files", nargs="*", help="Files to decode (default: stdin)")
    args = parser.parse_args()

    shift = args.shift if args.shift is not None else detect_shift(args.probe)
    print(f"# Detected shift: {shift}", file=sys.stderr)

    if args.files:
        for path in args.files:
            with open(path) as f:
                print(decode(f.read(), shift))
    else:
        print(decode(sys.stdin.read(), shift))


if __name__ == "__main__":
    main()
