"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const express = require("express");
const { Server } = require("socket.io");

const root = path.resolve(__dirname, "..");
const dataContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "js", "data.js"), "utf8"), dataContext);
vm.runInNewContext(fs.readFileSync(path.join(root, "js", "engine.js"), "utf8"), dataContext);
const CARDS = dataContext.window.GAME_DATA.CARDS;
// 联机服务端与单机版共用同一个 496 种组合牌型引擎，避免两边规则漂移。
const ENGINE = dataContext.window.ENGINE;
const rooms = new Map();

const app = express();
app.use(express.static(root));
const server = http.createServer(app);
const io = new Server(server);

function shuffle(cards) {
  const deck = cards.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (rooms.has(code));
  return code;
}
function safeName(value) {
  const name = String(value || "玩家").trim().replace(/[<>]/g, "").slice(0, 12);
  return name || "玩家";
}
function active(room) { return room.players.filter((p) => !p.folded); }
function betting(room) { return active(room).filter((p) => !p.waiting); }
function addEvent(room, text) {
  room.events.push({ at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), text });
  room.events = room.events.slice(-30);
}

function compare(a, b) { return ENGINE.compareHands(ENGINE.evaluate(a[0], a[1]), ENGINE.evaluate(b[0], b[1])); }
function handText(hand) { return ENGINE.handDesc(ENGINE.evaluate(hand[0], hand[1])); }

