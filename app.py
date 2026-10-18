"""
LOF Dashboard — Liquidity–Order Flow Confluence
Run locally:  streamlit run app.py
"""
import hmac
import json
import math
import os
import time

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
import streamlit.components.v1 as components
from plotly.subplots import make_subplots

import importlib

import engine as E

# Reload engine.py automatically when the file changes (no restart needed after updates)
_engine_mtime = os.path.getmtime(E.__file__)
if getattr(E, "_loaded_mtime", None) != _engine_mtime:
    E = importlib.reload(E)
    E._loaded_mtime = _engine_mtime

st.set_page_config(page_title="LOF Dashboard", page_icon="📊", layout="wide")

GREEN, RED, GREY, AMBER = "#26a69a", "#ef5350", "#787b86", "#f9a825"
LTF_MAP = {"5m": "5min", "15m": "15min", "1h": "1hour"}

st.markdown("""
<style>
.block-container {padding-top: 3.5rem; padding-bottom: 1rem;}
.hdr {display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; margin-bottom: 14px;}
.hdr-title {flex: 2 1 220px;}
.hdr-title .coin {font-size: 1.6rem; font-weight: 700; line-height: 1.2;}
.hdr-title .sub {opacity: 0.6; font-size: 0.85rem; margin-top: 4px;}
.hdr-price {flex: 1 1 150px;}
.hdr-price .lbl {opacity: 0.6; font-size: 0.85rem;}
.hdr-price .px {font-size: 1.8rem; font-weight: 700; white-space: nowrap;}
.badge {flex: 1 1 140px; padding: 10px 14px; border-radius: 8px; color: white; text-align: center;
        display: flex; flex-direction: column; justify-content: center;}
.badge.wide {flex: 2 1 240px;}
.badge .big {font-weight: 700; font-size: 1.1rem;}
.badge .small {font-size: 0.85rem; opacity: 0.95;}
.tiles {display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 6px 0 14px;}
.tile {background: rgba(128,128,128,0.08); border: 1px solid rgba(128,128,128,0.25); border-radius: 10px;
       padding: 10px 12px;}
.tile .lbl {opacity: 0.65; font-size: 0.8rem;}
.tile .val {font-size: 1.25rem; font-weight: 700; word-break: break-word;}
.tile .note {font-size: 0.78rem; opacity: 0.7;}
.tiles.pulse {grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px;}
.tiles.pulse .tile {padding: 8px 10px;}
.tiles.pulse .val {font-size: 1.05rem;}
.tiles.pulse .note {opacity: 0.95; font-weight: 600;}
.pulse-h {font-size: 0.8rem; font-weight: 600; opacity: 0.6; margin: 6px 0 4px; text-transform: uppercase;
          letter-spacing: 0.04em;}
.card {background: rgba(128,128,128,0.08); border: 1px solid rgba(128,128,128,0.25);
       border-radius: 10px; padding: 12px 14px; margin-bottom: 10px;}
.card h4 {margin: 0 0 8px 0; font-size: 0.95rem; opacity: 0.8;}
.row {display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.92rem;
      border-bottom: 1px dashed rgba(128,128,128,0.18);}
.row:last-child {border-bottom: none;}
.pill {white-space: nowrap; padding: 1px 8px; border-radius: 6px; color: white; font-weight: 600; font-size: 0.85rem;}
</style>
""", unsafe_allow_html=True)


# ════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════
def secret(name):
    try:
        v = st.secrets.get(name)
        if v:
            return str(v)
    except Exception:
        pass
    return os.environ.get(name, "")


def nan(x):
    return x is None or (isinstance(x, float) and math.isnan(x))


def fp(p):
    if nan(p):
        return "—"
    a = abs(p)
    d = 1 if a >= 1000 else 2 if a >= 100 else 3 if a >= 1 else 5 if a >= 0.01 else 8
    return f"{p:,.{d}f}"


def fusd(x):
    if nan(x):
        return "—"
    a = abs(x)
    for div, suf in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= div:
            return f"{'-' if x < 0 else ''}${a / div:,.2f}{suf}"
    return f"{'-' if x < 0 else ''}${a:,.0f}"


def fpct(x, d=2):
    return "—" if nan(x) else f"{x:+.{d}f}%"


def pill(text, color):
    return f"<span class='pill' style='background:{color}'>{text}</span>"


def tone(v, pos=GREEN, neg=RED):
    return GREY if nan(v) or v == 0 else pos if v > 0 else neg


def card(title, rows):
    body = "".join(f"<div class='row'><span>{k}</span><span>{v}</span></div>" for k, v in rows)
    st.markdown(f"<div class='card'><h4>{title}</h4>{body}</div>", unsafe_allow_html=True)


def tiles(items):
    """items: (label, value, note or None, value color or None)"""
    html = ""
    for label, value, note, color in items:
        style = f" style='color:{color}'" if color and color != GREY else ""
        note_html = f"<div class='note'>{note}</div>" if note else ""
        html += f"<div class='tile'><div class='lbl'>{label}</div><div class='val'{style}>{value}</div>{note_html}</div>"
    st.markdown(f"<div class='tiles'>{html}</div>", unsafe_allow_html=True)


def bias_pill(b):
    return pill("BULL", GREEN) if b == 1 else pill("BEAR", RED) if b == -1 else pill("MIXED", GREY)


OPENS = [("Daily open", "d_open", "#e0e0e0"), ("NY midnight", "ny_mid", "#00bcd4"),
         ("London open", "ldn_open", "#5b7fff"), ("NY open", "ny_open", "#ff9800"),
         ("Weekly open", "w_open", "#ce93d8"), ("Monthly open", "m_open", "#8d6e63")]
LINE_LAYERS = ["EMA 12", "EMA 21", "EMA 50", "Impulse candles", "Volume MA", "Levels"] + [o[0] for o in OPENS] + ["Trade plan"]
LINE_DEFAULT = ["EMA 12", "EMA 21", "EMA 50", "Impulse candles", "Volume MA", "Levels", "Daily open", "NY midnight",
                "London open", "NY open", "Weekly open", "Trade plan"]
ZONE_LAYERS = ["Asia range", "Sessions", "VP prev day", "VP prev week", "VP visible range"]
ZONE_DEFAULT = ["Asia range", "Sessions", "VP prev day", "VP prev week"]
CHART_SIZE = {"S": 380, "M": 520, "L": 700, "XL": 900}   # price pane height (px)
WATCH_DEFAULT = ["BTC", "GOLD", "SILVER", "SPX", "NDX"]
IMPULSE = {"Strict": 2.5, "Normal": 2.0, "Loose": 1.5}   # body vs average body of last 20 candles
SETTINGS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lof_settings.json")


def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings():
    """Remember chart layer choices between sessions."""
    cfg = load_settings()
    for k, name in (("chart_lines", "lines"), ("chart_zones", "zones"), ("chart_panes", "panes"),
                    ("watchlist", "watchlist")):
        if k in st.session_state:
            cfg[name] = st.session_state[k] or []
    if st.session_state.get("chart_size"):
        cfg["size"] = st.session_state["chart_size"]
    if st.session_state.get("chart_impulse"):
        cfg["impulse"] = st.session_state["chart_impulse"]
    cfg["seen_lines"], cfg["seen_zones"] = LINE_LAYERS, ZONE_LAYERS
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
    except Exception:
        pass


# ════════════════════════════════════════════════════════════════
# PASSWORD
# ════════════════════════════════════════════════════════════════
pw = secret("APP_PASSWORD")
if pw and not st.session_state.get("auth_ok"):
    st.title("📊 LOF Dashboard")
    entered = st.text_input("Password", type="password")
    if entered:
        if hmac.compare_digest(entered, pw):
            st.session_state.auth_ok = True
            st.rerun()
        st.error("Wrong password.")
    st.stop()


# ════════════════════════════════════════════════════════════════
# CACHED DATA
# ════════════════════════════════════════════════════════════════
@st.cache_data(ttl=86400, show_spinner="Loading markets…")
def markets(key):
    return E.load_markets(key)


@st.cache_data(ttl=180, show_spinner="Loading market data…")
def bundle(key, perp_syms, spot_syms, ltf, ls_sym, oi_syms, ver=0):
    return E.load_bundle(key, list(perp_syms), list(spot_syms), ltf, ls_sym, list(oi_syms))


@st.cache_data(ttl=180, show_spinner="Loading chart…")
def chart_data(key, perp_syms, spot_syms, interval, candles, want_spot, want_oi, want_liq, oi_syms):
    return E.load_chart(key, list(perp_syms), list(spot_syms), interval, 300, candles,
                        want_spot, want_oi, want_liq, list(oi_syms))


@st.cache_data(ttl=600, show_spinner=False)
def overview(coin, override, cg_key, ver=0):
    return E.cg_overview(coin, override, cg_key)


@st.cache_data(ttl=300, show_spinner="Loading market data…")
def yahoo_bundle(ticker, ltf, ver=0):
    return E.load_yahoo_bundle(ticker, ltf)


@st.cache_data(ttl=300, show_spinner="Loading chart…")
def yahoo_chart(ticker, interval, ver=0):
    return E.load_yahoo_chart(ticker, interval)


@st.cache_data(ttl=300, show_spinner=False)
def pulse(cg_key, ver=0):
    return E.market_pulse(cg_key)


@st.cache_data(ttl=300, show_spinner=False)
def scan_row(key, asset, perp_sym, ltf, params, ver=0):
    """One watchlist row. Crypto: 4 Coinalyze calls. Gold / silver / indices: Yahoo Finance."""
    try:
        if asset in E.TRADFI:
            ticker, label = E.TRADFI[asset]
            b_ = E.load_yahoo_bundle(ticker, ltf)
            r_ = E.analyze(b_, [ticker], {}, *params)
            row = E.watch_row(label, r_)
            row["chg24"] = E.tradfi_overview(b_, r_["price"]).get("chg_24h", row["chg24"])   # vs previous session close
            row["key"] = asset
            return row
        else:
            label = asset
            b_ = E.load_light_bundle(key, perp_sym, ltf)
            r_ = E.analyze(b_, [perp_sym], {}, *params)
        row = E.watch_row(label, r_)
        row["key"] = asset
        return row
    except Exception as e:
        return {"key": asset, "asset": asset, "error": str(e)[:80]}


