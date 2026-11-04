const socket = io();
let role = null;
let roomKey = null;
let state = null;
let selected = "BTC";
let toastTimer;
let lastSocketConnected = false;
const $ = id => document.getElementById(id);
let reconnectProfile = null;
try {
  reconnectProfile = JSON.parse(localStorage.getItem("seyGamerzReconnectProfile") || "null");
} catch (_) { reconnectProfile = null; }
if (reconnectProfile) {
  $("playerName").value = reconnectProfile.name || "";
  $("roomKey").value = reconnectProfile.key || "";
  $("startingCashInput").value = reconnectProfile.startingCash || "";
}
const fmt = value => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
}).format(value || 0);
const qty = value => Number(value || 0).toLocaleString("en-US", {
  maximumFractionDigits: 6
});
const coinMeta = {
  BTC: { name: "Bitcoin", icon: "₿" },
  ETH: { name: "Ethereum", icon: "Ξ" },
  SOL: { name: "Solana", icon: "◎" },
  DOGE: { name: "Dogecoin", icon: "Ð" }
};

function notice(message, error = false) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden", "error");
  if (error) $("toast").classList.add("error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 3500);
}

$("create").onclick = () => {
  localStorage.removeItem("seyGamerzReconnectProfile");
  reconnectProfile = null;
  socket.emit("createRoom", { name: $("hostName").value });
};
$("join").onclick = () => {
  const startingCash = Number($("startingCashInput").value);
  const name = $("playerName").value.trim();
  const key = $("roomKey").value.trim().toUpperCase();
  if (!name || !key) return notice("Enter your player name and current room key.", true);
  reconnectProfile = { name, key, startingCash };
  localStorage.setItem("seyGamerzReconnectProfile", JSON.stringify(reconnectProfile));
  socket.emit("joinRoom", { name, key, startingCash });
};

$("copyRoom").onclick = () => navigator.clipboard?.writeText(roomKey)
  .then(() => notice("Room key copied"))
  .catch(() => notice("Room key: " + roomKey));
$("startBtn").onclick = () => socket.emit("hostAction", { action: "start" });
$("pauseBtn").onclick = () => socket.emit("hostAction", { action: "pause" });
$("resumeBtn").onclick = () => socket.emit("hostAction", { action: "resume" });
$("nextBtn").onclick = () => socket.emit("hostAction", { action: "next" });
$("endBtn").onclick = () => {
  if (confirm("End the Crypto Bash game for everyone?")) {
    socket.emit("hostAction", { action: "end" });
  }
};

$("setSelect").innerHTML = Array.from({ length: 10 }, (_, index) =>
  `<option value="${index + 1}">Set ${String(index + 1).padStart(2, "0")}</option>`
).join("");
$("setSelect").onchange = () => socket.emit("hostAction", {
  action: "set",
  value: $("setSelect").value
});
$("buyBtn").onclick = () => trade("buy");
$("sellBtn").onclick = () => trade("sell");

function trade(side) {
  const amount = Number($("quantity").value);
  if (!amount || amount <= 0) return notice("Enter a quantity first.", true);
  socket.emit("trade", { side, symbol: selected, quantity: amount });
  $("quantity").value = "";
}

socket.on("joined", data => {
  role = data.role;
  roomKey = data.key;
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  document.body.classList.toggle("host-view", role === "host");
  $("roomDisplay").textContent = roomKey;
  $("roleLabel").textContent = role === "host" ? "HOST CONTROL TERMINAL" : "PLAYER TRADING TERMINAL";
  $("hostPanel").classList.toggle("hidden", role !== "host");

  if (role === "host") {
    $("tradePanel").classList.add("hidden");
    $("portfolioPanel").classList.add("hidden");
    $("historyEyebrow").textContent = "LIVE MARKET ACTIVITY";
    $("historyTitle").textContent = "PLAYER TRADE FLOOR";
    $("feedLiveTag").classList.remove("hidden");
    notice("Room created! Share key " + roomKey);
  } else {
    reconnectProfile = { name: data.name, key: data.key, startingCash: data.startingCash };
    localStorage.setItem("seyGamerzReconnectProfile", JSON.stringify(reconnectProfile));
    notice(data.reconnected
      ? `Welcome back, ${data.name}! Your previous game progress has been restored.`
      : `Joined room ${roomKey} — ${fmt(data.startingCash)} game cash ready.`);
  }
});

