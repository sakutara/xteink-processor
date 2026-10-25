#!/usr/bin/env python3
"""Sinh data/wordwise-en.tsv cho tính năng Wordwise.

Nguồn: WordNet (nghĩa) + wordfreq (độ hiếm). Cần: pip install wordfreq nltk, và dữ liệu WordNet của nltk.
Mỗi dòng: <tier>\t<từ gốc>\t<chú giải>, sắp từ khó nhất đến dễ nhất.
  tier 1 = khó nhất (cấp 1 chỉ chú thích tier 1), tier 2 (cấp 2 = tier 1-2), tier 3 (cấp 3 = tier 1-3).
Chạy: python3 tools/build_wordwise.py [thư_mục_nltk_data]
"""
import math
import re
import sys
from pathlib import Path

from nltk.corpus import wordnet as wn
from wordfreq import word_frequency

if len(sys.argv) > 1:
    import nltk
    nltk.data.path.insert(0, sys.argv[1])

# Ngưỡng zipf (gộp các dạng biến cách). Thấp hơn MIN: quá hiếm, thường là tên riêng/lỗi chính tả.
MIN_ZIPF = 2.0
T1_MAX, T2_MAX, T3_MAX = 3.4, 4.0, 4.6
MAX_WORDS_GLOSS = 6
MAX_CHARS_GLOSS = 38
VOWELS = 'aeiou'
DANGLING = set('a an the of or and to in on for with by that which who whom whose as at from into is are be being used having having its their his her one other any some such than but not especially usually'.split())
BAD = set('shit shitting fuck fucking cunt nigger'.split())


def forms(w):
    out = {w, w + 's', w + 'ed', w + 'ing', w + 'er', w + 'ly'}
    if w.endswith('e'):
        out |= {w + 'd', w[:-1] + 'ing', w + 'r'}
    if w.endswith('y') and len(w) > 2 and w[-2] not in VOWELS:
        out |= {w[:-1] + 'ies', w[:-1] + 'ied', w[:-1] + 'ier', w[:-1] + 'ily'}
    elif w.endswith(('s', 'x', 'z', 'ch', 'sh')):
        out.add(w + 'es')
    if len(w) > 2 and w[-1] not in VOWELS + 'wxy' and w[-2] in VOWELS and w[-3] not in VOWELS:
        out |= {w + w[-1] + 'ed', w + w[-1] + 'ing', w + w[-1] + 'er'}
    return out


def zipf(w):
    f = sum(word_frequency(x, 'en') for x in forms(w))
    return math.log10(f * 1e9) if f > 0 else 0.0


def short_def(d, word):
    d = re.sub(r'\([^)]*\)', '', d)
    d = re.split(r';|:', d)[0].strip()
    d = re.sub(r'^(a|an|the)\s+', '', d)
    if len(d) > MAX_CHARS_GLOSS:
        d = re.split(r',| (?:that|which|who|whose|whom|in which|used|especially|having|usually|typically|for|with|by|from) ', d)[0].strip()
    words = d.split()[:MAX_WORDS_GLOSS]
    while words and len(' '.join(words)) > MAX_CHARS_GLOSS:
        words.pop()
    while words and words[-1].lower().strip(',') in DANGLING:
        words.pop()
    return ' '.join(words).strip(' ,-')


def gloss_for(word, z):
    syns = wn.synsets(word)
    if not syns:
        return None
    # từ phổ biến vừa là danh từ vừa là động từ... thì không đoán được từ loại trong câu
    if z >= T1_MAX and len({'a' if x.pos() == 's' else x.pos() for x in syns}) > 1:
        return None
    # nhiều nghĩa mà nghĩa đầu không áp đảo -> dễ chú thích sai
    counts = [sum(l.count() for l in s.lemmas() if l.name().lower() == word) for s in syns]
    total = sum(counts)
    if len(syns) > 3 and (total == 0 or counts[0] * 2 < total):
        return None
    s = syns[0]
    # synset là tên riêng (địa danh, người...)
    if any(l.name()[0].isupper() for l in s.lemmas() if l.name().lower() == word):
        return None
    if wn.morphy(word) not in (None, word):
        return None  # dạng biến cách của từ khác
    # ưu tiên đồng nghĩa một từ, phổ biến hơn hẳn
    best, bz = None, 0
    for l in s.lemmas():
        n = l.name()
        if '_' in n or not n.isalpha() or n.lower() == word or n != n.lower():
            continue
        if word in n or n in word:
            continue
        nz = zipf(n)
        if nz >= max(z + 1.0, 4.0) and nz > bz:
            best, bz = n, nz
    if best:
        return best
    g = short_def(s.definition(), word)
    if len(g) < 3 or g.startswith('of or relating') or re.search(r'\b' + re.escape(word) + r'\w*', g):
        return None
    return g


def main():
    rows = []
    for w in set(wn.all_lemma_names()):
        if not re.fullmatch(r'[a-z]{4,}', w) or w in BAD:
            continue
        z = zipf(w)
        if z < MIN_ZIPF or z >= T3_MAX:
            continue
        g = gloss_for(w, z)
        if not g:
            continue
        tier = 1 if z < T1_MAX else 2 if z < T2_MAX else 3
        rows.append((z, tier, w, g))
    rows.sort()
    out = Path(__file__).resolve().parent.parent / 'data' / 'wordwise-en.tsv'
    out.parent.mkdir(exist_ok=True)
    with out.open('w', encoding='utf-8', newline='\n') as f:
        for _, tier, w, g in rows:
            f.write(f'{tier}\t{w}\t{g}\n')
    counts = {t: sum(1 for r in rows if r[1] == t) for t in (1, 2, 3)}
    print(len(rows), counts, out.stat().st_size, 'bytes')


main()
