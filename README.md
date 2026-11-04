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