socket.on("connect", () => {
  if (lastSocketConnected && role === "player" && reconnectProfile) {
    notice("Connection restored. Rejoining your game…");
    socket.emit("joinRoom", reconnectProfile);
  }
  lastSocketConnected = true;
});
socket.on("disconnect", () => {
  if (role === "player") notice("Connection lost. Your game progress is being kept. Reconnecting…", true);
});
socket.on("notice", data => notice(data.message, data.type === "error"));
socket.on("state", nextState => {
  state = nextState;
  render();
});
socket.on("roundEnd", () => notice("Set finished! Host may move to the next set."));
socket.on("tradeNotice", data => {
  notice(`${data.player} ${data.side === "buy" ? "bought" : "sold"} ${qty(data.quantity)} ${data.symbol}`);
});

function render() {
  if (!state) return;

  $("roundDisplay").textContent = `${String(state.set).padStart(2, "0")} / 10`;
  $("setSelect").value = state.set;
  const seconds = Math.ceil(state.remaining / 1000);
  $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  $("startBtn").textContent = state.ended ? "GAME ENDED" : state.started ? "ROUND RUNNING" : "START ROUND";
  $("startBtn").disabled = state.started || state.ended;
  $("pauseBtn").disabled = !state.started || state.paused;
  $("resumeBtn").disabled = !state.started || !state.paused;
  $("nextBtn").disabled = state.set >= 10;

  $("coinTabs").innerHTML = Object.entries(state.coins).map(([symbol, coin]) =>
    `<button class="coin-tab ${symbol === selected ? "active" : ""}" data-coin="${symbol}">${symbol} ${fmt(coin.price)}</button>`
  ).join("");
  document.querySelectorAll("[data-coin]").forEach(button => {
    button.onclick = () => {
      selected = button.dataset.coin;
      render();
    };
  });

  const coin = state.coins[selected];
  $("chartPrice").textContent = fmt(coin.price);
  const firstPrice = coin.history[0] || coin.price;
  const change = (coin.price / firstPrice - 1) * 100;
  $("chartChange").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% since set`;
  $("chartChange").style.color = change >= 0 ? "#32d69a" : "#ff6475";
  $("selectedIcon").textContent = coinMeta[selected].icon;
  $("selectedName").textContent = coinMeta[selected].name;
  $("selectedSymbol").textContent = selected;
  $("selectedPrice").textContent = fmt(coin.price);
  drawChart(coin.history);

  const me = state.players.find(player => player.id === socket.id);
  if (me && role === "player") {
    $("cash").textContent = fmt(me.cash);
    $("portfolio").textContent = fmt(me.portfolio);
    $("netWorth").textContent = fmt(me.netWorth);
    $("cryptoValue").textContent = fmt(me.portfolio);
    $("pnl").textContent = `${me.profit >= 0 ? "+" : ""}${fmt(me.profit)}`;
    $("pnl").style.color = me.profit >= 0 ? "#32d69a" : "#ff6475";
    $("holdings").innerHTML = Object.entries(me.holdings).map(([symbol, amount]) =>
      `<div class="holding"><small>${symbol} HOLDING</small><b>${qty(amount)}</b><small>${fmt(amount * state.coins[symbol].price)}</small></div>`
    ).join("");
    $("history").innerHTML = me.trades.length
      ? me.trades.slice().reverse().map(item =>
        `<div class="trade-row"><span class="${item.side === "buy" ? "buy-text" : "sell-text"}">${item.side.toUpperCase()} ${qty(item.quantity)} ${item.symbol}</span><span>${fmt(item.total)}</span></div>`
      ).join("")
      : "No trades yet. Your activity will appear here.";
  }

  const rankedPlayers = state.players.slice().sort((a, b) => b.netWorth - a.netWorth);
  $("leaderboard").innerHTML = rankedPlayers.map((player, index) =>
    `<div class="leader-row"><span class="rank">#${index + 1}</span><div>${esc(player.name)} ${player.id === socket.id ? "<small>YOU</small>" : ""}<small>${player.connected === false ? "DISCONNECTED · " : "ONLINE · "}Cash ${fmt(player.cash)} · Crypto ${fmt(player.portfolio)}</small></div><strong style="color:${player.profit >= 0 ? "#32d69a" : "#ff6475"}">${player.profit >= 0 ? "+" : ""}${fmt(player.profit)}</strong></div>`
  ).join("") || "<p class='muted'>Waiting for players to join…</p>";

  if (role === "host") renderHostTradeFeed(state.tradeFeed || []);

  const active = state.started && !state.paused && !state.ended;
  $("buyBtn").disabled = role !== "player" || !active;
  $("sellBtn").disabled = role !== "player" || !active;
  $("quantity").disabled = role !== "player" || !active;
  $("tradeHint").textContent = state.ended
    ? "Game ended. Trading is closed."
    : state.paused
      ? "Round paused. Wait for host to resume."
      : !state.started
        ? "Waiting for host to start the round."
        : "Trading is live. All trades use virtual game coins.";
}