# ════════════════════════════════════════════════════════════════
# SIDEBAR
# ════════════════════════════════════════════════════════════════
api_key = secret("COINALYZE_API_KEY")
with st.sidebar:
    st.header("⚙️ Settings")
    if not api_key:
        api_key = st.text_input("Coinalyze API key", type="password",
                                help="Better: put COINALYZE_API_KEY in the app secrets.")
if not api_key:
    st.info("Add your Coinalyze API key in the sidebar (or in the app secrets) to start.")
    st.stop()

try:
    names, fut, spot = markets(api_key)
except Exception as e:
    st.error(f"Could not load markets: {e}")
    st.stop()

coins = E.coin_list(fut)
ASSETS = list(E.TRADFI) + coins
asset_label = lambda a: E.TRADFI[a][1] if a in E.TRADFI else a
if "asset" not in st.session_state:
    st.session_state["asset"] = "BTC" if "BTC" in coins else ASSETS[0]
_cfg0 = load_settings()
with st.sidebar:
    asset = st.selectbox("Asset", ASSETS, key="asset", format_func=asset_label,
                         help="Crypto (Coinalyze) or Gold / Silver / S&P 500 / Nasdaq futures (Yahoo Finance).")
    watch = st.multiselect("Watchlist", ASSETS, key="watchlist", format_func=asset_label,
                           default=[x for x in _cfg0.get("watchlist", WATCH_DEFAULT) if x in ASSETS],
                           on_change=save_settings)
    ltf_label = st.radio("Entry timeframe (LTF)", list(LTF_MAP), index=1, horizontal=True)
    with st.expander("Strategy settings"):
        piv = st.slider("Swing strength (MSS)", 1, 10, 3)
        valid = st.slider("Sweep / MSS valid for (bars)", 5, 60, 20)
        min_rr = st.number_input("Min R:R", 0.5, 10.0, 2.0, 0.1)
        min_score = st.slider("Min score (of 9)", 1, 9, 7)
    manual = st.checkbox("✅ Liquidations / footprint confirm (manual)")
    live_on = st.toggle("🔴 Live chart (updates every 20 s)", value=True, key="live_on")
    cg_override = st.text_input("CoinGecko ID override (optional)",
                                help="If coin info is wrong, enter the CoinGecko ID, e.g. 'pepe'.")
    if st.button("🔄 Refresh now", width="stretch"):
        bundle.clear()
        chart_data.clear()
        overview.clear()
        yahoo_bundle.clear()
        yahoo_chart.clear()
        scan_row.clear()
        pulse.clear()
    st.caption("Data is kept for 3 minutes, then reloads on your next click. "
               "Refresh now = load fresh data.")

is_tradfi = asset in E.TRADFI
coin = asset
params = (piv, valid, min_rr, min_score, manual)


# ════════════════════════════════════════════════════════════════
# WATCHLIST
# ════════════════════════════════════════════════════════════════
def _pick_from_watchlist():
    sel = st.session_state.get("wl_table")
    rows = sel["selection"]["rows"] if sel else []
    if rows and rows[0] < len(st.session_state.get("wl_assets", [])):
        st.session_state["asset"] = st.session_state["wl_assets"][rows[0]]


def render_watchlist():
    if not watch:
        return
    out = []
    for a in watch:
        ps_ = None
        if a not in E.TRADFI:
            pp = E.pick_perps(fut, names, a)
            if not pp:
                continue
            ps_ = pp[0]["symbol"]
        out.append(scan_row(api_key, a, ps_, LTF_MAP[ltf_label], params, ver=E._loaded_mtime))
    ok = [x for x in out if "error" not in x]
    bad = [x for x in out if "error" in x]
    rank = lambda x: (x["decision"] == "WAIT", x["setup"] == "NONE", -x["score"])
    ok.sort(key=rank)
    bias = lambda b_: "▲ BULL" if b_ == 1 else "▼ BEAR" if b_ == -1 else "– MIXED"
    rows = []
    for x in ok:
        rows.append({
            "Asset": x["asset"], "Price": fp(x["price"]), "24h": fpct(x["chg24"]),
            "Daily": bias(x["d_bias"]), "4H": bias(x["h_bias"]),
            "Location": f"{x['zone']} {'' if nan(x['pos']) else f'{x[chr(112)+chr(111)+chr(115)] * 100:.0f}%'}"
                        + (" · OTE" if x["ote"] else ""),
            "NY mid": "above" if x["vs_ny_mid"] == 1 else "below" if x["vs_ny_mid"] == -1 else "—",
            "Setup": "—" if x["setup"] == "NONE" else f"{x['setup']} {x['side']}",
            "Decision": f"{x['decision']} {x['score']}/9",
            "Nearest level": "—" if not x["near_name"] else f"{x['near_name']} {x['near_dist']:+.2f}%",
        })
    st.session_state["wl_assets"] = [x["key"] for x in ok]
    if rows:
        df = pd.DataFrame(rows)

        def color(v):
            v = str(v)
            if v.startswith(("▲", "+", "LONG", "DISCOUNT", "above")) or "LONG" in v:
                return f"color:{GREEN};font-weight:600"
            if v.startswith(("▼", "-", "SHORT", "PREMIUM", "below")) or "SHORT" in v:
                return f"color:{RED};font-weight:600"
            if v.startswith("WAIT"):
                return f"color:{AMBER}"
            return ""
        st.dataframe(df.style.map(color, subset=["24h", "Daily", "4H", "Location", "NY mid", "Setup", "Decision"]),
                     hide_index=True, width="stretch", on_select=_pick_from_watchlist,
                     selection_mode="single-row", key="wl_table")
        st.caption("Click a row to open it. Setups are sorted to the top. Crypto uses Coinalyze; "
                   "Gold, Silver, S&P 500 and Nasdaq use Yahoo Finance futures (price only, no order flow). "
                   "Rows refresh every 5 minutes.")
    for x in bad:
        st.warning(f"{asset_label(x['asset'])}: could not load ({x['error']})")


def spark_svg(vals, up=None):
    vals = [v for v in (vals or []) if v is not None and not nan(v)]
    if len(vals) < 2:
        return ""
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1
    n = len(vals) - 1
    pts = " ".join(f"{i / n * 100:.1f},{24 - (v - lo) / rng * 22:.1f}" for i, v in enumerate(vals))
    col = GREEN if (vals[-1] >= vals[0] if up is None else up) else RED
    return (f"<svg viewBox='0 0 100 26' preserveAspectRatio='none' style='width:100%;height:26px;margin-top:4px'>"
            f"<polyline points='{pts}' fill='none' stroke='{col}' stroke-width='1.6' vector-effect='non-scaling-stroke'/></svg>")


def fg_color(v):
    return "#d32f2f" if v < 25 else "#ef6c00" if v < 45 else "#9e9e9e" if v <= 55 else "#7cb342" if v <= 75 else "#2e7d32"


def pulse_tile(label, value, d1=None, d7=None, spark=None, note=None, value_color=None, up=None):
    def ch(txt, v):
        if txt is None:
            return ""
        return f"<span style='color:{tone(v)}'>{txt}</span>"
    chg = " · ".join(x for x in (ch(*d1) if d1 else "", ch(*d7) if d7 else "") if x)
    chg_html = f"<div class='note'>{chg}</div>" if chg else ""
    note_html = f"<div class='note' style='opacity:.65;font-weight:400'>{note}</div>" if note else ""
    vstyle = f" style='color:{value_color}'" if value_color else ""
    return (f"<div class='tile'><div class='lbl'>{label}</div><div class='val'{vstyle}>{value}</div>"
            f"{chg_html}{note_html}{spark_svg(spark, up)}</div>")


def pulse_row(title, tiles_html):
    if tiles_html:
        st.markdown(f"<div class='pulse-h'>{title}</div><div class='tiles pulse'>{''.join(tiles_html)}</div>",
                    unsafe_allow_html=True)


def _open_pulse():
    k = st.session_state.get("pulse_open")
    if k:
        st.session_state["asset"] = k
        st.session_state["pulse_open"] = None


def render_pulse():
    pdata = pulse(secret("COINGECKO_API_KEY"), ver=E._loaded_mtime)
    bp = lambda v: None if nan(v) else (f"{v:+.1f} bp", v)
    pc = lambda v, sfx="": None if nan(v) else (f"{v:+.2f}%{sfx}", v)
    macro = []
    for m in pdata["macro"]:
        v = m["value"]
        if nan(v):
            macro.append(pulse_tile(m["label"], "—"))
            continue
        if m["kind"] == "yield":
            macro.append(pulse_tile(m["label"], f"{v:.2f}%", bp(m["chg"]), (lambda x: None if x is None else (x[0] + " 7d", x[1]))(bp(m["chg7"])), m["spark"]))
        else:
            val = f"{v:.5f}" if m["kind"] == "ratio" else f"{v:,.2f}"
            macro.append(pulse_tile(m["label"], val, pc(m["chg"]), pc(m["chg7"], " 7d"), m["spark"]))
    pulse_row("Macro · daily change · 7-day trend", [t for t, m in zip(macro, pdata["macro"]) if m["key"] != "ETHBTC"])

    senti = []
    for key, label in (("fg_crypto", "Crypto Fear & Greed"), ("fg_stocks", "Stocks Fear & Greed (CNN)")):
        fg = pdata.get(key)
        if fg:
            pt = lambda v, sfx="": None if nan(v) else (f"{v:+.0f}{sfx}", v)
            senti.append(pulse_tile(label, f"{fg['value']} · {fg['label']}", pt(fg["chg"]), pt(fg["chg7"], " 7d"),
                                    fg["spark"], value_color=fg_color(fg["value"])))
    vix = next((m for m in pdata["macro"] if m["key"] == "VIX" and not nan(m["value"])), None)
    if vix:
        senti.append(pulse_tile("VIX regime", "calm" if vix["value"] < 15 else "normal" if vix["value"] < 20
                                else "elevated" if vix["value"] < 30 else "fear",
                                note="<15 calm · 20+ elevated · 30+ fear",
                                value_color=GREEN if vix["value"] < 20 else AMBER if vix["value"] < 30 else RED))
    pulse_row("Sentiment", senti)

    cg, hist = pdata["crypto"], pdata.get("crypto_hist") or {}
    crypto = [t for t, m in zip(macro, pdata["macro"]) if m["key"] == "ETHBTC"]
    if cg:
        H = lambda k: hist.get(k, {})
        pp = lambda v, sfx="": None if nan(v) else (f"{v:+.2f}{sfx}", v)
        for k, label in (("total", "Crypto market cap"), ("total2", "TOTAL2 (ex BTC)"), ("total3", "TOTAL3 (ex BTC, ETH)")):
            d1 = pc(cg["chg"], " 24h") if k == "total" and not nan(cg.get("chg")) else pc(H(k).get("chg", E.NAN), " 24h")
            crypto.append(pulse_tile(label, fusd(cg[k]), d1, pc(H(k).get("chg7", E.NAN), " 7d"), H(k).get("spark")))
        for k, label, note in (("btc_d", "BTC dominance", None), ("eth_d", "ETH dominance", None),
                               ("usdt_d", "USDT dominance", "up = risk-off")):
            if cg.get(k) is None:
                continue
            spark = H(k).get("spark")
            up = None
            if k == "usdt_d" and spark and len(spark) > 1:
                up = spark[-1] <= spark[0]          # rising USDT dominance = bearish for crypto -> red
            crypto.append(pulse_tile(label, f"{cg[k]:.2f}%", pp(H(k).get("chg", E.NAN), " pts 24h"),
                                     pp(H(k).get("chg7", E.NAN), " pts 7d"), spark, note=note, up=up))
    pulse_row("Crypto", crypto)

    opts = [m["key"] for m in pdata["macro"]]
    names = {m["key"]: m["label"] for m in pdata["macro"]}
    st.pills("Open full chart", opts, format_func=lambda k: names.get(k, k), key="pulse_open", on_change=_open_pulse)
    st.caption("Macro: Yahoo Finance · Fear & Greed: alternative.me (crypto), CNN (stocks) · Market caps and "
               "dominance: CoinGecko; their 7-day lines are estimated from the top 10 coins. Refreshes every 5 minutes.")


