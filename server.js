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

function netWorth(player, room) {
  return player.cash + portfolio(player, room);
}

function roomState(room) {
  const players = Object.values(room.players).map(player => {
    const worth = netWorth(player, room);
    return {
      id: player.id,
      playerNumber: player.playerNumber,
      name: player.name,
      startingCash: player.startingCash,
      cash: player.cash,
      holdings: player.holdings,
      portfolio: portfolio(player, room),
      netWorth: worth,
      profit: worth - player.startingCash,
      trades: player.trades.slice(-8),
      connected: player.connected !== false
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
    const normalizedName = nickname.toLocaleLowerCase();
    const existingEntry = Object.entries(room.players).find(([, player]) =>
      player.name.toLocaleLowerCase() === normalizedName
    );

    let player;
    let reconnected = false;
    if (existingEntry) {
      const [oldId, existing] = existingEntry;
      if (existing.connected) {
        return fail(socket, "That player name is already connected. If this is your account, wait a moment and try again.");
      }
      delete room.players[oldId];
      player = existing;
      player.id = socket.id;
      player.connected = true;
      room.players[socket.id] = player;
      reconnected = true;
    } else {
      if (!Number.isFinite(capital) || capital <= 0 || capital > MAX_STARTING_CASH) {
        return fail(socket, "Enter a valid starting amount greater than zero for a new player.");
      }
      if (Object.keys(room.players).length >= 50) {
        return fail(socket, "Room is full (50 players maximum).");
      }
      player = {
        id: socket.id,
        playerNumber: room.nextPlayerNumber++,
        name: nickname,
        startingCash: capital,
        cash: capital,
        holdings: { BTC: 0, ETH: 0, SOL: 0, DOGE: 0 },
        trades: [],
        connected: true
      };
      room.players[socket.id] = player;
    }

    socket.join(key);
    socket.data.room = key;
    socket.data.role = "player";
    socket.emit("joined", {
      role: "player",
      key,
      name: player.name,
      playerNumber: player.playerNumber,
      startingCash: player.startingCash,
      reconnected
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

    if (side === "buy") {
      if (total > player.cash + 0.00001) return fail(socket, "Not enough available game coins.");
      player.cash -= total;
      player.holdings[symbol] += amount;
    } else if (side === "sell") {
      if (amount > player.holdings[symbol] + 1e-10) {
        return fail(socket, "You don't own enough of this crypto.");
      }
      player.holdings[symbol] -= amount;
      player.cash += total;
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
      time: new Date().toISOString(),
      cashAfter: player.cash,
      netWorthAfter: netWorth(player, room)
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
      total
    });
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.data.room];
    if (!room) return;
    if (socket.data.role === "player" && room.players[socket.id]) {
      room.players[socket.id].connected = false;
      room.players[socket.id].disconnectedAt = Date.now();
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => console.log("Crypto Bash running on " + PORT));
