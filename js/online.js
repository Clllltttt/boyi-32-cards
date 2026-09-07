(function () {
  "use strict";
  var socket = io();
  var state = null;
  var rubbedGameNo = 0, rubActive = false, rubDragging = false, rubStart = null;
  var rubOffset = { x: 0, y: 0 };
  var selectedMode = "classic";
  var modeNames = { classic: "32张经典", double: "看牌加倍", four: "经典四人" };
  var DECK_BASE = "assets/opendecks/svg cards/";
  var DECK_SUIT = { "红桃": "hearts", "方块": "diamonds", "黑桃": "spades", "梅花": "clubs" };
  var DECK_RANK = { "J": "jack", "Q": "queen" };
  var $ = function (id) { return document.getElementById(id); };
  function notice(text) { $("notice").textContent = text || ""; }
  function emit(event, data) { socket.emit(event, data, function (result) { if (!result.ok) notice(result.error); }); }
  function renderTurnText() {
    if (!state) return;
    var turn = state.players.find(function (p) { return p.id === state.turnId; });
    if (state.phase === "rubbing") {
      var ready = state.players.filter(function (p) { return p.rubReady; }).length;
      $("turn").textContent = "等待搓牌 " + ready + "/" + state.players.length;
      return;
    }
    if (state.phase === "showdown" && state.nextDeadline) {
      var nextSeconds = Math.max(0, Math.ceil((state.nextDeadline - Date.now()) / 1000));
      $("turn").textContent = nextSeconds + "s 后自动下一局";
      if ($("next")) $("next").textContent = "立即下一局（" + nextSeconds + "s）";
      return;
    }
    if (state.phase !== "playing" || !turn) {
      $("turn").textContent = state.phase === "showdown" ? "比牌完成" : "等待房主开始";
      return;
    }
    var seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : 0;
    $("turn").textContent = "轮到 " + turn.name + (turn.autoManaged ? "（托管思考中）" : " · " + seconds + "s");
  }
  function deckCardSrc(c) {
    if (c.rank === "大王") return encodeURI(DECK_BASE + "card fronts/jokers/red joker.svg");
    var suit = DECK_SUIT[c.suit];
    var rank = DECK_RANK[c.rank] || c.rank;
    return encodeURI(DECK_BASE + "card fronts/" + suit + "/" + rank + " of " + suit + ".svg");
  }
  function cardBack() {
    return '<div class="card-back deck-card-back"><img src="' + encodeURI(DECK_BASE + "card backs/card back blue.svg") + '" alt="牌背"></div>';
  }
  function card(card) {
    if (!card) return cardBack();
    var cls = card.color === "red" ? " red" : "";
    var label = card.rank === "大王" ? "大王" : card.rank + card.sym;
    return '<div class="card deck-card' + cls + '"><img src="' + deckCardSrc(card) + '" alt="' + label + '"></div>';
  }
  function updateRubSlide(dx, dy) {
    var slider = $("online-rub-slider");
    var distance = Math.sqrt(dx * dx + dy * dy), maxDistance = 240;
    if (distance > maxDistance) {
      var scale = maxDistance / distance;
      dx *= scale; dy *= scale; distance = maxDistance;
    }
    rubOffset = { x: dx, y: dy };
    var ratio = Math.min(1, distance / 215);
    slider.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx / 40) + "deg)";
    $("online-rub-progress-bar").style.width = Math.round(ratio * 100) + "%";
    $("online-rub-progress-text").textContent = ratio < .42 ? "先看边上的花点 · 已露出 " + Math.round(ratio * 100) + "%" : "不确定就继续慢慢搓 · 已露出 " + Math.round(ratio * 100) + "%";
    if (ratio >= 1) finishRubCards();
  }
  function finishRubCards() {
    if (!rubActive) return;
    rubActive = false; rubDragging = false; rubStart = null;
    var slider = $("online-rub-slider"), hidden = $("online-rub-hidden-face").parentElement;
    hidden.classList.add("rank-revealed");
    slider.classList.remove("dragging"); slider.classList.add("revealed");
    var dx = rubOffset.x || -1, dy = rubOffset.y || -.2;
    var distance = Math.sqrt(dx * dx + dy * dy) || 1, fly = 280 / distance;
    slider.style.transition = "transform .48s cubic-bezier(.2,.75,.28,1),opacity .38s ease";
    slider.style.transform = "translate(" + (dx * fly) + "px," + (dy * fly) + "px) rotate(" + (-5 + dx / 12) + "deg)";
    slider.style.opacity = ".18";
    $("online-rub-progress-bar").style.width = "100%";
    $("online-rub-progress-text").textContent = "两张牌已看清";
    setTimeout(function () {
      $("online-rub-overlay").classList.add("hidden");
      socket.emit("game:rub_ready", {}, function (result) { if (result && !result.ok) notice(result.error); });
    }, 650);
  }
  function showRubCards(hand, gameNo) {
    if (!hand || !hand[0] || !hand[1]) return;
    rubbedGameNo = gameNo; rubActive = true; rubDragging = false; rubStart = null; rubOffset = { x: 0, y: 0 };
    var slider = $("online-rub-slider"), hidden = $("online-rub-hidden-face").parentElement;
    $("online-rub-visible-face").src = deckCardSrc(hand[0]);
    $("online-rub-hidden-face").src = deckCardSrc(hand[1]);
    $("online-rub-round").textContent = "第" + gameNo + "局";
    hidden.classList.remove("rank-revealed");
    slider.classList.remove("dragging", "revealed");
    slider.style.transition = "none"; slider.style.transform = "translate(0,0)"; slider.style.opacity = "1";
    $("online-rub-progress-bar").style.width = "0";
    $("online-rub-progress-text").textContent = "拖动上牌，先观察边上的花点";
    $("online-rub-overlay").classList.remove("hidden");
  }
  function syncRubOverlay() {
    if (!state) return;
    var me = state.players.find(function (p) { return p.id === socket.id; });
    if (state.phase === "rubbing" && me && me.hand && state.gameNo !== rubbedGameNo) showRubCards(me.hand, state.gameNo);
    if (state.phase !== "rubbing" && rubActive) {
      rubActive = false; rubDragging = false;
      $("online-rub-overlay").classList.add("hidden");
    }
  }
  function render() {
    if (!state) return;
    $("lobby").classList.add("hidden"); $("room").classList.remove("hidden");
    $("room-code").textContent = state.code;
    $("phase").textContent = state.phase === "lobby" ? (modeNames[state.mode] || "等待玩家") : state.phase === "rubbing" ? "搓牌中" : state.phase === "showdown" ? "本局结算" : "第 " + state.round + " 轮";
    $("pot").textContent = state.pot;
    renderTurnText();
    var players = $("players"); players.innerHTML = "";
    state.players.forEach(function (p, index) {
      var el = document.createElement("div"); el.className = "player";
      var angle = (90 + index * 360 / state.players.length) * Math.PI / 180;
      el.style.left = (50 + 43 * Math.cos(angle)) + "%";
      el.style.top = (50 + 40 * Math.sin(angle)) + "%";
      el.style.setProperty("--seat-scale", state.players.length > 6 ? ".70" : state.players.length > 4 ? ".82" : "1");
      el.innerHTML = '<div class="name' + (p.id === state.turnId ? ' turn' : '') + '">' + p.name + (p.id === state.hostId ? ' · 房主' : '') + '</div>' +
        '<div class="chips">积分 ' + p.score + '</div><div class="cards">' + card(p.hand && p.hand[0]) + card(p.hand && p.hand[1]) + '</div>' +
        '<div class="status">' + (p.folded ? '已弃牌' : p.waiting ? '等待比牌' : state.phase === 'rubbing' ? (p.rubReady ? '已搓牌' : '搓牌中') : p.autoManaged ? '托管中' : p.id === state.winnerId ? '本局获胜' : p.handText || '') + '</div>';
      players.appendChild(el);
    });
    var actions = $("actions"); actions.innerHTML = "";
    if (state.actions) [["raise", "吃桌面 +" + state.pot, ""], ["call", "吃一个底注 +1", "secondary"], ["wait", "等待比牌", "secondary"], ["fold", "弃牌", "gray"]].forEach(function (entry) {
      if (!state.actions[entry[0]]) return;
      var button = document.createElement("button"); button.textContent = entry[1]; button.className = entry[2];
      button.onclick = function () { emit("game:action", { action: entry[0] }); }; actions.appendChild(button);
    });
    var eventBox = $("events"); eventBox.innerHTML = "";
    state.events.slice().reverse().forEach(function (e) { var line = document.createElement("div"); line.className = "event"; line.innerHTML = '<time>' + e.at + '</time>' + e.text; eventBox.appendChild(line); });
    var isHost = state.hostId === socket.id;
    $("start").classList.toggle("hidden", !isHost || state.phase !== "lobby");
    $("next").classList.toggle("hidden", !isHost || state.phase !== "showdown");
    if (state.phase !== "showdown") $("next").textContent = "下一局";
  }
  document.querySelectorAll(".mode-card[data-mode]").forEach(function (card) {
    card.onclick = function () {
      selectedMode = card.dataset.mode;
      document.querySelectorAll(".mode-card[data-mode]").forEach(function (item) { var on = item === card; item.classList.toggle("selected", on); item.setAttribute("aria-pressed", String(on)); });
      notice("已选择「" + modeNames[selectedMode] + "」，现在可以创建房间。");
    };
  });
  $("create").onclick = function () { emit("room:create", { name: $("name").value, mode: selectedMode }); };
  $("join").onclick = function () { emit("room:join", { name: $("name").value, code: $("code").value }); };
  $("start").onclick = function () { emit("game:start", {}); };
  $("next").onclick = function () { emit("game:next", {}); };
  $("online-rub-slider").addEventListener("pointerdown", function (e) {
    if (!rubActive) return;
    rubDragging = true; rubStart = { x: e.clientX - rubOffset.x, y: e.clientY - rubOffset.y };
    this.classList.add("dragging"); this.setPointerCapture(e.pointerId); e.preventDefault();
  });
  $("online-rub-slider").addEventListener("pointermove", function (e) { if (rubDragging && rubActive) updateRubSlide(e.clientX - rubStart.x, e.clientY - rubStart.y); });
  ["pointerup", "pointercancel"].forEach(function (name) { $("online-rub-slider").addEventListener(name, function () { rubDragging = false; rubStart = null; this.classList.remove("dragging"); }); });
  $("online-rub-reveal").onclick = finishRubCards;
  socket.on("room_state", function (next) { state = next; notice(""); render(); syncRubOverlay(); });
  socket.on("connect_error", function () { notice("无法连接联机服务，请确认服务端已启动。"); });
  setInterval(renderTurnText, 250);
})();
