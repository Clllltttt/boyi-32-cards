# -*- coding: utf-8 -*-
"""Parse the two reference markdown files and emit js/data.js
Contains: CARDS (32), CARD_TABLE (496 combos), HIERARCHY, plus a JS verify helper.
"""
import re, json

SRC_CARDS = r"D:/电脑管家迁移文件/xwechat_files/wxid_51wgdw1kray722_53d4/msg/file/2026-08/32张棋牌游戏_32张牌与496组合完整牌型表_V1.1.md"

text = open(SRC_CARDS, encoding="utf-8").read()
lines = text.splitlines()

# ---- parse 32 cards ----
cards = []
section = False
for ln in lines:
    if ln.strip().startswith("|编号|"):
        section = True
        continue
    if section:
        if ln.strip().startswith("|---") or ln.strip() == "":
            continue
        if ln.strip().startswith("|C"):
            parts = [p.strip() for p in ln.split("|")]
            # ["", "C01","红","红桃","2","2","2",""]
            cid, color, suit, rank, value, mianzi = parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]
            # map mianzi name to rank code used by engine
            mz_map = {"Q":"Q","2":"2","红8":"红8","红4":"红4","黑10":"黑10","无面子":"无面子"}
            cards.append({
                "id": cid,
                "rank": rank,
                "value": int(value),
                "color": "red" if color == "红" else "black",
                "suit": suit,
                "mianzi": mz_map.get(mianzi, "无面子"),
            })
        elif len(cards) >= 32:
            break

assert len(cards) == 32, f"expected 32 cards, got {len(cards)}"

# suit symbol + display helper
SUIT_SYMBOL = {"红桃":"♥","方块":"♦","黑桃":"♠","梅花":"♣","特殊":""}
for c in cards:
    c["sym"] = SUIT_SYMBOL.get(c["suit"], "")

# ---- parse 496 table ----
table = []
in_table = False
for ln in lines:
    if ln.strip().startswith("|序号|牌1|牌2|牌型层级|牌型|最高面子|性质|"):
        in_table = True
        continue
    if in_table:
        if ln.strip().startswith("|---"):
            continue
        if ln.strip().startswith("|"):
            parts = [p.strip() for p in ln.split("|")]
            # ["", "1","C03 3","C32 大王","1","大王 + 红桃3","—","特殊牌型",""]
            if len(parts) < 9:
                continue
            idx = int(parts[1])
            c1 = parts[2]   # "C03 3"
            c2 = parts[3]   # "C32 大王"
            level = int(parts[4])
            name = parts[5]
            mianzi = parts[6]   # "—" / "Q" / "无面子" / ...
            kind = parts[7]     # "特殊牌型" / "普通点数"
            def cid_of(s): return s.split()[0]
            table.append({
                "i": idx,
                "c1": cid_of(c1),
                "c2": cid_of(c2),
                "level": level,
                "name": name,
                "mianzi": mianzi,
                "kind": kind,
            })
        elif table:
            break

assert len(table) == 496, f"expected 496 rows, got {len(table)}"

# ---- hierarchy (25 tiers) ----
HIERARCHY = [
    (1,"大王 + 红桃3","特殊牌型，优先于普通点数"),
    (2,"Q + Q","特殊牌型，优先于普通点数"),
    (3,"2 + 2","特殊牌型，优先于普通点数"),
    (4,"红8对子","特殊牌型，优先于普通点数"),
    (5,"红4对子","特殊牌型，优先于普通点数"),
    (6,"黑10对子","特殊牌型，优先于普通点数"),
    (7,"其他同色对子","特殊牌型，优先于普通点数"),
    (8,"Q + 9","特殊牌型，优先于普通点数"),
    (9,"Q + 8","特殊牌型，优先于普通点数"),
    (10,"2 + 8","特殊牌型，优先于普通点数"),
    (11,"Q + 7","特殊牌型，优先于普通点数"),
    (12,"2 + 7","特殊牌型，优先于普通点数"),
    (13,"红8 + J","特殊牌型，优先于普通点数"),
    (14,"红4 + 5","特殊牌型，优先于普通点数"),
    (15,"黑10 + 9","特殊牌型，优先于普通点数"),
    (16,"9点","普通点数，同点数再比较最高面子"),
    (17,"8点","普通点数，同点数再比较最高面子"),
    (18,"7点","普通点数，同点数再比较最高面子"),
    (19,"6点","普通点数，同点数再比较最高面子"),
    (20,"5点","普通点数，同点数再比较最高面子"),
    (21,"4点","普通点数，同点数再比较最高面子"),
    (22,"3点","普通点数，同点数再比较最高面子"),
    (23,"2点","普通点数，同点数再比较最高面子"),
    (24,"1点","普通点数，同点数再比较最高面子"),
    (25,"0点","普通点数，同点数再比较最高面子"),
]

# ---- emit js ----
out = []
out.append("// Auto-generated from reference markdown. Do not edit by hand.")
out.append("// 32 cards + 496 two-card combinations + 25-tier hierarchy.")
out.append("window.GAME_DATA = {")
out.append("  CARDS: " + json.dumps(cards, ensure_ascii=False) + ",")
out.append("  TABLE: " + json.dumps(table, ensure_ascii=False) + ",")
out.append("  HIERARCHY: " + json.dumps(HIERARCHY, ensure_ascii=False))
out.append("};")
open("js/data.js", "w", encoding="utf-8").write("\n".join(out) + "\n")

# sanity: print a few
print("cards:", len(cards), "table:", len(table))
print("sample card:", cards[0], cards[31])
print("sample row:", table[0], table[64])
