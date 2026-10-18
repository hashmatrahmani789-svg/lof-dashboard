# LOF Dashboard (Liquidity–Order Flow Confluence)

Pick any coin and see, on one screen:
- Coin info: market cap, FDV, MC/FDV, volume, 7d/30d, distance from ATH, OI/MC
- Bias: Daily + 4H EMA 12/21
- Location: premium / discount / OTE in the 4H range
- Key levels: PDH/PDL, PWH/PWL, previous day + week POC / VAH / VAL, with distance %
- Trade plan: setup (A sweep / B pullback / A+), LTF MSS, SL, TP1, TP2, R:R, score /9, checklist
- Derivatives: aggregated OI (1h/4h/24h change), OI-weighted funding + predicted, perp CVD, spot CVD, 24h liquidations, long/short ratio
- Regime read: NEW LONGS / SHORT SQUEEZE / NEW SHORTS / LONG FLUSH / ABSORPTION, plus crowding warnings
- Charts: price + OI, perp vs spot CVD, liquidations, per-exchange table

Data: Coinalyze (free API key) + CoinGecko (free).

---

## Option A: Put it online (open from phone or PC)

1. **Get your Coinalyze key:** sign in at coinalyze.net → Account → API key.
2. **Create a GitHub account** (github.com) if you don't have one.
3. **New repository** → name it `lof-dashboard` → set it **Private** → Create.
4. Click **Add file → Upload files** and upload: `app.py`, `engine.py`, `lwc.js`, `requirements.txt`, `README.md`. Commit.
5. Go to **share.streamlit.io** → sign in with GitHub → **Create app** → choose the repo, branch `main`, main file `app.py`.
6. Open **Advanced settings → Secrets** and paste (with your own values):
   ```
   COINALYZE_API_KEY = "your-coinalyze-key"
   APP_PASSWORD = "your-password"
   ```
7. Click **Deploy**. Bookmark the link. The app asks for your password.

## Option B: Run on your computer

1. Install Python 3.11+.
2. In the folder with the files, run:
   ```
   pip install -r requirements.txt
   ```
3. Create a folder `.streamlit` and inside it a file `secrets.toml` with the same two lines as above.
4. Run:
   ```
   streamlit run app.py
   ```
   It opens in your browser.

---

## Notes
- **Market Pulse** (top): Macro (DXY, US 2Y/10Y/30Y, VIX, oil), Sentiment (crypto Fear & Greed from alternative.me, stock Fear & Greed from CNN, VIX regime) and Crypto (ETH/BTC, total cap, TOTAL2, TOTAL3, BTC/ETH/USDT dominance). Each tile shows the daily change, 7-day change and a 7-day line. Dominance and market-cap lines are estimated from the top 10 coins. Use 'Open full chart' to open any macro item as a full page.
- **Watchlist**: pick assets in the sidebar (saved). Click a row to open it. Crypto rows use Coinalyze (about 4 calls each); Gold, Silver, S&P 500 and Nasdaq use Yahoo Finance futures (GC, SI, ES, NQ) — price, bias, levels, opens and structure only, no order flow.
- Futures are closed on weekends: levels and opens then use the last trading day.
- Coinalyze allows 40 calls/minute. One coin load uses about 24 calls (the chart about 8 more on another timeframe), and data is kept for 3 minutes. If you switch coins very fast you may see a short wait; the bottom of the page shows calls used.
- The entry timeframe (5m / 15m / 1h) is chosen in the sidebar. MSS, sweeps, SL and CVD use that timeframe.
- If the coin info at the top is wrong (two coins with the same ticker), type the CoinGecko ID in the sidebar (for example `pepe`).
- Tick "Liquidations / footprint confirm" after you check those yourself. It adds 1 point to the score.
- Funding is shown as % per funding interval.
- Not financial advice. Always confirm the setup on your chart.

- Chart layers (opens, Asia range, sessions, volume profiles, trade plan) are switched on/off above the chart. Your choices are saved in `lof_settings.json` next to `app.py`.
- Opens use New York time: NY midnight 00:00, London 03:00, NY 08:30. Daily open = 00:00 UTC. Asia range = 20:00–00:00 NY.
- D / W POC, VAH, VAL = previous UTC day / previous week (Mon–Sun UTC), from 30-minute candles of the main perp.
- Chart: TradingView Lightweight Charts (Apache-2.0, © TradingView), bundled as `lwc.js`.