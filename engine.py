"""
LOF Dashboard engine
Data: Coinalyze (derivatives + candles) and CoinGecko (coin info).
Analysis: bias, levels, premium/discount, sweeps, MSS, order flow regime, trade plan.
"""
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

CZ_BASE = "https://api.coinalyze.net/v1/"
CG_BASE = "https://api.coingecko.com/api/v3/"

PERP_EXCH_PREF = ["binance", "bybit", "okx", "bitget", "gate", "bingx", "mexc", "kucoin"]
SPOT_EXCH_PREF = ["binance", "coinbase", "bybit", "okx", "kraken", "bitget"]
SPOT_QUOTES = {"USDT", "USD", "USDC", "FDUSD"}
INTERVAL_SECONDS = {"5min": 300, "15min": 900, "30min": 1800, "1hour": 3600, "2hour": 7200, "4hour": 14400,
                    "12hour": 43200, "daily": 86400}
CHART_TF = {"5m": "5min", "15m": "15min", "30m": "30min", "1h": "1hour", "2h": "2hour", "4h": "4hour",
            "12h": "12hour", "1D": "daily"}
NAN = float("nan")


class CoinalyzeError(Exception):
    pass


# ════════════════════════════════════════════════════════════════
# COINALYZE
# ════════════════════════════════════════════════════════════════
_CALLS = []          # (timestamp, calls used) for the 40 calls/min budget
_LOCK = threading.Lock()


def calls_last_minute():
    now = time.time()
    with _LOCK:
        _CALLS[:] = [c for c in _CALLS if now - c[0] < 60]
        return sum(n for _, n in _CALLS)


def cz_get(endpoint, api_key, params=None, retries=3):
    n = len(str((params or {}).get("symbols", "x")).split(","))
    for _ in range(retries):
        r = requests.get(CZ_BASE + endpoint, params=params or {}, headers={"api_key": api_key}, timeout=25)
        with _LOCK:
            _CALLS.append((time.time(), n))
        if r.status_code == 429:
            wait = float(r.headers.get("Retry-After", 5) or 5)
            time.sleep(min(max(wait, 1), 15))
            continue
        if r.status_code == 401:
            raise CoinalyzeError("Invalid or missing Coinalyze API key.")
        if r.status_code >= 400:
            raise CoinalyzeError(f"Coinalyze error {r.status_code} on {endpoint}: {r.text[:200]}")
        return r.json()
    raise CoinalyzeError("Coinalyze limit reached (40 calls per minute). Wait about a minute, then click Refresh.")


def _rank(name, pref):
    n = (name or "").lower()
    for i, p in enumerate(pref):
        if p in n:
            return i
    return len(pref) + 1


def load_markets(api_key):
    exch = cz_get("exchanges", api_key)
    names = {e["code"]: e["name"] for e in exch}
    fut = cz_get("future-markets", api_key)
    spot = cz_get("spot-markets", api_key)
    return names, fut, spot


def coin_list(fut):
    return sorted({m["base_asset"] for m in fut if m.get("is_perpetual") and m.get("margined") == "STABLE"})


def pick_perps(fut, names, coin, n=3):
    c = [m for m in fut
         if m.get("base_asset") == coin and m.get("is_perpetual") and m.get("margined") == "STABLE"
         and m.get("has_ohlcv_data") and m.get("has_buy_sell_data")]
    c.sort(key=lambda m: _rank(names.get(m["exchange"], m["exchange"]), PERP_EXCH_PREF))
    out, seen = [], set()
    for m in c:
        if m["exchange"] in seen:
            continue
        seen.add(m["exchange"])
        out.append(m)
        if len(out) == n:
            break
    return out


OI_EXCH_PREF = ["binance", "bybit", "okx", "bitget", "gate", "hyperliquid", "deribit", "bitmex", "htx", "huobi",
                "kucoin", "bingx", "mexc", "kraken", "coinbase"]


def pick_oi_markets(fut, names, coin, perp_syms, n=8):
    """Perps used for aggregated OI: the main perps first, then other exchanges and coin-margined contracts."""
    c = [m for m in fut if m.get("base_asset") == coin and m.get("is_perpetual") and m["symbol"] not in perp_syms]
    c.sort(key=lambda m: (_rank(names.get(m["exchange"], m["exchange"]), OI_EXCH_PREF), m.get("margined") != "STABLE"))
    return list(perp_syms) + [m["symbol"] for m in c][:max(0, n - len(perp_syms))]


def pick_spots(spot, names, coin, n=2):
    c = [m for m in spot
         if m.get("base_asset") == coin and m.get("quote_asset") in SPOT_QUOTES and m.get("has_buy_sell_data")]
    c.sort(key=lambda m: _rank(names.get(m["exchange"], m["exchange"]), SPOT_EXCH_PREF))
    out, seen = [], set()
    for m in c:
        if m["exchange"] in seen:
            continue
        seen.add(m["exchange"])
        out.append(m)
        if len(out) == n:
            break
    return out


def _hist(data):
    out = {}
    for item in data or []:
        df = pd.DataFrame(item.get("history", []))
        if not df.empty:
            df["t"] = pd.to_datetime(df["t"], unit="s", utc=True)
            df = df.sort_values("t").reset_index(drop=True)
        out[item["symbol"]] = df
    return out


def fetch_history(endpoint, api_key, symbols, interval, seconds_back, **extra):
    if not symbols:
        return {}
    now = int(time.time())
    params = {"symbols": ",".join(symbols), "interval": interval, "from": now - seconds_back, "to": now, **extra}
    return _hist(cz_get(endpoint, api_key, params))


def fetch_current(endpoint, api_key, symbols):
    if not symbols:
        return {}
    data = cz_get(endpoint, api_key, {"symbols": ",".join(symbols)})
    return {d["symbol"]: d.get("value") for d in data}


def _parallel(jobs):
    """Run several API requests at the same time. jobs: {name: (func, args, kwargs)}"""
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {k: ex.submit(f, *a, **kw) for k, (f, a, kw) in jobs.items()}
        return {k: f.result() for k, f in futs.items()}


