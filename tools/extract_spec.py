"""Extract the parts of the Luthier spec the app hands to Claude into app/data/spec.json.

Usage:
  pandoc Luthier_vNN.docx -t markdown -o luthier.md
  python3 tools/extract_spec.py luthier.md app/data/spec.json

Each section is found by its heading text (not by line number), so a new
version of the spec can be extracted the same way. A section runs from its
heading to the next top-level ('# ') heading.
"""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8").read().split("\n")

def clean(text):
    text = re.sub(r"\\([\"'\-\[\]\*<>$_])", r"\1", text)
    text = text.replace("**", "").replace("\\\n", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def top_heading(i):
    return lines[i].startswith("# ")

def section(pattern, level_top=True, stop=None):
    rx = re.compile(pattern)
    for i, l in enumerate(lines):
        if l.startswith("#") and rx.search(l):
            j = i + 1
            while j < len(lines):
                if stop and lines[j].startswith("#") and re.search(stop, lines[j]):
                    break
                if stop is None and (top_heading(j) or (not level_top and lines[j].startswith("## "))):
                    break
                j += 1
            return clean("\n".join(lines[i:j]))
    raise SystemExit(f"section not found: {pattern}")

def lite():
    a = next(i for i, l in enumerate(lines) if "THE LITE EDITION" in l)
    b = next(i for i, l in enumerate(lines) if l.startswith("# ") and "EXECUTION PROTOCOL" in l)
    return clean("\n".join(lines[a:b]))

spec = {
    "title": clean(next(l for l in lines if "VERSION" in l and "LUTHIER" in l.upper())),
    "lite": lite(),
    "principles": section(r"PART I: CORE PRINCIPLES"),
    "carrier_payload": section(r"PART III: THE CARRIER/PAYLOAD"),
    "module0": section(r"MODULE 0: SONG TYPE SELECTOR"),
    "triage": section(r"MODULE 0 EXTENSION: SONG TYPE TRIAGE"),
    "lyric": section(r"MODULE 10: LYRIC GENERATION", stop=r"^## 10\.7"),
    "phonetic": section(r"^## 10\.7 The Phonetic Scrub", level_top=False),
    "ladder": section(r"^## 10\.9 The Ladder", level_top=False),
    "hook": section(r"MODULE 23: HOOK ARCHITECTURE"),
    "hybrid": section(r"MODULE 25: THE HYBRID PROTOCOL"),
    "types": {
        "P": section(r"MODULE 10: LYRIC GENERATION", stop=r"^## 10\.7"),
        "N": section(r"MODULE 13: NARRATIVE"),
        "L": section(r"MODULE 14: LAMENT"),
        "G": section(r"MODULE 15: GROOVE"),
        "A": section(r"MODULE 16: ANTHEM"),
        "V": section(r"MODULE 17: LOVE SONG"),
        "PR": section(r"MODULE 18: PROPHETIC"),
        "W": section(r"MODULE 19: PRAISE/WORSHIP"),
        "M": section(r"MODULE 20: MEDITATIVE"),
        "B": section(r"^# \*\*MODULE 21: BLUES"),
        "T": section(r"^# \*\*MODULE 22: GOSPEL"),
    },
}
json.dump(spec, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
total = sum(len(v) for v in spec.values() if isinstance(v, str)) + sum(len(v) for v in spec["types"].values())
print("chars", total, {k: len(v) for k, v in spec["types"].items()})
