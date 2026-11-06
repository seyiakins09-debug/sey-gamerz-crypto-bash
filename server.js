const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ROUND_MS = 20 * 60 * 1000;
const MAX_STARTING_CASH = Number.MAX_SAFE_INTEGER;
const MAX_TRADE_FEED = 250;

const COINS = {
  BTC: { name: "Bitcoin", symbol: "BTC", price: 65000, vol: 0.018 },
  ETH: { name: "Ethereum", symbol: "ETH", price: 3400, vol: 0.025 },
  SOL: { name: "Solana", symbol: "SOL", price: 165, vol: 0.04 },
  DOGE: { name: "Dogecoin", symbol: "DOGE", price: 0.18, vol: 0.055 }
};

const rooms = {};
const fmtReward = value => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function newRoom(key, hostId) {
  const coins = {};
  for (const [symbol, coin] of Object.entries(COINS)) {
    coins[symbol] = { ...coin, history: [coin.price] };
  }

  return (rooms[key] = {
    key,
    hostId,
    hostName: "HOST",
    players: {},
    nextPlayerNumber: 1,
    tradeFeed: [],
    tradeCount: 0,
    set: 1,
    round: 1,
    started: false,
    paused: false,
    ended: false,
    deadline: null,
    remaining: ROUND_MS,
    coins,
    interval: null
  });
}

function portfolio(player, room) {
  return Object.entries(player.holdings).reduce(
    (total, [symbol, quantity]) => total + quantity * room.coins[symbol].price,
    0
  );
}

function holdingDetails(player, room) {
  return Object.entries(player.holdings).map(([symbol, quantity]) => {
    const basis = player.costBasis[symbol] || 0;
    const marketValue = quantity * room.coins[symbol].price;
    return {
      symbol,
      quantity,
      averageCost: quantity > 0 ? basis / quantity : 0,
      costBasis: basis,
      currentPrice: room.coins[symbol].price,
      marketValue,
      unrealizedProfitLoss: marketValue - basis
    };
  });
}

// Wealth follows the agreed SEY GAMERZ accounting model:
// cash + current crypto value + realized profit + separate rewards.
// Realized losses have already reduced cash, so they are not subtracted again.
function totalWealth(player, room) {
  return player.cash + portfolio(player, room) + player.totalProfit + player.rewardsEarned;
}

function roomState(room) {
  const players = Object.values(room.players).map(player => {
    // Compatibility defaults for players reconnecting to an older room state.
    player.costBasis ||= { BTC: 0, ETH: 0, SOL: 0, DOGE: 0 };
    player.totalProfit ||= 0;
    player.totalLoss ||= 0;
    player.rewardsEarned ||= 0;
    const cryptoValue = portfolio(player, room);
    const worth = totalWealth(player, room);
    return {
      id: player.id,
      playerNumber: player.playerNumber,
      name: player.name,
      startingCash: player.startingCash,
      cash: player.cash,
      holdings: player.holdings,
      holdingDetails: holdingDetails(player, room),
      portfolio: cryptoValue,
      totalProfit: player.totalProfit,
      totalLoss: player.totalLoss,
      rewardsEarned: player.rewardsEarned,
      totalWealth: worth,
      netWorth: worth,
      profit: worth - player.startingCash,
      trades: player.trades.slice(-50)
    };
  });

  return {
    key: room.key,
    set: room.set,
    round: room.round,
    started: room.started,
    paused: room.paused,
    ended: room.ended,
    remaining:
      room.started && !room.paused && !room.ended
        ? Math.max(0, room.deadline - Date.now())
        : room.remaining,
    coins: room.coins,
    players,
    tradeFeed: room.tradeFeed
  };
}

function emitRoom(room) {
  io.to(room.key).emit("state", roomState(room));
}

function fail(socket, message) {
  socket.emit("notice", { type: "error", message });
}