def load_bundle(api_key, perp_syms, spot_syms, ltf, ls_symbol, oi_syms=None):
    """~24 API calls (3 perps + 2 spot + 8 OI markets), fetched in parallel. Limit is 40 calls/min."""
    main = perp_syms[0]
    ltf_s = INTERVAL_SECONDS[ltf]
    empty = pd.DataFrame()
    H = fetch_history
    jobs = {
        "ltf_perp": (H, ("ohlcv-history", api_key, perp_syms, ltf, ltf_s * 400), {}),
        "ltf_spot": (H, ("ohlcv-history", api_key, spot_syms, ltf, ltf_s * 400), {}),
        "daily": (H, ("ohlcv-history", api_key, [main], "daily", 86400 * 150), {}),
        "h4": (H, ("ohlcv-history", api_key, [main], "4hour", 14400 * 200), {}),
        "m30": (H, ("ohlcv-history", api_key, [main], "30min", 86400 * 15), {}),
        "oi": (H, ("open-interest-history", api_key, list(oi_syms or perp_syms), "1hour", 3600 * 74),
               {"convert_to_usd": "true"}),
        "funding": (fetch_current, ("funding-rate", api_key, perp_syms), {}),
        "pred_funding": (fetch_current, ("predicted-funding-rate", api_key, [main]), {}),
        "liq": (H, ("liquidation-history", api_key, perp_syms, "1hour", 3600 * 26), {"convert_to_usd": "true"}),
    }
    if ls_symbol:
        jobs["ls"] = (H, ("long-short-ratio-history", api_key, [ls_symbol], "1hour", 3600 * 26), {})
    res = _parallel(jobs)
    b = dict(res)
    for k in ("daily", "h4", "m30"):
        b[k] = res[k].get(main, empty)
    b["ls"] = res["ls"].get(ls_symbol, empty) if ls_symbol else None
    b["fetched_at"] = datetime.now(timezone.utc)
    return b


def load_chart(api_key, perp_syms, spot_syms, interval, bars=300, candles=True,
               want_spot=True, want_oi=True, want_liq=False, oi_syms=None):
    """Data for the chart panes at any timeframe, fetched in parallel."""
    back = INTERVAL_SECONDS[interval] * bars
    H = fetch_history
    jobs = {}
    if candles:
        jobs["perp"] = (H, ("ohlcv-history", api_key, perp_syms, interval, back), {})
        if want_spot:
            jobs["spot"] = (H, ("ohlcv-history", api_key, spot_syms, interval, back), {})
    if want_oi:
        jobs["oi"] = (H, ("open-interest-history", api_key, list(oi_syms or perp_syms), interval, back),
                      {"convert_to_usd": "true"})
    if want_liq:
        jobs["liq"] = (H, ("liquidation-history", api_key, perp_syms, interval, back), {"convert_to_usd": "true"})
    res = _parallel(jobs) if jobs else {}
    return {k: res.get(k, {}) for k in ("perp", "spot", "oi", "liq")}


# ════════════════════════════════════════════════════════════════
# COINGECKO
# ════════════════════════════════════════════════════════════════
def cg_symbol(coin):
    m = re.match(r"^(1000000|100000|10000|1000|1M)([A-Z].*)$", coin)
    return (m.group(2) if m else coin).lower()


def cg_overview(coin, override_id="", cg_key=""):
    headers = {"x-cg-demo-api-key": cg_key} if cg_key else {}
    try:
        cid = override_id.strip()
        if not cid:
            sym = cg_symbol(coin)
            r = requests.get(CG_BASE + "search", params={"query": sym}, headers=headers, timeout=8)
            r.raise_for_status()
            hits = [c for c in r.json().get("coins", []) if (c.get("symbol") or "").lower() == sym]
            if not hits:
                return None
            hits.sort(key=lambda c: c.get("market_cap_rank") or 10**9)
            cid = hits[0]["id"]
        r = requests.get(CG_BASE + f"coins/{cid}", headers=headers, timeout=8, params={
            "localization": "false", "tickers": "false", "community_data": "false",
            "developer_data": "false", "sparkline": "false"})
        r.raise_for_status()
        j = r.json()
        md = j.get("market_data", {})
        usd = lambda k: (md.get(k) or {}).get("usd")
        price, circ, mx, tot = usd("current_price"), md.get("circulating_supply"), md.get("max_supply"), md.get("total_supply")
        fdv = usd("fully_diluted_valuation")
        if price and mx:
            fdv = price * mx                       # true FDV: price x max supply
        elif price and tot:
            fdv = price * tot
        return {
            "inflationary": not mx,
            "id": cid, "name": j.get("name"), "rank": j.get("market_cap_rank"),
            "categories": [c for c in (j.get("categories") or []) if c][:3],
            "price": usd("current_price"), "mcap": usd("market_cap"), "fdv": fdv,
            "volume": usd("total_volume"), "ath": usd("ath"), "ath_chg": usd("ath_change_percentage"),
            "chg_24h": md.get("price_change_percentage_24h"), "chg_7d": md.get("price_change_percentage_7d"),
            "chg_30d": md.get("price_change_percentage_30d"),
            "circ": md.get("circulating_supply"), "total": md.get("total_supply"), "max": md.get("max_supply"),
        }
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════
# ANALYSIS HELPERS
# ════════════════════════════════════════════════════════════════
def _nan(x):
    return x is None or (isinstance(x, float) and math.isnan(x))


def bias_from(closes, price, fast=12, slow=21):
    if closes is None or len(closes) < slow:
        return NAN, NAN, 0
    e1 = closes.ewm(span=fast, adjust=False).mean().iloc[-1]
    e2 = closes.ewm(span=slow, adjust=False).mean().iloc[-1]
    b = 1 if price > e1 > e2 else -1 if price < e1 < e2 else 0
    return float(e1), float(e2), b


def profile_rows(df, bins=40, va=0.70):
    """Volume profile split into buy (up-candle) and sell (down-candle) volume per price row."""
    if df is None or df.empty:
        return None
    hi, lo = float(df["h"].max()), float(df["l"].min())
    if not hi > lo:
        return None
    step = (hi - lo) / bins
    up, dn = np.zeros(bins), np.zeros(bins)
    vols = df["v"].fillna(0).clip(lower=0) if "v" in df else pd.Series(1.0, index=df.index)
    for o, h, l, c, v in zip(df["o"], df["h"], df["l"], df["c"], vols):
        b0 = int(np.clip(np.floor((l - lo) / step), 0, bins - 1))
        b1 = int(np.clip(np.floor((h - lo) / step), 0, bins - 1))
        (up if c >= o else dn)[b0:b1 + 1] += v / (b1 - b0 + 1)
    hist = up + dn
    if hist.sum() <= 0:
        return None
    pi = int(hist.argmax())
    total, acc, u, d = hist.sum(), hist[pi], pi, pi
    while acc < total * va and (u < bins - 1 or d > 0):
        vu = hist[u + 1] if u < bins - 1 else -1
        vd = hist[d - 1] if d > 0 else -1
        if vu >= vd:
            u += 1
            acc += vu
        else:
            d -= 1
            acc += vd
    return dict(lo=lo, step=step, up=up.tolist(), dn=dn.tolist(),
                poc=lo + step * (pi + 0.5), vah=lo + step * (u + 1), val=lo + step * d)


