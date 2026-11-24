"""Build app/data/lexicon.json: word -> "PHONES|zipf|concreteness".

Sources (installed with `pip install wordfreq cmudict`, plus the Brysbaert file):
  - CMU Pronouncing Dictionary (cmudict package): phones with stress.
  - wordfreq (Speer et al.): Zipf frequency in English.
  - Brysbaert, Warriner & Kuperman (2014) concreteness norms, 1-5 scale.
Usage: python3 tools/build_lexicon.py path/to/Concreteness_ratings_Brysbaert_et_al_BRM.txt
"""
import json, sys, re
import cmudict
from wordfreq import top_n_list, zipf_frequency

brys_path = sys.argv[1]
conc = {}
with open(brys_path, encoding="utf-8") as f:
    next(f)
    for line in f:
        p = line.rstrip("\n").split("\t")
        if len(p) > 2 and p[1] == "0":
            conc[p[0].lower()] = float(p[2])

cmu = cmudict.dict()
words = set(w for w in top_n_list("en", 60000) if re.fullmatch(r"[a-z']+", w))
words |= set(conc)
out = {}
for w in sorted(words):
    if w not in cmu:
        continue
    phones = " ".join(cmu[w][0])
    z = round(zipf_frequency(w, "en"), 2)
    c = conc.get(w)
    out[w] = f"{phones}|{z}|{'' if c is None else round(c, 2)}"
json.dump(out, open(sys.argv[2] if len(sys.argv) > 2 else "app/data/lexicon.json", "w"), separators=(",", ":"))
print(len(out), "words")
