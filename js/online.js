(function () {
  "use strict";
  var socket = io();
  var state = null;
  var rubbedGameNo = 0, rubActive = false, rubDragging = false, rubStart = null;
  var rubOffset = { x: 0, y: 0 };
  var selectedMode = "classic";
  var selectedMatchType = "rounds", selectedRounds = 20, selectedMinutes = 20;
  var modeNames = { classic: "32张经典", double: "看牌加倍", four: "经典四人" };
  var TOKEN_KEY = "boyi32_player_token", ROOM_KEY = "boyi32_room_code", NAME_KEY = "boyi32_player_name";
  var DECK_BASE = "assets/opendecks/svg cards/";
  var DECK_SUIT = { "红桃": "hearts", "方块": "diamonds", "黑桃": "spades", "梅花": "clubs" };
  var DECK_RANK = { "J": "jack", "Q": "queen" };
  var $ = function (id) { return document.getElementById(id); };
  function storageGet(key) { try { return localStorage.getItem(key) || ""; } catch (_error) { return ""; } }
  function storageSet(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (_error) {} }
  function makeToken() {
    var bytes = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
  }
  var playerToken = storageGet(TOKEN_KEY) || makeToken();
  storageSet(TOKEN_KEY, playerToken);
  if (storageGet(NAME_KEY)) $("name").value = storageGet(NAME_KEY);
  function notice(text) { $("notice").textContent = text || ""; }
  function emit(event, data, done) {
    socket.emit(event, data, function (result) {
      result = result || { ok: false, error: "服务器没有响应。" };
      if (!result.ok) notice(result.error);
      if (done) done(result);
    });
  }
  function renderTurnText() {
    if (!state) return;
    if (state.matchType === "time" && $("match-summary")) {
      var matchLeft = state.endAt ? Math.max(0, state.endAt - Date.now()) : state.durationMinutes * 60 * 1000;
      var minutes = Math.floor(matchLeft / 60000), secondsInMinute = Math.floor((matchLeft % 60000) / 1000);
      $("match-summary").textContent = "时长模式 · " + minutes + ":" + String(secondsInMinute).padStart(2, "0");
    }
    var turn = state.players.find(function (p) { return p.id === state.turnId; });
    if (state.phase === "blind_choice") {
      var blindSeconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : 30;
      if (state.turnId === state.selfId && window.GAME_AUDIO) window.GAME_AUDIO.tick(blindSeconds);
      $("turn").textContent = state.blindChoice ? ("你是头家 · 请选择是否蒙吃 · " + blindSeconds + "s") : ("等待头家选择是否蒙吃 · " + blindSeconds + "s");
      return;
    }
    if (state.phase === "rubbing") {
      var ready = state.players.filter(function (p) { return p.rubReady; }).length;
      $("turn").textContent = "等待搓牌 " + ready + "/" + state.players.length;
      return;
    }
    if (state.phase === "finished") {
      $("turn").textContent = "牌局已结束 · 查看最终积分";
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
    if (turn.id === state.selfId && window.GAME_AUDIO) window.GAME_AUDIO.tick(seconds);
    $("turn").textContent = !turn.connected && !turn.autoManaged ? ("等待 " + turn.name + " 重连 · " + seconds + "s") : "轮到 " + turn.name + (turn.autoManaged ? "（托管思考中）" : " · " + seconds + "s");
  }
  function renderRanking() {
    var panel = $("online-ranking");
    if (!panel || !state || state.phase !== "finished") {
      if (panel) { panel.classList.add("hidden"); panel.innerHTML = ""; }
      if ($("online-result-screen")) $("online-result-screen").classList.add("hidden");
      return;
    }
    var sorted = state.players.slice().sort(function (a, b) { return b.score - a.score; });
    var lastScore = null, shownRank = 0;
    var rows = sorted.map(function (player, index) {
      if (lastScore === null || player.score !== lastScore) shownRank = index + 1;
      lastScore = player.score;
      var medal = shownRank === 1 ? "🥇" : shownRank === 2 ? "🥈" : shownRank === 3 ? "🥉" : shownRank;
      return '<li class="' + (player.id === state.selfId ? "is-me" : "") + '"><span class="ranking-place">' + medal + '</span>' +
        '<span class="ranking-player">' + player.name + (player.id === state.selfId ? "（你）" : "") + '</span><b class="ranking-wins">' + (player.wins || 0) + ' 胜</b>' +
        '<strong class="ranking-score">' + (player.score > 0 ? "+" : "") + player.score + ' 分</strong></li>';
    }).join("");
    panel.innerHTML = '<div class="ranking-columns"><span>排名 / 玩家</span><span>胜局</span><span>总积分</span></div><ol>' + rows + '</ol>';
    panel.classList.remove("hidden");
    var me = state.players.find(function (player) { return player.id === state.selfId; });
    $("online-final-score").textContent = (me && me.score > 0 ? "+" : "") + (me ? me.score : 0);
    $("online-final-room").textContent = state.code;
    $("online-final-rounds").textContent = state.gameNo + "局";
    $("room").classList.add("hidden");
    $("online-result-screen").classList.remove("hidden");
    var again = $("online-result-again");
    again.disabled = state.hostId !== state.selfId;
    again.textContent = state.hostId === state.selfId ? "再来一场" : "等待房主再开一场";
  }
  function updateLiveLabels() {
    renderTurnText();
    if (state && state.phase === "blind_choice" && state.blindChoice) {
      var seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : 30;
      $("online-blind-seconds").textContent = seconds + "s";
      $("online-blind-bar").style.width = Math.min(100, seconds / 30 * 100) + "%";
    }
    document.querySelectorAll("[data-disconnect-deadline]").forEach(function (element) {
      var left = Math.max(0, Math.ceil((Number(element.dataset.disconnectDeadline) - Date.now()) / 1000));
      element.textContent = "断线重连中 · " + left + "s";
    });
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
    if (window.GAME_AUDIO) window.GAME_AUDIO.updateRub(ratio);
    slider.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx / 40) + "deg)";
    $("online-rub-progress-bar").style.width = Math.round(ratio * 100) + "%";
    $("online-rub-progress-text").textContent = ratio < .42 ? "先看边上的花点 · 已露出 " + Math.round(ratio * 100) + "%" : "不确定就继续慢慢搓 · 已露出 " + Math.round(ratio * 100) + "%";
    if (ratio >= 1) finishRubCards();
  }
  function finishRubCards() {
    if (!rubActive) return;
    if (window.GAME_AUDIO) { window.GAME_AUDIO.stopRub(); window.GAME_AUDIO.play("flip"); }
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
    var me = state.players.find(function (p) { return p.id === state.selfId; });
    if (me && me.hand && state.phase !== "showdown" && state.phase !== "finished" && state.gameNo !== rubbedGameNo) showRubCards(me.hand, state.gameNo);
    if ((state.phase === "lobby" || state.phase === "blind_choice" || state.phase === "showdown" || state.phase === "finished") && rubActive) {
      rubActive = false; rubDragging = false;
      if (window.GAME_AUDIO) window.GAME_AUDIO.stopRub();
      $("online-rub-overlay").classList.add("hidden");
    }
  }
  function syncBlindOverlay() {
    if (!state || !state.blindChoice) {
      $("online-blind-overlay").classList.add("hidden");
      return;
    }
    $("online-blind-eat").textContent = "蒙吃桌面 +" + state.blindChoice.cost;
    $("online-blind-bottom").textContent = "蒙吃底注 +1";
    $("online-blind-overlay").classList.remove("hidden");
  }
  function render() {
    if (!state) return;
    $("lobby").classList.add("hidden"); $("room").classList.remove("hidden");
    $("online-result-screen").classList.add("hidden");
    storageSet(ROOM_KEY, state.code);
    $("room-code").textContent = state.code;
    $("phase").textContent = state.phase === "lobby" ? (modeNames[state.mode] || "等待玩家") : state.phase === "blind_choice" ? "头家选择" : state.phase === "rubbing" ? "搓牌中" : state.phase === "showdown" ? "本局结算" : state.phase === "finished" ? "比赛结束" : "第 " + state.round + " 轮";
    var progress = state.matchType === "time" ? ("时长模式 · " + state.durationMinutes + "分钟") : ("局数模式 · " + state.gameNo + "/" + state.maxRounds + "局");
    $("match-summary").textContent = progress;
    $("pot").textContent = state.pot;
    renderTurnText();
    var players = $("players"); players.innerHTML = "";
    state.players.forEach(function (p, index) {
      var el = document.createElement("div"); el.className = "player" + (p.connected ? "" : " disconnected") + (p.id === state.dealerId ? " is-dealer" : "");
      var angle = (90 + index * 360 / state.players.length) * Math.PI / 180;
      el.style.left = (50 + 43 * Math.cos(angle)) + "%";
      el.style.top = (50 + 40 * Math.sin(angle)) + "%";
      el.style.setProperty("--seat-scale", state.players.length > 6 ? ".70" : state.players.length > 4 ? ".82" : "1");
      el.style.setProperty("--avatar-x", (index % 4) * 100 / 3 + "%");
      el.style.setProperty("--avatar-y", Math.floor((index % 8) / 4) * 100 + "%");
      el.innerHTML = '<div class="name' + (p.id === state.turnId ? ' turn' : '') + '"><span class="player-avatar" aria-hidden="true"></span>' + p.name + (p.id === state.hostId ? ' · 房主' : '') + (p.id === state.dealerId ? ' · 头家' : '') + '</div>' +
        '<div class="chips">积分 ' + p.score + '</div><div class="cards">' + card(p.hand && p.hand[0]) + card(p.hand && p.hand[1]) + '</div>' +
        '<div class="status">' + (!p.connected ? (p.autoManaged ? '断线托管中' : '<span data-disconnect-deadline="' + p.disconnectDeadline + '">断线重连中</span>') : p.folded ? '已弃牌' : p.waiting ? '等待比牌' : state.phase === 'blind_choice' ? (p.id === state.turnId ? '选择是否蒙吃' : '等待头家') : state.phase === 'rubbing' ? (p.blind ? '蒙牌中' : p.rubReady ? '已搓牌' : '搓牌中') : p.autoManaged ? '托管中' : p.id === state.winnerId ? '本局获胜' : p.handText || '') + '</div>';
      players.appendChild(el);
    });
    renderRanking();
    var actions = $("actions"); actions.innerHTML = "";
    if (state.canViewCards) {
      var viewButton = document.createElement("button"); viewButton.textContent = "看牌"; viewButton.className = "secondary";
      viewButton.onclick = function () { emit("game:view_cards", {}); }; actions.appendChild(viewButton);
    }
    if (state.actions) [["raise", "吃桌面 +" + state.pot, ""], ["call", "吃一个底注 +1", "secondary"], ["half", "吃半个公池 +" + Math.ceil(state.pot / 2), "secondary"], ["blindcall", "蒙吃底注 +1", "secondary"], ["wait", "等待比牌", "secondary"], ["fold", "弃牌", "gray"]].forEach(function (entry) {
      if (!state.actions[entry[0]]) return;
      var button = document.createElement("button"); button.textContent = entry[1]; button.className = entry[2];
      button.onclick = function () { emit("game:action", { action: entry[0] }); }; actions.appendChild(button);
    });
    var eventBox = $("events"); eventBox.innerHTML = "";
    state.events.slice().reverse().forEach(function (e) { var line = document.createElement("div"); line.className = "event"; line.innerHTML = '<time>' + e.at + '</time>' + e.text; eventBox.appendChild(line); });
    var isHost = state.hostId === state.selfId;
    $("start").classList.toggle("hidden", !isHost || (state.phase !== "lobby" && state.phase !== "finished"));
    $("start").textContent = state.phase === "finished" ? "重新开始" : "房主开始";
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
  document.querySelectorAll("[data-match-type]").forEach(function (button) {
    button.onclick = function () {
      selectedMatchType = button.dataset.matchType;
      document.querySelectorAll("[data-match-type]").forEach(function (item) { item.classList.toggle("selected", item === button); });
      $("online-round-settings").classList.toggle("hidden", selectedMatchType !== "rounds");
      $("online-time-settings").classList.toggle("hidden", selectedMatchType !== "time");
    };
  });
  document.querySelectorAll("[data-rounds]").forEach(function (button) { button.onclick = function () { selectedRounds = Number(button.dataset.rounds); document.querySelectorAll("[data-rounds]").forEach(function (item) { item.classList.toggle("selected", item === button); }); }; });
  document.querySelectorAll("[data-minutes]").forEach(function (button) { button.onclick = function () { selectedMinutes = Number(button.dataset.minutes); document.querySelectorAll("[data-minutes]").forEach(function (item) { item.classList.toggle("selected", item === button); }); }; });
  $("create").onclick = function () {
    storageSet(NAME_KEY, $("name").value.trim());
    emit("room:create", { name: $("name").value, mode: selectedMode, token: playerToken, matchType: selectedMatchType, maxRounds: selectedRounds, durationMinutes: selectedMinutes });
  };
  $("join").onclick = function () {
    storageSet(NAME_KEY, $("name").value.trim());
    emit("room:join", { name: $("name").value, code: $("code").value, token: playerToken });
  };
  $("start").onclick = function () { emit("game:start", {}); };
  $("next").onclick = function () { emit("game:next", {}); };
  $("online-result-again").onclick = function () { emit("game:start", {}); };
  $("online-rub-slider").addEventListener("pointerdown", function (e) {
    if (!rubActive) return;
    rubDragging = true; rubStart = { x: e.clientX - rubOffset.x, y: e.clientY - rubOffset.y };
    if (window.GAME_AUDIO) window.GAME_AUDIO.startRub();
    this.classList.add("dragging"); this.setPointerCapture(e.pointerId); e.preventDefault();
  });
  $("online-rub-slider").addEventListener("pointermove", function (e) { if (rubDragging && rubActive) updateRubSlide(e.clientX - rubStart.x, e.clientY - rubStart.y); });
  ["pointerup", "pointercancel"].forEach(function (name) { $("online-rub-slider").addEventListener(name, function () { rubDragging = false; rubStart = null; this.classList.remove("dragging"); if (window.GAME_AUDIO) window.GAME_AUDIO.stopRub(); }); });
  $("online-rub-reveal").onclick = finishRubCards;
  $("online-blind-eat").onclick = function () { emit("game:blind_choice", { choice: "blind_table" }); };
  $("online-blind-bottom").onclick = function () { emit("game:blind_choice", { choice: "blind_bottom" }); };
  $("online-blind-look").onclick = function () { emit("game:blind_choice", { choice: "look" }); };
  function syncSounds(previous, next) {
    if (!window.GAME_AUDIO || !previous) return;
    if (next.gameNo > previous.gameNo) {
      window.GAME_AUDIO.play("shuffle");
      setTimeout(function () { window.GAME_AUDIO.playDealSequence(next.players.length * 2); }, 260);
    }
    if (next.pot > previous.pot) window.GAME_AUDIO.play("bet");
    if (next.turnId !== previous.turnId) {
      window.GAME_AUDIO.resetCountdown();
      if (next.turnId === next.selfId && (next.phase === "playing" || next.phase === "blind_choice")) window.GAME_AUDIO.cue("turn");
    }
    if (next.phase === "showdown" && previous.phase !== "showdown") {
      var revealed = next.players.filter(function (player) { return !player.folded; }).length;
      for (var i = 0; i < revealed; i++) (function (index) { setTimeout(function () { window.GAME_AUDIO.play("flip"); }, index * 180); })(i);
    }
    if (next.winnerId && next.winnerId !== previous.winnerId) {
      window.GAME_AUDIO.cue("win");
      setTimeout(function () { window.GAME_AUDIO.play("payout"); }, 420);
    }
  }
  socket.on("room_state", function (next) { var previous = state; state = next; syncSounds(previous, next); notice(""); render(); syncBlindOverlay(); syncRubOverlay(); });
  function resumeRoom() {
    var code = storageGet(ROOM_KEY);
    if (!code) return;
    emit("room:resume", { code: code, token: playerToken }, function (result) {
      if (!result.ok) storageSet(ROOM_KEY, "");
      else notice("已恢复房间连接。");
    });
  }
  socket.on("connect", resumeRoom);
  if (socket.connected) resumeRoom();
  socket.on("connect_error", function () { notice("无法连接联机服务，请确认服务端已启动。"); });
  setInterval(updateLiveLabels, 250);
})();
