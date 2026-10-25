#!/usr/bin/env python3
"""Sinh data/wordwise-vi.tsv: chú giải tiếng Việt cho cùng bộ từ với wordwise-en.tsv.

Nguồn: data/av.txt của gói npm `tratu-core` (từ điển Anh-Việt). Tải về bằng:
  npm pack tratu-core && tar xzf tratu-core-*.tgz -C <thư_mục> && python3 tools/build_wordwise_vi.py <thư_mục>/package/data/av.txt
Mỗi dòng av.txt: `từ###loại|- nghĩa|- nghĩa|= ví dụ|+ ...`.
Giữ nguyên tier của bản tiếng Anh; chỉ lấy nghĩa ngắn đầu tiên, theo dõi "xem X" tới X.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / 'data' / 'wordwise-en.tsv'
VI = ROOT / 'data' / 'wordwise-vi.tsv'
MAX_CHARS = 38
SKIP_PREFIX = ('(vt', '(viết tắt', '(như', '(xem)', 'xem ', 'số nhiều', '(số nhiều', 'thông tục)')
POS_PREFIX = re.compile(r'^\s*\(([^)]*)\)\s*')
TAG = re.compile(r'<[^>]*>')
REDIR = re.compile(r'^\s*(?:\(\w+\)\s*)?xem\s+([\w\- ]+?)\s*$', re.I)


def parse(path):
    entries = {}
    for line in path.read_text(encoding='utf-8').split('\n'):
        # mục đầy đủ: `từ##[phiên âm]#loại|- nghĩa...`; mục rút gọn: `từ###loại|- nghĩa` hoặc `từ###- xem X`
        m = re.match(r'^([^#]+?)#{2,3}(.*)$', line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        if not key or '=' in key or (key in entries and entries[key]):
            continue
        meanings = [x[1:].strip() for x in m.group(2).split('|') if x.startswith('- ')]
        if meanings:
            entries[key] = meanings
    return entries


def clean(m):
    m = TAG.sub('', m).strip()
    m = re.sub(r'\s+', ' ', m)
    return m


def short(m):
    m = clean(m)
    m = POS_PREFIX.sub('', m).strip()  # bỏ nhãn lĩnh vực đầu nghĩa: (giải phẫu), (thông tục)...
    m = re.sub(r'\([^)]*\)?', '', m)  # bỏ chú thích trong ngoặc, kể cả ngoặc không đóng
    m = re.split(r'[;,]', m)[0].strip()
    m = m.strip(' .:-')
    while len(m) > MAX_CHARS and ' ' in m:
        m = m.rsplit(' ', 1)[0]
    return m if len(m) >= 2 else ''


def gloss(entries, word, depth=0):
    if depth > 2 or word not in entries:
        return ''
    for m in entries[word]:
        if REDIR.match(m):
            target = REDIR.match(m).group(1).lower()
            g = gloss(entries, target, depth + 1)
            if g:
                return g
            continue
        if m.lower().startswith(SKIP_PREFIX) or not m[:1].isalpha() and m[:1] != '(':
            continue
        g = short(m)
        if g:
            return g
    return ''


def main():
    src = Path(sys.argv[1])
    entries = parse(src)
    out = []
    missing = 0
    for line in EN.read_text(encoding='utf-8').split('\n'):
        if not line:
            continue
        tier, word, _ = line.split('\t')
        g = gloss(entries, word)
        if not g:
            missing += 1
            continue
        out.append(f'{tier}\t{word}\t{g}')
    VI.write_text('\n'.join(out) + '\n', encoding='utf-8', newline='\n')
    print(len(out), 'mục; thiếu', missing, '->', VI, VI.stat().st_size, 'bytes')


main()
