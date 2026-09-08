// 游戏逻辑（人机对战）—— 依据《完整规则 V1.0》，复用已校验引擎 ENGINE
(function () {
  "use strict";
  var E = window.ENGINE;
  var D = window.GAME_DATA;

  var SUIT_SYMBOL = { "红桃": "♥", "方块": "♦", "黑桃": "♠", "梅花": "♣", "特殊": "" };
  var DECK_SUIT = { "红桃": "hearts", "方块": "diamonds", "黑桃": "spades", "梅花": "clubs" };
  var DECK_RANK = { "J": "jack", "Q": "queen" };
  var DECK_BASE = "assets/opendecks/svg cards/";
  function avatarStyle(index) {
    var col = index % 4, row = Math.floor((index % 8) / 4);
    return "--avatar-x:" + (col * 100 / 3) + "%;--avatar-y:" + (row * 100) + "%";
  }

  var G = {
    players: [], n: 4, dealer: -1, round: 1, pot: 0, phase: "setup",
    lastRaiseRound: 0, bettingRound: 0, started: false, timerOn: true,
    currentPlayer: -1, actionResolve: null, timerHandle: null, seatTimerHandle: null,
    nextRoundTicker: null,
    seatTimerLeft: null, gameOver: false,
    timeoutCount: 0, autoManaged: false,
    session: 0,
    winner: null, tiePlayers: null, showdownPlayers: [], ante: 1,
    deck: [], shuffleCount: 0, dealing: false,
    skipRubForMatch: false, roundActions: [], roundStartScores: [], roundStartPot: 0,
    lastRoundReview: null, revealingPlayer: null
  };
  var cfg = { n: 6, timerOn: true, mode: "rounds", rounds: 20, minutes: 20 };

  var $ = function (id) { return document.getElementById(id); };
  var shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function log(msg, cls) {
    var box = $("log");
    var div = document.createElement("div");
    div.className = "l " + (cls || "");
    var t = new Date().toTimeString().slice(0, 5);
    div.innerHTML = '<span class="t">' + t + "</span>" + msg;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function deckCardSrc(c) {
    if (c.rank === "大王") return encodeURI(DECK_BASE + "card fronts/jokers/red joker.svg");
    var suit = DECK_SUIT[c.suit];
    var rank = DECK_RANK[c.rank] || c.rank;
    return encodeURI(DECK_BASE + "card fronts/" + suit + "/" + rank + " of " + suit + ".svg");
  }
  function cardHTML(c, opts) {
    opts = opts || {};
    if (!c) return cardBackHTML();
    var col = c.color === "red" ? "red" : "black";
    var extra = opts.reveal ? " reveal" : "";
    var label = c.rank === "大王" ? "大王" : c.rank + c.sym;
    return '<div class="card deck-card ' + col + extra + '">' +
      '<img src="' + deckCardSrc(c) + '" alt="' + label + '"></div>';
  }
  function cardBackHTML() {
    return '<div class="card-back deck-card-back"><img src="' +
      encodeURI(DECK_BASE + "card backs/card back blue.svg") + '" alt="牌背"></div>';
  }

  /* ---------- 搓牌 ---------- */
  var rubResolve = null, rubDragging = false, rubStart = null;
  var rubOffset = { x: 0, y: 0 };
  var RUB_REVEAL_DISTANCE = 215;
  var blindChoiceResolve = null, blindChoiceTimer = null;

  function updateRubSlide(dx, dy) {
    var slider = $("rub-slider");
    var distance = Math.sqrt(dx * dx + dy * dy);
    var maxDistance = 240;
    if (distance > maxDistance) {
      var scale = maxDistance / distance;
      dx *= scale;
      dy *= scale;
      distance = maxDistance;
    }
    rubOffset = { x: dx, y: dy };
    var ratio = Math.min(1, distance / RUB_REVEAL_DISTANCE);
    if (window.GAME_AUDIO) window.GAME_AUDIO.updateRub(ratio);
    slider.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx / 40) + "deg)";
    $("rub-progress-bar").style.width = Math.round(ratio * 100) + "%";
    $("rub-progress-text").textContent = ratio >= 1
      ? "底牌已经完全露出"
      : ratio < .42
        ? "先看边上的花点 · 已露出 " + Math.round(ratio * 100) + "%"
        : "不确定就继续慢慢搓 · 已露出 " + Math.round(ratio * 100) + "%";
    if (ratio >= 1) finishRubCards();
  }
  function finishRubCards() {
    if (!rubResolve) return;
    if (window.GAME_AUDIO) { window.GAME_AUDIO.stopRub(); window.GAME_AUDIO.play("flip"); }
    var resolve = rubResolve;
    rubResolve = null;
    rubDragging = false;
    rubStart = null;
    var slider = $("rub-slider");
    $("rub-hidden-face").parentElement.classList.add("rank-revealed");
    slider.classList.remove("dragging");
    slider.classList.add("revealed");
    var dx = rubOffset.x || -1;
    var dy = rubOffset.y || -.2;
    var distance = Math.sqrt(dx * dx + dy * dy) || 1;
    var flyScale = 280 / distance;
    slider.style.transition = "transform .48s cubic-bezier(.2,.75,.28,1), opacity .38s ease";
    slider.style.transform = "translate(" + (dx * flyScale) + "px," + (dy * flyScale) + "px) rotate(" + (-5 + dx / 12) + "deg)";
    slider.style.opacity = ".18";
    $("rub-progress-bar").style.width = "100%";
    $("rub-progress-text").textContent = "两张牌已看清";
    setTimeout(function () {
      $("rub-overlay").classList.add("hidden");
      resolve();
    }, 650);
  }
  function cancelRubCards() {
    if (!rubResolve) return;
    if (window.GAME_AUDIO) window.GAME_AUDIO.stopRub();
    var resolve = rubResolve;
    rubResolve = null;
    rubDragging = false;
    rubStart = null;
    $("rub-slider").classList.remove("dragging");
    $("rub-overlay").classList.add("hidden");
    resolve();
  }
  function showRubCards(hand) {
    if (G.skipRubForMatch) return Promise.resolve();
    return new Promise(function (resolve) {
      var slider = $("rub-slider");
      rubResolve = resolve;
      rubDragging = false;
      rubStart = null;
      rubOffset = { x: 0, y: 0 };
      $("rub-hidden-face").parentElement.classList.remove("rank-revealed");
      $("rub-visible-face").src = deckCardSrc(hand[0]);
      $("rub-hidden-face").src = deckCardSrc(hand[1]);
      $("rub-round").textContent = "第" + G.round + "局";
      $("rub-progress-bar").style.width = "0";
      $("rub-progress-text").textContent = "拖动上牌，先观察边上的花点";
      slider.classList.remove("dragging", "revealed");
      slider.style.transition = "none";
      slider.style.transform = "translate(0,0) rotate(0deg)";
      slider.style.opacity = "1";
      $("rub-overlay").classList.remove("hidden");
    });
  }
  $("rub-slider").addEventListener("pointerdown", function (e) {
    if (!rubResolve) return;
    rubDragging = true;
    if (window.GAME_AUDIO) window.GAME_AUDIO.startRub();
    rubStart = { x: e.clientX - rubOffset.x, y: e.clientY - rubOffset.y };
    this.classList.add("dragging");
    this.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  $("rub-slider").addEventListener("pointermove", function (e) {
    if (!rubDragging || !rubResolve) return;
    updateRubSlide(e.clientX - rubStart.x, e.clientY - rubStart.y);
  });
  ["pointerup", "pointercancel"].forEach(function (name) {
    $("rub-slider").addEventListener(name, function () {
      if (!rubDragging) return;
      rubDragging = false;
      if (window.GAME_AUDIO) window.GAME_AUDIO.stopRub();
      rubStart = null;
      this.classList.remove("dragging");
    });
  });
  $("rub-reveal").addEventListener("click", finishRubCards);
  $("rub-skip-match").addEventListener("click", function () {
    G.skipRubForMatch = true;
    finishRubCards();
  });

  /* ---------- 头家蒙吃选择 ---------- */
  function stopBlindChoiceTimer() {
    if (blindChoiceTimer) clearInterval(blindChoiceTimer);
    blindChoiceTimer = null;
  }
  function finishBlindChoice(choice) {
    if (!blindChoiceResolve) return;
    if (window.GAME_AUDIO) window.GAME_AUDIO.resetCountdown();
    var resolve = blindChoiceResolve;
    blindChoiceResolve = null;
    stopBlindChoiceTimer();
    $("blind-overlay").classList.add("hidden");
    resolve(choice);
  }
  function startBlindChoiceTimer() {
    stopBlindChoiceTimer();
    var timer = document.querySelector(".blind-countdown");
    if (!G.timerOn) { timer.classList.add("hidden"); return; }
    timer.classList.remove("hidden");
    var duration = 30, startedAt = Date.now();
    function paint() {
      var left = Math.max(0, duration - (Date.now() - startedAt) / 1000);
      if (window.GAME_AUDIO) window.GAME_AUDIO.tick(left);
      $("blind-countdown-text").textContent = Math.ceil(left) + "s";
      $("blind-countdown-bar").style.width = (left / duration * 100) + "%";
      if (left > 0) return;
      stopBlindChoiceTimer();
      G.timeoutCount++;
      if (G.timeoutCount < 3) {
        log("第 <b>" + G.timeoutCount + "</b> 次超时，继续等待头家选择（第 3 次超时后托管）。", "hl");
        startBlindChoiceTimer();
      } else {
        G.autoManaged = true;
        log("头家蒙吃选择已第 <b>3</b> 次超时，系统开启托管并选择先看牌。", "hl");
        finishBlindChoice("look");
      }
    }
    paint();
    blindChoiceTimer = setInterval(paint, 100);
  }
  function askBlindChoice(cost) {
    return new Promise(function (resolve) {
      if (window.GAME_AUDIO) { window.GAME_AUDIO.resetCountdown(); window.GAME_AUDIO.cue("turn"); }
      blindChoiceResolve = resolve;
      $("blind-eat-btn").textContent = "蒙吃桌面 +" + cost;
      $("blind-bottom-btn").textContent = "蒙吃底注 +" + G.ante;
      $("blind-overlay").classList.remove("hidden");
      startBlindChoiceTimer();
    });
  }
  function cancelBlindChoice() {
    if (!blindChoiceResolve) return;
    if (window.GAME_AUDIO) window.GAME_AUDIO.resetCountdown();
    finishBlindChoice(null);
  }
  $("blind-eat-btn").addEventListener("click", function () { finishBlindChoice("blind_table"); });
  $("blind-bottom-btn").addEventListener("click", function () { finishBlindChoice("blind_bottom"); });
  $("blind-look-btn").addEventListener("click", function () { finishBlindChoice("look"); });

  /* ---------- 渲染 ---------- */
  function renderSeats() {
    var wrap = $("seats");
    wrap.innerHTML = "";
    var n = G.n;
    wrap.className = "seats players-" + n;
    var mobileTable = window.matchMedia && window.matchMedia("(max-width: 600px)").matches;
    var cx = 50, cy = mobileTable ? 46 : 44;
    var rx = mobileTable ? (n >= 6 ? 34 : 37) : 40;
    var ry = mobileTable ? (n >= 6 ? 34 : 32) : 36;
    var dealerPosition = null;
    G.players.forEach(function (p, i) {
      var left, top;
      if (i === 0) { left = 50; top = mobileTable ? 90 : 88; }
      else {
        var ang = (90 + i * (360 / n)) * Math.PI / 180;
        left = cx + rx * Math.cos(ang);
        top = cy + ry * Math.sin(ang);
      }
      var cls = ["seat"];
      if (n >= 9) cls.push("seat-dense");
      if (p.isHuman) cls.push("is-me");
      if (p.folded) cls.push("folded");
      if (p.out) cls.push("out");
      if (p.isWinner) cls.push("winner");
      if (G.revealingPlayer === p) cls.push("is-revealing");
      var isActive = G.phase === "betting" && G.players[G.currentPlayer] === p && !p.folded && !p.out;
      if (isActive) cls.push("is-active");

      var seat = document.createElement("div");
      seat.className = cls.join(" ");
      seat.style.left = left + "%";
      seat.style.top = top + "%";

      // 座位号按当前头家动态计算：头家永远为1号，之后按行动顺序递增。
      var seatNo = G.dealer >= 0 ? ((i - G.dealer + n) % n) + 1 : i + 1;
      if (seatNo === 1) seat.classList.add("is-dealer");
      if (seatNo === 1) dealerPosition = { left: left, top: top };

      // 发牌阶段只显示已经真正发到座位上的牌，避免动画尚未到达就出现两张牌。
      var handHTML;
      if (G.dealing) {
        handHTML = p.hand.filter(Boolean).map(function () { return cardBackHTML(); }).join("");
      } else if (p.revealed) handHTML = cardHTML(p.hand[0], { reveal: true }) + cardHTML(p.hand[1], { reveal: true });
      else if (p.isHuman && p.hasLooked) handHTML = cardHTML(p.hand[0]) + cardHTML(p.hand[1]);
      else handHTML = cardBackHTML() + cardBackHTML();

      // 行为徽标（弃牌 / 出局由 CSS ::after / .out 处理，故只渲染玩家真正选择的动作）
      var actionHTML = "";
      if (!p.out && !p.folded && !p.isWinner && p.lastAction) {
        var actionCls = p.lastAction;
        actionHTML = '<span class="seat-action ' + actionCls + '">' + p.lastAction + '</span>';
      }

      var nameHTML =
        '<div class="seat-name">' +
          '<div class="seat-avatar" style="' + avatarStyle(i) + '" aria-label="' + p.name + '头像"></div>' +
          '<span class="seat-name-text">' + p.name + (seatNo === 1 ? " · 头家" : "") + '</span>' +
        '</div>';

      var timerLeft = Math.max(0, Math.ceil(G.seatTimerLeft == null ? 30 : G.seatTimerLeft));
      var timerWidth = Math.max(0, Math.min(100, ((G.seatTimerLeft == null ? 30 : G.seatTimerLeft) / 30) * 100));
      var turnTimerHTML = isActive && G.timerOn ?
        '<div class="seat-turn-timer"><span id="seat-timer-txt">' + timerLeft + 's</span>' +
        '<span class="seat-timer-bar"><i id="seat-timer-bar" style="width:' + timerWidth + '%"></i></span></div>' : '';
      var bottomHTML =
        '<div class="seat-bottom">' +
          actionHTML +
          '<span class="seat-chips"><span class="coin-icon"></span>' + p.chips + '</span>' +
        '</div>';

      seat.innerHTML = turnTimerHTML + nameHTML + '<div class="seat-hand">' + handHTML + '</div>' + bottomHTML;
      wrap.appendChild(seat);
    });
    var dc = $("dealer-chip"), dp = $("dealer-pill");
    if (G.dealer != null && G.dealer >= 0 && G.players[G.dealer]) {
      dc.classList.remove("hidden"); dp.classList.remove("hidden");
      if (dealerPosition) {
        dc.style.left = dealerPosition.left + "%";
        dc.style.top = Math.max(5, dealerPosition.top - 13) + "%";
      }
      dp.textContent = "头家：" + G.players[G.dealer].name;
    } else { dc.classList.add("hidden"); dp.classList.add("hidden"); }
  }
  function renderPot() { $("pot-val").textContent = G.pot; }
  function showShowdownCallout(text, winner) {
    var el = $("showdown-callout");
    if (!el) return;
    if (!text) { el.classList.add("hidden"); el.classList.remove("winner"); el.textContent = ""; return; }
    el.textContent = text;
    el.classList.toggle("winner", !!winner);
    el.classList.remove("hidden");
  }
  function renderDeckPile() {
    var pile = $("deck-pile"), count = G.deck ? G.deck.length : 0;
    if (!pile) return;
    $("deck-count").textContent = count + "张";
    pile.setAttribute("aria-label", "牌堆剩余" + count + "张");
    pile.classList.toggle("is-empty", count === 0);
  }
  function renderMyZone() {
    var me = G.players[0];
    var zone = $("my-hand");
    if (!me || G.phase === "setup" || G.dealing || me.out || !me.hand[0]) {
      zone.innerHTML = '<span class="muted">' + (G.phase === "setup" ? "等待开局…" : "等待发牌…") + "</span>";
      return;
    }
    if (!me.hasLooked && !me.revealed) {
      zone.innerHTML = cardBackHTML() + cardBackHTML() +
        '<div class="hand-info"><div class="hname">' + (G.humanBlind ? "当前蒙牌" : "尚未看牌") + '</div>' +
        '<div class="hdesc">可随时看牌；看牌后不能再蒙吃底注</div>' +
        (G.humanBlindPending ? '' : '<button type="button" class="view-cards-now" id="view-cards-now">看牌</button>') + '</div>' +
        '<div class="my-meta"><div class="label">你的积分</div><div class="chips"><span class="coin-icon"></span>' + me.chips + '</div></div>';
      return;
    }
    var ev = E.evaluate(me.hand[0], me.hand[1]);
    zone.innerHTML =
      // 手牌区域会随其他玩家行动而重绘；不添加翻牌动画，避免牌面反复闪动。
      cardHTML(me.hand[0]) + cardHTML(me.hand[1]) +
      '<div class="hand-info"><div class="hname">' + E.handDesc(ev) + "</div>" +
      '<div class="hdesc">' + (ev.type === "special" ? "特殊牌型（不计算普通点数）" : ("点数 (" + me.hand[0].value + "+" + me.hand[1].value + ") 取个位 → " + ev.point + "点")) + "</div></div>" +
      '<div class="my-meta"><div class="label">你的积分</div>' +
      '<div class="chips"><span class="coin-icon"></span>' + me.chips + '</div></div>';
  }
  async function viewMyCardsNow() {
    var me = G.players[0];
    if (!me || me.hasLooked || G.humanBlindPending || !me.hand[0] || rubResolve) return;
    var session = G.session;
    me.hasLooked = true; G.humanBlind = false; renderAll();
    if (G.actionResolve && G._humanOpts) {
      G._humanOpts = G._humanOpts.filter(function (option) { return option !== "blindcall"; });
      showActions(true, G._humanOpts, G.bettingRound === 1);
    }
    await showRubCards(me.hand);
    if (isCurrentSession(session)) renderAll();
  }
  $("my-hand").addEventListener("click", function (event) {
    if (event.target && event.target.id === "view-cards-now") viewMyCardsNow();
  });
  function renderPills() {
    $("round-pill").textContent = G.matchMode === "rounds" ? ("第 " + G.round + " / " + G.maxRounds + " 局") : ("第 " + G.round + " 局 · 时长模式");
    var ph = { setup: "准备中", deal: "翻牌定头家", betting: "下注阶段", showdown: "比牌阶段", settle: "结算" };
    $("phase-pill").textContent = ph[G.phase] || G.phase;
  }
  function renderMatchRanking() {
    var panel = $("match-ranking");
    if (!panel) return;
    if (!G.matchFinished) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      $("solo-result-screen").classList.add("hidden");
      return;
    }
    var sorted = G.players.slice().sort(function (a, b) { return b.chips - a.chips; });
    var lastScore = null, shownRank = 0;
    var rows = sorted.map(function (p, index) {
      if (lastScore === null || p.chips !== lastScore) shownRank = index + 1;
      lastScore = p.chips;
      var medal = shownRank === 1 ? "🥇" : shownRank === 2 ? "🥈" : shownRank === 3 ? "🥉" : shownRank;
      return '<li class="' + (p.isHuman ? "is-me" : "") + '"><span class="ranking-place">' + medal + '</span>' +
        '<span class="ranking-player">' + p.name + (p.isHuman ? "（你）" : "") + '</span><b class="ranking-wins">' + p.wins + ' 胜</b>' +
        '<strong class="ranking-score">' + (p.chips > 0 ? "+" : "") + p.chips + ' 分</strong></li>';
    }).join("");
    var matchText = G.matchMode === "rounds" ? (G.maxRounds + "局已完成") : "本场时长已结束";
    panel.innerHTML = '<div class="ranking-columns"><span>排名 / 玩家</span><span>胜局</span><span>总积分</span></div><ol>' + rows + '</ol>';
    panel.classList.remove("hidden");
    $("solo-final-score").textContent = (G.players[0].chips > 0 ? "+" : "") + G.players[0].chips;
    $("solo-final-mode").textContent = G.matchMode === "rounds" ? G.maxRounds + "局模式" : cfg.minutes + "分钟";
    $("solo-final-rounds").textContent = G.round + "局";
    $("game-screen").classList.add("hidden");
    $("solo-result-screen").classList.remove("hidden");
  }
  function renderAll() { renderSeats(); renderPot(); renderDeckPile(); renderMyZone(); renderPills(); }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function recordRoundAction(p, action, amount) {
    G.roundActions.push({ player: p.name, action: action, amount: amount || 0, pot: G.pot });
  }
  function captureRoundReview(winner, prize, finalPot) {
    G.lastRoundReview = {
      round: G.round,
      winner: winner ? winner.name : G.lastSeatThresholdFailed ? "无人获胜" : "平局",
      prize: prize || 0,
      finalPot: finalPot,
      actions: G.roundActions.slice(),
      players: G.players.map(function (p, i) {
        return {
          name: p.name, folded: p.folded, won: p === winner,
          hand: p.hand[0] && p.hand[1] ? E.handDesc(E.evaluate(p.hand[0], p.hand[1])) : "未发牌",
          change: p.chips - (G.roundStartScores[i] || 0)
        };
      })
    };
    $("review-toggle").disabled = false;
    renderLastRoundReview();
  }
  function renderLastRoundReview() {
    var box = $("last-round-review"), review = G.lastRoundReview;
    if (!box || !review) return;
    var actions = review.actions.map(function (item) {
      return '<span class="review-action"><b>' + escapeHTML(item.player) + '</b> ' + escapeHTML(item.action) +
        (item.amount ? " +" + item.amount : "") + " · 公池" + item.pot + "</span>";
    }).join("");
    var players = review.players.map(function (item) {
      return '<div class="review-player' + (item.won ? " won" : "") + (item.folded ? " folded" : "") + '">' +
        '<b>' + escapeHTML(item.name) + (item.folded ? " · 弃牌" : "") + '</b><em>' + (item.change > 0 ? "+" : "") + item.change +
        '</em><span>' + escapeHTML(item.hand) + '</span></div>';
    }).join("");
    box.innerHTML = '<div class="review-head"><h3>第 ' + review.round + ' 局回顾</h3><strong>' + escapeHTML(review.winner) +
      (review.prize ? " 赢得 " + review.prize : "") + " · 最终公池 " + review.finalPot + '</strong></div>' +
      '<div class="review-actions">' + actions + '</div><div class="review-players">' + players + '</div>';
  }
  $("review-toggle").addEventListener("click", function () {
    var box = $("last-round-review");
    if (!G.lastRoundReview) return;
    box.classList.toggle("hidden");
    this.textContent = box.classList.contains("hidden") ? "上局回顾" : "收起回顾";
  });

  /* ---------- 金币流动动画 ---------- */
  function pointInTable(el) {
    var table = document.querySelector(".table");
    if (!table || !el) return null;
    var tr = table.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - tr.left + r.width / 2, y: r.top - tr.top + r.height / 2 };
  }
  function flyCoins(fromEl, toEl, amount) {
    var layer = $("coin-fx"), from = pointInTable(fromEl), to = pointInTable(toEl);
    if (!layer || !from || !to || amount <= 0) return Promise.resolve();
    // 金额越大，画面中的金币略增；数量封顶，避免公池很大时拖慢画面。
    var count = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(amount))));
    var jobs = [];
    for (var i = 0; i < count; i++) {
      (function (num) {
        var coin = document.createElement("i");
        coin.className = "flying-coin";
        var spreadX = (Math.random() - .5) * 18, spreadY = (Math.random() - .5) * 12;
        coin.style.left = (from.x + spreadX) + "px";
        coin.style.top = (from.y + spreadY) + "px";
        layer.appendChild(coin);
        var dx = to.x - from.x + (Math.random() - .5) * 12;
        var dy = to.y - from.y + (Math.random() - .5) * 10;
        var arcX = dx * .48 + (Math.random() - .5) * 48;
        var arcY = dy * .48 - 38 - Math.random() * 28;
        var duration = 560 + Math.random() * 140;
        var animation = coin.animate([
          { transform: "translate(-50%,-50%) scale(.72)", opacity: 0 },
          { transform: "translate(" + (arcX - 9) + "px," + (arcY - 9) + "px) scale(1.12)", opacity: 1, offset: .42 },
          { transform: "translate(" + (dx - 9) + "px," + (dy - 9) + "px) scale(.78)", opacity: .15 }
        ], { duration: duration, delay: num * 55, easing: "cubic-bezier(.2,.75,.28,1)", fill: "forwards" });
        jobs.push(new Promise(function (resolve) {
          animation.onfinish = function () { coin.remove(); resolve(); };
          animation.oncancel = function () { coin.remove(); resolve(); };
        }));
      })(i);
    }
    return Promise.all(jobs);
  }
  function queueCoinsToPot(p, amount) {
    if (window.GAME_AUDIO) window.GAME_AUDIO.play("bet");
    var playerIndex = G.players.indexOf(p);
    requestAnimationFrame(function () {
      var seats = document.querySelectorAll("#seats .seat");
      flyCoins(seats[playerIndex] && seats[playerIndex].querySelector(".seat-chips"), document.querySelector(".pot-center"), amount);
    });
  }
  function sendPotToWinner(p, amount) {
    var playerIndex = G.players.indexOf(p), seats = document.querySelectorAll("#seats .seat");
    if (window.GAME_AUDIO) window.GAME_AUDIO.play("payout");
    return flyCoins(document.querySelector(".pot-center"), seats[playerIndex] && seats[playerIndex].querySelector(".seat-chips"), amount);
  }

  /* ---------- 牌堆与发牌动画 ---------- */
  async function shuffleDeckForNextRound(session, reason) {
    var pile = $("deck-pile");
    if (reason) log(reason + "，重新洗满 <b>32张</b>。", "hl");
    G.deck = shuffle(D.CARDS);
    G.shuffleCount++;
    if (window.GAME_AUDIO) window.GAME_AUDIO.play("shuffle");
    renderDeckPile();
    if (pile) pile.classList.add("is-shuffling");
    await delay(720);
    if (pile) pile.classList.remove("is-shuffling");
    return isCurrentSession(session);
  }
  function animateDealCard(playerIndex) {
    var layer = $("deal-fx"), pile = $("deck-pile");
    var seats = document.querySelectorAll("#seats .seat");
    var target = seats[playerIndex] && seats[playerIndex].querySelector(".seat-hand");
    var from = pointInTable(pile), to = pointInTable(target || seats[playerIndex]);
    if (!layer || !from || !to) {
      if (window.GAME_AUDIO) window.GAME_AUDIO.play("deal");
      return delay(70);
    }
    var flying = document.createElement("div");
    flying.className = "flying-card";
    flying.innerHTML = '<img src="' + encodeURI(DECK_BASE + "card backs/card back blue.svg") + '" alt="">';
    flying.style.left = from.x + "px";
    flying.style.top = from.y + "px";
    layer.appendChild(flying);
    var dx = to.x - from.x, dy = to.y - from.y;
    var turn = playerIndex % 2 ? 7 : -7;
    var animation = flying.animate([
      { transform: "translate(-50%,-50%) scale(.94) rotate(0deg)", opacity: 1 },
      { transform: "translate(" + (dx * .52 - 27) + "px," + (dy * .52 - 38) + "px) scale(1.03) rotate(" + (turn * .55) + "deg)", opacity: 1, offset: .52 },
      { transform: "translate(" + (dx - 27) + "px," + (dy - 38) + "px) scale(.88) rotate(" + turn + "deg)", opacity: .18 }
    ], { duration: 260, easing: "cubic-bezier(.22,.7,.25,1)", fill: "forwards" });
    // 落牌声对齐牌到达玩家手边的瞬间，而不是动画刚起飞时。
    setTimeout(function () { if (window.GAME_AUDIO) window.GAME_AUDIO.play("deal"); }, 205);
    return new Promise(function (resolve) {
      animation.onfinish = function () { flying.remove(); resolve(); };
      animation.oncancel = function () { flying.remove(); resolve(); };
    });
  }
  async function dealFromPersistentDeck(session) {
    var activeIndexes = [];
    G.players.forEach(function (p, i) { if (!p.out) activeIndexes.push(i); });
    var required = activeIndexes.length * 2;
    if (G.deck.length < required) {
      var left = G.deck.length;
      if (!await shuffleDeckForNextRound(session, "牌堆剩余 <b>" + left + "张</b>，不足下一局所需的 <b>" + required + "张</b>")) return false;
    }
    var order = [];
    for (var offset = 0; offset < G.n; offset++) {
      var idx = (G.dealer + offset) % G.n;
      if (!G.players[idx].out) order.push(idx);
    }
    G.dealing = true;
    renderAll();
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < order.length; i++) {
        if (!isCurrentSession(session)) { G.dealing = false; return false; }
        var playerIndex = order[i];
        var card = G.deck.shift();
        renderDeckPile();
        await animateDealCard(playerIndex);
        G.players[playerIndex].hand[pass] = card;
        renderAll();
        await delay(45);
      }
    }
    G.dealing = false;
    renderAll();
    return true;
  }

  /* ---------- 设置 ---------- */
  function bindSeg(id, cb) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      $(id).querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      cb(b.dataset.v);
    });
  }
  bindSeg("player-count-seg", function (v) { cfg.n = +v; });
  bindSeg("timer-seg", function (v) { cfg.timerOn = v === "on"; });
  bindSeg("round-count-seg", function (v) { cfg.rounds = +v; });
  bindSeg("duration-seg", function (v) { cfg.minutes = +v; });
  bindSeg("mode-seg", function (v) {
    cfg.mode = v;
    $("round-settings").classList.toggle("hidden", v !== "rounds");
    $("time-settings").classList.toggle("hidden", v !== "time");
  });

  $("start-btn").addEventListener("click", function () {
    G.session++;
    initGame();
    $("setup-screen").classList.add("hidden");
    $("game-screen").classList.remove("hidden");
    G.started = true; G.phase = "deal";
    runLoop(G.session);
  });
  $("restart-btn").addEventListener("click", function () {
    stopTimer();
    clearNextRoundCountdown();
    cancelRubCards();
    cancelBlindChoice();
    G.session++;
    // 若正等待玩家操作，先解除等待，避免旧牌局在后台继续推进。
    if (G.actionResolve) { var resolve = G.actionResolve; G.actionResolve = null; resolve(null); }
    showActions(false);
    $("game-screen").classList.add("hidden");
    $("setup-screen").classList.remove("hidden");
    G.started = false; G.gameOver = false;
  });

  /* ---------- 初始化 ---------- */
  function createAiStyle() {
    var roll = Math.random();
    if (roll < 1 / 3) {
      return { kind: "aggressive", label: "激进型", aggression: 1.16 + Math.random() * .16, risk: 1.12 + Math.random() * .16, bluff: 1.06 + Math.random() * .18 };
    }
    if (roll < 2 / 3) {
      return { kind: "conservative", label: "保守型", aggression: .72 + Math.random() * .14, risk: .70 + Math.random() * .16, bluff: .62 + Math.random() * .16 };
    }
    return { kind: "selective", label: "看牌型", aggression: .92 + Math.random() * .16, risk: .88 + Math.random() * .16, bluff: .72 + Math.random() * .16 };
  }
  function initGame() {
    clearNextRoundCountdown();
    G.n = cfg.n; G.timerOn = cfg.timerOn; G.matchMode = cfg.mode; G.maxRounds = cfg.rounds;
    G.endAt = cfg.mode === "time" ? Date.now() + cfg.minutes * 60 * 1000 : 0;
    G.matchFinished = false; G.players = [];
    for (var i = 0; i < G.n; i++) {
      G.players.push({
        name: i === 0 ? "你" : ("AI-" + i), isHuman: i === 0, chips: 0,
        hand: [null, null], folded: false, out: false, roundStake: 0,
        lastRaiseRound: 0, revealed: false, lastAction: "", isWinner: false,
        hasBetThisRound: false, hasRaised: false, waitingShowdown: false,
        usedBottom: false, hasTakenTurn: false, winCap: 1, bluffUsed: false, hookPlan: false, hasLooked: false, wins: 0,
        tableRaiseCount: 0,
        aiStyle: i === 0 ? null : createAiStyle()
      });
    }
    G.dealer = -1; G.round = 1; G.pot = 0; G.gameOver = false; G.showdownPlayers = [];
    G.deck = shuffle(D.CARDS); G.shuffleCount = 1; G.dealing = false;
    G.skipRubForMatch = false; G.roundActions = []; G.roundStartScores = []; G.roundStartPot = 0;
    G.lastRoundReview = null; G.revealingPlayer = null;
    G.timeoutCount = 0; G.autoManaged = false;
    $("log").innerHTML = "";
    var b = $("result-banner"); b.className = "result-banner"; b.innerHTML = "";
    $("review-toggle").disabled = true; $("review-toggle").textContent = "上局回顾";
    $("last-round-review").classList.add("hidden"); $("last-round-review").innerHTML = "";
    showShowdownCallout("");
    renderMatchRanking();
    log("游戏开始：<b>" + G.n + "人局</b>，每人从 <b>0 积分</b>开始，底注 <b>" + G.ante + "</b>。");
    renderAll();
  }
  function determineDealerFirstRound() {
    var card = D.CARDS[Math.floor(Math.random() * D.CARDS.length)];
    var n = card.value; // 大王=6
    var idx = (n - 1) % G.n;
    G.dealer = idx;
    log("第一局翻牌：翻出 <b>" + card.rank + (card.suit !== "特殊" ? " " + card.sym : "") + "</b>（计 " + n + "），逆时针第 " + n + " 位 → 头家为 <b>" + G.players[idx].name + "</b>。");
  }

  /* ---------- 主循环 ---------- */
  function isCurrentSession(session) { return G.started && G.session === session; }
  async function runLoop(session) {
    while (isCurrentSession(session) && !G.gameOver) {
      await playRound(session);
      if (!isCurrentSession(session) || G.gameOver) break;
      await waitNextRound(session);
    }
    if (isCurrentSession(session) && G.gameOver) finishGame();
  }
  async function playRound(session) {
    G.roundActions = [];
    G.roundStartScores = G.players.map(function (p) { return p.chips; });
    G.roundStartPot = G.pot;
    G.revealingPlayer = null; showShowdownCallout("");
    G.showdownPlayers = []; G.lastSeatThresholdFailed = false; G.lastSeatThresholdDirectWin = false;
    G.blindTableOpened = false; G.dealerBlindPlanned = ""; G.blindBottomChain = false; G.tableRaisesThisRound = 0; G.humanBlindPending = false; G.humanBlind = false;
    G.players.forEach(function (p) {
      p.hand = [null, null]; p.folded = false; p.roundStake = 0;
      p.lastRaiseRound = 0; p.revealed = false; p.lastAction = ""; p.isWinner = false;
      p.hasBetThisRound = false; p.hasRaised = false; p.waitingShowdown = false;
      p.usedBottom = false; p.hasTakenTurn = false; p.winCap = G.ante; p.bluffUsed = false; p.hookPlan = false; p.hasLooked = false; p.tableRaiseCount = 0;
    });
    if (G.round === 1) determineDealerFirstRound();
    G.phase = "deal"; renderAll(); await delay(500);
    if (!isCurrentSession(session)) return;

    if (!await dealFromPersistentDeck(session)) return;
    var dealerPlayer = G.players[G.dealer];
    G.humanBlindPending = !!(dealerPlayer && dealerPlayer.isHuman && !G.autoManaged);
    log("发牌完成，牌堆剩余 <b>" + G.deck.length + "张</b>；本局底注各 <b>" + G.ante + "</b> 积分。");
    renderAll();
    G.players.forEach(function (p) {
      if (p.out) return;
      var ante = G.ante;
      p.chips -= ante; p.roundStake += ante; G.pot += ante; queueCoinsToPot(p, ante);
      recordRoundAction(p, "底注", ante);
    });
    renderAll(); await delay(400);
    if (!isCurrentSession(session)) return;

    if (dealerPlayer && dealerPlayer.isHuman && !G.autoManaged) {
      var blindChoice = await askBlindChoice(G.pot);
      if (!isCurrentSession(session) || !blindChoice) return;
      G.humanBlindPending = false;
      if (blindChoice === "blind_table") {
        G.dealerBlindPlanned = "blind_table";
        G.humanBlind = true;
        log("头家 <b>你</b> 选择蒙吃桌面；之后可自由看牌，后续玩家不能吃底注或半池。", "hl");
        renderAll();
      } else if (blindChoice === "blind_bottom") {
        G.dealerBlindPlanned = "blind_bottom";
        G.humanBlind = true;
        log("头家 <b>你</b> 选择蒙吃底注；下一家在未看牌时可继续蒙吃底注。", "hl");
        renderAll();
      } else {
        dealerPlayer.hasLooked = true; G.humanBlind = false;
        renderAll();
        await showRubCards(G.players[0].hand);
        if (!isCurrentSession(session)) return;
      }
    } else {
      // AI 是否蒙吃只由独立随机数决定，不能读取牌面后再决定。
      if (dealerPlayer && !dealerPlayer.isHuman) {
        var blindRoll = Math.random();
        // 用户风格：50%先看牌、30%蒙吃底注、20%蒙吃桌面。
        G.dealerBlindPlanned = blindRoll < .20 ? "blind_table" : blindRoll < .50 ? "blind_bottom" : "";
      }
      // 非头家的看牌流程在头家选择完成后统一触发。
    }

    // 非头家在自己的两张牌均发到位后进入搓牌；选择“本场不再搓牌”后，后续各局直接看牌。
    var human = G.players[0];
    if (dealerPlayer && !dealerPlayer.isHuman && human && !G.autoManaged) {
      human.hasLooked = true;
      renderAll();
      await showRubCards(human.hand);
      if (!isCurrentSession(session)) return;
      renderAll();
    }

    G.phase = "betting"; G.bettingRound = 0; G.lastRaiseRound = 0;
    await bettingPhase(session);
    if (!isCurrentSession(session)) return;

    G.phase = "showdown"; await showdownPhase(session);
    if (!isCurrentSession(session)) return;

    G.phase = "settle"; await settlePhase(session); renderAll();
  }

  /* ---------- 下注 ----------
   1) 头家可在看牌前蒙吃桌面或底注；蒙吃后仍可自由看牌。
   2) 蒙吃桌面后，首轮后续玩家不能吃底注或半池；蒙吃底注只能由紧邻的未看牌玩家连续跟蒙。
   3) 吃底注与吃半个公池共用每局一次的资格，且仅限首轮。
   3) 只要没有弃牌，就始终保留比牌资格；吃桌面只会抬高公池。
   4) 吃过底注或吃过桌面即锁定比牌资格，后续不可弃牌，只能继续吃桌面或等待比牌。
   5) 尚未进行有效下注者仍可弃牌；积分允许为负，不设全下与出局。
   ----------------------------------------------------------------- */
  function computeOptions(p, isOpeningRound, canPass, canFold) {
    var opts = [];
    var raiseCost = G.pot;
    var canRaise = raiseCost > 0;
    var canCall = isOpeningRound && !G.blindTableOpened && !p.usedBottom;
    var canBlindCall = canCall && G.blindBottomChain && !p.hasLooked;
    if (canRaise) opts.push("raise");
    if (canCall) opts.push("call");
    if (canCall) opts.push("half");
    if (canBlindCall) opts.push("blindcall");
    if (canPass) opts.push("pass");
    if (canFold && !p.usedBottom && !p.hasRaised && !p.folded && !p.out) opts.push("fold");
    return opts;
  }
  function meetsLastSeatWinThreshold(p) {
    var ev = E.evaluate(p.hand[0], p.hand[1]);
    // 特殊牌型均高于普通点数；普通牌必须至少 8 点。
    return ev.type === "special" || ev.point >= 8;
  }

  async function bettingPhase(session) {
    G.players.forEach(function (p) {
      p.hasBetThisRound = false; p.waitingShowdown = false;
      p.usedBottom = false; p.hasTakenTurn = false;
    });
    var turn = 0, openingPlayers = [], openingHasTableBet = false, openingAllPriorFolded = true;
    G.tableRaisesThisRound = 0;
    log("<b>首轮下注开始</b>：可选吃桌面、吃一个底注、吃半个公池或弃牌；符合条件的未看牌玩家还可跟蒙底注。");
    // 首轮：每位未出局玩家各行动一次。吃底注和吃桌面都取得第一轮资格。
    for (var i = 0; i < G.n; i++) {
      if (!isCurrentSession(session)) return;
      var idx = (G.dealer + i) % G.n, p = G.players[idx];
      if (p.out || p.folded) continue;
      var dealerBlindTurn = i === 0 && idx === G.dealer && G.dealerBlindPlanned;
      var openingOpts = dealerBlindTurn ? [G.dealerBlindPlanned] : computeOptions(p, true, false, true);
      if (!openingOpts.length) continue;
      turn++; G.bettingRound = 1; G.currentPlayer = idx; renderAll();
      var openingAction;
      if (dealerBlindTurn) {
        if (!p.isHuman) {
          startSeatTimer(30);
          await delay(3000 + Math.floor(Math.random() * 2501));
          stopSeatTimer();
          if (!isCurrentSession(session)) return;
        }
        openingAction = G.dealerBlindPlanned;
      } else {
        openingAction = await getAction(p, openingOpts, true);
      }
      if (!isCurrentSession(session)) return;
      p.hasTakenTurn = true;
      var openingRaised = openingAction === "blind_table" ? applyBlindRaise(p) : openingAction === "blind_bottom" ? applyBlindBottom(p) : applyAction(p, openingAction);
      G.blindBottomChain = openingAction === "blind_bottom" || openingAction === "blindcall";
      if (openingAction !== "fold") openingAllPriorFolded = false;
      if (!p.folded && p.hasBetThisRound) openingPlayers.push(p);
      if (openingRaised) {
        openingHasTableBet = true;
      }
      // 头家起前序玩家全弃牌时，最后一家不再无条件获胜：
      // 必须亮牌，特殊牌型或普通 8 点以上才可直接带走公池。
      var lastUnacted = G.players.filter(function (q) {
        return !q.out && !q.folded && !q.hasTakenTurn;
      });
      if (openingAllPriorFolded && lastUnacted.length === 1) {
        var lastSeat = lastUnacted[0];
        lastSeat.hasTakenTurn = true;
        lastSeat.revealed = true;
        G.showdownPlayers = [lastSeat];
        if (meetsLastSeatWinThreshold(lastSeat)) {
          G.lastSeatThresholdDirectWin = true;
          log("前序玩家均弃牌，最后一家 <b>" + lastSeat.name + "</b> 亮牌 → " + E.handDesc(E.evaluate(lastSeat.hand[0], lastSeat.hand[1])) + "，达到普通8点门槛，直接获胜。", "hl");
        } else {
          G.lastSeatThresholdFailed = true;
          log("前序玩家均弃牌，最后一家 <b>" + lastSeat.name + "</b> 亮牌 → " + E.handDesc(E.evaluate(lastSeat.hand[0], lastSeat.hand[1])) + "，未达到普通8点门槛，本局无人获胜，公池结转。", "hl");
        }
        renderAll();
        break;
      }
      renderAll(); await delay(380);
    }

    // 吃桌面不会抹去同一首轮其他主动下注者的资格；它只决定下一轮谁拥有“过”牌权。
    var qualified = openingPlayers;
    var baseOnlyPassRound = !openingHasTableBet && qualified.length > 1;
    var hasTableBet = openingHasTableBet;
    var passToShowdown = false, round = 1;
    // 多人首轮吃底注时，下一轮全体保留资格者均可选择“过”。
    while (isCurrentSession(session) && (hasTableBet || baseOnlyPassRound) && qualified.length > 1) {
      round++;
      var nextQualified = [], roundHasBet = false;
      G.tableRaisesThisRound = 0;
      G.bettingRound = round;
      log("<b>第 " + round + " 轮</b>：继续下注可抬高公池，未弃牌者均保留比牌资格。" );

      // 每一轮都由头家开始，座位顺序固定，避免上一轮最后行动者紧接着又成为下一轮首位。
      // 转回最后抬价者且无人继续抬价时，才可选择“过”。
      var startIndex = G.dealer;
      for (var j = 0; j < G.n; j++) {
        if (!isCurrentSession(session)) return;
        var turnIdx = (startIndex + j) % G.n;
        var player = G.players[turnIdx];
        if (qualified.indexOf(player) < 0 || player.out || player.folded || player.waitingShowdown) continue;
        // 已经下注的玩家可以选择等待比牌；这会停止本轮继续抬价，直接结算比牌。
        var canPass = player.hasBetThisRound;
        var opts = computeOptions(player, false, canPass, true);
        if (!opts.length) continue;
        turn++; G.currentPlayer = turnIdx; renderAll();
        var action = await getAction(player, opts, false);
        if (!isCurrentSession(session)) return;
        if (action === "pass") {
          applyAction(player, action);
          renderAll();
          // 两人局直接收口；多人局中若其余玩家都已等待比牌，最后一人也不能再抬价。
          var activePlayers = G.players.filter(function (q) { return !q.out && !q.folded; });
          var playersStillBetting = activePlayers.filter(function (q) { return !q.waitingShowdown; });
          if (activePlayers.length <= 2 || playersStillBetting.length <= 1) {
            if (playersStillBetting.length <= 1) log("其余未弃牌玩家均已等待比牌，最后一名玩家不能继续抬价，直接比牌。", "hl");
            passToShowdown = true;
            break;
          }
          await delay(380);
          continue;
        }
        var raised = applyAction(player, action);
        if (raised) {
          roundHasBet = true;
          player.lastRaiseRound = round;
          G.lastRaiseRound = round;
          nextQualified.push(player);
        }
        // 有效资格只剩一人时立即收口，不能再把操作权交给该玩家。
        var remainingQualified = qualified.filter(function (q) { return !q.out && !q.folded; });
        if (remainingQualified.length <= 1) {
          qualified = remainingQualified;
          break;
        }
        renderAll(); await delay(380);
      }

      if (passToShowdown || qualified.length <= 1) break;
      // 本轮无人继续下注：沿用上一轮资格直接比牌。
      if (!roundHasBet) break;
      hasTableBet = true;
      baseOnlyPassRound = false;
      qualified = nextQualified;
      // 仅一人进入本轮，他已是唯一保留资格者，直接获胜。
      if (qualified.length <= 1) break;
    }
    G.currentPlayer = -1;
    // 比牌资格不按最后一轮下注筛选：所有已参与、且尚未弃牌的玩家均有赢钱机会。
    G.showdownPlayers = G.players.filter(function (p) { return !p.out && !p.folded && p.hasTakenTurn; });
    if (!G.lastSeatThresholdDirectWin && !G.lastSeatThresholdFailed) {
      log(G.showdownPlayers.length === 1 ? "仅 <b>" + G.showdownPlayers[0].name + "</b> 尚未弃牌，直接获胜。" : "下注结束，所有未弃牌玩家进入<b>比牌</b>阶段。");
    }
  }
  // 返回 true 表示本动作进入下一有效下注轮。
  function applyBlindRaise(p) {
    var bet = G.pot;
    p.chips -= bet; p.roundStake += bet; G.pot += bet;
    p.winCap = bet;
    queueCoinsToPot(p, bet);
    p.hasBetThisRound = true;
    p.hasRaised = true;
    p.tableRaiseCount += 1;
    p.lastAction = "蒙吃桌面";
    G.blindTableOpened = true;
    G.tableRaisesThisRound = (G.tableRaisesThisRound || 0) + 1;
    recordRoundAction(p, "蒙吃桌面", bet);
    log("头家 <b>" + p.name + "</b> 蒙吃桌面，下注 <b>" + bet + "</b>，公池 → <b>" + G.pot + "</b>；后续玩家不能吃底注或半池，头家之后可自由看牌。");
    return true;
  }
  function applyBlindBottom(p) {
    var bet = G.ante;
    p.chips -= bet; p.roundStake += bet; G.pot += bet;
    p.winCap = bet; p.hasBetThisRound = true; p.usedBottom = true; p.lastAction = "蒙吃底注";
    queueCoinsToPot(p, bet);
    recordRoundAction(p, "蒙吃底注", bet);
    log("<b>" + p.name + "</b> 蒙吃一个底注（+" + bet + "），公池 → <b>" + G.pot + "</b>；下一家可继续蒙吃底注。");
    return false;
  }
  function applyAction(p, action) {
    // 吃过底注或桌面后已取得比牌权，任何入口都不得再执行弃牌。
    if (action === "fold" && (p.usedBottom || p.hasRaised)) action = "pass";
    if (action === "raise") {
      var bet = G.pot;
      p.chips -= bet; p.roundStake += bet; G.pot += bet;
      p.winCap = bet;
      queueCoinsToPot(p, bet);
      p.hasBetThisRound = true;
      p.hasRaised = true;
      p.tableRaiseCount += 1;
      G.tableRaisesThisRound = (G.tableRaisesThisRound || 0) + 1;
      p.lastAction = "吃桌面";
      recordRoundAction(p, "吃桌面", bet);
      log("<b>" + p.name + "</b> 吃桌面，下注 <b>" + bet + "</b>，公池 → <b>" + G.pot + "</b>。");
      return true;
    } else if (action === "call" || action === "blindcall" || action === "half") {
      var cb = action === "half" ? Math.ceil(G.pot / 2) : G.ante;
      p.chips -= cb; p.roundStake += cb; G.pot += cb;
      p.winCap = cb;
      queueCoinsToPot(p, cb);
      p.hasBetThisRound = true; p.usedBottom = true;
      p.lastAction = action === "half" ? "吃半池" : action === "blindcall" ? "蒙吃底注" : "吃底注";
      recordRoundAction(p, p.lastAction, cb);
      log("<b>" + p.name + "</b> " + (action === "half" ? "吃半个公池" : action === "blindcall" ? "蒙吃一个底注" : "吃一个底注") + "（+" + cb + "），公池 → <b>" + G.pot + "</b>。" + (action === "blindcall" ? " 下一家可继续蒙吃底注。" : ""));
      return false;
    } else if (action === "pass") {
      p.waitingShowdown = true;
      p.lastAction = "等待比牌";
      recordRoundAction(p, "等待比牌", 0);
      log("<b>" + p.name + "</b> 选择等待比牌：不再追加下注，保留比牌资格。", "hl");
      return false;
    } else if (action === "fold") {
      p.folded = true;
      p.lastAction = "弃牌";
      recordRoundAction(p, "弃牌", 0);
      log("<b>" + p.name + "</b> 弃牌（已投入不退）。");
      return false;
    }
    return false;
  }
  function aiThinkTime(p, action, opts, isOpeningRound) {
    var ev = E.evaluate(p.hand[0], p.hand[1]);
    var pressure = G.tableRaisesThisRound || 0;
    var obvious = action === "fold" || (action === "raise" && ev.type === "special" && ev.level <= 4);
    var difficult = pressure > 0 || G.pot >= 16 || opts.length >= 4 || action === "half" || action === "pass";
    var min = obvious ? 2400 : difficult ? 5200 : 3600;
    var max = obvious ? 3900 : difficult ? 7900 : 5900;
    if (isOpeningRound && action === "call") { min -= 350; max -= 350; }
    if (p.aiStyle && p.aiStyle.kind === "aggressive") { min -= 250; max -= 250; }
    if (p.aiStyle && p.aiStyle.kind === "conservative") { min += 300; max += 300; }
    return Math.max(1800, min + Math.floor(Math.random() * Math.max(1, max - min + 1)));
  }
  function getAction(p, opts, isOpeningRound) {
    if (p.isHuman && !G.autoManaged) return new Promise(function (resolve) {
      if (window.GAME_AUDIO) { window.GAME_AUDIO.resetCountdown(); window.GAME_AUDIO.cue("turn"); }
      G.actionResolve = resolve; G._humanOpts = opts; showActions(true, opts, isOpeningRound); startTimer(isOpeningRound);
    });
    // AI先形成决定，再按难度决定思考时长：明确强弱牌更果断，边缘牌和高压局面更慢。
    var plannedAction;
    if (opts.indexOf("blindcall") >= 0 && !p.hasLooked && Math.random() < .38) plannedAction = "blindcall";
    else {
      p.hasLooked = true;
      plannedAction = aiDecide(p, opts, isOpeningRound);
    }
    var thinkTime = aiThinkTime(p, plannedAction, opts, isOpeningRound);
    startSeatTimer(30);
    return delay(thinkTime).then(function () {
      stopSeatTimer();
      return plannedAction;
    });
  }

  function showActions(show, opts, isFirstTurn) {
    var bar = $("actions");
    bar.style.display = show ? "flex" : "none";
    if (!show) { stopTimer(); return; }
    var me = G.players[0];
    var raiseCost = G.pot;
    var callCost = G.ante;
    var bR = $("btn-raise"), bC = $("btn-call"), bH = $("btn-half"), bBC = $("btn-blind-call"), bP = $("btn-pass"), bF = $("btn-fold");
    bR.textContent = "吃桌面 +" + raiseCost;
    bR.style.display = opts.indexOf("raise") >= 0 ? "" : "none";
    bR.disabled = !opts || opts.indexOf("raise") < 0;
    bC.textContent = "吃一个底注 +" + callCost;
    bC.style.display = opts.indexOf("call") >= 0 ? "" : "none";
    bC.disabled = !opts || opts.indexOf("call") < 0;
    bH.textContent = "吃半个公池 +" + Math.ceil(G.pot / 2);
    bH.style.display = opts.indexOf("half") >= 0 ? "" : "none";
    bH.disabled = !opts || opts.indexOf("half") < 0;
    bBC.textContent = "蒙吃底注 +" + callCost;
    bBC.style.display = opts.indexOf("blindcall") >= 0 ? "" : "none";
    bBC.disabled = !opts || opts.indexOf("blindcall") < 0;
    bP.textContent = "等待比牌";
    bP.style.display = opts.indexOf("pass") >= 0 ? "" : "none";
    bP.disabled = !opts || opts.indexOf("pass") < 0;
    bF.style.display = opts.indexOf("fold") >= 0 ? "" : "none";
    bF.disabled = !opts || opts.indexOf("fold") < 0;
  }
  function doAction(a) {
    if (a === "blindcall" && G.players[0] && G.players[0].hasLooked) return;
    stopTimer(); showActions(false);
    var r = G.actionResolve; G.actionResolve = null;
    if (r) r(a);
  }
  $("btn-raise").onclick = function () { doAction("raise"); };
  $("btn-call").onclick = function () { doAction("call"); };
  $("btn-half").onclick = function () { doAction("half"); };
  $("btn-blind-call").onclick = function () { doAction("blindcall"); };
  $("btn-pass").onclick = function () { doAction("pass"); };
  $("btn-fold").onclick = function () { doAction("fold"); };

  function setSeatTimer(left, duration) {
    G.seatTimerLeft = left;
    var txt = $("seat-timer-txt"), bar = $("seat-timer-bar");
    if (txt) txt.textContent = Math.max(0, Math.ceil(left)) + "s";
    if (bar) bar.style.width = Math.max(0, (left / duration) * 100) + "%";
  }
  function startSeatTimer(duration) {
    stopSeatTimer();
    if (!G.timerOn) return;
    var startedAt = Date.now();
    setSeatTimer(duration, duration);
    G.seatTimerHandle = setInterval(function () {
      var left = Math.max(0, duration - (Date.now() - startedAt) / 1000);
      setSeatTimer(left, duration);
      if (left <= 0) stopSeatTimer();
    }, 100);
  }
  function stopSeatTimer() {
    if (G.seatTimerHandle) { clearInterval(G.seatTimerHandle); G.seatTimerHandle = null; }
    G.seatTimerLeft = null;
  }

  function startTimer(isFirstTurn) {
    if (!G.timerOn) return;
    var t = $("timer"); t.classList.remove("hidden");
    var duration = 30;
    var left = duration; var bar = $("timer-bar"); var txt = $("timer-txt");
    bar.style.width = "100%"; txt.textContent = left + "s";
    startSeatTimer(duration);
    G.timerHandle = setInterval(function () {
      left -= 0.1;
      if (window.GAME_AUDIO) window.GAME_AUDIO.tick(left);
      if (left <= 5) t.classList.add("warn"); else t.classList.remove("warn");
      bar.style.width = Math.max(0, (left / duration * 100)) + "%";
      txt.textContent = Math.ceil(left) + "s";
      setSeatTimer(left, duration);
      if (left <= 0) {
        clearInterval(G.timerHandle); G.timerHandle = null;
        G.timeoutCount++;
        if (G.timeoutCount < 3) {
          log("第 <b>" + G.timeoutCount + "</b> 次超时，继续等待（第 3 次超时后托管）。", "hl");
          startTimer(isFirstTurn);
          return;
        }
        t.classList.add("hidden"); stopSeatTimer();
        G.autoManaged = true;
        log("已第 <b>3</b> 次超时，系统已开启<b>托管</b>，后续操作将自动进行。", "hl");
        // 第三次超时起，立即由托管策略完成当前操作。
        var opts = G._humanOpts || [];
        var def = aiDecide(G.players[0], opts, isFirstTurn);
        doAction(def);
      }
    }, 100);
  }
  function stopTimer() {
    if (G.timerHandle) { clearInterval(G.timerHandle); G.timerHandle = null; }
    stopSeatTimer();
    if (window.GAME_AUDIO) window.GAME_AUDIO.resetCountdown();
    $("timer").classList.add("hidden");
  }

  /* ---------- 比牌 ---------- */
  async function showdownPhase(session) {
    // 所有未弃牌玩家均拥有比牌资格。
    var contenders = (G.showdownPlayers || []).filter(function (p) {
      return !p.out && !p.folded;
    });
    $("hint").textContent = "";
    showShowdownCallout("准备比牌");
    if (G.lastSeatThresholdFailed) {
      G.winner = null; G.tiePlayers = [];
      showShowdownCallout("未达到获胜门槛 · 公池结转");
      return;
    }
    if (contenders.length === 1) {
      contenders[0].revealed = true; G.revealingPlayer = contenders[0]; renderAll();
      if (window.GAME_AUDIO) window.GAME_AUDIO.play("flip");
      showShowdownCallout(contenders[0].name + " · " + E.handDesc(E.evaluate(contenders[0].hand[0], contenders[0].hand[1])));
      await delay(900);
      if (!isCurrentSession(session)) return;
      G.revealingPlayer = null; renderAll();
      if (!G.lastSeatThresholdDirectWin) log("其余玩家均已弃牌，<b>" + contenders[0].name + "</b> 直接获胜。");
      G.winner = contenders[0]; G.tiePlayers = null; return;
    }
    if (contenders.length === 0) {
      // 兜底：理论上不会发生（若发生，把所有未弃牌玩家拉进来比）
      contenders = G.players.filter(function (p) { return !p.out && !p.folded; });
      if (contenders.length === 0) { G.winner = null; G.tiePlayers = null; return; }
      if (contenders.length === 1) { G.winner = contenders[0]; G.tiePlayers = null; return; }
    }
    log("比牌玩家：" + contenders.map(function (p) { return p.name; }).join("、") + "（按顺序揭牌）。");
    for (var k = 0; k < contenders.length; k++) {
      if (!isCurrentSession(session)) return;
      var p = contenders[k];
      p.revealed = true; G.revealingPlayer = p; renderAll();
      if (window.GAME_AUDIO) window.GAME_AUDIO.play("flip");
      var ev = E.evaluate(p.hand[0], p.hand[1]);
      showShowdownCallout(p.name + " 揭牌 · " + E.handDesc(ev));
      log("<b>" + p.name + "</b> 揭牌 → " + E.handDesc(ev));
      await delay(950);
      if (!isCurrentSession(session)) return;
      G.revealingPlayer = null; renderAll();
    }
    var best = contenders[0], tie = false;
    for (var i = 1; i < contenders.length; i++) {
      var c = contenders[i];
      var cmp = E.compareHands(E.evaluate(c.hand[0], c.hand[1]), E.evaluate(best.hand[0], best.hand[1]));
      if (cmp > 0) { best = c; tie = false; }
      else if (cmp === 0) { tie = true; }
    }
    if (tie) {
      G.winner = null;
      G.tiePlayers = contenders.filter(function (c) {
        return E.compareHands(E.evaluate(c.hand[0], c.hand[1]), E.evaluate(best.hand[0], best.hand[1])) === 0;
      });
      showShowdownCallout("牌型相同 · 本局平局");
    } else {
      G.winner = best; G.tiePlayers = null;
      showShowdownCallout(best.name + " 牌型领先", true);
    }
  }

  /* ---------- 结算 ---------- */
  async function settlePhase(session) {
    var banner = $("result-banner");
    var finalPot = G.pot;
    G.matchFinished = G.matchMode === "rounds" ? G.round >= G.maxRounds : Date.now() >= G.endAt;
    var nextLabel = G.matchFinished ? "结束牌局" : "下一局";
    if (G.winner) {
      var w = G.winner;
      // 最后一家通过8点门槛的直接获胜通吃；其他情况才受主动下注两倍上限约束。
      var prize = G.lastSeatThresholdDirectWin ? G.pot : Math.min(G.pot, w.winCap * 2), remainder = G.pot - prize;
      // 先明确胜者、保留公池数字，再把金币从桌心发向胜者。
      w.isWinner = true; renderAll();
      if (window.GAME_AUDIO) window.GAME_AUDIO.cue("win");
      showShowdownCallout("胜者 " + w.name + " · 赢得 " + prize + " 积分", true);
      await delay(900);
      await sendPotToWinner(w, prize);
      if (session != null && !isCurrentSession(session)) return;
      w.chips += prize;
      w.wins += 1;
      log("<b class='gd'>" + w.name + "</b> 获胜，赢得 <b>" + prize + "</b> 积分" + (remainder > 0 ? "，公池结转 <b>" + remainder + "</b> 积分。" : "！"), "gd");
      banner.className = "result-banner win";
      banner.innerHTML = "本局胜者：<b>" + w.name + "</b> 　赢得 <b>" + prize + "</b> 积分" +
        (remainder > 0 ? "　公池结转 <b>" + remainder + "</b> 积分" : "") + "　<button class='next-btn' id='next-btn'>" + nextLabel + "</button>";
      G.pot = remainder;
      G.dealer = G.players.indexOf(w);
      captureRoundReview(w, prize, finalPot);
    } else {
      log("<b class='hl'>平局！</b> 所有投入 <b>" + G.pot + "</b> 积分全部结转下一局公池。", "hl");
      banner.className = "result-banner tie";
      banner.innerHTML = "平局：无人收益，公池 <b>" + G.pot + "</b> 结转下一局　<button class='next-btn' id='next-btn'>" + nextLabel + "</button>";
      G.dealer = (G.dealer + 1) % G.n;
      captureRoundReview(null, 0, finalPot);
    }
    renderAll();
    renderMatchRanking();
  }
  function waitNextRound(session) {
    return new Promise(function (resolve) {
      if (G.matchFinished) { G.started = false; resolve(); return; }
      var btn = $("next-btn");
      if (!btn) { resolve(); return; }
      var finished = false;
      function continueGame() {
        if (finished) return;
        finished = true;
        clearNextRoundCountdown();
        if (!isCurrentSession(session)) { resolve(); return; }
        if (G.matchFinished) {
          $("game-screen").classList.add("hidden");
          $("setup-screen").classList.remove("hidden");
          G.started = false; G.gameOver = false; G.matchFinished = false;
          resolve(); return;
        }
        G.round++;
        var b = $("result-banner"); b.className = "result-banner"; b.innerHTML = "";
        resolve();
      }
      btn.onclick = continueGame;
      if (G.matchFinished) return;

      var seconds = 10;
      function showCountdown() {
        if (btn && btn.isConnected) btn.textContent = "下一局（" + seconds + "s）";
      }
      showCountdown();
      clearNextRoundCountdown();
      G.nextRoundTicker = setInterval(function () {
        if (!isCurrentSession(session)) {
          finished = true;
          clearNextRoundCountdown();
          resolve();
          return;
        }
        seconds--;
        if (seconds <= 0) continueGame();
        else showCountdown();
      }, 1000);
    });
  }
  $("solo-result-again").addEventListener("click", function () {
    $("solo-result-screen").classList.add("hidden");
    $("setup-screen").classList.remove("hidden");
    G.matchFinished = false;
  });
  function clearNextRoundCountdown() {
    if (G.nextRoundTicker) clearInterval(G.nextRoundTicker);
    G.nextRoundTicker = null;
  }
  function finishGame() {
    var winner = G.players.find(function (p) { return !p.out; });
    $("hint").textContent = "游戏结束，胜者：" + (winner ? winner.name : "—");
    log("<b class='gd'>游戏结束！</b>");
  }

  /* ---------- AI 决策 ---------- */
  function handScore(ev) {
    if (ev.type === "special") return 100 + (15 - ev.level);
    return ev.point * 10 + ev.mianzi;
  }
  function aiEquity(p) {
    var ev = E.evaluate(p.hand[0], p.hand[1]);
    var alive = G.players.filter(function (q) { return !q.out && !q.folded && q !== p; }).length;
    var base;
    if (ev.type === "special") base = Math.max(.72, .965 - ev.level * .016);
    else {
      var pointBase = [.18, .22, .26, .30, .35, .40, .47, .60, .78, .90];
      base = pointBase[ev.point] + Math.min(.035, (ev.mianzi || 0) * .006);
    }
    // 对手越多，当前牌同时击败所有人的概率越低；只使用人数，不读取对手手牌。
    return Math.max(.025, Math.min(.98, Math.pow(base, 1 + Math.max(0, alive - 1) * .22)));
  }
  function aiActiveOrder() {
    return G.players.filter(function (q) { return !q.out && !q.folded; }).sort(function (a, b) {
      var aSeat = G.players.indexOf(a), bSeat = G.players.indexOf(b);
      return ((aSeat - G.dealer + G.n) % G.n) - ((bSeat - G.dealer + G.n) % G.n);
    });
  }
  function aiPositionRatio(p) {
    var active = aiActiveOrder();
    if (active.length <= 1) return 0;
    return active.indexOf(p) / Math.max(1, active.length - 1);
  }
  function aiActionValue(p, action, equity, context) {
    if (action === "fold") return 0;
    if (action === "pass") {
      var heldPrize = Math.min(G.pot, Math.max(G.ante, p.winCap) * 2);
      return equity * heldPrize + .08;
    }
    var cost = action === "raise" ? G.pot : action === "half" ? Math.ceil(G.pot / 2) : G.ante;
    var finalPot = G.pot + cost;
    var maxPrize = Math.min(finalPot, cost * 2);
    var value = equity * maxPrize - cost;
    // 连续抬价、多人仍在场和靠前位置都会提高继续投入的风险。
    if (action === "raise") {
      value -= cost * (context.pressure * .055 + Math.max(0, context.alive - 2) * .025);
      value += cost * context.position * .055;
    } else if (action === "half") {
      value -= cost * (context.pressure * .028 + Math.max(0, context.alive - 3) * .015);
      value += cost * context.position * .03;
    } else value += cost * context.position * .018;
    // 每场随机人格只调整不在固定打法覆盖内的边缘决策。
    var style = p.aiStyle;
    if (style) {
      var isPressureAction = action === "raise" || action === "half";
      if (style.kind === "aggressive" && isPressureAction) value += cost * .16;
      if (style.kind === "conservative" && isPressureAction) value -= cost * .16;
      if (style.kind === "selective" && isPressureAction) {
        if (equity >= .70) value += cost * .20;
        else if (equity < .52) value -= cost * .22;
      }
    }
    // 小幅扰动只负责打破固定套路，不足以长期覆盖明显亏损的决策。
    value += (Math.random() - .5) * Math.max(.12, cost * .10);
    return value;
  }
  function aiDecide(p, opts, isFirstTurn) {
    var has = function (k) { return opts.indexOf(k) >= 0; };
    var ev = E.evaluate(p.hand[0], p.hand[1]);
    var point = ev.type === "special" ? 10 : ev.point;
    var equity = aiEquity(p);
    var activeOrder = aiActiveOrder();
    var context = {
      alive: activeOrder.length,
      position: aiPositionRatio(p),
      isFirstActor: activeOrder[0] === p,
      pressure: G.tableRaisesThisRound || 0
    };
    var someoneUsedBottom = activeOrder.some(function (q) { return q !== p && q.usedBottom; });
    var anotherPlayerRaised = activeOrder.some(function (q) { return q !== p && q.hasRaised; });
    var candidates = ["raise", "half", "call", "pass", "fold"].filter(has);
    if (!candidates.length) return null;

    /* 用户风格覆盖层：
       1) 基础牌力打法适用于所有人数；只有场上5人以上才额外走多人谨慎策略；
       2) 普通5点面对已吃底注者直接弃；6、7、8点只拿底注；
       3) 9点在前家只吃底注时主动吃桌面施压，前家已吃桌面时先用半池；
       4) Q8、Q7等中档特殊牌首轮敢吃桌面，但被反加立即等待；最低特殊牌按压力和公池分层；
       5) 5人以上Q9比Q8更主动；Q8采用“甩钩子后反加”，红8对子按人数在直接施压与甩钩子间分流；
       6) 二人局保留9点90%主动吃桌面，以及先手0—3点诈唬的专属比例。 */
    if (isFirstTurn && context.alive === 2 && ev.type === "normal" && point >= 9 && has("raise")) {
      // 已确认的二人局专属规则：9点及以上九成直接吃桌面，剩余一成用底注隐藏。
      if (Math.random() < .90) return "raise";
      if (has("call")) return "call";
    }
    if (isFirstTurn && context.alive >= 2 && ev.type === "normal") {
      if (point <= 5 && someoneUsedBottom && has("fold")) return "fold";
      if ((point === 6 || point === 7 || point === 8) && has("call")) return "call";
      if (point === 9) {
        // 场上5人以上，9点不在首轮过早亮出攻击性，先低成本拿资格。
        if (context.alive >= 5 && has("call")) return "call";
        // 前家已吃桌面代表实力信号，9点先半池控风险；只有底注信号时则满注施压后家。
        if (context.pressure > 0 && G.pot <= 16 && has("half")) return "half";
        if (context.pressure === 0 && has("raise")) return "raise";
      }
    }
    if (isFirstTurn && context.alive >= 2 && ev.type === "special") {
      // 红8对子在5人以上可二选一：人数越多越倾向甩钩子；8人时正好是60%施压、40%甩钩子。
      if (context.alive >= 5 && ev.level === 4 && context.pressure === 0 && someoneUsedBottom && has("raise") && has("call")) {
        var redEightRaiseChance = Math.max(.60, Math.min(.70, .80 - context.alive * .025));
        if (Math.random() < redEightRaiseChance) return "raise";
        p.hookPlan = true;
        return "call";
      }
      // 场上5人以上的Q9：比Q8更主动，60%直接施压，40%甩钩子后反加。
      if (context.alive >= 5 && ev.level === 8 && context.pressure === 0 && has("raise") && has("call")) {
        if (Math.random() < .60) return "raise";
        p.hookPlan = true;
        return "call";
      }
      // 场上5人以上的Q8：首轮只吃底注甩钩子；有人抬价后在下一次轮到自己时反加。
      if (context.alive >= 5 && ev.level === 9 && context.pressure === 0 && has("call")) {
        p.hookPlan = true;
        return "call";
      }
      if (ev.level === 15) {
        if (context.pressure === 0 && has("raise")) return "raise";
        if (context.pressure > 0 && G.pot < 16 && has("half")) return "half";
        if (context.pressure > 0 && G.pot >= 48 && has("call")) return "call";
        // 16—47分的吃桌面压力区：激进AI偏半池，稳健AI偏底注。
        if (context.pressure > 0) {
          var lowSpecialStyle = p.aiStyle || { aggression: 1, risk: 1 };
          var halfChance = .50 + (lowSpecialStyle.risk - 1) * .70 + (lowSpecialStyle.aggression - 1) * .30;
          halfChance = Math.max(.30, Math.min(.65, halfChance));
          return has("half") && Math.random() < halfChance ? "half" : has("call") ? "call" : candidates[0];
        }
      }
      // Q9、Q8、Q7均按中档特殊牌处理：首轮直接抬价给后家压力。
      if (ev.level >= 8 && ev.level <= 11 && has("raise")) return "raise";
    }
    // 真正两人局的弱牌诈唬率为68%；多人局打到只剩两人时，原始人数越多越谨慎。
    // 任一存活玩家已经吃过底注，说明对方已有低成本比牌权，弱牌不再诈唬。
    if (context.alive === 2 && context.isFirstActor && context.pressure === 0 && ev.type === "normal" && point <= 3 && has("raise") && !p.bluffUsed) {
      var headsUpBluffChance = someoneUsedBottom ? 0 : .68 * Math.min(1, 2 / G.n);
      if (Math.random() < headsUpBluffChance) {
        p.bluffUsed = true;
        return "raise";
      }
      return has("fold") ? "fold" : has("pass") ? "pass" : candidates[0];
    }
    if (!isFirstTurn && has("pass")) {
      // 选择甩钩子的Q9/Q8/红8对子：只要其他玩家已吃桌面，就立即反加一次。
      // 这里不能只看本轮压力：新一轮开始会重置本轮计数，但前一轮的抬价仍然有效。
      var hookHand = ev.type === "special" && (ev.level === 8 || ev.level === 9 || ev.level === 4);
      if (hookHand && p.hookPlan && p.usedBottom && p.tableRaiseCount === 0 && anotherPlayerRaised && has("raise")) return "raise";
      // 普通牌严禁连续吃桌面：自己已经抬过价，或其他玩家已经抬价后，统一等待比牌。
      // 这样普通8点吃过底注后不会因为进入新一轮而再次被通用评分驱动去抬价。
      if (ev.type === "normal" && (p.tableRaiseCount >= 1 || anotherPlayerRaised)) return "pass";
      // 特殊牌的次数上限每次轮到AI都先检查，不能因新一轮开始而绕过。
      if (ev.type === "special" && ev.level >= 11 && p.tableRaiseCount >= 1) return "pass";
      if (ev.type === "special" && ev.level >= 8 && ev.level <= 10 && p.tableRaiseCount >= 2) return "pass";
      if (ev.type === "special" && ev.level === 7 && p.tableRaiseCount >= 2) return "pass";
      if (context.pressure > 0 || anotherPlayerRaised) {
        if (ev.type !== "special") return "pass";
        // Q7及以下（Q7、27、红8J、红45、黑109）最多吃一次桌面。
        if (ev.level >= 11) return "pass";
        // 28、Q8、Q9可视局面吃第二次桌面，但绝不超过两次。
        if (ev.level >= 8 && ev.level <= 10) {
          if (p.tableRaiseCount >= 2) return "pass";
          var middleStyle = p.aiStyle || { aggression: 1, risk: 1 };
          var middleChance = ev.level === 8 ? .72 : ev.level === 9 ? .62 : .52;
          middleChance += (middleStyle.aggression - 1) * .24 + (middleStyle.risk - 1) * .20;
          middleChance -= Math.max(0, context.alive - 2) * .035;
          middleChance -= Math.log(Math.max(2, G.pot)) / Math.log(2) * .014;
          middleChance = Math.max(.18, Math.min(.88, middleChance));
          return has("raise") && Math.random() < middleChance ? "raise" : "pass";
        }
        // 普通对子（第7级）通常吃两次桌面，到第二次后止损。
        if (ev.level === 7) {
          if (p.tableRaiseCount >= 2) return "pass";
          var pairStyle = p.aiStyle || { aggression: 1, risk: 1 };
          var pairChance = .76 + (pairStyle.aggression - 1) * .22 + (pairStyle.risk - 1) * .18;
          pairChance -= Math.max(0, context.alive - 2) * .03;
          pairChance = Math.max(.42, Math.min(.92, pairChance));
          return has("raise") && Math.random() < pairChance ? "raise" : "pass";
        }
        // 最大特殊牌绝对领先，可以无限吃桌面。
        if (ev.level === 1 && has("raise")) return "raise";
        // 特殊对子（QQ、22、红8/红4/黑10对子）按等级、性格、人数与公池动态决定吃两次、三次或更多。
        var style = p.aiStyle || { aggression: 1, risk: 1, bluff: 1 };
        var specialStrength = (16 - ev.level) / 15;
        var continueChance = .13 + specialStrength * .82;
        continueChance += (style.aggression - 1) * .34 + (style.risk - 1) * .30;
        continueChance -= Math.max(0, p.tableRaiseCount - 1) * (.12 + (1 - specialStrength) * .12);
        continueChance -= Math.max(0, context.alive - 2) * .045;
        continueChance -= Math.log(Math.max(2, G.pot)) / Math.log(2) * .012;
        continueChance = Math.max(.03, Math.min(.94, continueChance));
        return has("raise") && Math.random() < continueChance ? "raise" : "pass";
      }
    }
    var scored = candidates.map(function (action) {
      return { action: action, value: aiActionValue(p, action, equity, context) };
    });

    // 弱牌仍保留有条件的诈唬：人数少、位置靠后、抬价压力低时才可能触发。
    var styleForBluff = p.aiStyle || { bluff: 1 };
    var bluffChance = !p.bluffUsed && equity < .44
      ? Math.max(0, (.025 + context.position * .075 - Math.max(0, context.alive - 2) * .012 - context.pressure * .018) * styleForBluff.bluff)
      : 0;
    if (Math.random() < bluffChance) {
      var bluffAction = has("half") ? "half" : has("call") ? "call" : has("raise") ? "raise" : null;
      if (bluffAction) {
        p.bluffUsed = true;
        return bluffAction;
      }
    }
    scored.sort(function (a, b) { return b.value - a.value; });
    // 两个方案收益接近时偶尔选择次优项，使行为不机械。
    if (scored.length > 1 && scored[0].value - scored[1].value < .16 && Math.random() < .22) return scored[1].action;
    return scored[0].action;
  }

  renderAll();

  // 暴露给控制台便于调试
  window.GAME = G;
})();