with st.expander("🌐 Market Pulse", expanded=True):
    try:
        render_pulse()
    except Exception as e:
        st.warning(f"Market Pulse unavailable right now ({str(e)[:80]}).")

with st.expander("📋 Watchlist", expanded=True):
    render_watchlist()

_t0 = time.perf_counter()
if is_tradfi:
    ticker, tf_name = E.TRADFI[asset]
    perp_syms, spot_syms, oi_syms = (ticker,), (), (ticker,)
    denoms, exch_of, ls_sym = {}, {}, None
    try:
        b = yahoo_bundle(ticker, LTF_MAP[ltf_label], ver=E._loaded_mtime)
        r = E.analyze(b, [ticker], denoms, *params)
    except Exception as e:
        st.error(f"Could not load {tf_name} from Yahoo Finance: {e}")
        st.stop()
    ov = None
else:
    perps = E.pick_perps(fut, names, coin)
    if not perps:
        st.error(f"No USDT/USDC perpetual with buy/sell data found for {coin}.")
        st.stop()
    spots = E.pick_spots(spot, names, coin)
    perp_syms = tuple(m["symbol"] for m in perps)
    spot_syms = tuple(m["symbol"] for m in spots)
    denoms = {m["symbol"]: m.get("oi_lq_vol_denominated_in", "BASE_ASSET") for m in perps}
    exch_of = {m["symbol"]: names.get(m["exchange"], m["exchange"]) for m in perps + spots}
    ls_sym = next((m["symbol"] for m in perps if m.get("has_long_short_ratio_data")), None)
    oi_syms = tuple(E.pick_oi_markets(fut, names, coin, perp_syms))
    exch_of.update({m["symbol"]: names.get(m["exchange"], m["exchange"]) for m in fut if m["symbol"] in oi_syms})
    try:
        b = bundle(api_key, perp_syms, spot_syms, LTF_MAP[ltf_label], ls_sym, oi_syms, ver=E._loaded_mtime)
        r = E.analyze(b, list(perp_syms), denoms, piv, valid, min_rr, min_score, manual)
    except Exception as e:
        st.error(f"Data error: {e}")
        st.stop()
    ov = overview(coin, cg_override, secret("COINGECKO_API_KEY"), ver=E._loaded_mtime)
tov = E.tradfi_overview(b, r["price"]) if is_tradfi else {}

# ════════════════════════════════════════════════════════════════
# HEADER
# ════════════════════════════════════════════════════════════════
dec = r["decision"]
dec_col = GREEN if dec == "LONG" else RED if dec == "SHORT" else AMBER
reg_label, reg_text, reg_tone = r["regime"]
reg_col = GREEN if reg_tone == "bull" else RED if reg_tone == "bear" else GREY

title = E.TRADFI[asset][1] if is_tradfi else (f"{ov['name']} ({coin})" if ov else coin)
sub = " · ".join(x for x in [f"Rank #{ov['rank']}" if ov and ov.get("rank") else "",
                              f"CoinGecko: {ov['id']}" if ov else "",
                              ", ".join(ov["categories"]) if ov and ov.get("categories") else ""] if x)
chg = tov.get("chg_24h") if is_tradfi else (ov.get("chg_24h") if ov else None)
if is_tradfi:
    sub = f"Chart: Yahoo Finance · {E.TRADFI[asset][0]} · price data only"
else:
    m0 = perps[0]
    sub = (sub + "<br>" if sub else "") + (f"Chart: {exch_of.get(m0['symbol'], m0['exchange'])} · "
           f"{m0.get('symbol_on_exchange', m0['symbol'])} · {m0.get('quote_asset', 'USDT')} perpetual · "
           f"OI from {len(oi_syms)} markets · CVD from {len(perp_syms)} perp + {len(spot_syms)} spot")
chg_html = "" if nan(chg) else f"<div style='color:{tone(chg)};font-size:0.95rem'>{chg:+.2f}% 24h</div>"
st.markdown(f"""
<div class='hdr'>
  <div class='hdr-title'><div class='coin'>{title}</div><div class='sub'>{sub}</div></div>
  <div class='hdr-price'><div class='lbl'>{"Price" if is_tradfi else "Price (perp)"}</div><div class='px'>{fp(r['price'])}</div>{chg_html}</div>
  <div class='badge' style='background:{dec_col}'><div class='big'>{dec}</div><div>score {r['score']}/9</div></div>
  <div class='badge wide' style='background:{reg_col}'><div class='big'>{reg_label}</div><div class='small'>{reg_text}</div></div>
</div>""", unsafe_allow_html=True)

# ════════════════════════════════════════════════════════════════
# COIN OVERVIEW
# ════════════════════════════════════════════════════════════════
if is_tradfi:
    if tov:
        tiles([
            ("24h", fpct(tov["chg_24h"]), None, tone(tov["chg_24h"])),
            ("1 week", fpct(tov["chg_7d"]), None, tone(tov["chg_7d"])),
            ("1 month", fpct(tov["chg_30d"]), None, tone(tov["chg_30d"])),
            ("52-week high", fp(tov["hi_52w"]), f"{(r['price'] / tov['hi_52w'] - 1) * 100:+.1f}% from price", None),
            ("52-week low", fp(tov["lo_52w"]), f"{(r['price'] / tov['lo_52w'] - 1) * 100:+.1f}% from price", None),
        ])
elif ov:
    mc_fdv = ov["mcap"] / ov["fdv"] * 100 if ov.get("mcap") and ov.get("fdv") else None
    oi_mc = r["oi_now"] / ov["mcap"] * 100 if ov.get("mcap") and not nan(r["oi_now"]) else None
    tiles([
        ("Market cap", fusd(ov["mcap"]), None, None),
        ("FDV", fusd(ov["fdv"]), None, None),
        ("MC / FDV", "No max supply" if ov.get("inflationary") else ("—" if mc_fdv is None else f"{mc_fdv:.0f}%"),
         "supply keeps growing (inflation)" if ov.get("inflationary") else "low = unlock risk", None),
        ("24h volume", fusd(ov["volume"]), None, None),
        ("7d", fpct(ov.get("chg_7d")), None, tone(ov.get("chg_7d"))),
        ("30d", fpct(ov.get("chg_30d")), None, tone(ov.get("chg_30d"))),
        ("From ATH", fpct(ov.get("ath_chg"), 1), f"ATH {fp(ov.get('ath'))}", None),
        ("OI / MC", "—" if oi_mc is None else f"{oi_mc:.1f}%", "high = crowded", None),
    ])
else:
    st.caption("Coin info from CoinGecko unavailable. Set the CoinGecko ID override in the sidebar.")

st.divider()

# ════════════════════════════════════════════════════════════════
# BIAS · LEVELS · TRADE PLAN
# ════════════════════════════════════════════════════════════════
c1, c2, c3 = st.columns([1, 1.15, 1.1])
loc = r["loc"]
with c1:
    pos = loc["pos"]
    zone_col = GREEN if loc["zone"] == "DISCOUNT" else RED if loc["zone"] == "PREMIUM" else GREY
    ote = " · OTE" if loc["in_ote_long"] or loc["in_ote_short"] else ""
    ses_col = GREEN if r["session"] != "OFF" else GREY
    card("Bias & Location", [
        ("Daily EMA 12/21", bias_pill(r["d_bias"])),
        ("4H EMA 12/21", bias_pill(r["h_bias"])),
        ("Location (4H range)", pill(f"{loc['zone']} {'' if nan(pos) else f'{pos * 100:.0f}%'}{ote}", zone_col)),
        ("Range high", fp(loc["hi"])),
        ("Equilibrium 0.5", fp(loc["eq"])),
        ("Range low", fp(loc["lo"])),
        ("OTE long zone", f"{fp(loc['ote_long'][0])} – {fp(loc['ote_long'][1])}"),
        ("OTE short zone", f"{fp(loc['ote_short'][0])} – {fp(loc['ote_short'][1])}"),
        ("Session (NY time)", pill(r["session"], ses_col)),
        ("vs NY midnight open", pill("ABOVE · bullish day", GREEN) if r["vs_ny_mid"] == 1
         else pill("BELOW · bearish day", RED) if r["vs_ny_mid"] == -1 else "—"),
    ])