def volume_profile(df, bins=40, va=0.70):
    p = profile_rows(df, bins, va)
    return (NAN, NAN, NAN) if p is None else (p["poc"], p["vah"], p["val"])


def session_profiles(m30, now):
    """Previous UTC day and previous week (Mon-Sun UTC) profiles with their time ranges."""
    out = {}
    if m30 is None or m30.empty:
        return out
    day0 = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    week0 = day0 - timedelta(days=day0.weekday())
    pday = day0 - timedelta(days=1)
    for _ in range(7):                       # last UTC day that has candles (futures: skip weekends)
        if ((m30["t"] >= pday) & (m30["t"] < pday + timedelta(days=1))).any():
            break
        pday -= timedelta(days=1)
    for key, start, end in (("day", pday, pday + timedelta(days=1)), ("week", week0 - timedelta(days=7), week0)):
        p = profile_rows(m30[(m30["t"] >= start) & (m30["t"] < end)])
        if p:
            p.update(start=int(start.timestamp()), end=int(end.timestamp()))
            out[key] = p
    return out


def _last_at(now_ny, hh, mm):
    """Most recent New York wall-clock time hh:mm at or before now (as UTC datetime)."""
    t = now_ny.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if t > now_ny:
        t -= timedelta(days=1)
        t = t.replace(hour=hh, minute=mm)   # keep wall-clock time across DST changes
    return t.astimezone(timezone.utc)


def compute_opens(m30, daily, now):
    """Opening prices: daily (UTC), NY midnight, London (03:00 NY), NY (08:30 NY), weekly, monthly."""
    NY = ZoneInfo("America/New_York")
    out = {}
    if m30 is not None and not m30.empty:
        idx = {int(t.timestamp()): float(o) for t, o in zip(m30["t"], m30["o"])}
        now_ny = now.astimezone(NY)
        day0 = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        for key, ts in (("d_open", day0), ("ny_mid", _last_at(now_ny, 0, 0)),
                        ("ldn_open", _last_at(now_ny, 3, 0)), ("ny_open", _last_at(now_ny, 8, 30))):
            for _ in range(7):               # markets closed at that time -> previous trading day
                t = int(ts.timestamp())
                if t in idx:
                    out[key] = dict(time=t, price=idx[t])
                    break
                ts_ny = ts.astimezone(NY) - timedelta(days=1)
                ts = ts_ny.replace(hour=ts.astimezone(NY).hour, minute=ts.astimezone(NY).minute).astimezone(timezone.utc)
    if daily is not None and not daily.empty:
        didx = {t.date(): (int(t.timestamp()), float(o)) for t, o in zip(daily["t"], daily["o"])}
        today = now.date()
        for key, d in (("w_open", today - timedelta(days=today.weekday())), ("m_open", today.replace(day=1))):
            first = min((x for x in didx if x >= d), default=None)
            if key == "w_open" and first is None:          # weekend before futures reopen: this week's open = last week's
                first = min((x for x in didx if x >= d - timedelta(days=7)), default=None)
            if first is not None:
                out[key] = dict(time=didx[first][0], price=didx[first][1])
    return out


def asia_range(m30, now):
    """Latest Asia session (20:00-00:00 New York): high, low, start, end. Live while in session."""
    if m30 is None or m30.empty:
        return None
    now_ny = now.astimezone(ZoneInfo("America/New_York"))
    start = _last_at(now_ny, 20, 0)
    for _ in range(7):                       # last Asia session that actually traded
        end = start + timedelta(hours=4)
        w = m30[(m30["t"] >= start) & (m30["t"] < end)]
        if not w.empty:
            break
        s_ny = start.astimezone(ZoneInfo("America/New_York")) - timedelta(days=1)
        start = s_ny.replace(hour=20, minute=0).astimezone(timezone.utc)
    if w.empty:
        return None
    return dict(start=int(start.timestamp()), end=int(end.timestamp()),
                hi=float(w["h"].max()), lo=float(w["l"].min()), live=bool(now < end))


def compute_levels(daily, m30, now):
    today = now.date()
    prev_day = today - timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    pw_start = week_start - timedelta(days=7)
    lv = dict(pdh=NAN, pdl=NAN, pwh=NAN, pwl=NAN, pd_poc=NAN, pd_vah=NAN, pd_val=NAN,
              pw_poc=NAN, pw_vah=NAN, pw_val=NAN)
    if daily is not None and not daily.empty:
        d = daily.assign(date=daily["t"].dt.date)
        past_days = d.loc[d["date"] < today, "date"]
        if not past_days.empty and prev_day not in set(past_days):
            prev_day = past_days.max()          # markets closed yesterday (weekend / holiday) -> last trading day
        pr = d[d["date"] == prev_day]
        if not pr.empty:
            lv["pdh"], lv["pdl"] = float(pr["h"].iloc[0]), float(pr["l"].iloc[0])
        pw = d[(d["date"] >= pw_start) & (d["date"] < week_start)]
        if not pw.empty:
            lv["pwh"], lv["pwl"] = float(pw["h"].max()), float(pw["l"].min())
    if m30 is not None and not m30.empty:
        m = m30.assign(date=m30["t"].dt.date)
        md = m.loc[m["date"] < today, "date"]
        pday = prev_day if prev_day in set(md) else (md.max() if not md.empty else prev_day)
        lv["pd_poc"], lv["pd_vah"], lv["pd_val"] = volume_profile(m[m["date"] == pday])
        lv["pw_poc"], lv["pw_vah"], lv["pw_val"] = volume_profile(m[(m["date"] >= pw_start) & (m["date"] < week_start)])
    return lv


def location(h4, price, lookback=30):
    if h4 is None or h4.empty:
        return dict(hi=NAN, lo=NAN, eq=NAN, pos=NAN, zone="—", in_ote_long=False, in_ote_short=False,
                    ote_long=(NAN, NAN), ote_short=(NAN, NAN))
    w = h4.tail(lookback)
    hi, lo = max(float(w["h"].max()), price), min(float(w["l"].min()), price)
    rng = hi - lo
    pos = (price - lo) / rng if rng > 0 else NAN
    zone = "—" if _nan(pos) else "EQUILIBRIUM" if 0.48 <= pos <= 0.52 else "PREMIUM" if pos > 0.5 else "DISCOUNT"
    return dict(hi=hi, lo=lo, eq=lo + rng / 2, pos=pos, zone=zone,
                in_ote_long=not _nan(pos) and 0.21 <= pos <= 0.38,
                in_ote_short=not _nan(pos) and 0.62 <= pos <= 0.79,
                ote_long=(hi - 0.79 * rng, hi - 0.62 * rng), ote_short=(lo + 0.62 * rng, lo + 0.79 * rng))


