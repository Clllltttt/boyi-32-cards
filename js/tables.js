// 牌型表页：32张牌 + 25层级 + 496组合查表（含引擎校验）
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var E = window.ENGINE, D = window.GAME_DATA;
  var MZ_LABEL = { "Q": "Q", "2": "2", "红8": "红8", "红4": "红4", "黑10": "黑10", "无面子": "无面子", "—": "—" };

  function cardChip(id) {
    var c = E.byId[id];
    var col = c.color === "red" ? "red" : "black";
    if (c.rank === "大王") return '<span class="cchip red">大王</span>';
    return '<span class="cchip ' + col + '">' + c.rank + (c.sym ? " " + c.sym : "") + "</span>";
  }

  function renderCards() {
    var grid = $("cards-grid");
    grid.innerHTML = D.CARDS.map(function (c) {
      var col = c.color === "red" ? "red" : "black";
      var mz = c.mianzi && c.mianzi !== "无面子" ? '<span class="mz">' + c.mianzi + "面子</span>" : "";
      var rk = c.rank === "大王" ? "大王" : c.rank;
      return '<div class="ccard ' + col + '"><div class="cc-top">' + rk + (c.sym ? " " + c.sym : "") + "</div>" +
        '<div class="cc-id">' + c.id + "</div>" + mz + "</div>";
    }).join("");
  }

  function renderHierarchy() {
    var box = $("hierarchy");
    box.innerHTML = D.HIERARCHY.map(function (h) {
      var special = h[0] <= 15;
      return '<div class="hier-row ' + (special ? "sp" : "nm") + '"><span class="hier-lv">' + h[0] + "</span>" +
        '<span class="hier-name">' + h[1] + "</span><span class=\"hier-note\">" + h[2] + "</span></div>";
    }).join("");
  }

  function renderTable(filter) {
    filter = filter || {};
    var rows = D.TABLE.filter(function (r) {
      if (filter.kind && r.kind !== filter.kind) return false;
      if (filter.mianzi && r.mianzi !== filter.mianzi) return false;
      if (filter.q && !matchesQuery(r, filter.q)) return false;
      return true;
    });
    var tbody = $("combo-tbody");
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">无匹配结果</td></tr>'; }
    else {
      tbody.innerHTML = rows.map(function (r) {
        var special = r.kind === "特殊牌型";
        return '<tr class="' + (special ? "sp" : "nm") + '" data-c1="' + r.c1 + '" data-c2="' + r.c2 + '">' +
          "<td>" + r.i + "</td><td>" + cardChip(r.c1) + " + " + cardChip(r.c2) + "</td>" +
          "<td>" + r.level + "</td><td>" + r.name + "</td>" +
          "<td>" + (MZ_LABEL[r.mianzi] || r.mianzi) + "</td><td>" + (special ? "特殊" : "普通") + "</td></tr>";
      }).join("");
    }
    $("combo-count").textContent = rows.length;
    // 行点击 → 详情
    Array.prototype.forEach.call(tbody.querySelectorAll("tr[data-c1]"), function (tr) {
      tr.onclick = function () {
        $("combo-detail").innerHTML = "组合：" + cardChip(tr.dataset.c1) + " + " + cardChip(tr.dataset.c2) +
          " → <b>" + tr.children[3].textContent + "</b>";
      };
    });
  }
  function matchesQuery(r, q) {
    q = q.trim().toLowerCase();
    if (!q) return true;
    if (r.c1.toLowerCase().indexOf(q) >= 0 || r.c2.toLowerCase().indexOf(q) >= 0) return true;
    if (r.name.toLowerCase().indexOf(q) >= 0) return true;
    if (r.i.toString() === q) return true;
    return false;
  }

  function bindControls() {
    var filter = { kind: "", mianzi: "", q: "" };
    var kindSel = $("filter-kind"), mzSel = $("filter-mianzi"), qInput = $("filter-q"), btn = $("verify-btn");
    kindSel.onchange = function () { filter.kind = kindSel.value; renderTable(filter); };
    mzSel.onchange = function () { filter.mianzi = mzSel.value; renderTable(filter); };
    qInput.oninput = function () { filter.q = qInput.value; renderTable(filter); };
    btn.onclick = function () {
      var res = E.verify();
      var el = $("verify-result");
      if (res.ok) {
        el.className = "verify ok";
        el.textContent = "✓ 引擎校验通过：全部 " + res.total + " 种组合与文档牌型表完全一致。";
      } else {
        el.className = "verify bad";
        el.textContent = "✗ 校验失败 " + res.fails.length + " 项：" + JSON.stringify(res.fails.slice(0, 5));
      }
    };
  }

  function init() {
    renderCards(); renderHierarchy(); renderTable({}); bindControls();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