with c2:
    lv = r["levels"]
    rows = [("PWH", lv["pwh"]), ("PDH", lv["pdh"]), ("W VAH", lv["pw_vah"]), ("D VAH", lv["pd_vah"]),
            ("W POC", lv["pw_poc"]), ("D POC", lv["pd_poc"]), ("D VAL", lv["pd_val"]),
            ("W VAL", lv["pw_val"]), ("PDL", lv["pdl"]), ("PWL", lv["pwl"])]
    op = r["opens"]
    rows += [(f"<span style='color:#00bcd4'>{n}</span>", op[k]["price"]) for n, k in
             (("Daily open", "d_open"), ("NY midnight", "ny_mid"), ("London open", "ldn_open"),
              ("NY open", "ny_open"), ("Weekly open", "w_open"), ("Monthly open", "m_open")) if k in op]
    rows = [(k, v) for k, v in rows if not nan(v)] + [("▶ PRICE", r["price"])]
    rows.sort(key=lambda x: -x[1])
    out = []
    for k, v in rows:
        if k == "▶ PRICE":
            out.append((f"<b>{k}</b>", f"<b>{fp(v)}</b>"))
        else:
            d = (v / r["price"] - 1) * 100
            out.append((k, f"{fp(v)} &nbsp; <span style='color:{tone(d)}'>{d:+.2f}%</span>"))
    card("Key levels (prev day / week · opens)", out)

with c3:
    if r["setup"] == "NONE":
        card(f"Trade plan · {pill('NO SETUP', GREY)}", [
            ("Long side", f"{r['set_long'].title() if r['set_long'] != 'NONE' else 'no setup'} · {r['score_long']}/9"),
            ("Short side", f"{r['set_short'].title() if r['set_short'] != 'NONE' else 'no setup'} · {r['score_short']}/9"),
            ("Waiting for", "Setup A (sweep) or B (pullback)"),
            ("Price", fp(r["price"])),
        ])
    else:
        side = "LONG" if r["lead_long"] else "SHORT"
        side_col = GREEN if r["lead_long"] else RED
        ready = r["decision"] != "WAIT"
        mss_txt = f"✓ {r['mss_ago']} bars ago" if r["mss_ok"] else "waiting"
        rr = r["rr"]
        card(f"Trade plan · {pill(side + ('' if ready else ' · waiting'), side_col if ready else GREY)}", [
            ("Setup", r["setup"]),
            (f"LTF MSS ({ltf_label})", mss_txt),
            ("Entry (now)", fp(r["price"])),
            ("Stop loss", f"<span style='color:{RED}'>{fp(r['sl'])}</span>"),
            ("TP1", f"<span style='color:{GREEN}'>{fp(r['tp1'])}</span>"),
            ("TP2", f"<span style='color:{GREEN}'>{fp(r['tp2'])}</span>"),
            ("R:R (to TP1)", pill("—" if nan(rr) else f"1 : {rr:.2f}",
                                  GREY if nan(rr) else GREEN if rr >= min_rr else RED)),
        ])
    side_name = "long" if r["lead_long"] else "short"
    card(f"Pre-entry checklist · {side_name.upper()} side · {r['score']}/9",
         [(("✅ " if ok else "❌ ") + label, "") for label, ok in r["checks"]]
         + [("<span style='opacity:0.7'>Take the trade only when every box is ✅</span>", "")])

# ════════════════════════════════════════════════════════════════
# DERIVATIVES & FLOW
# ════════════════════════════════════════════════════════════════
st.subheader("Derivatives & order flow")
if is_tradfi:
    st.info("Order flow data (OI, funding, CVD, liquidations) isn't available for this market from free sources. "
            "Use bias, levels, opens and structure.")
else:
    side_txt = lambda v: None if nan(v) else ("buyers" if v > 0 else "sellers")
    tiles([
        ("Open interest", fusd(r["oi_now"]), None if nan(r["oi_24h"]) else f"{fpct(r['oi_24h'])} 24h", None),
        ("OI change 1h / 4h", f"{fpct(r['oi_1h'])} / {fpct(r['oi_4h'])}", None, tone(r["oi_4h"])),
        ("Funding (OI-wtd)", "—" if nan(r["funding"]) else f"{r['funding']:+.4f}%",
         None if nan(r["pred_funding"]) else f"next {r['pred_funding']:+.4f}%", None),
        ("Perp CVD (4h)", fusd(r["perp_cvd_4h"]), side_txt(r["perp_cvd_4h"]), tone(r["perp_cvd_4h"])),
        ("Spot CVD (4h)", fusd(r["spot_cvd_4h"]), side_txt(r["spot_cvd_4h"]), tone(r["spot_cvd_4h"])),
        ("Liquidations 24h", f"L {fusd(r['liq_long_24h'])}", f"S {fusd(r['liq_short_24h'])}", None),
    ])

    if r["regime_notes"]:
        for text, t in r["regime_notes"]:
            (st.success if t == "bull" else st.error if t == "bear" else st.info)(text)
    if not nan(r["ls_ratio"]):
        st.caption(f"Long/short account ratio ({exch_of.get(ls_sym, '')}): **{r['ls_ratio']:.2f}**  "
                   "(>1 = more accounts long)")

# ════════════════════════════════════════════════════════════════
# CHARTS
# ════════════════════════════════════════════════════════════════
st.subheader("Chart")
PANES = ["OI", "Perp CVD", "Spot CVD", "Volume", "Liquidations"]


