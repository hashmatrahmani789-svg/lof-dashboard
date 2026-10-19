# LOF Dashboard (web version)

A fast trading dashboard for the Liquidity–Order Flow Confluence system.

- **Chart:** live Binance futures candles in your browser (every trade), TradingView Lightweight Charts, with all LOF layers and drawing tools.
- **Order flow:** OI, CVD (perp + spot), funding, liquidations and long/short from Coinalyze, summed across the main exchanges. Your API key stays on the server.
- **Analysis:** bias, premium/discount/OTE, levels, volume profiles, opens, Asia range, setups A / B / A+, trade plan and the 9-point checklist. It's the same engine as the old app.
- **Pro tools:** coin search (`/`), timeframe keys (`1`–`8`), full screen (`F`), status light, killzone timer, next USD news, screener, Market Pulse, Telegram and browser alerts, setup history with win rate, and Save to Notion journal.

## Deploy on Vercel (free)

1. Put this `web` folder inside your `lof-dashboard` folder, then push to GitHub (`git add .`, `git commit -m "web app"`, `git push`).
2. Go to **vercel.com** → sign in with GitHub → **Add New → Project** → import `lof-dashboard`.
3. Set **Root Directory** to `web`. Leave Framework Preset as **Other**. Don't change the build settings.
4. Open **Environment Variables** and add:
   - `COINALYZE_API_KEY` = your Coinalyze key
   - `APP_PASSWORD` = the password for the site
5. Click **Deploy**. Your link will look like `lof-dashboard.vercel.app`.

Updates: push to GitHub and Vercel redeploys automatically.

## Optional features

| Feature | Environment variables |
|---|---|
| Telegram alerts | `TELEGRAM_BOT_TOKEN` (from @BotFather), `TELEGRAM_CHAT_ID` (your chat id, from @userinfobot) |
| Save trades to Notion | `NOTION_TOKEN` (notion.so/my-integrations → New integration), `NOTION_DB_ID` (the id in your Trade Log database link). In Notion, open the database → ••• → Connections → add your integration. |
| CoinGecko key (optional) | `COINGECKO_API_KEY` |

After adding variables, go to **Deployments → ⋯ → Redeploy**.

Notion fields are matched by column name: Coin/Asset, Side/Direction, Setup, Entry, SL/Stop, TP/Target, TP2, R:R, Score, Timeframe, Date, Notes.

## Telegram alerts on your phone (even when the dashboard is closed)

1. In Telegram, open **@BotFather** → send `/newbot` → pick a name → copy the **token**.
2. Open your new bot and press **Start**. Then open **@userinfobot** → it shows your **chat id**.
3. Add three variables (Cursor terminal, inside the `web` folder):
   `npx vercel env add TELEGRAM_BOT_TOKEN production`, `npx vercel env add TELEGRAM_CHAT_ID production`, `npx vercel env add SCAN_KEY production` (any secret word).
   Optional: `WATCHLIST` (e.g. `BTC,ETH,SOL`), `SCAN_TF` (`5m`, `15m` or `1h`, default `15m`).
4. `npx vercel --prod`
5. Test: open `https://YOUR-SITE.vercel.app/api/scan?key=YOUR_SCAN_KEY&test=1`. You get a Telegram message.
6. Go to **cron-job.org** (free) → Create cronjob → URL `https://YOUR-SITE.vercel.app/api/scan?key=YOUR_SCAN_KEY` → every 5 minutes → Save.

You then get one message each time a watchlist market turns LONG or SHORT READY on a closed candle.

## Notes

- **Matching coinalyze.net:** order flow is summed across the markets listed under **Data sources** (top exchanges, USD). On coinalyze.net, use the aggregated chart with the same exchanges to see the same numbers. CVD starts at 0 on the first candle you can see, the same way Coinalyze draws it.
- **OI coverage:** Settings → Order flow coverage: OI from 6, 12 (default) or 20 perp markets. 20 is closest to coinalyze.net's aggregated OI. CVD always uses the top 6 perp + 3 spot markets.
- **Coinalyze limit:** 40 calls a minute, and each market counts as one call. One coin uses about 30 calls with 12 OI markets. Chart timeframes up to 4h are built from the entry-timeframe data, so they cost nothing extra. Data is cached on the server for 1–2 minutes. If you switch coins very fast, the order-flow panel can take up to a minute; the price chart is never delayed.
- **Live price:** Binance futures websocket (`/market` address). If your network blocks the websocket, the chart updates every 2 seconds instead (status shows "Live · 2s").
- **Screener** uses Binance data only (fast, no Coinalyze calls), so its score can differ by a point from the main view.
- **Gold, Silver, S&P 500, Nasdaq and macro** come from Yahoo Finance and update every 30 seconds. They have no order flow.
- **Alerts and setup history** run while the dashboard is open on your phone or PC. History is saved in that browser.
- **Settings and drawings** are saved in your browser.
- **Binance** must be reachable from your network for the chart.
- Chart: TradingView Lightweight Charts™ (Apache-2.0, © TradingView), bundled as `js/lwc.js`.
- Not financial advice. Confirm every setup on your chart.