def structure(df, piv, valid, bull_levels, bear_levels):
    h, l, c = df["h"].to_numpy(float), df["l"].to_numpy(float), df["c"].to_numpy(float)
    n = len(c)
    last_ph = last_pl = NAN
    state = 0
    mss_bull = mss_bear = sw_bull = sw_bear = None
    sw_bull_px = sw_bear_px = NAN
    for i in range(n):
        j = i - piv
        if j >= piv:
            if h[j] == h[j - piv:j + piv + 1].max():
                last_ph = h[j]
            if l[j] == l[j - piv:j + piv + 1].min():
                last_pl = l[j]
        if i > 0:
            if not math.isnan(last_ph) and c[i] > last_ph and c[i - 1] <= last_ph:
                if state == -1:
                    mss_bull = i
                state = 1
            if not math.isnan(last_pl) and c[i] < last_pl and c[i - 1] >= last_pl:
                if state == 1:
                    mss_bear = i
                state = -1
        if i >= n - 1 - valid:
            if any(not _nan(x) and l[i] < x < c[i] for x in bull_levels):
                sw_bull, sw_bull_px = i, l[i]
            if any(not _nan(x) and h[i] > x > c[i] for x in bear_levels):
                sw_bear, sw_bear_px = i, h[i]
    recent = lambda k: k is not None and (n - 1 - k) <= valid
    return dict(last_ph=last_ph, last_pl=last_pl,
                mss_bull=recent(mss_bull), mss_bear=recent(mss_bear),
                mss_bull_ago=None if mss_bull is None else n - 1 - mss_bull,
                mss_bear_ago=None if mss_bear is None else n - 1 - mss_bear,
                sw_bull=recent(sw_bull), sw_bear=recent(sw_bear),
                sw_bull_px=sw_bull_px, sw_bear_px=sw_bear_px)


def atr(df, n=14):
    h, l, c = df["h"], df["l"], df["c"]
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return float(tr.rolling(n).mean().iloc[-1])


def _usd_delta(df, denom):
    if df is None or df.empty or "v" not in df or "bv" not in df:
        return pd.Series(dtype=float)          # no taker buy/sell data (e.g. Yahoo futures) -> no CVD
    mult = df["c"] if denom == "BASE_ASSET" else 1.0
    v = df["v"].fillna(0) * mult
    bv = df["bv"].fillna(0) * mult
    return pd.Series((2 * bv - v).to_numpy(), index=df["t"])


def aggregate_delta(hists, denoms):
    parts = [_usd_delta(df, denoms.get(sym, "BASE_ASSET")) for sym, df in hists.items()]
    parts = [p for p in parts if not p.empty]
    if not parts:
        return pd.Series(dtype=float)
    return pd.concat(parts, axis=1).fillna(0).sum(axis=1).sort_index()


def aggregate_volume(hists, denoms):
    parts = []
    for sym, df in hists.items():
        if df is None or df.empty or "v" not in df:
            continue
        mult = df["c"] if denoms.get(sym, "BASE_ASSET") == "BASE_ASSET" else 1.0
        parts.append(pd.Series((df["v"].fillna(0) * mult).to_numpy(), index=df["t"]))
    if not parts:
        return pd.Series(dtype=float)
    return pd.concat(parts, axis=1).fillna(0).sum(axis=1).sort_index()


def aggregate_liq(hists):
    parts = [df.set_index("t")[["l", "s"]] for df in hists.values() if df is not None and not df.empty]
    if not parts:
        return pd.DataFrame(columns=["l", "s"])
    return pd.concat(parts).groupby(level=0).sum().sort_index()


def aggregate_ohlc(hists):
    """Sum OHLC across exchanges (e.g. aggregated open-interest candles)."""
    frames = [df.set_index("t")[["o", "h", "l", "c"]] for df in hists.values()
              if df is not None and not df.empty and {"o", "h", "l", "c"} <= set(df.columns)]
    if not frames:
        return pd.DataFrame(columns=["o", "h", "l", "c"])
    fixed = []
    for f in frames:
        f = f.astype(float).copy()
        oc_max, oc_min = f[["o", "c"]].max(axis=1), f[["o", "c"]].min(axis=1)
        f["h"] = f["h"].where(f["h"] >= oc_max, oc_max)                   # repair missing / bad highs
        f["l"] = f["l"].where((f["l"] > 0) & (f["l"] <= oc_min), oc_min)  # repair missing / bad lows
        fixed.append(f)
    frames = fixed
    idx = sorted(set().union(*[f.index for f in frames]))
    frames = [f[~f.index.duplicated()].reindex(idx).ffill() for f in frames]
    out = sum(frames)
    return out.dropna()


def aggregate_close(hists):
    parts = {s: df.set_index("t")["c"] for s, df in hists.items() if df is not None and not df.empty}
    if not parts:
        return pd.Series(dtype=float)
    return pd.concat(parts, axis=1).sort_index().ffill().dropna().sum(axis=1)


def pct_change_over(series, hours, now):
    if series is None or series.empty:
        return NAN
    past = series[series.index <= now - timedelta(hours=hours)]
    if past.empty or past.iloc[-1] == 0:
        return NAN
    return (series.iloc[-1] / past.iloc[-1] - 1) * 100


def funding_scale(vals):
    v = [abs(x) for x in vals if not _nan(x)]
    if not v:
        return 1.0
    return 100.0 if float(np.median(v)) < 0.002 else 1.0  # decimal → percent


def session_now(now):
    ny = now.astimezone(ZoneInfo("America/New_York"))
    m = ny.hour * 60 + ny.minute
    return "LONDON" if 120 <= m < 300 else "NEW YORK" if 420 <= m < 600 else "OFF"


def targets(levels, price, min_dist, is_long):
    c = sorted(x for x in levels if not _nan(x) and (x > price + min_dist if is_long else x < price - min_dist))
    f = []
    for x in c:
        if not f or abs(x - f[-1]) > min_dist:
            f.append(x)
    if not is_long:
        f = f[::-1]
    return (f[0] if f else NAN), (f[1] if len(f) > 1 else NAN)