@st.cache_resource
def lwc_js():
    """TradingView Lightweight Charts library (lwc.js next to app.py); CDN if the file is missing."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lwc.js")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return "<script>" + f.read() + "</script>"
    return "<script src='https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js'></script>"


DRAW_JS = r"""
// LOF drawing tools for TradingView Lightweight Charts v5.
// Needs: chart, cs (candlestick series), D (data with candles, coin, prec), off (tz offset seconds), LC.
(function () {
  const RT = D.candles.map(c => c.time);          // raw UTC times
  const N = RT.length;
  const STEP = N > 1 ? RT[N - 1] - RT[N - 2] : 60;
  const KEY = 'lof_draw_' + D.coin;
  const fmt = p => Number(p).toFixed(D.prec);
  const FIB = [0, 0.5, 0.62, 0.705, 0.79, 1];

  // ── time <-> logical (bar index), works between bars and beyond the last bar
  function timeToLogical(t) {
    if (t <= RT[0]) return (t - RT[0]) / STEP;
    if (t >= RT[N - 1]) return N - 1 + (t - RT[N - 1]) / STEP;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (RT[m] <= t) lo = m; else hi = m; }
    return lo + (t - RT[lo]) / (RT[hi] - RT[lo]);
  }
  function logicalToTime(l) {
    if (l <= 0) return RT[0] + l * STEP;
    if (l >= N - 1) return RT[N - 1] + (l - (N - 1)) * STEP;
    const i = Math.floor(l), f = l - i;
    return RT[i] + f * (RT[i + 1] - RT[i]);
  }
  const X = t => chart.timeScale().logicalToCoordinate(timeToLogical(t));
  const Y = p => cs.priceToCoordinate(p);

  // ── state
  let shapes = [];
  try { shapes = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { shapes = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(shapes)); } catch (e) {} };
  let tool = 'cursor', pending = [], hover = null, magnet = true;
  const NEED = { h: 1, trend: 2, rect: 2, fib: 2, long: 3, short: 3 };
  const hLines = new Map();   // shape -> price line

  // ── canvas drawing layer
  function line(ctx, x1, y1, x2, y2, color, w, dash) {
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = w || 1.5;
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
  }
  function label(ctx, txt, x, y, color, bg) {
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(txt).width + 8;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y - 13, w, 16); }
    ctx.fillStyle = color; ctx.fillText(txt, x + 4, y - 1);
  }
  function drawShape(ctx, s, W) {
    if (s.type === 'h') return;   // price lines handle these
    const x1 = X(s.t1), y1 = Y(s.p1);
    if (x1 == null || y1 == null) return;
    if (s.type === 'trend') {
      const x2 = X(s.t2), y2 = Y(s.p2); if (x2 == null || y2 == null) return;
      line(ctx, x1, y1, x2, y2, '#2962ff', 2);
      [[x1, y1], [x2, y2]].forEach(([a, b]) => { ctx.beginPath(); ctx.fillStyle = '#2962ff'; ctx.arc(a, b, 3, 0, 7); ctx.fill(); });
    } else if (s.type === 'rect') {
      const x2 = X(s.t2), y2 = Y(s.p2); if (x2 == null || y2 == null) return;
      ctx.fillStyle = 'rgba(41,98,255,0.15)'; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === 'fib') {
      // TradingView convention: 1 = first click (A), 0 = second click (B)
      const pr = l => s.p2 + (s.p1 - s.p2) * l;
      const ya = Y(pr(0.62)), yb = Y(pr(0.79));
      if (ya != null && yb != null) { ctx.fillStyle = 'rgba(249,168,37,0.13)'; ctx.fillRect(x1, Math.min(ya, yb), W - x1, Math.abs(yb - ya)); }
      FIB.forEach(l => {
        const y = Y(pr(l)); if (y == null) return;
        const c = (l === 0.62 || l === 0.705 || l === 0.79) ? '#f9a825' : l === 0.5 ? '#9598a1' : '#d1d4dc';
        line(ctx, x1, y, W, y, c, 1);
        label(ctx, `${l} (${fmt(pr(l))})`, x1, y, c);
      });
      const x2 = X(s.t2), y2 = Y(s.p2);
      if (x2 != null && y2 != null) line(ctx, x1, y1, x2, y2, '#9598a1', 1, [4, 4]);
    } else if (s.type === 'long' || s.type === 'short') {
      let x2 = X(s.t2); if (x2 == null) return;
      if (x2 - x1 < 40) x2 = x1 + 120;
      const ye = y1, ys = Y(s.p2), yt = Y(s.p3); if (ys == null || yt == null) return;
      ctx.fillStyle = 'rgba(38,166,154,0.22)'; ctx.fillRect(x1, Math.min(ye, yt), x2 - x1, Math.abs(yt - ye));
      ctx.fillStyle = 'rgba(239,83,80,0.22)'; ctx.fillRect(x1, Math.min(ye, ys), x2 - x1, Math.abs(ys - ye));
      line(ctx, x1, ye, x2, ye, '#d1d4dc', 1);
      const risk = Math.abs(s.p1 - s.p2), rr = risk > 0 ? Math.abs(s.p3 - s.p1) / risk : 0;
      label(ctx, `${s.type.toUpperCase()}  entry ${fmt(s.p1)}  R:R 1:${rr.toFixed(2)}`, x1 + 2, ye - 2, '#fff', 'rgba(19,23,34,0.85)');
      label(ctx, `TP ${fmt(s.p3)} (${(Math.abs(s.p3 - s.p1) / s.p1 * 100).toFixed(2)}%)`, x1 + 2, yt + (yt < ye ? 14 : -2), '#26a69a');
      label(ctx, `SL ${fmt(s.p2)} (${(risk / s.p1 * 100).toFixed(2)}%)`, x1 + 2, ys + (ys > ye ? -2 : 14), '#ef5350');
    }
  }
  function previewShape() {
    if (!pending.length || !hover) return null;
    const pts = pending.concat([hover]);
    const s = { type: tool, t1: pts[0].t, p1: pts[0].p };
    if (tool === 'long' || tool === 'short') {
      s.p2 = pts[1] ? pts[1].p : hover.p;
      s.p3 = pts[2] ? pts[2].p : s.p1 + (s.p1 - s.p2) * 2;
      s.t2 = pts[pts.length - 1].t;
    } else { s.t2 = pts[1].t; s.p2 = pts[1].p; }
    return s;
  }
  const layer = {
    attached(p) { this.req = p.requestUpdate; },
    detached() {},
    updateAllViews() {},
    paneViews() {
      return [{
        zOrder: () => 'top',
        renderer: () => ({
          draw: target => target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const W = mediaSize.width;
            shapes.forEach(s => drawShape(ctx, s, W));
            const pv = previewShape(); if (pv) { ctx.globalAlpha = 0.7; drawShape(ctx, pv, W); ctx.globalAlpha = 1; }
            if (pending.length && tool !== 'cursor') {
              pending.forEach(p => { const x = X(p.t), y = Y(p.p); if (x != null && y != null) { ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(x, y, 3, 0, 7); ctx.fill(); } });
            }
          }),
        }),
      }];
    },
  };
  cs.attachPrimitive(layer);
  const redraw = () => layer.req && layer.req();

  // ── horizontal lines (with price-axis label)
  function addH(s) { hLines.set(s, cs.createPriceLine({ price: s.p1, color: '#2962ff', lineWidth: 1, lineStyle: LC.LineStyle.Solid, axisLabelVisible: true, title: '' })); }
  shapes.filter(s => s.type === 'h').forEach(addH);

  // ── mouse
  function pointFrom(param) {
    if (!param.point || param.logical == null || param.paneIndex !== 0) return null;
    let p = cs.coordinateToPrice(param.point.y); if (p == null) return null;
    const l = param.logical;
    if (magnet) {
      const i = Math.round(l);
      if (i >= 0 && i < N) {
        const c = D.candles[i];
        const near = [c.open, c.high, c.low, c.close].reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a);
        const yy = cs.priceToCoordinate(near);
        if (yy != null && Math.abs(yy - param.point.y) < 14) p = near;   // snap only when close
      }
    }
    return { t: logicalToTime(Math.round(l)), p };
  }
  chart.subscribeCrosshairMove(param => { if (tool !== 'cursor') { hover = pointFrom(param); redraw(); } });
  chart.subscribeClick(param => {
    if (tool === 'cursor') return;
    const pt = pointFrom(param); if (!pt) return;
    pending.push(pt);
    if (pending.length >= NEED[tool]) {
      const s = { type: tool, t1: pending[0].t, p1: pending[0].p };
      if (tool === 'long' || tool === 'short') { s.p2 = pending[1].p; s.p3 = pending[2].p; s.t2 = pending[2].t; }
      else if (NEED[tool] === 2) { s.t2 = pending[1].t; s.p2 = pending[1].p; }
      shapes.push(s); if (s.type === 'h') addH(s);
      save(); setTool('cursor');
    }
    redraw();
  });

  // ── toolbar
  const bar = document.getElementById('tools');
  const hint = document.getElementById('hint');
  const HINT = { h: 'Click a price', trend: 'Click 2 points', rect: 'Click 2 corners',
                 fib: 'Click swing start, then swing end', long: 'Click entry, then stop, then target',
                 short: 'Click entry, then stop, then target' };
  function setTool(t) {
    tool = t; pending = []; hover = null;
    bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    hint.textContent = HINT[t] || ''; hint.style.display = HINT[t] ? 'block' : 'none';
    document.getElementById('c').style.cursor = t === 'cursor' ? 'default' : 'crosshair';
    redraw();
  }
  function undo() {
    const s = shapes.pop(); if (!s) return;
    if (s.type === 'h' && hLines.has(s)) { cs.removePriceLine(hLines.get(s)); hLines.delete(s); }
    save(); redraw();
  }
  function clearAll() {
    if (!shapes.length || !confirm('Delete all drawings for ' + D.coin + '?')) return;
    hLines.forEach(pl => cs.removePriceLine(pl)); hLines.clear(); shapes = []; save(); redraw();
  }
  bar.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(tool === b.dataset.tool ? 'cursor' : b.dataset.tool));
  document.getElementById('undo').onclick = undo;
  document.getElementById('clear').onclick = clearAll;
  const mag = document.getElementById('magnet');
  mag.classList.toggle('on', magnet);
  mag.onclick = () => { magnet = !magnet; mag.classList.toggle('on', magnet); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setTool('cursor');
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  });
  setTool('cursor');
})();

// ── Visible-range volume profile (like TradingView VPVR) on the price pane
(function () {
  if (!D.vp || !D.vol || !D.vol.length) return;
  const ROWS = 48, VA = 0.70;
  const vp = {
    attached(p) { this.req = p.requestUpdate; },
    detached() {},
    updateAllViews() {},
    paneViews() {
      return [{
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: target => target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const r = chart.timeScale().getVisibleLogicalRange(); if (!r) return;
            const a = Math.max(0, Math.ceil(r.from)), b = Math.min(D.candles.length - 1, Math.floor(r.to));
            if (b - a < 3) return;
            let lo = Infinity, hi = -Infinity;
            for (let i = a; i <= b; i++) { lo = Math.min(lo, D.candles[i].low); hi = Math.max(hi, D.candles[i].high); }
            if (!(hi > lo)) return;
            const step = (hi - lo) / ROWS, up = new Array(ROWS).fill(0), dn = new Array(ROWS).fill(0);
            for (let i = a; i <= b; i++) {
              const c = D.candles[i], v = D.vol[i] || 0; if (!v) continue;
              const r0 = Math.min(ROWS - 1, Math.max(0, Math.floor((c.low - lo) / step)));
              const r1 = Math.min(ROWS - 1, Math.max(0, Math.floor((c.high - lo) / step)));
              const sh = v / (r1 - r0 + 1), arr = c.close >= c.open ? up : dn;
              for (let k = r0; k <= r1; k++) arr[k] += sh;
            }
            const tot = up.map((x, i) => x + dn[i]);
            const total = tot.reduce((x, y) => x + y, 0); if (!total) return;
            let poc = 0; tot.forEach((x, i) => { if (x > tot[poc]) poc = i; });
            let u = poc, d = poc, acc = tot[poc];
            while (acc < total * VA && (u < ROWS - 1 || d > 0)) {
              const vu = u < ROWS - 1 ? tot[u + 1] : -1, vd = d > 0 ? tot[d - 1] : -1;
              if (vu >= vd) { u++; acc += vu; } else { d--; acc += vd; }
            }
            const W = mediaSize.width, maxW = W * 0.22, mx = tot[poc];
            for (let i = 0; i < ROWS; i++) {
              const yTop = cs.priceToCoordinate(lo + step * (i + 1)), yBot = cs.priceToCoordinate(lo + step * i);
              if (yTop == null || yBot == null) continue;
              const h = Math.max(1, Math.abs(yBot - yTop) - 1), inVA = i >= d && i <= u;
              const wUp = maxW * up[i] / mx, wDn = maxW * dn[i] / mx;
              ctx.fillStyle = inVA ? 'rgba(38,166,154,0.38)' : 'rgba(38,166,154,0.16)';
              ctx.fillRect(W - wUp - wDn, yTop, wUp, h);
              ctx.fillStyle = inVA ? 'rgba(239,83,80,0.38)' : 'rgba(239,83,80,0.16)';
              ctx.fillRect(W - wDn, yTop, wDn, h);
            }
            const yp = cs.priceToCoordinate(lo + step * (poc + 0.5));
            if (yp != null) {
              ctx.strokeStyle = '#f9a825'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
              ctx.beginPath(); ctx.moveTo(0, yp); ctx.lineTo(W, yp); ctx.stroke(); ctx.setLineDash([]);
              ctx.font = '11px sans-serif'; ctx.fillStyle = '#f9a825';
              ctx.fillText('VP POC ' + (lo + step * (poc + 0.5)).toFixed(D.prec), W - maxW - 4 - 110, yp - 4);
            }
          }),
        }),
      }];
    },
  };
  cs.attachPrimitive(vp);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => vp.req && vp.req());
})();

// ── TradingView-style vertical drag: dragging inside any pane moves it up/down as well as sideways.
//    Auto-scale turns off while you drag; double-click the price axis to go back to auto-scale.
(function () {
  const el = document.getElementById('c');
  let drag = null;
  function paneAt(y) {
    let top = 0;
    for (const p of chart.panes()) { const h = p.getHeight(); if (y >= top && y < top + h) return { p, h }; top += h + 1; }
    return null;
  }
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (typeof tool !== 'undefined' && tool !== 'cursor') return;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > r.width - cs.priceScale().width()) return;          // not on the price axis
    if (y > r.height - chart.timeScale().height()) return;      // not on the time axis
    const hit = paneAt(y); if (!hit) return;
    const ser = hit.p.getSeries()[0]; if (!ser) return;
    const ps = ser.priceScale(), vr = ps.getVisibleRange(); if (!vr) return;
    drag = { ps, vr, y0: e.clientY, h: hit.h, auto: ps.options().autoScale, moved: false };
  }, true);
  window.addEventListener('pointermove', e => {
    if (!drag || !(e.buttons & 1)) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    const shift = dy * (drag.vr.to - drag.vr.from) / drag.h;   // drag down = see higher prices
    const target = { from: drag.vr.from + shift, to: drag.vr.to + shift };
    drag.ps.applyOptions({ autoScale: false });
    drag.ps.setVisibleRange(target);
    requestAnimationFrame(() => drag && drag.ps.setVisibleRange(target));
  }, true);
  window.addEventListener('pointerup', () => { drag = null; }, true);
})();

