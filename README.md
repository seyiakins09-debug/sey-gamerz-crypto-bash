# SEY GAMERZ — Crypto Bash

Multiplayer simulated crypto-trading game built with Node.js, Express, and Socket.IO.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in a browser.

## Current game rules

- 10 sets, with 1 round per set.
- Each set lasts 20 minutes.
- Players choose their own positive starting amount of virtual game cash when joining.
- The market is simulated and includes Bitcoin (BTC), Ethereum (ETH), Solana (SOL), and Dogecoin (DOGE).
- No real-money deposits, wallets, or transactions are used.
- The host is a spectator and controls the game. The host cannot trade.

## Host dashboard

The host view omits the player trading terminal and personal portfolio summary. It includes a live trade-floor feed showing each player's number and name, whether they bought or sold, the coin and quantity, execution price, trade value, and time. The feed retains the latest 250 trade events for the current room.

## Deploy

Use `npm install` as the build/install command and `npm start` as the start command on a Node.js web service. The server listens on the `PORT` environment variable supplied by the host platform.
## Player reconnection

- If a phone call or temporary network interruption disconnects a player, the room keeps that player's game record instead of removing it.
- The browser automatically attempts to rejoin when its Socket.IO connection returns.
- If the player refreshes or reopens the game, use the **same room key and exact same nickname** to rejoin. The original player number, virtual cash, holdings, trade history, and progress are restored.
- A returning player does not need to re-enter starting capital; the saved original amount is kept.
- The host and leaderboard can see whether a player is online or disconnected.
- Reconnection works while the game server and room are still running. A server restart or an ended room cannot restore an in-memory room.


## Reconnection fix (updated)
- Fixed a startup bug where saved reconnect details could trigger a JavaScript error before the page initialized.
- Rejoining with the same room key and nickname now resumes the existing player even if the server has not yet processed the old socket's disconnect event.
- The old socket is replaced, while the original player number, virtual cash, holdings, trade history, and starting capital are retained.
- Reconnection requires the same running server process and an active room. Since room/player data is stored in server memory, a Render restart or game end still clears the room state.
