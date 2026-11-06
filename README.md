# SEY GAMERZ Crypto Bash

Multiplayer simulated crypto-trading game built with Express and Socket.IO.

## Run

```bash
npm install
npm start
```

Open the deployed URL, create a room as host, and share the room key with players. The host starts each round before players can trade.

## Financial accounting

- Starting cash is the player's initial virtual capital.
- Buying crypto deducts the purchase value from cash and adds the purchase value to that coin's cost basis.
- Holdings show units, average purchase price, cost basis, live price, market value, and unrealized profit/loss.
- Selling returns the sold units' original cost basis to cash. Realized profit is recorded separately and is not added to spendable cash.
- A realized loss is deducted from the principal returned to cash and tracked separately. It is not subtracted a second time from wealth.
- Host-issued rewards are recorded separately; they do not change cash or crypto holdings.
- Total Wealth = Cash Balance + Crypto Market Value + Realized Profit + Rewards Earned.
- Leaderboard ranks players by Total Wealth.
- Player and host trade histories show purchases, sales, principal returned, realized profit/loss, and rewards.

All currencies and trades are simulated virtual game values; no real money or actual cryptocurrency is involved.