// ── Chart layers: opens, Asia range, sessions, previous day / week volume profiles, trade plan lines
(function () {
  const L = D.layers || {};
  const RT = D.candles.map(c => c.time), N = RT.length;
  if (!N) return;
  const STEP = N > 1 ? RT[N - 1] - RT[N - 2] : 60;
  function tl(t) {
    if (t <= RT[0]) return (t - RT[0]) / STEP;
    if (t >= RT[N - 1]) return N - 1 + (t - RT[N - 1]) / STEP;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (RT[m] <= t) lo = m; else hi = m; }
    return lo + (t - RT[lo]) / (RT[hi] - RT[lo]);
  }
  const X = t => chart.timeScale().logicalToCoordinate(tl(t));
  const Y = p => cs.priceToCoordinate(p);
  const fmt = p => Number(p).toFixed(D.prec);
  function hline(ctx, x1, x2, y, color, dash, w) {
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
  }
  function text(ctx, s, x, y, color, align) {
    ctx.font = '11px sans-serif'; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y);
    ctx.textAlign = 'left';
  }

  // sessions: London 02:00-05:00 NY, New York 07:00-10:00 NY (intraday charts only)
  const nyMin = (() => {
    if (!L.sessions || STEP > 3600) return null;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    return RT.map(t => { const p = f.formatToParts(new Date(t * 1000)); const g = k => +p.find(x => x.type === k).value; return g('hour') * 60 + g('minute'); });
  })();
  const sess = m => (m >= 120 && m < 300) ? 'L' : (m >= 420 && m < 600) ? 'N' : null;

  function drawProfile(ctx, p, pal, W) {
    const x1 = X(p.start), x2 = X(p.end);
    if (x1 == null || x2 == null || x2 < 0 || x1 > W) return;
    const tot = p.up.map((u, i) => u + p.dn[i]), mx = Math.max(...tot) || 1;
    const width = Math.max(40, (x2 - x1) * 0.35);
    for (let i = 0; i < tot.length; i++) {
      const yt = Y(p.lo + p.step * (i + 1)), yb = Y(p.lo + p.step * i);
      if (yt == null || yb == null) continue;
      const h = Math.max(1, Math.abs(yb - yt) - 1), mid = p.lo + p.step * (i + 0.5);
      const inVA = mid >= p.val && mid <= p.vah, a = inVA ? pal.a1 : pal.a2;
      const wu = width * p.up[i] / mx, wd = width * p.dn[i] / mx;
      ctx.fillStyle = pal.up.replace('A', a); ctx.fillRect(x1, yt, wu, h);
      ctx.fillStyle = pal.dn.replace('A', a); ctx.fillRect(x1 + wu, yt, wd, h);
    }
    const end = Math.min(x2, W);
    [[p.poc, pal.poc, [], 'POC'], [p.vah, pal.va, [4, 3], 'VAH'], [p.val, pal.va, [4, 3], 'VAL']].forEach(([v, c, d, n]) => {
      const y = Y(v); if (y == null) return;
      hline(ctx, x1, end, y, c, d, n === 'POC' ? 1.5 : 1);
      text(ctx, `${pal.tag} ${n}`, x1 + 3, y - 3, c);
    });
  }

  const layer = {
    attached(p) { this.req = p.requestUpdate; }, detached() {}, updateAllViews() {},
    paneViews() {
      return [{
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: target => target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const W = mediaSize.width, H = mediaSize.height;
            // sessions
            if (nyMin) {
              const bs = chart.timeScale().options().barSpacing / 2;
              let i = 0;
              while (i < N) {
                const s = sess(nyMin[i]); if (!s) { i++; continue; }
                let j = i; while (j + 1 < N && sess(nyMin[j + 1]) === s) j++;
                const a = chart.timeScale().logicalToCoordinate(i), b = chart.timeScale().logicalToCoordinate(j);
                if (a != null && b != null && b > -50 && a < W + 50) {
                  ctx.fillStyle = s === 'L' ? 'rgba(41,98,255,0.07)' : 'rgba(249,168,37,0.07)';
                  ctx.fillRect(a - bs, 0, b - a + 2 * bs, H);
                  text(ctx, s === 'L' ? 'London' : 'New York', a - bs + 3, H - 6, s === 'L' ? '#5b7fff' : '#c9952a');
                }
                i = j + 1;
              }
            }
            // previous week / day volume profiles
            if (L.vp_week && D.profiles.week) drawProfile(ctx, D.profiles.week, { up: 'rgba(171,71,188,A)', dn: 'rgba(171,71,188,A)', a1: 0.38, a2: 0.16, poc: '#ce93d8', va: '#ab47bc', tag: 'W' }, W);
            if (L.vp_day && D.profiles.day) drawProfile(ctx, D.profiles.day, { up: 'rgba(38,166,154,A)', dn: 'rgba(239,83,80,A)', a1: 0.42, a2: 0.18, poc: '#f9a825', va: '#9598a1', tag: 'D' }, W);
            // Asia range
            if (L.asia && D.asia) {
              const a = D.asia, x1 = X(a.start), x2 = X(a.end), yh = Y(a.hi), yl = Y(a.lo);
              if (x1 != null && x2 != null && yh != null && yl != null) {
                ctx.fillStyle = 'rgba(149,152,161,0.10)'; ctx.fillRect(x1, yh, x2 - x1, yl - yh);
                ctx.strokeStyle = 'rgba(149,152,161,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x1, yh, x2 - x1, yl - yh);
                hline(ctx, x2, W, yh, 'rgba(149,152,161,0.7)', [3, 3]); hline(ctx, x2, W, yl, 'rgba(149,152,161,0.7)', [3, 3]);
                text(ctx, `Asia H ${fmt(a.hi)}`, x1 + 3, yh - 3, '#b2b5be'); text(ctx, `Asia L ${fmt(a.lo)}`, x1 + 3, yl + 12, '#b2b5be');
              }
            }
            // opens: line from the open time to the right edge
            (D.opens || []).forEach(o => {
              const y = Y(o.price); if (y == null) return;
              let x = X(o.time); if (x == null) return; x = Math.max(0, x);
              hline(ctx, x, W, y, o.color, [6, 3], 1.2);
              text(ctx, `${o.title} ${fmt(o.price)}`, x + 4, y - 3, o.color);
            });
          }),
        }),
      }];
    },
  };
  cs.attachPrimitive(layer);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => layer.req && layer.req());

  // trade plan: entry / SL / TP lines with price-axis labels
  (D.plan || []).forEach(p => cs.createPriceLine({ price: p.price, color: p.color, lineWidth: 2,
    lineStyle: p.title === 'Entry' ? LC.LineStyle.Solid : LC.LineStyle.LargeDashed, axisLabelVisible: true, title: p.title }));
})();

// ── EMA 12 / 21 / 50 and impulse (displacement) candles on the chart timeframe
(function () {
  const L = D.layers || {}, C = D.candles;
  if (!C.length) return;
  const closes = C.map(c => c.close);
  function ema(n) {
    const k = 2 / (n + 1), out = []; let e = closes[0];
    closes.forEach((v, i) => { e = i === 0 ? v : v * k + e * (1 - k); out.push(e); });
    return out;
  }
  [[12, 'ema12', '#26c6da'], [21, 'ema21', '#ffb74d'], [50, 'ema50', '#e0e0e0']].forEach(([n, key, color]) => {
    if (!L[key]) return;
    const e = ema(n), s = chart.addSeries(LC.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false, title: 'EMA ' + n }, 0);
    s.setData(T(C.map((c, i) => ({ time: c.time, value: e[i] })).slice(Math.min(n, C.length - 1))));
  });
  if (L.impulse) {
    // Displacement: body >= K x average body of the previous 20 candles and body >= 60% of the candle range
    const K = D.impulseMult || 2.0, N0 = 20;
    const bodies = C.map(c => Math.abs(c.close - c.open));
    let sum = 0;
    const out = C.map((c, i) => {
      const avg = i >= N0 ? sum / N0 : 0;
      sum += bodies[i]; if (i >= N0) sum -= bodies[i - N0];
      const rng = c.high - c.low;
      if (i >= N0 && avg > 0 && rng > 0 && bodies[i] >= K * avg && bodies[i] / rng >= 0.6) {
        const col = c.close > c.open ? '#40c4ff' : '#ff4081';
        return Object.assign({}, c, { color: col, wickColor: col, borderColor: col });
      }
      return c;
    });
    cs.setData(T(out));
  }
})();

// ── Zoom buttons + keyboard zoom (Ctrl + / Ctrl - / + / - / 0 while the mouse is over the chart)
(function () {
  const ts = chart.timeScale(), n = D.candles.length;
  function zoom(f) {
    const r = ts.getVisibleLogicalRange(); if (!r) return;
    const w = (r.to - r.from) * f;
    if (w < 10 || w > n * 3) return;
    ts.setVisibleLogicalRange({ from: r.to - w, to: r.to });   // keep the right edge, like TradingView
  }
  function reset() {
    cs.priceScale().applyOptions({ autoScale: true });
    ts.setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 5 });
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:8px;left:135px;z-index:10;display:flex;gap:4px';
  [['＋', 'Zoom in (Ctrl +)', () => zoom(0.8)], ['－', 'Zoom out (Ctrl −)', () => zoom(1.25)],
   ['⟲', 'Reset view (0)', reset]].forEach(([t, title, fn]) => {
    const b = document.createElement('button');
    b.textContent = t; b.title = title; b.onclick = fn;
    b.style.cssText = 'background:#2a2e39;color:#d1d4dc;border:1px solid #363a45;border-radius:6px;' +
                      'width:30px;height:26px;cursor:pointer;font:14px sans-serif;opacity:0.85';
    box.appendChild(b);
  });
  document.getElementById('wrap').appendChild(box);
  const hint = document.getElementById('hint'); if (hint) hint.style.left = '240px';
  let over = false;
  const el = document.getElementById('wrap');
  el.tabIndex = -1; el.style.outline = 'none';
  el.addEventListener('mouseenter', () => { over = true; try { window.focus(); el.focus({ preventScroll: true }); } catch (e) {} });
  el.addEventListener('mouseleave', () => { over = false; });
  window.addEventListener('keydown', e => {
    if (!over && !document.fullscreenElement) return;
    const k = e.key;
    if (k === '+' || k === '=') { e.preventDefault(); zoom(0.8); }
    else if (k === '-' || k === '_') { e.preventDefault(); zoom(1.25); }
    else if (k === '0' && !e.ctrlKey) { e.preventDefault(); reset(); }
  }, true);
})();