def regime(px_4h, oi_4h, perp_4h, spot_4h, funding, oi_24h, has_spot, vol_4h=NAN, th_px=0.3):
    th_oi = 0.5
    imb = abs(perp_4h) / vol_4h if not _nan(vol_4h) and vol_4h > 0 and not _nan(perp_4h) else 0.0
    strong = imb >= 0.08    # net taker imbalance >= 8% of 4h perp volume
    up, dn = px_4h > th_px, px_4h < -th_px
    oi_up, oi_dn = oi_4h > th_oi, oi_4h < -th_oi
    if _nan(px_4h) or _nan(oi_4h):
        main = ("NO DATA", "Not enough data for a regime read.", "neu")
    elif up and oi_up:
        main = ("NEW LONGS", "Price ↑ + OI ↑: fresh longs entering, strong up move.", "bull")
    elif up and oi_dn:
        main = ("SHORT SQUEEZE", "Price ↑ + OI ↓: shorts closing. Move can fade once covering ends.", "bull")
    elif dn and oi_up:
        main = ("NEW SHORTS", "Price ↓ + OI ↑: fresh shorts entering, strong down move.", "bear")
    elif dn and oi_dn:
        main = ("LONG FLUSH", "Price ↓ + OI ↓: longs liquidated/closing. Often exhausts near a sweep low.", "bear")
    elif not up and not dn and strong and perp_4h < 0:
        main = ("ABSORPTION (BULLISH)", f"Price flat while perp sellers dominate ({imb:.0%} of 4h volume): sellers being absorbed.", "bull")
    elif not up and not dn and strong and perp_4h > 0:
        main = ("ABSORPTION (BEARISH)", f"Price flat while perp buyers dominate ({imb:.0%} of 4h volume): buyers being absorbed.", "bear")
    else:
        main = ("LOW-LEVERAGE MOVE" if (up or dn) else "RANGE / NO EDGE",
                "OI flat: no strong positioning signal.", "neu")
    notes = []
    if has_spot and not _nan(spot_4h) and not _nan(perp_4h):
        if spot_4h > 0 > perp_4h:
            notes.append(("Spot buying vs perp selling: spot-led, healthier.", "bull"))
        elif perp_4h > 0 > spot_4h:
            notes.append(("Perp buying vs spot selling: leverage-led, fragile.", "bear"))
    if not _nan(funding) and not _nan(oi_24h):
        if funding > 0.03 and oi_24h > 5:
            notes.append(("CROWDED LONGS: high funding + rising OI → long-squeeze risk.", "bear"))
        elif funding < -0.01 and oi_24h > 5:
            notes.append(("CROWDED SHORTS: negative funding + rising OI → short-squeeze risk.", "bull"))
    if not _nan(funding) and abs(funding) >= 0.05:
        notes.append((f"Funding extreme ({funding:+.4f}%).", "bear" if funding > 0 else "bull"))
    return main, notes


