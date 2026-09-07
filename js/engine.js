// 牌型判定引擎 —— 严格依据《完整规则 V1.0》与《496组合牌型表 V1.1》
// 判定优先级：特殊牌型 > 普通点数(9→0) > 同点数最高面子(Q>2>红8>红4>黑10>无) > 平局
(function (global) {
  "use strict";

  var D = (typeof window !== "undefined" && window.GAME_DATA) || global.GAME_DATA;
  var CARDS = D.CARDS;
  var byId = {};
  CARDS.forEach(function (c) { byId[c.id] = c; });

  // 面子牌识别
  function isRed8(c)  { return c.id === "C18" || c.id === "C19"; }
  function isRed4(c)  { return c.id === "C04" || c.id === "C05"; }
  function isBlack10(c){ return c.id === "C26" || c.id === "C27"; }
  function isRed3(c)  { return c.id === "C03"; }
  function isKing(c)  { return c.id === "C32"; }

  // 特殊牌型层级：1 最大 … 15 最小；0 = 非特殊
  function specialLevel(a, b) {
    if ((isKing(a) && isRed3(b)) || (isKing(b) && isRed3(a))) return 1;   // 大王+红桃3
    if (a.rank === "Q" && b.rank === "Q") return 2;                        // QQ
    if (a.rank === "2" && b.rank === "2") return 3;                        // 22
    if ((a.id === "C18" && b.id === "C19") || (a.id === "C19" && b.id === "C18")) return 4; // 红8对
    if ((a.id === "C04" && b.id === "C05") || (a.id === "C05" && b.id === "C04")) return 5; // 红4对
    if ((a.id === "C26" && b.id === "C27") || (a.id === "C27" && b.id === "C26")) return 6; // 黑10对
    if (a.rank === b.rank && a.color === b.color) return 7;                // 其他同色对子
    if ((a.rank === "Q" && b.rank === "9") || (a.rank === "9" && b.rank === "Q")) return 8;  // Q9
    if ((a.rank === "Q" && b.rank === "8") || (a.rank === "8" && b.rank === "Q")) return 9;  // Q8
    if ((a.rank === "2" && b.rank === "8") || (a.rank === "8" && b.rank === "2")) return 10; // 28
    if ((a.rank === "Q" && b.rank === "7") || (a.rank === "7" && b.rank === "Q")) return 11; // Q7
    if ((a.rank === "2" && b.rank === "7") || (a.rank === "7" && b.rank === "2")) return 12; // 27
    if ((isRed8(a) && b.rank === "J") || (isRed8(b) && a.rank === "J")) return 13;           // 红8+J
    if ((isRed4(a) && b.rank === "5") || (isRed4(b) && a.rank === "5")) return 14;           // 红4+5
    if ((isBlack10(a) && b.rank === "9") || (isBlack10(b) && a.rank === "9")) return 15;     // 黑10+9
    return 0;
  }

  // 面子等级：Q=5 > 2=4 > 红8=3 > 红4=2 > 黑10=1 > 无=0
  function mianziRank(c) {
    if (c.rank === "Q") return 5;
    if (c.rank === "2") return 4;
    if (isRed8(c)) return 3;
    if (isRed4(c)) return 2;
    if (isBlack10(c)) return 1;
    return 0;
  }

  // 评估一手两张牌
  function evaluate(a, b) {
    var lv = specialLevel(a, b);
    if (lv) return { type: "special", level: lv, label: "特殊·" + SPECIAL_NAMES[lv], point: null, mianzi: null };
    var point = (a.value + b.value) % 10;
    var mz = Math.max(mianziRank(a), mianziRank(b));
    return { type: "normal", level: null, label: point + "点", point: point, mianzi: mz };
  }

  // 比较两手牌：>0 表示 A 胜，<0 B 胜，=0 平局（牌型完全相同）
  function compareHands(ea, eb) {
    if (ea.type === "special" && eb.type === "special") return eb.level - ea.level; // 层级小者强
    if (ea.type === "special") return 1;
    if (eb.type === "special") return -1;
    if (ea.point !== eb.point) return ea.point - eb.point;
    if (ea.mianzi !== eb.mianzi) return ea.mianzi - eb.mianzi;
    return 0;
  }

  var SPECIAL_NAMES = {
    1: "大王 + 红桃3", 2: "Q + Q", 3: "2 + 2", 4: "红8对子", 5: "红4对子",
    6: "黑10对子", 7: "其他同色对子", 8: "Q + 9", 9: "Q + 8", 10: "2 + 8",
    11: "Q + 7", 12: "2 + 7", 13: "红8 + J", 14: "红4 + 5", 15: "黑10 + 9"
  };
  var MIANZI_NAMES = { 5: "Q", 4: "2", 3: "红8", 2: "红4", 1: "黑10", 0: "无面子" };

  function handDesc(ev) {
    if (ev.type === "special") return ev.label;
    var s = ev.point + "点";
    if (ev.mianzi > 0) s += "（" + MIANZI_NAMES[ev.mianzi] + "面子）";
    return s;
  }

  // 用文档 496 表校验引擎：覆盖全部 C(32,2) 组合
  function verify() {
    var MZ = { "Q": 5, "2": 4, "红8": 3, "红4": 2, "黑10": 1, "无面子": 0 };
    var fails = [];
    D.TABLE.forEach(function (row) {
      var a = byId[row.c1], b = byId[row.c2];
      [ [a, b], [b, a] ].forEach(function (pair) {
        var ev = evaluate(pair[0], pair[1]);
        if (row.kind === "特殊牌型") {
          if (ev.type !== "special" || ev.level !== row.level)
            fails.push({ i: row.i, pair: row.c1 + "+" + row.c2, got: JSON.stringify(ev), want: "special L" + row.level });
        } else {
          var wantPoint = 25 - row.level;
          var wantMz = MZ[row.mianzi];
          if (ev.type !== "normal" || ev.point !== wantPoint || ev.mianzi !== wantMz)
            fails.push({ i: row.i, pair: row.c1 + "+" + row.c2, got: JSON.stringify(ev), want: "normal " + wantPoint + "点 mz" + wantMz });
        }
      });
    });
    return { ok: fails.length === 0, total: D.TABLE.length, fails: fails };
  }

  var API = {
    CARDS: CARDS, byId: byId, SPECIAL_NAMES: SPECIAL_NAMES, MIANZI_NAMES: MIANZI_NAMES,
    isRed8: isRed8, isRed4: isRed4, isBlack10: isBlack10, isRed3: isRed3, isKing: isKing,
    specialLevel: specialLevel, mianziRank: mianziRank, evaluate: evaluate,
    compareHands: compareHands, handDesc: handDesc, verify: verify
  };

  if (typeof window !== "undefined") window.ENGINE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