function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; room.deadline = 0; }
function clearNextTimer(room) { if (room.nextTimer) clearTimeout(room.nextTimer); room.nextTimer = null; room.nextDeadline = 0; }
function clearRubTimer(room) { if (room.rubTimer) clearTimeout(room.rubTimer); room.rubTimer = null; }
function handStrength(hand) {
  const ev = ENGINE.evaluate(hand[0], hand[1]);
  return ev.type === "special" ? 100 + (15 - ev.level) : ev.point * 10 + ev.mianzi;
}
function meetsLastSeatWinThreshold(player) {
  const ev = ENGINE.evaluate(player.hand[0], player.hand[1]);
  // 特殊牌型均高于普通点数；普通牌至少 8 点才能在全员弃牌时直接获胜。
  return ev.type === "special" || ev.point >= 8;
}
function legalActions(room, player) {
  const opening = room.bettingStage === "opening";
  return {
    raise: room.pot > 0,
    call: opening && !player.usedBottom,
    wait: !opening && player.hasBetThisRound,
    fold: !player.usedBottom && !player.hasRaised
  };
}
function autoAction(room, player) {
  const ev = ENGINE.evaluate(player.hand[0], player.hand[1]);
  const point = ev.type === "special" ? 10 : ev.point;
  const r = Math.random();
  const bluff = (action) => { player.bluffUsed = true; return action; };
  const legal = legalActions(room, player);
  const choose = (action) => legal[action] ? action : legal.wait ? "wait" : legal.raise ? "raise" : legal.call ? "call" : "fold";
  if (room.bettingStage === "opening") {
    if (point >= 8) return choose(r < 0.78 ? "raise" : "call");
    if (point === 7) return choose(!player.bluffUsed && r < 0.08 ? bluff("raise") : "call");
    if (!player.bluffUsed && r < 0.06) return choose(bluff("raise"));
    if (!player.bluffUsed && r < 0.28) return choose(bluff("call"));
    return choose("fold");
  }
  if (point >= 8) return choose(r < 0.72 ? "raise" : "wait");
  if (point === 7) return choose(r < 0.80 ? "wait" : (r < 0.94 ? "raise" : "fold"));
  if (!player.bluffUsed && r < 0.08) return choose(bluff("raise"));
  if (r < 0.35) return choose("wait");
  return choose("fold");
}
function armTimer(room) {
  clearTimer(room);
  if (room.phase !== "playing" || !room.turnId) return;
  const player = room.players.find((p) => p.id === room.turnId);
  if (!player) return;
  const auto = player.autoManaged;
  const duration = auto ? 5000 + Math.floor(Math.random() * 3001) : 30000;
  room.deadline = Date.now() + duration;
  room.timer = setTimeout(() => {
    if (room.phase !== "playing" || room.turnId !== player.id) return;
    if (player.autoManaged) return applyAction(room, player, autoAction(room, player), true);
    player.timeoutCount += 1;
    if (player.timeoutCount < 3) {
      addEvent(room, player.name + " 第 " + player.timeoutCount + " 次超时，继续等待（第 3 次超时后托管）。");
      armTimer(room); broadcast(room);
      return;
    }
    player.autoManaged = true;
    addEvent(room, player.name + " 已第 3 次超时，系统开启托管。");
    armTimer(room); broadcast(room);
  }, duration);
}
function nextPlayer(room, fromId, list) {
  const candidates = list || betting(room);
  if (!candidates.length) return null;
  const oldIndex = room.players.findIndex((p) => p.id === fromId);
  for (let offset = 1; offset <= room.players.length; offset++) {
    const candidate = room.players[(oldIndex + offset) % room.players.length];
    if (candidates.includes(candidate)) return candidate;
  }
  return candidates[0];
}
function settle(room, contenders) {
  clearTimer(room);
  room.phase = "showdown";
  const players = contenders && contenders.length ? contenders : active(room);
  if (!players.length) return;
  if (room.lastSeatThresholdFailed) {
    room.winnerId = null;
    room.dealer = (room.dealer + 1) % room.players.length;
    addEvent(room, "最后一家未达到普通8点门槛：本局无人获胜，公池 " + room.pot + " 积分结转下一局。");
    return scheduleNextRound(room);
  }
  let winner = players[0];
  let tie = false;
  for (const player of players.slice(1)) {
    const result = compare(player.hand, winner.hand);
    if (result > 0) { winner = player; tie = false; }
    else if (result === 0) tie = true;
  }
  if (tie) {
    room.winnerId = null;
    room.dealer = (room.dealer + 1) % room.players.length;
    addEvent(room, "平局：无人收益，公池 " + room.pot + " 积分结转下一局。");
  } else {
    // 最后一家通过8点门槛的直接获胜通吃；其他情况才受主动下注两倍上限约束。
    const prize = room.lastSeatThresholdDirectWin ? room.pot : Math.min(room.pot, winner.winCap * 2);
    winner.score += prize;
    room.pot -= prize;
    room.winnerId = winner.id;
    room.dealer = room.players.indexOf(winner);
    addEvent(room, winner.name + " 获胜，赢得 " + prize + " 积分" + (room.pot ? "，公池结转 " + room.pot + " 积分。" : "！"));
  }
  scheduleNextRound(room);
}
function scheduleNextRound(room) {
  clearNextTimer(room);
  room.nextDeadline = Date.now() + 10000;
  room.nextTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.phase !== "showdown") return;
    if (room.players.length < 2) {
      room.phase = "lobby";
      room.nextDeadline = 0;
      return broadcast(room);
    }
    startRound(room);
  }, 10000);
  broadcast(room);
}
function maybeFinish(room) {
  const alive = active(room);
  if (alive.length <= 1) { settle(room, alive); return true; }
  // 已有人等待比牌，最后一名仍在下注的玩家不再获得继续抬价机会。
  if (room.bettingStage === "followup" && betting(room).length <= 1) { settle(room, alive); return true; }
  return false;
}
function beginFollowup(room) {
  room.bettingStage = "followup";
  room.round += 1;
  room.roundHasRaise = false;
  betting(room).forEach((p) => { p.acted = false; });
  room.turnId = room.players[room.dealer % room.players.length].id;
  if (!betting(room).includes(room.players[room.dealer % room.players.length])) room.turnId = nextPlayer(room, room.players[(room.dealer - 1 + room.players.length) % room.players.length].id).id;
  addEvent(room, "第 " + room.round + " 轮：继续下注可抬高公池，未弃牌者均保留比牌资格。");
  armTimer(room); broadcast(room);
}
function finishOpening(room) {
  const contenders = active(room).filter((p) => p.hasTakenTurn);
  if (contenders.length <= 1) return settle(room, contenders);
  // 首轮有人吃桌面，或多人仅吃底注时，才进入可“等待比牌”的后续轮。
  if (room.openingHasTableBet || contenders.length > 1) return beginFollowup(room);
  settle(room, contenders);
}
function applyAction(room, player, action, timeout) {
  if (room.phase !== "playing" || room.turnId !== player.id) return;
  const legal = legalActions(room, player);
  if (!legal[action]) return false;
  const cost = room.pot;
  const opening = room.bettingStage === "opening";
  if (action === "call" && opening && !player.usedBottom) {
    player.score -= 1; player.stake += 1; player.winCap = 1; player.usedBottom = true; player.hasBetThisRound = true;
    addEvent(room, player.name + " 吃一个底注（+1），公池 → " + (room.pot + 1) + "。");
    room.pot += 1;
  } else if (action === "raise" && cost > 0) {
    player.score -= cost; player.stake += cost; player.winCap = cost; player.hasRaised = true; player.hasBetThisRound = true; room.pot += cost;
    if (opening) room.openingHasTableBet = true;
    else room.roundHasRaise = true;
    addEvent(room, player.name + " 吃桌面，下注 " + cost + "，公池 → " + room.pot + "。");
  } else if (action === "wait" && !opening && player.hasBetThisRound) {
    player.waiting = true;
    addEvent(room, player.name + " 选择等待比牌：不再追加下注，保留比牌资格。" + (timeout ? "（托管）" : ""));
  } else if (action === "fold") {
    player.folded = true;
    addEvent(room, player.name + " 弃牌（已投入不退）。" + (timeout ? "（托管）" : ""));
  } else return;
  player.acted = true; player.hasTakenTurn = true;
  if (opening && action !== "fold") room.openingAllPriorFolded = false;
  if (opening) {
    const unacted = active(room).filter((p) => !p.acted);
    if (room.openingAllPriorFolded && unacted.length === 1) {
      const lastSeat = unacted[0];
      lastSeat.acted = true; lastSeat.hasTakenTurn = true;
      const hand = handText(lastSeat.hand);
      if (meetsLastSeatWinThreshold(lastSeat)) {
        room.lastSeatThresholdDirectWin = true;
        addEvent(room, "前序玩家均弃牌，最后一家 " + lastSeat.name + " 亮牌 → " + hand + "，达到普通8点门槛，直接获胜。");
      } else {
        room.lastSeatThresholdFailed = true;
        addEvent(room, "前序玩家均弃牌，最后一家 " + lastSeat.name + " 亮牌 → " + hand + "，未达到普通8点门槛。");
      }
      return settle(room, [lastSeat]);
    }
    if (maybeFinish(room)) return;
    if (!unacted.length) return finishOpening(room);
    room.turnId = nextPlayer(room, player.id, unacted).id;
  } else {
    if (maybeFinish(room)) return;
    const candidates = betting(room);
    if (candidates.every((p) => p.acted)) {
      if (!room.roundHasRaise) return settle(room, active(room));
      return beginFollowup(room);
    }
    room.turnId = nextPlayer(room, player.id, candidates.filter((p) => !p.acted)).id;
  }
  armTimer(room);
  broadcast(room);
  return true;
}
function beginBetting(room) {
  if (room.phase !== "rubbing") return;
  clearRubTimer(room);
  room.phase = "playing";
  room.turnId = room.players[room.dealer % room.players.length].id;
  addEvent(room, "全员搓牌完成，首轮下注开始：每位玩家可选「吃桌面／吃一个底注／弃牌」。");
  armTimer(room);
  broadcast(room);
}
function startRound(room) {
  clearNextTimer(room);
  clearRubTimer(room);
  const deck = shuffle(CARDS);
  if (!room.gameNo) {
    const headCard = CARDS[Math.floor(Math.random() * CARDS.length)];
    room.dealer = (headCard.value - 1) % room.players.length;
    addEvent(room, "首局翻牌：" + headCard.rank + (headCard.sym || "") + "，头家为 " + room.players[room.dealer].name + "。");
  }
  room.gameNo = (room.gameNo || 0) + 1;
  room.round = 1; room.bettingStage = "opening"; room.openingHasTableBet = false; room.openingAllPriorFolded = true; room.lastSeatThresholdFailed = false; room.lastSeatThresholdDirectWin = false; room.roundHasRaise = false;
  room.phase = "rubbing"; room.winnerId = null; room.turnId = null;
  room.players.forEach((p, i) => {
    p.hand = [deck[i * 2], deck[i * 2 + 1]]; p.folded = false; p.waiting = false; p.usedBottom = false;
    p.hasRaised = false; p.hasBetThisRound = false; p.hasTakenTurn = false; p.acted = false; p.stake = 1; p.winCap = 1; p.bluffUsed = false; p.rubReady = false;
    p.score -= 1; p.timeoutCount = 0; p.autoManaged = false;
  });
  room.pot += room.players.length;
  addEvent(room, "第 " + room.gameNo + " 局发牌完成，本局底注各 1 积分。");
  addEvent(room, "等待所有玩家完成搓牌。");
  broadcast(room);
  room.rubTimer = setTimeout(() => beginBetting(room), 30000);
}
function view(room, viewerId) {
  const isShowdown = room.phase === "showdown";
  return {
    code: room.code, mode: room.mode, phase: room.phase, round: room.round, gameNo: room.gameNo, pot: room.pot, deadline: room.deadline, nextDeadline: room.nextDeadline || 0,
    hostId: room.hostId, turnId: room.turnId, winnerId: room.winnerId, events: room.events,
    players: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score, folded: p.folded, waiting: p.waiting, rubReady: !!p.rubReady, autoManaged: p.autoManaged,
      hand: (isShowdown || p.id === viewerId) ? p.hand : null,
      handText: isShowdown ? handText(p.hand) : null
    })),
    actions: room.phase === "playing" && room.turnId === viewerId ? (() => {
      const p = room.players.find((x) => x.id === viewerId);
      return legalActions(room, p);
    })() : null
  };
}
function broadcast(room) { room.players.forEach((p) => io.to(p.id).emit("room_state", view(room, p.id))); }
function getRoomFor(socket) { return rooms.get(socket.data.roomCode); }

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, mode }, done) => {
    const code = roomCode();
    const room = { code, mode: ["classic", "double", "four"].includes(mode) ? mode : "classic", hostId: socket.id, players: [], phase: "lobby", round: 1, gameNo: 0, bettingStage: "opening", pot: 0, dealer: 0, events: [], timer: null, deadline: 0, nextTimer: null, nextDeadline: 0, rubTimer: null };
    rooms.set(code, room);
    const player = { id: socket.id, name: safeName(name), score: 0, hand: [], folded: false, waiting: false, stake: 0, winCap: 1, usedBottom: false, hasRaised: false, hasBetThisRound: false, hasTakenTurn: false, acted: false, bluffUsed: false, timeoutCount: 0, autoManaged: false };
    room.players.push(player); socket.join(code); socket.data.roomCode = code;
    addEvent(room, player.name + " 创建了房间。"); broadcast(room); done({ ok: true, code });
  });
  socket.on("room:join", ({ code, name }, done) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.phase !== "lobby") return done({ ok: false, error: "房间不存在或已经开局。" });
    if (room.players.length >= 8) return done({ ok: false, error: "房间已满（最多 8 人）。" });
    const player = { id: socket.id, name: safeName(name), score: 0, hand: [], folded: false, waiting: false, stake: 0, winCap: 1, usedBottom: false, hasRaised: false, hasBetThisRound: false, hasTakenTurn: false, acted: false, bluffUsed: false, timeoutCount: 0, autoManaged: false };
    room.players.push(player); socket.join(room.code); socket.data.roomCode = room.code;
    addEvent(room, player.name + " 加入了房间。"); broadcast(room); done({ ok: true, code: room.code });
  });
  socket.on("game:start", (_payload, done) => {
    done = typeof done === "function" ? done : function () {};
    const room = getRoomFor(socket);
    if (!room || room.hostId !== socket.id) return done({ ok: false, error: "只有房主可以开始。" });
    if (room.players.length < 2) return done({ ok: false, error: "至少需要 2 名玩家。" });
    if (room.mode === "four" && room.players.length !== 4) return done({ ok: false, error: "经典四人需要 4 名玩家全部加入后才能开始。" });
    startRound(room); done({ ok: true });
  });
  socket.on("game:action", ({ action }, done) => {
    done = typeof done === "function" ? done : function () {};
    const room = getRoomFor(socket);
    const player = room && room.players.find((p) => p.id === socket.id);
    if (!room || !player || room.turnId !== socket.id) return done({ ok: false, error: "现在不是你的行动时间。" });
    if (!legalActions(room, player)[action]) return done({ ok: false, error: "该操作不符合当前规则。" });
    applyAction(room, player, action, false);
    done({ ok: true });
  });
  socket.on("game:rub_ready", (_payload, done) => {
    done = typeof done === "function" ? done : function () {};
    const room = getRoomFor(socket);
    const player = room && room.players.find((p) => p.id === socket.id);
    if (!room || !player || room.phase !== "rubbing") return done({ ok: false, error: "当前不在搓牌阶段。" });
    player.rubReady = true;
    addEvent(room, player.name + " 已完成搓牌。");
    if (room.players.every((p) => p.rubReady)) beginBetting(room); else broadcast(room);
    done({ ok: true });
  });
  socket.on("game:next", (_payload, done) => {
    done = typeof done === "function" ? done : function () {};
    const room = getRoomFor(socket);
    if (!room || room.hostId !== socket.id || room.phase !== "showdown") return done({ ok: false, error: "只有房主可开启下一局。" });
    clearNextTimer(room); startRound(room); done({ ok: true });
  });
  socket.on("disconnect", () => {
    const room = getRoomFor(socket);
    if (!room) return;
    if (room.phase === "lobby") room.players = room.players.filter((p) => p.id !== socket.id);
    else { const p = room.players.find((x) => x.id === socket.id); if (p) p.folded = true; maybeFinish(room); }
    if (!room.players.length) { clearTimer(room); clearNextTimer(room); clearRubTimer(room); rooms.delete(room.code); }
    else { if (room.hostId === socket.id) room.hostId = room.players[0].id; broadcast(room); }
  });
});

server.listen(process.env.PORT || 3000, () => console.log("联机原型已启动：http://127.0.0.1:3000/online.html"));