// ── Mouse wheel over the price axis stretches / squeezes that pane vertically (TradingView-style)
(function () {
  const el = document.getElementById('c');
  el.addEventListener('wheel', e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const axisW = cs.priceScale().width();
    if (x < r.width - axisW) return;                       // only over the price axis
    let top = 0, pane = null;
    for (const p of chart.panes()) { const h = p.getHeight(); if (y >= top && y < top + h) { pane = p; break; } top += h + 1; }
    if (!pane) return;
    const ser = pane.getSeries()[0]; if (!ser) return;
    const ps = ser.priceScale(), vr = ps.getVisibleRange(); if (!vr) return;
    e.preventDefault(); e.stopPropagation();
    const f = e.deltaY > 0 ? 1.1 : 1 / 1.1;                // wheel down = squeeze, up = stretch
    const mid = (vr.from + vr.to) / 2, half = (vr.to - vr.from) / 2 * f;
    ps.applyOptions({ autoScale: false });
    ps.setVisibleRange({ from: mid - half, to: mid + half });
  }, { capture: true, passive: false });
})();

// ── Live updates (from the hidden live feed) + remember zoom / scroll per coin & timeframe
(function () {
  const n0 = D.candles.length;
  const key = 'lof_view_' + D.coin + '_' + D.tf;
  try {
    const sv = JSON.parse(localStorage.getItem(key) || 'null');
    if (sv && Date.now() - sv.ts < 6 * 3600e3) {
      chart.timeScale().setVisibleLogicalRange({ from: n0 - sv.r1, to: n0 - sv.r2 });
    }
  } catch (e) {}
  let last = D.candles.length ? D.candles[D.candles.length - 1].time : 0;
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (!r) return;
    const n = D.candles.length;
    try { localStorage.setItem(key, JSON.stringify({ r1: n - r.from, r2: n - r.to, ts: Date.now() })); } catch (e) {}
  });
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.type !== 'lof-live' || m.coin !== D.coin || m.tf !== D.tf) return;
    (m.candles || []).forEach(c => {
      if (c.time < last) return;
      try { cs.update(T([c])[0]); } catch (err) { return; }
      if (c.time > last) { D.candles.push(c); last = c.time; }
      else { D.candles[D.candles.length - 1] = c; }
    });
    const badge = document.getElementById('live');
    if (badge) { badge.textContent = '● LIVE ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); badge.style.opacity = 1; }
  });
})();
"""


def _pts(s):
    s = s.dropna()
    return [{"time": int(t.timestamp()), "value": float(v)} for t, v in s.items()]


def tv_chart(px, panes_data, levels, prec, height, coin_name, vol=None, show_vp=False, extra=None):
    candles = [{"time": int(t.timestamp()), "open": float(o), "high": float(h), "low": float(l), "close": float(c)}
               for t, o, h, l, c in zip(px["t"], px["o"], px["h"], px["l"], px["c"])]
    vols = [] if vol is None else [float(vol.get(t, 0.0)) for t in px["t"]]
    data = {"candles": candles, "panes": panes_data, "levels": levels, "prec": prec, "coin": coin_name,
            "vol": vols, "vp": bool(show_vp),
            "minMove": float(10 ** -prec)}
    data.update(extra or {})
    html = lwc_js() + f"""
<style>
  body {{ margin: 0; }}
  #wrap {{ position: relative; background: #131722; }}
  #c {{ height: {height}px; width: 100%; }}
  #wrap:fullscreen #c {{ height: 100vh; }}
  #fs {{ position: absolute; top: 8px; left: 8px; z-index: 10; background: #2a2e39; color: #d1d4dc;
         border: 1px solid #363a45; border-radius: 6px; padding: 4px 10px; font: 13px sans-serif;
         cursor: pointer; opacity: 0.85; }}
  #fs:hover {{ opacity: 1; background: #363a45; }}
  #tools {{ position: absolute; top: 44px; left: 8px; z-index: 10; display: flex; flex-direction: column; gap: 4px;
            background: rgba(30,34,45,0.92); border: 1px solid #363a45; border-radius: 8px; padding: 4px; }}
  #tools button {{ width: 34px; height: 30px; background: transparent; color: #d1d4dc; border: none;
                   border-radius: 5px; cursor: pointer; font: 14px sans-serif; }}
  #tools button:hover {{ background: #363a45; }}
  #tools button.on {{ background: #2962ff; color: #fff; }}
  #tools hr {{ border: none; border-top: 1px solid #363a45; margin: 2px 0; }}
  #hint {{ position: absolute; top: 8px; left: 150px; z-index: 10; display: none; background: #2962ff; color: #fff;
           border-radius: 6px; padding: 4px 10px; font: 12px sans-serif; }}
</style>
<div id="wrap">
  <button id="fs" title="Full screen (Esc to exit)">⛶ Full screen</button>
  <div id="live" style="position:absolute;top:12px;right:80px;z-index:10;font:11px sans-serif;color:#26a69a;opacity:.0"></div>
  <div id="hint"></div>
  <div id="tools">
    <button data-tool="h" title="Horizontal line">─</button>
    <button data-tool="trend" title="Trend line">╱</button>
    <button data-tool="rect" title="Rectangle / zone (OB, FVG)">▭</button>
    <button data-tool="fib" title="Fib retracement (OTE 0.62–0.79)">F</button>
    <button data-tool="long" title="Long position" style="color:#26a69a">▲</button>
    <button data-tool="short" title="Short position" style="color:#ef5350">▼</button>
    <hr>
    <button id="magnet" title="Magnet: snap to candle high / low / open / close">🧲</button>
    <button id="undo" title="Undo (Ctrl+Z)">↶</button>
    <button id="clear" title="Delete all drawings for this coin">🗑</button>
  </div>
  <div id="c"></div>
</div>
<script>
const D = {json.dumps(data)};
const off = -new Date().getTimezoneOffset() * 60;
const T = a => a.map(p => Object.assign({{}}, p, {{time: p.time + off}}));
const abbr = v => {{ const a = Math.abs(v), s = v < 0 ? '-' : '';
  return a >= 1e9 ? s + (a/1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a/1e6).toFixed(2) + 'M'
       : a >= 1e3 ? s + (a/1e3).toFixed(1) + 'K' : s + a.toFixed(0); }};
const LC = LightweightCharts;
const chart = LC.createChart(document.getElementById('c'), {{
  autoSize: true,
  localization: {{ locale: 'en-US' }},
  layout: {{ background: {{type: 'solid', color: '#131722'}}, textColor: '#d1d4dc', fontSize: 12,
            panes: {{ separatorColor: '#2a2e39', separatorHoverColor: '#363a45', enableResize: true }} }},
  grid: {{ vertLines: {{color: '#1e222d'}}, horzLines: {{color: '#1e222d'}} }},
  crosshair: {{ mode: LC.CrosshairMode.Normal }},
  rightPriceScale: {{ borderColor: '#2a2e39' }},
  timeScale: {{ borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 6 }},
}});
const cs = chart.addSeries(LC.CandlestickSeries, {{
  upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  priceFormat: {{ type: 'price', precision: D.prec, minMove: D.minMove }} }}, 0);
cs.setData(T(D.candles));
D.levels.forEach(l => cs.createPriceLine({{ price: l.price, color: l.color, lineWidth: 1,
  lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: l.title }}));
