// 游戏逻辑（人机对战）—— 依据《完整规则 V1.0》，复用已校验引擎 ENGINE
(function () {
  "use strict";
  var E = window.ENGINE;
  var D = window.GAME_DATA;

  var SUIT_SYMBOL = { "红桃": "♥", "方块": "♦", "黑桃": "♠", "梅花": "♣", "特殊": "" };
  var DECK_SUIT = { "红桃": "hearts", "方块": "diamonds", "黑桃": "spades", "梅花": "clubs" };
  var DECK_RANK = { "J": "jack", "Q": "queen" };
  var DECK_BASE = "assets/opendecks/svg cards/";
  var SEAT_COLORS = ["#c62828", "#3d6ea5", "#7b5ea7", "#2e7d32", "#d97b29", "#00838f", "#ad1457", "#5d4037"];

  var G = {
    players: [], n: 4, dealer: -1, round: 1, pot: 0, phase: "setup",
    lastRaiseRound: 0, bettingRound: 0, started: false, timerOn: true,
    currentPlayer: -1, actionResolve: null, timerHandle: null, seatTimerHandle: null,
    nextRoundTicker: null,
    seatTimerLeft: null, gameOver: false,
    timeoutCount: 0, autoManaged: false,
    session: 0,
    winner: null, tiePlayers: null, showdownPlayers: [], ante: 1
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
    var resolve = rubResolve;
    rubResolve = null;
    rubDragging = false;
    rubStart = null;
    $("rub-slider").classList.remove("dragging");
    $("rub-overlay").classList.add("hidden");
    resolve();
  }
  function showRubCards(hand) {
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
      rubStart = null;
      this.classList.remove("dragging");
    });
  });
  $("rub-reveal").addEventListener("click", finishRubCards);

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
      var isActive = G.phase === "betting" && G.players[G.currentPlayer] === p && !p.folded && !p.out;
      if (isActive) cls.push("is-active");

      var seat = document.createElement("div");
      seat.className = cls.join(" ");
      seat.style.left = left + "%";
      seat.style.top = top + "%";

      var seatColor = SEAT_COLORS[i % 8];
      // 座位号按当前头家动态计算：头家永远为1号，之后按行动顺序递增。
      var seatNo = G.dealer >= 0 ? ((i - G.dealer + n) % n) + 1 : i + 1;
      var avatarChar = seatNo;
      if (seatNo === 1) dealerPosition = { left: left, top: top };

      // 手牌（他人背面，我自己和揭牌者正面）
      var handHTML;
      if (p.revealed) handHTML = cardHTML(p.hand[0], { reveal: true }) + cardHTML(p.hand[1], { reveal: true });
      else if (p.isHuman) handHTML = cardHTML(p.hand[0]) + cardHTML(p.hand[1]);
      else handHTML = cardBackHTML() + cardBackHTML();

      // 行为徽标（弃牌 / 出局由 CSS ::after / .out 处理，故只渲染玩家真正选择的动作）
      var actionHTML = "";
      if (!p.out && !p.folded && !p.isWinner && p.lastAction) {
        var actionCls = p.lastAction;
        actionHTML = '<span class="seat-action ' + actionCls + '">' + p.lastAction + '</span>';
      }

      var nameHTML =
        '<div class="seat-name">' +
          '<div class="seat-avatar" style="background:' + seatColor + '">' + avatarChar + '</div>' +
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
  function renderMyZone() {
    var me = G.players[0];
    var zone = $("my-hand");
    if (!me || G.phase === "setup" || me.out || !me.hand[0]) {
      zone.innerHTML = '<span class="muted">' + (G.phase === "setup" ? "等待开局…" : "等待发牌…") + "</span>";
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
      return;
    }
    var sorted = G.players.slice().sort(function (a, b) { return b.chips - a.chips; });
    var lastScore = null, shownRank = 0;
    var rows = sorted.map(function (p, index) {
      if (lastScore === null || p.chips !== lastScore) shownRank = index + 1;
      lastScore = p.chips;
      var medal = shownRank === 1 ? "🥇" : shownRank === 2 ? "🥈" : shownRank === 3 ? "🥉" : shownRank;
      return '<li class="' + (p.isHuman ? "is-me" : "") + '"><span class="ranking-place">' + medal + '</span>' +
        '<span class="ranking-player">' + p.name + (p.isHuman ? "（你）" : "") + '</span>' +
        '<strong class="ranking-score">' + (p.chips > 0 ? "+" : "") + p.chips + ' 分</strong></li>';
    }).join("");
    var matchText = G.matchMode === "rounds" ? (G.maxRounds + "局已完成") : "本场时长已结束";
    panel.innerHTML = '<div class="ranking-head"><div><small>FINAL RANKING</small><h2>对局排行榜</h2></div><span>' + matchText + '</span></div><ol>' + rows + '</ol>';
    panel.classList.remove("hidden");
  }
  function renderAll() { renderSeats(); renderPot(); renderMyZone(); renderPills(); }

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
    var playerIndex = G.players.indexOf(p);
    requestAnimationFrame(function () {
      var seats = document.querySelectorAll("#seats .seat");
      flyCoins(seats[playerIndex] && seats[playerIndex].querySelector(".seat-chips"), document.querySelector(".pot-center"), amount);
    });
  }
  function sendPotToWinner(p, amount) {
    var playerIndex = G.players.indexOf(p), seats = document.querySelectorAll("#seats .seat");
    return flyCoins(document.querySelector(".pot-center"), seats[playerIndex] && seats[playerIndex].querySelector(".seat-chips"), amount);
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
    G.session++;
    // 若正等待玩家操作，先解除等待，避免旧牌局在后台继续推进。
    if (G.actionResolve) { var resolve = G.actionResolve; G.actionResolve = null; resolve(null); }
    showActions(false);
    $("game-screen").classList.add("hidden");
    $("setup-screen").classList.remove("hidden");
    G.started = false; G.gameOver = false;
  });

  /* ---------- 初始化 ---------- */
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
        usedBottom: false, hasTakenTurn: false, winCap: 1, bluffUsed: false
      });
    }
    G.dealer = -1; G.round = 1; G.pot = 0; G.gameOver = false; G.showdownPlayers = [];
    G.timeoutCount = 0; G.autoManaged = false;
    $("log").innerHTML = "";
    var b = $("result-banner"); b.className = "result-banner"; b.innerHTML = "";
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
    G.showdownPlayers = []; G.lastSeatThresholdFailed = false; G.lastSeatThresholdDirectWin = false;
    G.players.forEach(function (p) {
      p.hand = [null, null]; p.folded = false; p.roundStake = 0;
      p.lastRaiseRound = 0; p.revealed = false; p.lastAction = ""; p.isWinner = false;
      p.hasBetThisRound = false; p.hasRaised = false; p.waitingShowdown = false;
      p.usedBottom = false; p.hasTakenTurn = false; p.winCap = G.ante; p.bluffUsed = false;
    });
    if (G.round === 1) determineDealerFirstRound();
    G.phase = "deal"; renderAll(); await delay(500);
    if (!isCurrentSession(session)) return;

    var deck = shuffle(D.CARDS);
    G.players.forEach(function (p, i) { if (!p.out) p.hand = [deck[i * 2], deck[i * 2 + 1]]; });
    log("发牌完成，本局底注各 <b>" + G.ante + "</b> 积分。");
    renderAll();
    await showRubCards(G.players[0].hand);
    if (!isCurrentSession(session)) return;

    G.players.forEach(function (p) {
      if (p.out) return;
      var ante = G.ante;
      p.chips -= ante; p.roundStake += ante; G.pot += ante; queueCoinsToPot(p, ante);
    });
    renderAll(); await delay(400);
    if (!isCurrentSession(session)) return;

    G.phase = "betting"; G.bettingRound = 0; G.lastRaiseRound = 0;
    await bettingPhase(session);
    if (!isCurrentSession(session)) return;

    G.phase = "showdown"; await showdownPhase(session);
    if (!isCurrentSession(session)) return;

    G.phase = "settle"; await settlePhase(session); renderAll();
  }

  /* ---------- 下注 ----------
   1) 每位玩家每局仅能「吃一个底注」一次，且仅限首轮。
   2) 只要没有弃牌，就始终保留比牌资格；吃桌面只会抬高公池。
   3) 吃过底注或吃过桌面即锁定比牌资格，后续不可弃牌，只能继续吃桌面或等待比牌。
   4) 尚未进行有效下注者仍可弃牌；积分允许为负，不设全下与出局。
   ----------------------------------------------------------------- */
  function computeOptions(p, isOpeningRound, canPass, canFold) {
    var opts = [];
    var raiseCost = G.pot;
    var canRaise = raiseCost > 0;
    var canCall = isOpeningRound && !p.usedBottom;
    if (canRaise) opts.push("raise");
    if (canCall) opts.push("call");
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
    log("<b>首轮下注开始</b>：每位玩家可选「吃桌面／吃一个底注／弃牌」。");
    // 首轮：每位未出局玩家各行动一次。吃底注和吃桌面都取得第一轮资格。
    for (var i = 0; i < G.n; i++) {
      if (!isCurrentSession(session)) return;
      var idx = (G.dealer + i) % G.n, p = G.players[idx];
      if (p.out || p.folded) continue;
      var openingOpts = computeOptions(p, true, false, true);
      if (!openingOpts.length) continue;
      turn++; G.bettingRound = 1; G.currentPlayer = idx; renderAll();
      var openingAction = await getAction(p, openingOpts, true);
      if (!isCurrentSession(session)) return;
      p.hasTakenTurn = true;
      var openingRaised = applyAction(p, openingAction);
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
      p.lastAction = "吃桌面";
      log("<b>" + p.name + "</b> 吃桌面，下注 <b>" + bet + "</b>，公池 → <b>" + G.pot + "</b>。");
      return true;
    } else if (action === "call") {
      var cb = G.ante;
      p.chips -= cb; p.roundStake += cb; G.pot += cb;
      p.winCap = cb;
      queueCoinsToPot(p, cb);
      p.hasBetThisRound = true; p.usedBottom = true;
      p.lastAction = "吃底注";
      log("<b>" + p.name + "</b> 吃一个底注（+" + cb + "），公池 → <b>" + G.pot + "</b>。");
      return false;
    } else if (action === "pass") {
      p.waitingShowdown = true;
      p.lastAction = "等待比牌";
      log("<b>" + p.name + "</b> 选择等待比牌：不再追加下注，保留比牌资格。", "hl");
      return false;
    } else if (action === "fold") {
      p.folded = true;
      p.lastAction = "弃牌";
      log("<b>" + p.name + "</b> 弃牌（已投入不退）。");
      return false;
    }
    return false;
  }
  function getAction(p, opts, isOpeningRound) {
    if (p.isHuman && !G.autoManaged) return new Promise(function (resolve) { G.actionResolve = resolve; G._humanOpts = opts; showActions(true, opts, isOpeningRound); startTimer(isOpeningRound); });
    // 让 AI 保持一段可感知的思考时间，行动节奏更接近真人。
    var thinkTime = 5000 + Math.floor(Math.random() * 3001);
    startSeatTimer(30);
    return delay(thinkTime).then(function () {
      stopSeatTimer();
      return aiDecide(p, opts, isOpeningRound);
    });
  }

  function showActions(show, opts, isFirstTurn) {
    var bar = $("actions");
    bar.style.display = show ? "flex" : "none";
    if (!show) { stopTimer(); return; }
    var me = G.players[0];
    var raiseCost = G.pot;
    var callCost = G.ante;
    var bR = $("btn-raise"), bC = $("btn-call"), bP = $("btn-pass"), bF = $("btn-fold");
    bR.textContent = "吃桌面 +" + raiseCost;
    bR.style.display = opts.indexOf("raise") >= 0 ? "" : "none";
    bR.disabled = !opts || opts.indexOf("raise") < 0;
    bC.textContent = "吃一个底注 +" + callCost;
    bC.style.display = opts.indexOf("call") >= 0 ? "" : "none";
    bC.disabled = !opts || opts.indexOf("call") < 0;
    bP.textContent = "等待比牌";
    bP.style.display = opts.indexOf("pass") >= 0 ? "" : "none";
    bP.disabled = !opts || opts.indexOf("pass") < 0;
    bF.style.display = opts.indexOf("fold") >= 0 ? "" : "none";
    bF.disabled = !opts || opts.indexOf("fold") < 0;
  }
  function doAction(a) {
    stopTimer(); showActions(false);
    var r = G.actionResolve; G.actionResolve = null;
    if (r) r(a);
  }
  $("btn-raise").onclick = function () { doAction("raise"); };
  $("btn-call").onclick = function () { doAction("call"); };
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
    $("timer").classList.add("hidden");
  }

  /* ---------- 比牌 ---------- */
  async function showdownPhase(session) {
    // 所有未弃牌玩家均拥有比牌资格。
    var contenders = (G.showdownPlayers || []).filter(function (p) {
      return !p.out && !p.folded;
    });
    $("hint").textContent = "";
    if (G.lastSeatThresholdFailed) {
      G.winner = null; G.tiePlayers = [];
      return;
    }
    if (contenders.length === 1) {
      contenders[0].revealed = true; renderAll();
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
      p.revealed = true; renderAll();
      var ev = E.evaluate(p.hand[0], p.hand[1]);
      log("<b>" + p.name + "</b> 揭牌 → " + E.handDesc(ev));
      await delay(650);
      if (!isCurrentSession(session)) return;
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
    } else { G.winner = best; G.tiePlayers = null; }
  }

  /* ---------- 结算 ---------- */
  async function settlePhase(session) {
    var banner = $("result-banner");
    G.matchFinished = G.matchMode === "rounds" ? G.round >= G.maxRounds : Date.now() >= G.endAt;
    var nextLabel = G.matchFinished ? "结束牌局" : "下一局";
    if (G.winner) {
      var w = G.winner;
      // 最后一家通过8点门槛的直接获胜通吃；其他情况才受主动下注两倍上限约束。
      var prize = G.lastSeatThresholdDirectWin ? G.pot : Math.min(G.pot, w.winCap * 2), remainder = G.pot - prize;
      // 先明确胜者、保留公池数字，再把金币从桌心发向胜者。
      w.isWinner = true; renderAll();
      await delay(40);
      await sendPotToWinner(w, prize);
      if (session != null && !isCurrentSession(session)) return;
      w.chips += prize;
      log("<b class='gd'>" + w.name + "</b> 获胜，赢得 <b>" + prize + "</b> 积分" + (remainder > 0 ? "，公池结转 <b>" + remainder + "</b> 积分。" : "！"), "gd");
      banner.className = "result-banner win";
      banner.innerHTML = "本局胜者：<b>" + w.name + "</b> 　赢得 <b>" + prize + "</b> 积分" +
        (remainder > 0 ? "　公池结转 <b>" + remainder + "</b> 积分" : "") + "　<button class='next-btn' id='next-btn'>" + nextLabel + "</button>";
      G.pot = remainder;
      G.dealer = G.players.indexOf(w);
    } else {
      log("<b class='hl'>平局！</b> 所有投入 <b>" + G.pot + "</b> 积分全部结转下一局公池。", "hl");
      banner.className = "result-banner tie";
      banner.innerHTML = "平局：无人收益，公池 <b>" + G.pot + "</b> 结转下一局　<button class='next-btn' id='next-btn'>" + nextLabel + "</button>";
      G.dealer = (G.dealer + 1) % G.n;
    }
    renderAll();
    renderMatchRanking();
  }
  function waitNextRound(session) {
    return new Promise(function (resolve) {
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
  function aiDecide(p, opts, isFirstTurn) {
    var ev = E.evaluate(p.hand[0], p.hand[1]);
    var has = function (k) { return opts.indexOf(k) >= 0; };
    var r = Math.random();
    var point = ev.type === "special" ? 10 : ev.point;
    var bluff = function (action) { p.bluffUsed = true; return action; };
    var legalFallback = function () {
      if (has("pass")) return "pass";
      if (has("raise")) return "raise";
      if (has("call")) return "call";
      return has("fold") ? "fold" : null;
    };
    // 特殊、8、9 点积极；7 点偏保守；0–6 点保留一次小概率诈唬。
    if (isFirstTurn) {
      if (point >= 8) return has("raise") && r < 0.78 ? "raise" : (has("call") ? "call" : "fold");
      if (point === 7) {
        if (has("raise") && !p.bluffUsed && r < 0.08) return bluff("raise");
        return has("call") ? "call" : "fold";
      }
      if (!p.bluffUsed && has("raise") && r < 0.06) return bluff("raise");
      if (!p.bluffUsed && has("call") && r < 0.28) return bluff("call");
      return "fold";
    }
    if (point >= 8) return has("raise") && r < 0.72 ? "raise" : legalFallback();
    if (point === 7) {
      if (has("pass") && r < 0.80) return "pass";
      if (has("raise") && r < 0.14) return "raise";
      return has("fold") ? "fold" : legalFallback();
    }
    if (!p.bluffUsed && has("raise") && r < 0.08) return bluff("raise");
    // 弱牌偶尔等待比牌，既保留博弈感，也不会持续抬高公池。
    if (has("pass") && r < 0.35) return "pass";
    return has("fold") ? "fold" : legalFallback();
  }

  renderAll();

  // 暴露给控制台便于调试
  window.GAME = G;
})();