# ════════════════════════════════════════════════════════════════
# FULL ANALYSIS
# ════════════════════════════════════════════════════════════════
def analyze(b, perp_syms, denoms, piv=3, valid=20, min_rr=2.0, min_score=7, manual=False, now=None):
    now = now or datetime.now(timezone.utc)
    main = perp_syms[0]
    ltf = b["ltf_perp"].get(main)
    if ltf is None or ltf.empty:
        raise ValueError("No price data returned for this coin.")
    price = float(ltf["c"].iloc[-1])

    d_e1, d_e2, dB = bias_from(b["daily"]["c"] if not b["daily"].empty else None, price)
    h_e1, h_e2, hB = bias_from(b["h4"]["c"] if not b["h4"].empty else None, price)
    lv = compute_levels(b["daily"], b["m30"], now)
    loc = location(b["h4"], price)

    bull_lv = [lv["pdl"], lv["pwl"], lv["pd_val"], lv["pw_val"]]
    bear_lv = [lv["pdh"], lv["pwh"], lv["pd_vah"], lv["pw_vah"]]
    s = structure(ltf, piv, valid, bull_lv, bear_lv)

    # ── flow
    perp_delta = aggregate_delta(b["ltf_perp"], denoms)
    spot_delta = aggregate_delta(b["ltf_spot"], {})
    cut = now - timedelta(hours=4)
    perp_4h = float(perp_delta[perp_delta.index > cut].sum()) if not perp_delta.empty else NAN
    spot_4h = float(spot_delta[spot_delta.index > cut].sum()) if not spot_delta.empty else NAN
    px_series = ltf.set_index("t")["c"]
    px_4h = pct_change_over(px_series, 4, now)
    oi = aggregate_close(b["oi"])
    oi_now = float(oi.iloc[-1]) if not oi.empty else NAN
    oi_1h, oi_4h, oi_24h = (pct_change_over(oi, h, now) for h in (1, 4, 24))

    # ── funding (OI-weighted)
    last_oi = {sym: float(df["c"].iloc[-1]) for sym, df in b["oi"].items() if df is not None and not df.empty}
    scale = funding_scale(list(b["funding"].values()))
    pscale = funding_scale(list(b["pred_funding"].values()))

    def wavg(vals, sc):
        num = den = 0.0
        for sym, v in vals.items():
            if _nan(v):
                continue
            w = last_oi.get(sym, 1.0)
            num += v * sc * w
            den += w
        return num / den if den else NAN

    funding = wavg(b["funding"], scale)
    pred_funding = wavg(b["pred_funding"], pscale)

    # ── liquidations + long/short
    liq_long = liq_short = 0.0
    liq_series = []
    for df in b["liq"].values():
        if df is not None and not df.empty:
            d24 = df[df["t"] > now - timedelta(hours=24)]
            liq_long += float(d24["l"].sum())
            liq_short += float(d24["s"].sum())
            liq_series.append(df.set_index("t")[["l", "s"]])
    liq_hourly = pd.concat(liq_series).groupby(level=0).sum() if liq_series else pd.DataFrame(columns=["l", "s"])
    ls = b.get("ls")
    ls_ratio = float(ls["r"].iloc[-1]) if ls is not None and not ls.empty and "r" in ls else NAN

    vol_ser = aggregate_volume(b["ltf_perp"], denoms)
    vol_4h = float(vol_ser[vol_ser.index > cut].sum()) if not vol_ser.empty else NAN
    th_px = 0.3
    h4 = b["h4"]
    if h4 is not None and len(h4) > 15:
        h4_atr_pct = atr(h4) / price * 100
        if not _nan(h4_atr_pct):
            th_px = max(0.15, 0.35 * h4_atr_pct)   # "flat" = move smaller than ~1/3 of a normal 4h candle
    reg_main, reg_notes = regime(px_4h, oi_4h, perp_4h, spot_4h, funding, oi_24h, bool(b["ltf_spot"]), vol_4h, th_px)
    if b.get("tradfi"):
        reg_main, reg_notes = ("PRICE ONLY", "No OI / CVD / funding data for this market. Use bias, levels and structure.", "neu"), []

    # ── setups
    in_disc = not _nan(loc["pos"]) and loc["pos"] < 0.5
    in_prem = not _nan(loc["pos"]) and loc["pos"] > 0.5
    a_long = s["sw_bull"] and in_disc and not (dB == -1 and hB == -1)
    b_long = hB == 1 and dB != -1 and in_disc
    a_short = s["sw_bear"] and in_prem and not (dB == 1 and hB == 1)
    b_short = hB == -1 and dB != 1 and in_prem
    name = lambda a, bb: "A+ SWEEP + PULLBACK" if a and bb else "A SWEEP" if a else "B PULLBACK" if bb else "NONE"
    set_l, set_s = name(a_long, b_long), name(a_short, b_short)

    # ── SL / TP
    a = atr(ltf)
    a = a if not _nan(a) else price * 0.003
    min_dist = a * 0.25
    win = piv * 4 + 1
    base_l = s["sw_bull_px"] if s["sw_bull"] else s["last_pl"]
    if _nan(base_l) or base_l >= price:
        base_l = float(ltf["l"].tail(win).min())
    base_s = s["sw_bear_px"] if s["sw_bear"] else s["last_ph"]
    if _nan(base_s) or base_s <= price:
        base_s = float(ltf["h"].tail(win).max())
    sl_l, sl_s = base_l - a * 0.2, base_s + a * 0.2
    tgt_levels = [lv[k] for k in lv] + [loc["hi"], loc["lo"], loc["eq"]]
    tp1_l, tp2_l = targets(tgt_levels, price, min_dist, True)
    tp1_s, tp2_s = targets(tgt_levels, price, min_dist, False)
    rr_l = (tp1_l - price) / (price - sl_l) if price > sl_l and not _nan(tp1_l) else NAN
    rr_s = (price - tp1_s) / (sl_s - price) if sl_s > price and not _nan(tp1_s) else NAN

    session = session_now(now)
    in_ses = session != "OFF"
    cvd_up = not _nan(perp_4h) and perp_4h > 0
    cvd_dn = not _nan(perp_4h) and perp_4h < 0

    bt = lambda v: "BULL" if v == 1 else "BEAR" if v == -1 else "MIXED"
    now_ = lambda x: f" · now {x}"
    rrt = lambda v: "—" if _nan(v) else f"1:{v:.2f}"
    cvd_t = "N/A" if _nan(perp_4h) else ("rising" if perp_4h > 0 else "falling")
    checks_l = [("Daily EMA bullish" + now_(bt(dB)), dB == 1), ("4H EMA bullish" + now_(bt(hB)), hB == 1),
                ("In discount" + now_(loc["zone"]), in_disc),
                ("Setup A/B present" + now_(set_l), set_l != "NONE"),
                ("LTF MSS bullish" + now_("yes" if s["mss_bull"] else "not yet"), s["mss_bull"]),
                ("Perp CVD rising (4h)" + now_(cvd_t), cvd_up), ("In London/NY session" + now_(session_now(now)), in_ses),
                (f"R:R ≥ {min_rr}" + now_(rrt(rr_l)), not _nan(rr_l) and rr_l >= min_rr),
                ("Liqs / footprint confirm" + now_("ticked" if manual else "tick in sidebar"), manual)]
    checks_s = [("Daily EMA bearish" + now_(bt(dB)), dB == -1), ("4H EMA bearish" + now_(bt(hB)), hB == -1),
                ("In premium" + now_(loc["zone"]), in_prem),
                ("Setup A/B present" + now_(set_s), set_s != "NONE"),
                ("LTF MSS bearish" + now_("yes" if s["mss_bear"] else "not yet"), s["mss_bear"]),
                ("Perp CVD falling (4h)" + now_(cvd_t), cvd_dn), ("In London/NY session" + now_(session_now(now)), in_ses),
                (f"R:R ≥ {min_rr}" + now_(rrt(rr_s)), not _nan(rr_s) and rr_s >= min_rr),
                ("Liqs / footprint confirm" + now_("ticked" if manual else "tick in sidebar"), manual)]
    score_l, score_s = sum(v for _, v in checks_l), sum(v for _, v in checks_s)

    long_ok = set_l != "NONE" and s["mss_bull"] and not _nan(rr_l) and rr_l >= min_rr and score_l >= min_score
    short_ok = set_s != "NONE" and s["mss_bear"] and not _nan(rr_s) and rr_s >= min_rr and score_s >= min_score
    decision = "LONG" if long_ok and (not short_ok or score_l >= score_s) else "SHORT" if short_ok else "WAIT"
    if decision != "WAIT":
        lead_long = decision == "LONG"
    elif set_l != "NONE" and set_s == "NONE":
        lead_long = True
    elif set_s != "NONE" and set_l == "NONE":
        lead_long = False
    else:
        lead_long = score_l >= score_s

    opens = compute_opens(b["m30"], b["daily"], now)
    ny_mid = opens.get("ny_mid", {}).get("price", NAN)
    return dict(
        opens=opens, asia=asia_range(b["m30"], now), profiles=session_profiles(b["m30"], now),
        vs_ny_mid=0 if _nan(ny_mid) else (1 if price > ny_mid else -1),
        set_long=set_l, set_short=set_s, score_long=score_l, score_short=score_s,
        checks_long=checks_l, checks_short=checks_s,
        price=price, now=now, session=session,
        d_bias=dB, h_bias=hB, d_ema=(d_e1, d_e2), h_ema=(h_e1, h_e2),
        levels=lv, loc=loc, struct=s,
        perp_cvd_4h=perp_4h, spot_cvd_4h=spot_4h, px_4h=px_4h,
        perp_cvd=perp_delta.cumsum(), spot_cvd=spot_delta.cumsum(),
        oi_series=oi, oi_now=oi_now, oi_1h=oi_1h, oi_4h=oi_4h, oi_24h=oi_24h,
        funding=funding, pred_funding=pred_funding,
        funding_by_sym={k: (None if _nan(v) else v * scale) for k, v in b["funding"].items()},
        pred_by_sym={k: (None if _nan(v) else v * pscale) for k, v in b["pred_funding"].items()},
        oi_by_sym=last_oi,
        liq_long_24h=liq_long, liq_short_24h=liq_short, liq_hourly=liq_hourly, ls_ratio=ls_ratio,
        regime=reg_main, regime_notes=reg_notes,
        lead_long=lead_long, decision=decision,
        setup=set_l if lead_long else set_s,
        mss_ok=s["mss_bull"] if lead_long else s["mss_bear"],
        mss_ago=s["mss_bull_ago"] if lead_long else s["mss_bear_ago"],
        sl=sl_l if lead_long else sl_s,
        tp1=tp1_l if lead_long else tp1_s, tp2=tp2_l if lead_long else tp2_s,
        rr=rr_l if lead_long else rr_s,
        score=score_l if lead_long else score_s,
        checks=checks_l if lead_long else checks_s,
        ltf_df=ltf,
    )