function renderHostTradeFeed(trades) {
  const buys = trades.filter(item => item.side === "buy").length;
  const sells = trades.length - buys;
  $("hostFeedSummary").classList.remove("hidden");
  $("hostFeedSummary").innerHTML = `
    <div class="feed-stat"><small>RECENT TRADES</small><strong>${trades.length}</strong></div>
    <div class="feed-stat"><small>BUY ORDERS</small><strong class="buy-text">${buys}</strong></div>
    <div class="feed-stat"><small>SELL ORDERS</small><strong class="sell-text">${sells}</strong></div>`;

  if (!trades.length) {
    $("history").innerHTML = '<div class="feed-empty"><strong>THE MARKET FLOOR IS QUIET</strong><span>Player purchases and sales will appear here live as soon as trading begins.</span></div>';
    return;
  }

  $("history").innerHTML = trades.slice().reverse().map(item => {
    const time = new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const action = item.side.toUpperCase();
    const number = String(item.playerNumber || 0).padStart(2, "0");
    return `<article class="host-trade-card">
      <div class="host-trade-top">
        <div class="host-player"><span class="player-number">PLAYER ${number}</span><strong>${esc(item.player)}</strong></div>
        <span class="trade-action ${item.side === "buy" ? "buy-action" : "sell-action"}">${action}</span>
      </div>
      <div class="host-trade-main"><strong>${qty(item.quantity)} <span>${esc(item.symbol)}</span></strong><b>${fmt(item.total)}</b></div>
      <div class="host-trade-meta"><span>${fmt(item.price)} per ${esc(item.symbol)}</span><time>${time}</time></div>
    </article>`;
  }).join("");
}

function drawChart(values) {
  const canvas = $("chart");
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 190;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  for (let index = 0; index < 4; index++) {
    context.strokeStyle = "#252c34";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, index * height / 3);
    context.lineTo(width, index * height / 3);
    context.stroke();
  }
  if (values.length < 2) return;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    max *= 1.001;
    min *= 0.999;
  }
  const points = values.map((value, index) => ({
    x: index / (values.length - 1) * width,
    y: height - 12 - (value - min) / (max - min) * (height - 24)
  }));
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  const rising = values.at(-1) >= values[0];
  context.strokeStyle = rising ? "#32d69a" : "#ff6475";
  context.lineWidth = 2.5;
  context.stroke();
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, rising ? "#32d69a30" : "#ff647530");
  gradient.addColorStop(1, "#10131800");
  context.fillStyle = gradient;
  context.fill();
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

setInterval(() => {
  if (state && state.started && !state.paused && !state.ended) {
    const seconds = Math.ceil(state.remaining / 1000) - 1;
    $("timer").textContent = `${String(Math.max(0, Math.floor(seconds / 60))).padStart(2, "0")}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;
  }
}, 1000);
