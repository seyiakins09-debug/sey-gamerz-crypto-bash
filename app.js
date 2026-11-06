const socket = io();
let role = null;
let roomKey = null;
let state = null;
let selected = "BTC";
let toastTimer;

const $ = id => document.getElementById(id);
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

$("create").onclick = () => socket.emit("createRoom", { name: $("hostName").value });
$("join").onclick = () => {
  const startingCash = Number($("startingCashInput").value);
  if (!Number.isFinite(startingCash) || startingCash <= 0) {
    notice("Enter the starting amount you want to bring into the game.", true);
    $("startingCashInput").focus();
    return;
  }
  socket.emit("joinRoom", {
    name: $("playerName").value,
    key: $("roomKey").value,
    startingCash
  });
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

$("awardReward").onclick = () => {
  const playerId = $("rewardPlayer").value;
  const amount = Number($("rewardAmount").value);
  if (!playerId) return notice("Select a player to reward.", true);
  if (!Number.isFinite(amount) || amount <= 0) return notice("Enter a valid reward amount.", true);
  socket.emit("awardReward", { playerId, amount });
  $("rewardAmount").value = "";
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
    notice(`Joined room ${roomKey} — ${fmt(data.startingCash)} game cash ready.`);
  }
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
    $("startingCash").textContent = fmt(me.startingCash);
    $("cashBalance").textContent = fmt(me.cash);
    $("cryptoValue").textContent = fmt(me.portfolio);
    $("totalProfit").textContent = fmt(me.totalProfit || 0);
    $("totalLoss").textContent = fmt(me.totalLoss || 0);
    $("rewardsEarned").textContent = fmt(me.rewardsEarned || 0);
    $("netWorth").textContent = fmt(me.totalWealth ?? me.netWorth);

    const details = me.holdingDetails || Object.entries(me.holdings || {}).map(([symbol, amount]) => ({
      symbol, quantity: amount, averageCost: 0, costBasis: 0,
      currentPrice: state.coins[symbol].price,
      marketValue: amount * state.coins[symbol].price,
      unrealizedProfitLoss: 0
    }));
    $("holdings").innerHTML = details.map(item => {
      const positive = item.unrealizedProfitLoss >= 0;
      return `<article class="holding-card">
        <div class="holding-top"><strong>${coinMeta[item.symbol]?.name || item.symbol}</strong><span>${item.symbol}</span></div>
        <div class="holding-quantity"><small>UNITS OWNED</small><b>${qty(item.quantity)}</b></div>
        <div class="holding-detail"><span>Average purchase</span><b>${fmt(item.averageCost)}</b></div>
        <div class="holding-detail"><span>Cost basis</span><b>${fmt(item.costBasis)}</b></div>
        <div class="holding-detail"><span>Current price</span><b>${fmt(item.currentPrice)}</b></div>
        <div class="holding-detail"><span>Market value</span><b>${fmt(item.marketValue)}</b></div>
        <div class="holding-detail unrealized ${positive ? "positive" : "negative"}"><span>Unrealized P/L</span><b>${positive ? "+" : "−"}${fmt(Math.abs(item.unrealizedProfitLoss))}</b></div>
      </article>`;
    }).join("");

    $("history").innerHTML = me.trades.length
      ? me.trades.slice().reverse().map(item => {
        const time = new Date(item.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        const outcome = item.side === "reward"
          ? `<span class="history-outcome positive">Reward earned +${fmt(item.rewardAmount || item.total)} · cash unchanged</span>`
          : item.realizedProfit > 0
          ? `<span class="history-outcome positive">Realized profit +${fmt(item.realizedProfit)}</span>`
          : item.realizedLoss > 0
            ? `<span class="history-outcome negative">Realized loss −${fmt(item.realizedLoss)}</span>`
            : item.side === "buy" ? `<span class="history-outcome">Cost basis added ${fmt(item.total)}</span>` : `<span class="history-outcome">Principal returned ${fmt(item.principalReturned || 0)}</span>`;
        return `<article class="player-trade-card">
          <div class="trade-card-heading"><strong class="${item.side === "buy" ? "buy-text" : item.side === "reward" ? "reward-text" : "sell-text"}">${item.side === "reward" ? "REWARD" : `${item.side.toUpperCase()} ${qty(item.quantity)} ${item.symbol}`}</strong><time>${time}</time></div>
          <div class="trade-card-values"><span>Execution price <b>${fmt(item.price)}</b></span><span>Trade value <b>${fmt(item.total)}</b></span></div>
          ${outcome}
          <small class="trade-cash-after">Cash balance after trade: ${fmt(item.cashAfter)}</small>
        </article>`;
      }).join("")
      : "No trades yet. Your activity will appear here.";
  }

  if (role === "host") {
    const selectedRewardPlayer = $("rewardPlayer").value;
    $("rewardPlayer").innerHTML = '<option value="">Select player</option>' + state.players.map(player =>
      `<option value="${player.id}">${esc(player.name)} (Player ${String(player.playerNumber).padStart(2, "0")})</option>`
    ).join("");
    if (state.players.some(player => player.id === selectedRewardPlayer)) $("rewardPlayer").value = selectedRewardPlayer;
  }

  const rankedPlayers = state.players.slice().sort((a, b) => (b.totalWealth ?? b.netWorth) - (a.totalWealth ?? a.netWorth));
  $("leaderboard").innerHTML = rankedPlayers.map((player, index) =>
    `<div class="leader-row"><span class="rank">#${index + 1}</span><div>${esc(player.name)} ${player.id === socket.id ? "<small>YOU</small>" : ""}<small>${player.connected === false ? "OFFLINE · " : "ONLINE · "}Cash ${fmt(player.cash)} · Crypto ${fmt(player.portfolio)} · Profit ${fmt(player.totalProfit || 0)} · Rewards ${fmt(player.rewardsEarned || 0)}</small></div><strong class="leader-wealth">${fmt(player.totalWealth ?? player.netWorth)}</strong></div>`
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
  const rewards = trades.filter(item => item.side === "reward").length;
  const sells = trades.filter(item => item.side === "sell").length;
  $("hostFeedSummary").classList.remove("hidden");
  $("hostFeedSummary").innerHTML = `
    <div class="feed-stat"><small>RECENT TRADES</small><strong>${trades.length}</strong></div>
    <div class="feed-stat"><small>BUY ORDERS</small><strong class="buy-text">${buys}</strong></div>
    <div class="feed-stat"><small>SELL ORDERS</small><strong class="sell-text">${sells}</strong></div>
    <div class="feed-stat"><small>REWARDS</small><strong class="reward-text">${rewards}</strong></div>`;

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
        <span class="trade-action ${item.side === "buy" ? "buy-action" : item.side === "reward" ? "reward-action" : "sell-action"}">${item.side === "reward" ? "REWARD" : action}</span>
      </div>
      <div class="host-trade-main"><strong>${item.side === "reward" ? "Reward" : `${qty(item.quantity)} <span>${esc(item.symbol)}</span>`}</strong><b>${fmt(item.total)}</b></div>
      <div class="host-trade-meta"><span>${fmt(item.price)} per ${esc(item.symbol)} · Cash ${fmt(item.cashAfter)}</span><time>${time}</time></div>
      ${item.side === "reward" ? `<div class="host-realized positive">Reward recorded separately · cash unchanged</div>` : item.realizedProfit > 0 ? `<div class="host-realized positive">Realized profit +${fmt(item.realizedProfit)}</div>` : item.realizedLoss > 0 ? `<div class="host-realized negative">Realized loss −${fmt(item.realizedLoss)}</div>` : item.side === "sell" ? `<div class="host-realized">Principal returned ${fmt(item.principalReturned || 0)}</div>` : `<div class="host-realized">Purchase cost added to holdings</div>`}
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
