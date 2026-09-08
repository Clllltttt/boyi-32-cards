(function () {
  "use strict";

  var STORAGE_KEY = "boyi32_sound_muted";
  var base = "assets/audio/";
  var clips = {
    shuffle: ["shuffle.mp3"],
    deal: ["deal-1.mp3", "deal-2.mp3", "deal-3.mp3"],
    rub: ["rub.mp3"],
    flip: ["flip.mp3"],
    bet: ["bet.mp3"],
    payout: ["payout.mp3"]
  };
  var volumes = { shuffle: .48, deal: .34, rub: .18, flip: .42, bet: .42, payout: .55 };
  var muted = false;
  var context = null;
  var rubAudio = null;
  var lastTick = null;

  try { muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_error) {}

  function ensureContext() {
    if (!context) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) context = new AudioContext();
    }
    if (context && context.state === "suspended") context.resume().catch(function () {});
    return context;
  }

  function unlock() {
    var ctx = ensureContext();
    if (!ctx) return;
    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    gain.gain.value = 0;
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(); oscillator.stop(ctx.currentTime + .01);
  }

  function play(name, options) {
    if (muted || !clips[name]) return null;
    options = options || {};
    var files = clips[name];
    var file = files[Math.floor(Math.random() * files.length)];
    var audio = new Audio(base + file);
    audio.preload = "auto";
    audio.volume = Math.max(0, Math.min(1, options.volume == null ? volumes[name] : options.volume));
    audio.playbackRate = options.rate || 1;
    audio.play().catch(function () {});
    return audio;
  }

  function tone(frequency, duration, volume, type, delay) {
    if (muted) return;
    var ctx = ensureContext();
    if (!ctx) return;
    var start = ctx.currentTime + (delay || 0);
    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(start); oscillator.stop(start + duration + .02);
  }

  function playCue(name) {
    if (name === "turn") {
      tone(660, .13, .055, "sine", 0); tone(880, .2, .06, "sine", .12);
    } else if (name === "win") {
      tone(523, .18, .055, "triangle", 0); tone(659, .2, .06, "triangle", .14); tone(784, .34, .07, "triangle", .29);
    } else if (name === "tick") {
      tone(900, .075, .035, "square", 0);
    }
  }

  function tick(seconds) {
    var value = Math.ceil(seconds);
    if (value > 5 || value <= 0 || value === lastTick) return;
    lastTick = value;
    playCue("tick");
  }

  function resetCountdown() { lastTick = null; }

  function startRub() {
    if (muted || rubAudio) return;
    rubAudio = new Audio(base + clips.rub[0]);
    rubAudio.loop = true; rubAudio.volume = volumes.rub; rubAudio.playbackRate = .72;
    rubAudio.play().catch(function () { rubAudio = null; });
  }

  function updateRub(ratio) {
    if (!rubAudio) return;
    rubAudio.playbackRate = .68 + Math.max(0, Math.min(1, ratio || 0)) * .55;
  }

  function stopRub() {
    if (!rubAudio) return;
    rubAudio.pause(); rubAudio.currentTime = 0; rubAudio = null;
  }

  function playDealSequence(count) {
    if (muted) return;
    var total = Math.max(1, Math.min(16, Number(count) || 1));
    for (var i = 0; i < total; i++) {
      (function (index) { setTimeout(function () { play("deal"); }, index * 105); })(i);
    }
  }

  function updateButton() {
    var button = document.getElementById("sound-toggle");
    if (!button) return;
    button.textContent = muted ? "🔇 音效关" : "🔊 音效开";
    button.setAttribute("aria-pressed", String(!muted));
    button.title = muted ? "开启游戏音效" : "关闭游戏音效";
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopRub();
    try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (_error) {}
    updateButton();
  }

  function mountToggle() {
    if (document.getElementById("sound-toggle")) return;
    var button = document.createElement("button");
    button.type = "button"; button.id = "sound-toggle"; button.className = "sound-toggle";
    button.onclick = function () { unlock(); setMuted(!muted); if (!muted) playCue("turn"); };
    document.body.appendChild(button);
    updateButton();
  }

  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountToggle);
  else mountToggle();

  window.GAME_AUDIO = {
    unlock: unlock,
    play: play,
    cue: playCue,
    tick: tick,
    resetCountdown: resetCountdown,
    startRub: startRub,
    updateRub: updateRub,
    stopRub: stopRub,
    playDealSequence: playDealSequence,
    setMuted: setMuted,
    isMuted: function () { return muted; }
  };
})();