# ════════════════════════════════════════════════════════════════
# TRADFI (Yahoo Finance futures) + WATCHLIST SCAN
# ════════════════════════════════════════════════════════════════
TRADFI = {
    "GOLD": ("GC=F", "Gold futures (GC)"),
    "SILVER": ("SI=F", "Silver futures (SI)"),
    "SPX": ("ES=F", "S&P 500 futures (ES)"),
    "NDX": ("NQ=F", "Nasdaq 100 futures (NQ)"),
}
YF_INTERVAL = {"5min": ("5m", "7d"), "15min": ("15m", "10d"), "30min": ("30m", "20d"),
               "1hour": ("60m", "60d"), "2hour": ("60m", "90d"), "4hour": ("60m", "180d"),
               "12hour": ("60m", "365d"), "daily": ("1d", "2y")}
RESAMPLE = {"2hour": "2h", "4hour": "4h", "12hour": "12h"}


def yf_history(ticker, interval, period):
    import yfinance as yf
    df = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=False, prepost=True)
    if df is None or df.empty:
        return pd.DataFrame(columns=["t", "o", "h", "l", "c", "v"])
    idx = df.index
    idx = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
    out = pd.DataFrame({"t": idx, "o": df["Open"].to_numpy(float), "h": df["High"].to_numpy(float),
                        "l": df["Low"].to_numpy(float), "c": df["Close"].to_numpy(float),
                        "v": df["Volume"].fillna(0).to_numpy(float)})
    return out.dropna(subset=["o", "h", "l", "c"]).reset_index(drop=True)


def _resample(df, rule):
    if df.empty:
        return df
    r = df.set_index("t").resample(rule, origin="epoch").agg({"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"})
    return r.dropna(subset=["o"]).reset_index()


def yf_bars(ticker, interval, bars=300):
    yi, period = YF_INTERVAL[interval]
    df = yf_history(ticker, yi, period)
    if interval in RESAMPLE:
        df = _resample(df, RESAMPLE[interval])
    return df.tail(bars).reset_index(drop=True)


def load_yahoo_bundle(ticker, ltf):
    """Same shape as load_bundle, with no order-flow data (OI, funding, CVD, liquidations)."""
    jobs = {"ltf": (yf_bars, (ticker, ltf, 400), {}), "m30": (yf_history, (ticker, "30m", "20d"), {}),
            "h4": (yf_bars, (ticker, "4hour", 200), {}), "daily": (yf_history, (ticker, "1d", "1y"), {})}
    res = _parallel(jobs)
    return {"ltf_perp": {ticker: res["ltf"]}, "ltf_spot": {}, "daily": res["daily"], "h4": res["h4"],
            "m30": res["m30"], "oi": {}, "funding": {}, "pred_funding": {}, "liq": {}, "ls": None,
            "fetched_at": datetime.now(timezone.utc), "tradfi": True}


def load_yahoo_chart(ticker, interval, bars=300):
    return {"perp": {ticker: yf_bars(ticker, interval, bars)}, "spot": {}, "oi": {}, "liq": {}}


def load_light_bundle(api_key, perp_sym, ltf):
    """4-call crypto scan for the watchlist (no OI / funding / spot)."""
    ltf_s = INTERVAL_SECONDS[ltf]
    H = fetch_history
    res = _parallel({"ltf": (H, ("ohlcv-history", api_key, [perp_sym], ltf, ltf_s * 400), {}),
                     "daily": (H, ("ohlcv-history", api_key, [perp_sym], "daily", 86400 * 150), {}),
                     "h4": (H, ("ohlcv-history", api_key, [perp_sym], "4hour", 14400 * 200), {}),
                     "m30": (H, ("ohlcv-history", api_key, [perp_sym], "30min", 86400 * 15), {})})
    e = pd.DataFrame()
    return {"ltf_perp": res["ltf"], "ltf_spot": {}, "daily": res["daily"].get(perp_sym, e),
            "h4": res["h4"].get(perp_sym, e), "m30": res["m30"].get(perp_sym, e),
            "oi": {}, "funding": {}, "pred_funding": {}, "liq": {}, "ls": None,
            "fetched_at": datetime.now(timezone.utc)}


def tradfi_overview(b, price):
    """Basic performance tiles for a non-crypto market from its daily candles."""
    d = b["daily"]
    if d is None or d.empty:
        return {}
    c = d["c"].to_numpy(float)
    chg = lambda n: (price / c[-1 - n] - 1) * 100 if len(c) > n else NAN
    yr = d.tail(252)
    return {"chg_24h": chg(1), "chg_7d": chg(5), "chg_30d": chg(21),
            "hi_52w": float(yr["h"].max()), "lo_52w": float(yr["l"].min())}


def watch_row(name, r):
    """Compact watchlist row from a full analysis result."""
    lv = dict(r["levels"])
    lv.update({k.upper(): v["price"] for k, v in r["opens"].items()})
    names = {"pdh": "PDH", "pdl": "PDL", "pwh": "PWH", "pwl": "PWL", "pd_poc": "D POC", "pw_poc": "W POC",
             "pd_vah": "D VAH", "pd_val": "D VAL", "pw_vah": "W VAH", "pw_val": "W VAL", "D_OPEN": "Daily open",
             "NY_MID": "NY midnight", "LDN_OPEN": "London open", "NY_OPEN": "NY open", "W_OPEN": "Weekly open",
             "M_OPEN": "Monthly open"}
    near = min(((names.get(k, k), v) for k, v in lv.items() if not _nan(v)),
               key=lambda x: abs(x[1] - r["price"]), default=(None, NAN))
    ltf = r["ltf_df"]
    past = ltf[ltf["t"] <= r["now"] - timedelta(hours=24)]
    chg24 = (r["price"] / float(past["c"].iloc[-1]) - 1) * 100 if not past.empty else NAN
    return {"asset": name, "price": r["price"], "chg24": chg24, "d_bias": r["d_bias"], "h_bias": r["h_bias"],
            "zone": r["loc"]["zone"], "pos": r["loc"]["pos"],
            "ote": r["loc"]["in_ote_long"] or r["loc"]["in_ote_short"], "vs_ny_mid": r["vs_ny_mid"],
            "setup": r["setup"], "side": "LONG" if r["lead_long"] else "SHORT", "decision": r["decision"],
            "score": r["score"], "near_name": near[0],
            "near_dist": NAN if near[0] is None else (near[1] / r["price"] - 1) * 100,
            "regime": r["regime"][0]}