D.panes.forEach((p, i) => {{
  p.series.forEach(s => {{
    const opts = {{ color: s.color, priceFormat: {{ type: 'custom', formatter: abbr, minMove: 1 }},
                   title: s.name, lastValueVisible: true, priceLineVisible: false }};
    const ser = s.kind === 'line'
      ? chart.addSeries(LC.LineSeries, Object.assign(opts, {{ lineWidth: 2 }}), i + 1)
      : s.kind === 'candle'
      ? chart.addSeries(LC.CandlestickSeries, Object.assign(opts, {{ upColor: '#26a69a', downColor: '#ef5350',
          borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' }}), i + 1)
      : chart.addSeries(LC.HistogramSeries, opts, i + 1);
    ser.setData(T(s.data));
  }});
}});
const ps = chart.panes();
if (ps.length > 1) {{
  ps[0].setStretchFactor(ps.length > 3 ? 2.5 : 2);
  for (let i = 1; i < ps.length; i++) ps[i].setStretchFactor(1);
}}
const fsBtn = document.getElementById('fs');
fsBtn.onclick = () => {{
  const w = document.getElementById('wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else (w.requestFullscreen || w.webkitRequestFullscreen).call(w);
}};
document.addEventListener('fullscreenchange', () => {{
  fsBtn.textContent = document.fullscreenElement ? '✕ Exit full screen' : '⛶ Full screen';
}});
const n = D.candles.length;
chart.timeScale().setVisibleLogicalRange({{ from: Math.max(0, n - 150), to: n + 5 }});
</script>""" + "<script>" + DRAW_JS + "</script>"
    components.html(html, height=height + 10)


@st.fragment
def chart_section():
    tf_keys = list(E.CHART_TF)
    tf_label = st.segmented_control("Timeframe", tf_keys, default=ltf_label, key="chart_tf") or ltf_label
    if True:
        panes = st.pills("Panes (click to add / remove)", PANES, selection_mode="multi",
                         default=[x for x in load_settings().get("panes", ["OI", "Perp CVD", "Spot CVD"]) if x in PANES],
                         key="chart_panes", on_change=save_settings) or []
    panes = [p for p in PANES if p in panes]
    if is_tradfi:
        if any(p != "Volume" for p in panes):
            st.caption("OI, CVD and liquidations aren't available for this market, so only Volume is shown.")
        panes = [p for p in panes if p == "Volume"]

    cfg = load_settings()
    seen = cfg.get("seen_lines", [x for x in LINE_LAYERS if x not in ("EMA 12", "EMA 21", "EMA 50", "Impulse candles", "Volume MA")])
    saved = cfg.get("lines", LINE_DEFAULT) + [x for x in LINE_DEFAULT if x not in seen]
    lines = st.pills("Chart layers · lines", LINE_LAYERS, selection_mode="multi",
                     default=[x for x in LINE_LAYERS if x in saved],
                     key="chart_lines", on_change=save_settings) or []
    zones = st.pills("Chart layers · zones & profiles", ZONE_LAYERS, selection_mode="multi",
                     default=[x for x in cfg.get("zones", ZONE_DEFAULT) if x in ZONE_LAYERS],
                     key="chart_zones", on_change=save_settings) or []
    if "Impulse candles" in lines:
        imp = st.segmented_control("Impulse sensitivity", list(IMPULSE), key="chart_impulse",
                                   default=cfg.get("impulse", "Normal"), on_change=save_settings) or "Normal"
    else:
        imp = cfg.get("impulse", "Normal")
    size = st.segmented_control("Chart size", list(CHART_SIZE), key="chart_size",
                                default=cfg.get("size", "M"), on_change=save_settings) or "M"
    show_lv = "Levels" in lines
    show_vp = "VP visible range" in zones

    interval = E.CHART_TF[tf_label]
    same_tf = interval == LTF_MAP[ltf_label]
    try:
        if is_tradfi:
            cd = {"perp": {}, "spot": {}, "oi": {}, "liq": {}} if same_tf else yahoo_chart(perp_syms[0], interval, ver=E._loaded_mtime)
        else:
            cd = chart_data(api_key, perp_syms, spot_syms, interval, not same_tf,
                            "Spot CVD" in panes, "OI" in panes, "Liquidations" in panes, oi_syms)
    except Exception as e:
        st.error(f"Chart data error: {e}")
        return
    perp_h = b["ltf_perp"] if same_tf else cd["perp"]
    spot_h = b["ltf_spot"] if same_tf else cd["spot"]
    px = perp_h.get(perp_syms[0], pd.DataFrame())
    if px.empty:
        st.info("No price data for this timeframe.")
        return
    t0 = px["t"].min()
    cut = lambda s: s[s.index >= t0]

    out = []
    for p in panes:
        if p == "OI":
            oi = E.aggregate_ohlc(cd["oi"])
            oi = oi[oi.index >= t0]
            out.append({"series": [{"kind": "candle", "name": "OI", "color": AMBER,
                                    "data": [{"time": int(t.timestamp()), "open": float(o), "high": float(h),
                                              "low": float(l), "close": float(c)}
                                             for t, o, h, l, c in zip(oi.index, oi["o"], oi["h"], oi["l"], oi["c"])]}]})
        elif p == "Perp CVD":
            out.append({"series": [{"kind": "line", "name": "Perp CVD", "color": RED,
                                    "data": _pts(E.aggregate_delta(perp_h, denoms).cumsum())}]})
        elif p == "Spot CVD":
            out.append({"series": [{"kind": "line", "name": "Spot CVD", "color": GREEN,
                                    "data": _pts(E.aggregate_delta(spot_h, {}).cumsum())}]})
        elif p == "Volume":
            vol = cut(E.aggregate_volume(perp_h, denoms))
            up = dict(zip(px["t"], px["c"] >= px["o"]))
            pts = _pts(vol)
            for pt, t in zip(pts, vol.dropna().index):
                pt["color"] = "rgba(38,166,154,0.6)" if up.get(t, True) else "rgba(239,83,80,0.6)"
            series = [{"kind": "hist", "name": "Volume", "color": GREY, "data": pts}]
            if "Volume MA" in lines:
                series.append({"kind": "line", "name": "Vol MA 20", "color": AMBER,
                               "data": _pts(vol.rolling(20).mean())})
            out.append({"series": series})
        elif p == "Liquidations":
            lq = E.aggregate_liq(cd["liq"])
            lq = lq[lq.index >= t0] if not lq.empty else lq
            out.append({"series": [
                {"kind": "hist", "name": "Long liqs", "color": RED,
                 "data": _pts(-lq["l"]) if not lq.empty else []},
                {"kind": "hist", "name": "Short liqs", "color": GREEN,
                 "data": _pts(lq["s"]) if not lq.empty else []}]})

    levels = []
    if show_lv:
        lv = r["levels"]
        for k, col, name in (("pwh", RED, "PWH"), ("pdh", RED, "PDH"), ("pd_poc", AMBER, "D POC"),
                             ("pw_poc", "#ab47bc", "W POC"), ("pdl", GREEN, "PDL"), ("pwl", GREEN, "PWL")):
            if not nan(lv[k]):
                levels.append({"price": float(lv[k]), "color": col, "title": name})

    a = abs(float(px["c"].iloc[-1]))
    prec = 1 if a >= 1000 else 2 if a >= 100 else 3 if a >= 1 else 5 if a >= 0.01 else 8
    vol_map = E.aggregate_volume(perp_h, denoms).to_dict() if show_vp else None
    opens = []
    for name, key, col in OPENS:
        o = r["opens"].get(key)
        if name in lines and o:
            opens.append({"title": name, "price": o["price"], "time": o["time"], "color": col})
    plan = []
    if "Trade plan" in lines and r["setup"] != "NONE":
        for title, v, col in (("Entry", r["price"], "#d1d4dc"), ("SL", r["sl"], RED),
                              ("TP1", r["tp1"], GREEN), ("TP2", r["tp2"], GREEN)):
            if not nan(v):
                plan.append({"title": title, "price": float(v), "color": col})
    extra = {"tf": tf_label, "opens": opens, "plan": plan, "impulseMult": IMPULSE[imp], "asia": r["asia"], "profiles": r["profiles"],
             "layers": {"asia": "Asia range" in zones, "sessions": "Sessions" in zones,
                        "ema12": "EMA 12" in lines, "ema21": "EMA 21" in lines, "ema50": "EMA 50" in lines,
                        "impulse": "Impulse candles" in lines,
                        "vp_day": "VP prev day" in zones, "vp_week": "VP prev week" in zones}}
    tv_chart(px, out, levels, prec, CHART_SIZE[size] + int(CHART_SIZE[size] * 0.3) * len(out), coin, vol_map, show_vp, extra)
    st.caption("Scroll or Ctrl +/− (mouse over chart) to zoom · ＋/－/⟲ buttons · drag to move (also up/down) · wheel or drag on the price axis to stretch/squeeze, double-click it to reset · drag the line between panes to resize · drawing tools on the left (Esc cancels, Ctrl+Z undo, saved per coin). "
               "CVD = cumulative taker buy − sell (USD) across the exchanges in 'Per exchange'. "
               "The Trade plan always uses the entry timeframe from the sidebar.")


chart_section()


@st.cache_data(ttl=15, show_spinner=False)
def live_tail(key, sym, interval, tradfi):
    """Last few candles of the chart symbol (1 Coinalyze call, or Yahoo for TradFi)."""
    if tradfi:
        df = E.yf_bars(sym, interval, 3)
    else:
        df = E.fetch_history("ohlcv-history", key, [sym], interval, E.INTERVAL_SECONDS[interval] * 3).get(sym)
    if df is None or df.empty:
        return []
    return [{"time": int(t.timestamp()), "open": float(o), "high": float(h), "low": float(l), "close": float(c)}
            for t, o, h, l, c in zip(df["t"], df["o"], df["h"], df["l"], df["c"])]


@st.fragment(run_every=20)
def live_feed():
    if not st.session_state.get("live_on", True):
        return
    tf = st.session_state.get("chart_tf") or ltf_label
    try:
        candles = live_tail(api_key, perp_syms[0], E.CHART_TF[tf], is_tradfi)
    except Exception:
        return
    msg = json.dumps({"type": "lof-live", "coin": coin, "tf": tf, "candles": candles})
    components.html(f"""<script>
const m = {msg};
const fr = window.parent.frames;
for (let i = 0; i < fr.length; i++) {{ try {{ fr[i].postMessage(m, '*'); }} catch (e) {{}} }}
</script>""", height=0)


live_feed()

if not is_tradfi:
    t3, t4 = st.tabs(["Liquidations 24h", "Per exchange"])
    layout = dict(height=320, margin=dict(l=10, r=10, t=30, b=10), hovermode="x unified",
                  legend=dict(orientation="h", y=1.08))

    with t3:
        lq = r["liq_hourly"]
        if lq.empty:
            st.info("No liquidation data.")
        else:
            fig = go.Figure()
            fig.add_bar(x=lq.index, y=-lq["l"], name="Long liqs", marker_color=RED)
            fig.add_bar(x=lq.index, y=lq["s"], name="Short liqs", marker_color=GREEN)
            fig.update_layout(**layout, barmode="relative")
            st.plotly_chart(fig, width="stretch")

    with t4:
        rows = []
        for sym in perp_syms:
            f = r["funding_by_sym"].get(sym)
            pf = r["pred_by_sym"].get(sym)
            rows.append({"Exchange": exch_of.get(sym, sym), "Symbol": sym, "Type": "Perp",
                         "OI (USD)": fusd(r["oi_by_sym"].get(sym)),
                         "Funding %": "—" if f is None else f"{f:+.4f}",
                         "Predicted %": "—" if pf is None else f"{pf:+.4f}"})
        for sym in oi_syms:
            if sym in perp_syms:
                continue
            rows.append({"Exchange": exch_of.get(sym, sym), "Symbol": sym, "Type": "Perp (OI only)",
                         "OI (USD)": fusd(r["oi_by_sym"].get(sym)), "Funding %": "", "Predicted %": ""})
        for sym in spot_syms:
            rows.append({"Exchange": exch_of.get(sym, sym), "Symbol": sym, "Type": "Spot (CVD)",
                         "OI (USD)": "", "Funding %": "", "Predicted %": ""})
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")

used = E.calls_last_minute()
st.caption(f"Page loaded in {time.perf_counter() - _t0:.1f}s · Coinalyze calls in the last minute: {used}/40"
           + (" — near the limit, the next load may wait" if used > 30 else ""))
st.caption(f"Data: Coinalyze · CoinGecko  ·  Updated {r['now'].strftime('%Y-%m-%d %H:%M UTC')}  ·  "
           "Not financial advice. Confirm every setup on your chart.")