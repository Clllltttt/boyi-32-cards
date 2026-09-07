"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { io } = require("socket.io-client");

const root = path.resolve(__dirname, "..");
const port = 32123;
const url = `http://127.0.0.1:${port}`;

function ack(socket, event, data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 3000);
    socket.emit(event, data, (result) => { clearTimeout(timer); resolve(result); });
  });
}

function observe(socket) {
  const observer = { state: null };
  socket.on("room_state", (state) => { observer.state = state; });
  return observer;
}

function waitFor(observer, predicate, message) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (observer.state && predicate(observer.state)) {
        clearInterval(timer);
        resolve(observer.state);
      } else if (Date.now() - started > 4000) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 20);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
}

test("room settings, five-round finish and reconnect identity", async (t) => {
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => server.kill());
  await waitForServer();

  const hostToken = "host_token_123456789012345678901234";
  const guestToken = "guest_token_12345678901234567890123";
  const host = io(url, { transports: ["websocket"] });
  let guest = io(url, { transports: ["websocket"] });
  t.after(() => { host.close(); guest.close(); });
  const hostView = observe(host);
  let guestView = observe(guest);

  await Promise.all([
    new Promise((resolve) => host.on("connect", resolve)),
    new Promise((resolve) => guest.on("connect", resolve))
  ]);
  const created = await ack(host, "room:create", { name: "房主", mode: "classic", token: hostToken, matchType: "rounds", maxRounds: 5, durationMinutes: 20 });
  assert.equal(created.ok, true);
  const joined = await ack(guest, "room:join", { name: "客人", code: created.code, token: guestToken });
  assert.equal(joined.ok, true);
  const joinedState = await waitFor(hostView, (state) => state.players.length === 2, "guest did not join");
  assert.equal(joinedState.matchType, "rounds");
  assert.equal(joinedState.maxRounds, 5);
  const guestId = guestView.state.selfId;

  guest.close();
  const disconnected = await waitFor(hostView, (state) => state.players.some((player) => player.id === guestId && !player.connected), "disconnect grace state missing");
  assert.ok(disconnected.players.find((player) => player.id === guestId).disconnectDeadline > Date.now());

  guest = io(url, { transports: ["websocket"] });
  guestView = observe(guest);
  await new Promise((resolve) => guest.on("connect", resolve));
  const resumed = await ack(guest, "room:resume", { code: created.code, token: guestToken });
  assert.equal(resumed.ok, true);
  const resumedState = await waitFor(guestView, (state) => state.selfId === guestId, "stable player identity was not restored");
  assert.equal(resumedState.players.find((player) => player.id === guestId).connected, true);

  assert.equal((await ack(host, "game:start", {})).ok, true);
  let blindRuleVerified = false;
  let blindBottomVerified = false;
  while (true) {
    const current = await waitFor(hostView, (state) => ["blind_choice", "rubbing", "playing", "showdown", "finished"].includes(state.phase), "game state stalled");
    if (current.phase === "finished") break;
    if (current.phase === "blind_choice") {
      const actor = current.turnId === current.selfId ? host : guest;
      const actorView = actor === host ? hostView : guestView;
      const actorState = await waitFor(actorView, (state) => state.phase === "blind_choice" && state.blindChoice, "dealer blind choice missing");
      const potBeforeChoice = actorState.pot;
      const choice = !blindRuleVerified ? "blind_table" : !blindBottomVerified ? "blind_bottom" : "look";
      assert.equal((await ack(actor, "game:blind_choice", { choice })).ok, true);
      const rubbingState = await waitFor(hostView, (state) => state.phase === "playing", "betting did not start after dealer choice");
      if (!blindRuleVerified) {
        assert.equal(rubbingState.pot, potBeforeChoice * 2);
        assert.equal(rubbingState.blindTableOpened, true);
      }
      continue;
    }
    if (current.phase === "playing") {
      const actor = current.turnId === current.selfId ? host : guest;
      const actorView = actor === host ? hostView : guestView;
      if (!blindRuleVerified && current.blindTableOpened) {
        const actingState = await waitFor(actorView, (state) => state.phase === "playing" && state.turnId === current.turnId && state.actions, "blind follower actions missing");
        assert.equal(actingState.actions.call, false);
        assert.equal(actingState.actions.half, false);
        assert.equal(actingState.actions.raise, true);
        assert.equal(actingState.actions.fold, true);
        blindRuleVerified = true;
      } else if (!blindBottomVerified) {
        const actingState = await waitFor(actorView, (state) => state.phase === "playing" && state.turnId === current.turnId && state.actions, "blind bottom follower actions missing");
        if (actingState.actions.blindcall) {
          assert.equal(actingState.actions.call, true);
          assert.equal(actingState.actions.half, true);
          assert.equal(actingState.canViewCards, true);
          assert.equal((await ack(actor, "game:action", { action: "blindcall" })).ok, true);
          blindBottomVerified = true;
          continue;
        }
      }
      const actionState = await waitFor(actorView, (state) => state.phase === "playing" && state.turnId === current.turnId && state.actions, "actor actions missing");
      const action = actionState.actions.wait ? "wait" : "fold";
      assert.equal((await ack(actor, "game:action", { action })).ok, true);
      await waitFor(hostView, (state) => state.phase !== "playing", "round did not settle");
      continue;
    }
    if (current.phase === "showdown") {
      assert.equal((await ack(host, "game:next", {})).ok, true);
      await waitFor(hostView, (state) => state.phase !== "showdown", "next round did not start");
    }
  }
  assert.equal(blindRuleVerified, true);
  assert.equal(blindBottomVerified, true);
  assert.equal(hostView.state.gameNo, 5);
  assert.match(hostView.state.events.at(-1).text, /最终排名/);
});