function tick(room) {
  if (!room.started || room.paused || room.ended) return;

  const now = Date.now();
  for (const coin of Object.values(room.coins)) {
    const drift = (Math.random() - 0.49) * coin.vol;
    const jump = Math.random() < 0.025 ? (Math.random() - 0.5) * coin.vol * 3 : 0;
    coin.price = Math.max(coin.price * 0.02, coin.price * (1 + drift + jump));
    coin.history.push(coin.price);
    if (coin.history.length > 90) coin.history.shift();
  }

  room.remaining = Math.max(0, room.deadline - now);
  if (room.remaining <= 0) {
    room.ended = true;
    room.started = false;
    clearInterval(room.interval);
    room.interval = null;
    io.to(room.key).emit("roundEnd", roomState(room));
  }
  emitRoom(room);
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}) => {
    let key;
    do {
      key = Math.random().toString(36).slice(2, 7).toUpperCase();
    } while (rooms[key]);

    const room = newRoom(key, socket.id);
    room.hostName = (name || "Host").trim().slice(0, 24) || "Host";
    socket.join(key);
    socket.data.room = key;
    socket.data.role = "host";
    socket.emit("joined", { role: "host", key, name: room.hostName });
    emitRoom(room);
  });

  socket.on("joinRoom", ({ key, name, startingCash } = {}) => {
    key = (key || "").trim().toUpperCase();
    const room = rooms[key];
    if (!room) return fail(socket, "Room key not found.");
    if (room.ended) return fail(socket, "This game has ended.");
    if (Object.keys(room.players).length >= 50) {
      return fail(socket, "Room is full (50 players maximum).");
    }

    const nickname = (name || "Player").trim().slice(0, 24) || "Player";
    const capital = Number(startingCash);
    if (!Number.isFinite(capital) || capital <= 0 || capital > MAX_STARTING_CASH) {
      return fail(socket, "Enter a valid starting amount greater than zero.");
    }

    const id = socket.id;
    const playerNumber = room.nextPlayerNumber++;
    room.players[id] = {
      id,
      playerNumber,
      name: nickname,
      startingCash: capital,
      cash: capital,
      holdings: { BTC: 0, ETH: 0, SOL: 0, DOGE: 0 },
      trades: []
    };

    socket.join(key);
    socket.data.room = key;
    socket.data.role = "player";
    socket.emit("joined", {
      role: "player",
      key,
      name: nickname,
      playerNumber,
      startingCash: capital
    });
    emitRoom(room);
  });

  socket.on("hostAction", ({ action, value } = {}) => {
    const room = rooms[socket.data.room];
    if (!room || socket.data.role !== "host" || room.hostId !== socket.id) return;

    if (action === "start") {
      if (room.ended) return;
      room.started = true;
      room.paused = false;
      room.deadline = Date.now() + room.remaining;
      if (!room.interval) room.interval = setInterval(() => tick(room), 1000);
    }

    if (action === "pause" && room.started && !room.paused) {
      room.remaining = Math.max(0, room.deadline - Date.now());
      room.paused = true;
    }

    if (action === "resume" && room.started && room.paused) {
      room.paused = false;
      room.deadline = Date.now() + room.remaining;
    }

    if (action === "next" || action === "set") {
      if (room.interval) clearInterval(room.interval);
      room.interval = null;
      room.set = action === "set"
        ? Math.min(10, Math.max(1, Number(value) || 1))
        : Math.min(10, room.set + 1);
      room.round = room.set;
      room.started = false;
      room.paused = false;
      room.ended = false;
      room.remaining = ROUND_MS;
      room.deadline = null;
    }

    if (action === "end") {
      room.ended = true;
      room.started = false;
      room.paused = false;
      if (room.interval) clearInterval(room.interval);
      room.interval = null;
    }

    emitRoom(room);
  });

  socket.on("awardReward", ({ playerId, amount } = {}) => {
    const room = rooms[socket.data.room];
    if (!room || socket.data.role !== "host" || room.hostId !== socket.id || room.ended) return;
    const player = room.players[playerId];
    const reward = Number(amount);
    if (!player) return fail(socket, "Choose a player to reward.");
    if (!Number.isFinite(reward) || reward <= 0 || reward > MAX_STARTING_CASH) {
      return fail(socket, "Enter a valid reward amount greater than zero.");
    }
    player.rewardsEarned ||= 0;
    player.trades ||= [];
    player.rewardsEarned += reward;
    const record = {
      tradeNumber: ++room.tradeCount,
      playerNumber: player.playerNumber,
      player: player.name,
      side: "reward",
      symbol: "REWARD",
      quantity: reward,
      price: reward,
      total: reward,
      principalReturned: 0,
      realizedProfit: 0,
      realizedLoss: 0,
      rewardAmount: reward,
      time: new Date().toISOString(),
      cashAfter: player.cash,
      portfolioAfter: portfolio(player, room),
      totalWealthAfter: totalWealth(player, room)
    };
    player.trades.push(record);
    room.tradeFeed.push(record);
    if (room.tradeFeed.length > MAX_TRADE_FEED) room.tradeFeed.shift();
    io.to(room.key).emit("tradeNotice", { player: player.name, side: "reward", symbol: "REWARD", quantity: reward, total: reward });
    emitRoom(room);
    socket.emit("notice", { type: "success", message: `Rewarded ${player.name} ${fmtReward(reward)}.` });
  });

  socket.on("trade", ({ side, symbol, quantity } = {}) => {
    const room = rooms[socket.data.room];
    const player = room && room.players[socket.id];
    if (!room || !player || socket.data.role !== "player") return;
    if (!room.started || room.paused || room.ended) {
      return fail(socket, "Trading is available only while the round is running.");
    }

    const coin = room.coins[symbol];
    const amount = Number(quantity);
    if (!coin || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
      return fail(socket, "Enter a valid quantity.");
    }

    const total = amount * coin.price;
    if (!Number.isFinite(total)) return fail(socket, "That trade amount is too large.");

    player.costBasis ||= { BTC: 0, ETH: 0, SOL: 0, DOGE: 0 };
    player.totalProfit ||= 0;
    player.totalLoss ||= 0;
    player.rewardsEarned ||= 0;

    let principalReturned = 0;
    let realizedProfit = 0;
    let realizedLoss = 0;

    if (side === "buy") {
      if (total > player.cash + 0.00001) return fail(socket, "Not enough available game coins.");
      const oldQuantity = player.holdings[symbol];
      player.cash -= total;
      player.holdings[symbol] += amount;
      player.costBasis[symbol] += total;
      const newQuantity = player.holdings[symbol];
      // Keep the weighted-average basis stable for partial and repeated buys.
      if (!Number.isFinite(newQuantity) || newQuantity <= 0) return fail(socket, "Invalid holding quantity.");
    } else if (side === "sell") {
      if (amount > player.holdings[symbol] + 1e-10) {
        return fail(socket, "You don't own enough of this crypto.");
      }
      const held = player.holdings[symbol];
      const basisBeforeSale = player.costBasis[symbol] || 0;
      const averageCost = held > 0 ? basisBeforeSale / held : 0;
      principalReturned = Math.min(basisBeforeSale, averageCost * amount);
      const difference = total - principalReturned;
      if (difference >= 0) {
        realizedProfit = difference;
        player.totalProfit += realizedProfit;
        // Profit is tracked separately and is not added to spendable cash.
        player.cash += principalReturned;
      } else {
        realizedLoss = -difference;
        player.totalLoss += realizedLoss;
        // Loss reduces the returned principal and is also recorded separately.
        player.cash += principalReturned - realizedLoss;
      }
      player.holdings[symbol] = Math.max(0, held - amount);
      player.costBasis[symbol] = Math.max(0, basisBeforeSale - principalReturned);
      if (player.holdings[symbol] < 1e-10) {
        player.holdings[symbol] = 0;
        player.costBasis[symbol] = 0;
      }
    } else {
      return;
    }

    const trade = {
      tradeNumber: ++room.tradeCount,
      playerNumber: player.playerNumber,
      player: player.name,
      side,
      symbol,
      quantity: amount,
      price: coin.price,
      total,
      principalReturned,
      realizedProfit,
      realizedLoss,
      time: new Date().toISOString(),
      cashAfter: player.cash,
      portfolioAfter: portfolio(player, room),
      totalWealthAfter: totalWealth(player, room)
    };
    player.trades.push(trade);
    room.tradeFeed.push(trade);
    if (room.tradeFeed.length > MAX_TRADE_FEED) room.tradeFeed.shift();

    io.to(room.key).emit("tradeNotice", {
      player: player.name,
      side,
      symbol,
      quantity: amount,
      price: coin.price,
      total,
      principalReturned,
      realizedProfit,
      realizedLoss
    });
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.data.room];
    if (!room) return;
    if (socket.data.role === "player" && room.players[socket.id]) {
      delete room.players[socket.id];
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => console.log("Crypto Bash running on " + PORT));
