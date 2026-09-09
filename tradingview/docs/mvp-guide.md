# MVP Guide — Patterns, Confirmations & Backtest Runs

## Patterns kaise dikhte hain (visual rules)

Har pattern candle ke **shape + context** se pehchana jata hai. Chart par body (open–close), wick (high/low shadow), aur pichhli 1–2 candles matter karti hain.

| Pattern | Kya dekho | Bullish / Bearish |
|---------|-----------|-------------------|
| **Hammer** | Chhoti body upar, lambi neeche wick (≥2× body), upar wick chhoti | Bullish (downtrend ke baad) |
| **Bullish Engulfing** | Pehli candle bearish, doosri bullish — poori body pehli ko cover kare | Bullish |
| **Morning Star** | 3 candles: bearish → chhoti/star → bullish jo pehli ke midpoint se upar close kare | Bullish |
| **Bearish Engulfing** | Pehli bullish, doosri bearish — body engulf | Bearish |
| **Evening Star** | 3 candles: bullish → chhoti/star → bearish jo pehli ke midpoint se neeche close kare | Bearish |
| **Three White Soldiers** | 3 lagatar bullish, har close upar, chhoti upper wicks | Bullish |
| **Three Black Crows** | 3 lagatar bearish, har close neeche, opens prior body ke andar | Bearish |

Script in rules ko numbers se check karti hai (body ratio, wick ratio, engulf logic).

---

## Confirmation kya hoti hai?

**Pattern alone = signal nahi.** Confirmation = extra checks jo false signals kam karein.

### MVP mein 2 confirmations (filters)

| # | Name | Long ke liye | Short ke liye | Kyon? |
|---|------|--------------|---------------|-------|
| 1 | **Volume > 20 SMA** | Pattern candle par volume average se zyada | Same | Real participation — weak volume = fake move |
| 2 | **EMA 200 trend** | Close > EMA200 | Close < EMA200 | Trend ke saath trade — counter-trend kam reliable |

### Signal formula

```
LONG  = bullish_pattern_detected  AND  volume_ok  AND  close > EMA200
SHORT = bearish_pattern_detected  AND  volume_ok  AND  close < EMA200
```

Sab teen pass → entry. Koi ek fail → skip (chart par pattern dikhega lekin trade nahi).

---

## Chart par kya display hoga

1. **Shape markers** — pattern detect hone par triangle (▲ long, ▼ short)
2. **Confirmation table** (top-right) — har row: Pattern | Detected | Volume | EMA | Signal
3. **Checklist table** — aaj ki bar par kaunsi condition pass/fail
4. **Info label** — entry par SL/TP distance

---

## Backtest settings (fixed — fair compare)

| Setting | Value |
|---------|-------|
| Timeframe | 15m |
| History | ~2 saal (broker/data plan ke hisaab se) |
| Stop Loss | 1.5 × ATR(14) |
| Take Profit | 2R (= 3 × ATR entry se) |
| Entry | Signal candle **close** ke baad next bar (no repaint) |

---

## 7 runs — spreadsheet template

Har run mein **sirf ek pattern ON**, baaki OFF. Same symbol, same dates.

File: `tradingview/docs/backtest_log.csv`

Columns: Pattern, Trades, Win%, Profit Factor, Net Profit, Max DD%, Avg Trade, Volume Filter, EMA Filter

Best 2 patterns shortlist → phir RSI, MACD, HTF add karke Phase 2 test.

---

## TradingView mein use kaise karein

1. TradingView → Pine Editor → `pattern_backtester_mvp.pine` paste karo (Pine Script **v6**)
2. **Add to chart** (15m)
3. Strategy Tester → Overview metrics note karo
4. Settings → **Test Mode ON** → sirf ek pattern enable
5. 7 runs complete → CSV/spreadsheet fill karo