# ════════════════════════════════════════════════════════════════
# MARKET PULSE (macro + crypto market structure)
# ════════════════════════════════════════════════════════════════
PULSE_YF = [  # (label, Yahoo ticker, kind, asset key)
    ("Dollar (DXY)", "DX-Y.NYB", "price", "DXY"),
    ("US 2Y", "2YY=F", "yield", "US2Y"),
    ("US 10Y", "^TNX", "yield", "US10Y"),
    ("US 30Y", "^TYX", "yield", "US30Y"),
    ("VIX", "^VIX", "price", "VIX"),
    ("Oil (WTI)", "CL=F", "price", "OIL"),
    ("ETH / BTC", "ETH-BTC", "ratio", "ETHBTC"),
]
TRADFI.update({key: (t, lab) for lab, t, _, key in PULSE_YF})
TOP_IDS = ["bitcoin", "ethereum", "tether", "ripple", "binancecoin", "solana", "usd-coin", "dogecoin", "tron", "cardano"]


def _thin(vals, n=60):
    vals = [float(v) for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if len(vals) <= n:
        return vals
    step = len(vals) / n
    return [vals[int(i * step)] for i in range(n)] + [vals[-1]]


def _pulse_yf(label, ticker, kind, key):
    d = yf_history(ticker, "1d", "15d")
    h = yf_history(ticker, "60m", "7d")
    out = {"label": label, "value": NAN, "chg": NAN, "chg7": NAN, "kind": kind, "key": key, "spark": []}
    if d.empty or len(d) < 2:
        return out
    last, prev = float(d["c"].iloc[-1]), float(d["c"].iloc[-2])
    week = float(d["c"].iloc[-6]) if len(d) >= 6 else float(d["c"].iloc[0])
    diff = (lambda a, b: (a - b) * 100) if kind == "yield" else (lambda a, b: (a / b - 1) * 100)   # yields in bp
    spark = h["c"].tolist() if not h.empty else d["c"].tail(7).tolist()
    out.update(value=last, chg=diff(last, prev), chg7=diff(last, week), spark=_thin(spark))
    return out


def cg_global(cg_key=""):
    headers = {"x-cg-demo-api-key": cg_key} if cg_key else {}
    r = requests.get(CG_BASE + "global", headers=headers, timeout=8)
    r.raise_for_status()
    d = r.json().get("data", {})
    total = (d.get("total_market_cap") or {}).get("usd")
    pct = d.get("market_cap_percentage") or {}
    btc, eth, usdt = pct.get("btc"), pct.get("eth"), pct.get("usdt")
    return {"total": total, "chg": d.get("market_cap_change_percentage_24h_usd"),
            "btc_d": btc, "eth_d": eth, "usdt_d": usdt,
            "total2": total * (1 - btc / 100) if total and btc is not None else None,
            "total3": total * (1 - (btc + eth) / 100) if total and btc is not None and eth is not None else None}


def cg_history(cg, cg_key=""):
    """Approximate 7-day history of total cap / TOTAL2 / TOTAL3 / dominance from the top 10 coins' 7-day
    sparklines (one CoinGecko call). Total(t) = Total(now) x TopTen(t) / TopTen(now)."""
    headers = {"x-cg-demo-api-key": cg_key} if cg_key else {}
    r = requests.get(CG_BASE + "coins/markets", headers=headers, timeout=10, params={
        "vs_currency": "usd", "ids": ",".join(TOP_IDS), "sparkline": "true"})
    r.raise_for_status()
    rows = {c["id"]: c for c in r.json()}
    series = {}
    for cid, c in rows.items():
        px = (c.get("sparkline_in_7d") or {}).get("price") or []
        supply = (c.get("market_cap") or 0) / c["current_price"] if c.get("current_price") else 0
        if px and supply:
            series[cid] = np.array(px, dtype=float) * supply
    if "bitcoin" not in series or not cg or not cg.get("total"):
        return {}
    n = min(len(v) for v in series.values())
    series = {k: v[-n:] for k, v in series.items()}
    top = sum(series.values())
    total = cg["total"] * top / top[-1]
    btc, eth = series["bitcoin"], series.get("ethereum", np.zeros(n))
    usdt = series.get("tether", np.zeros(n))
    h = {"total": total, "total2": total - btc, "total3": total - btc - eth,
         "btc_d": btc / total * 100, "eth_d": eth / total * 100, "usdt_d": usdt / total * 100}
    out = {}
    for k, v in h.items():
        per_day = max(1, n // 7)
        ch = lambda back: NAN if n <= back else ((v[-1] - v[-1 - back]) if k.endswith("_d") else (v[-1] / v[-1 - back] - 1) * 100)
        out[k] = {"spark": _thin(v.tolist()), "chg": ch(per_day), "chg7": ch(n - 1)}
    return out


def fear_greed_crypto():
    r = requests.get("https://api.alternative.me/fng/", params={"limit": 30}, timeout=8)
    r.raise_for_status()
    data = r.json().get("data", [])
    if not data:
        return None
    vals = [int(x["value"]) for x in reversed(data)]
    return {"value": vals[-1], "label": data[0].get("value_classification", ""), "spark": vals,
            "chg": vals[-1] - vals[-2] if len(vals) > 1 else NAN, "chg7": vals[-1] - vals[-8] if len(vals) > 7 else NAN}


def fear_greed_stocks():
    """CNN Fear & Greed (stock market). Unofficial endpoint; may be unavailable."""
    r = requests.get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", timeout=8,
                     headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                                            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                              "Accept": "application/json", "Referer": "https://edition.cnn.com/"})
    r.raise_for_status()
    j = r.json()
    fg = j.get("fear_and_greed", {})
    hist = [p.get("y") for p in (j.get("fear_and_greed_historical", {}).get("data") or [])][-30:]
    v = fg.get("score")
    if v is None:
        return None
    prev, wk = fg.get("previous_close"), fg.get("previous_1_week")
    return {"value": round(float(v)), "label": str(fg.get("rating", "")).title(), "spark": _thin(hist) if hist else [],
            "chg": NAN if prev is None else float(v) - float(prev), "chg7": NAN if wk is None else float(v) - float(wk)}


def market_pulse(cg_key=""):
    jobs = {lab: (_pulse_yf, (lab, t, k, key), {}) for lab, t, k, key in PULSE_YF}
    jobs["_cg"] = (cg_global, (cg_key,), {})
    jobs["_fg"] = (fear_greed_crypto, (), {})
    jobs["_fgs"] = (fear_greed_stocks, (), {})
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {k: ex.submit(f, *a, **kw) for k, (f, a, kw) in jobs.items()}
        res = {}
        for k, f in futs.items():
            try:
                res[k] = f.result()
            except Exception:
                res[k] = None
    hist = {}
    if res.get("_cg"):
        try:
            hist = cg_history(res["_cg"], cg_key)
        except Exception:
            hist = {}
    macro = [res[lab] for lab, _, _, _ in PULSE_YF if res.get(lab)]
    return {"macro": macro, "crypto": res.get("_cg"), "crypto_hist": hist,
            "fg_crypto": res.get("_fg"), "fg_stocks": res.get("_fgs")}