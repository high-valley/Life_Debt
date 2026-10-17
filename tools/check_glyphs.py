#!/usr/bin/env python3
"""同梱フォントに無い文字がUIテキストに使われていないか確認する（Web版の豆腐表示を防ぐ）。
  python3 tools/check_glyphs.py   → 足りない文字があれば終了コード1
"""
import pathlib, sys
from fontTools.ttLib import TTFont

root = pathlib.Path(__file__).resolve().parent.parent
cmap = TTFont(root / "assets/fonts/NotoSansJP-Subset.otf").getBestCmap()
missing = {}
for p in list(root.glob("scripts/**/*.gd")) + list(root.glob("data/*.json")):
    for c in set(p.read_text(encoding="utf-8")):
        if ord(c) > 127 and ord(c) not in cmap:
            missing.setdefault(c, []).append(str(p.relative_to(root)))
if missing:
    for c, files in sorted(missing.items()):
        print(f"フォントに無い文字: {c!r} (U+{ord(c):04X})  {', '.join(sorted(set(files)))}")
    print("→ tools/subset_font.py を再実行するか、別の文字に置き換える")
    sys.exit(1)
print("glyph check ok")
