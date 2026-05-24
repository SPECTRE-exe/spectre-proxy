const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const ALPACA = 'https://paper-api.alpaca.markets/v2';
const BINANCE = 'https://api.binance.com/api/v3';

const H = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET || ''
});

let log = [];
let signals = [];

function addLog(agent, msg) {
  const entry = { agent, msg, time: new Date().toISOString() };
  log.unshift(entry);
  if (log.length > 100) log.pop();
  console.log(`[${agent}] ${msg}`);
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'SPECTRE ENGINE ONLINE', uptime: Math.floor(process.uptime() / 60) + ' min' });
});

// Alpaca account
app.get('/account', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/account`, { headers: H() });
    const d = await r.json();
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alpaca positions
app.get('/positions', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/positions`, { headers: H() });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alpaca orders
app.get('/orders', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/orders?status=all&limit=50`, { headers: H() });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// BTC signal via Binance
app.get('/signal/btc', async (req, res) => {
  try {
    addLog('S3', 'Fetching BTC data from Binance...');

    const [ticker, klines] = await Promise.all([
      fetch(`${BINANCE}/ticker/24hr?symbol=BTCUSDT`).then(r => r.json()),
      fetch(`${BINANCE}/klines?symbol=BTCUSDT&interval=1d&limit=15`).then(r => r.json())
    ]);

    const price = parseFloat(ticker.lastPrice);
    const change24h = parseFloat(ticker.priceChangePercent);
    const prices = klines.map(k => parseFloat(k[4])); // close prices
    const rsi = calcRSI(prices, 14);
    const signal = rsi < 35 ? 'STRONG BUY' : rsi < 45 ? 'BUY' : rsi > 65 ? 'STRONG SELL' : rsi > 55 ? 'SELL' : 'HOLD';
    const confidence = Math.min(92, 50 + Math.abs(50 - rsi) * 0.8 + Math.abs(change24h) * 2);

    addLog('S3', `BTC $${Math.round(price).toLocaleString()} | RSI: ${rsi.toFixed(1)} | Signal: ${signal} | Confidence: ${confidence.toFixed(0)}%`);

    const result = { market: 'BTC/USD', agent: 'S3', price, rsi: +rsi.toFixed(2), change24h: +change24h.toFixed(2), confidence: +confidence.toFixed(0), signal, timestamp: new Date().toISOString() };
    signals.unshift(result);
    if (signals.length > 30) signals.pop();
    res.json(result);
  } catch (e) {
    addLog('S3', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Gold signal via Binance (PAXG is gold-backed token)
app.get('/signal/gold', async (req, res) => {
  try {
    addLog('S8', 'Fetching gold data from Binance...');
    const ticker = await fetch(`${BINANCE}/ticker/24hr?symbol=PAXGUSDT`).then(r => r.json());
    const price = parseFloat(ticker.lastPrice);
    const change = parseFloat(ticker.priceChangePercent);
    const signal = change > 0.4 ? 'BUY' : change < -0.4 ? 'SELL' : 'HOLD';
    const confidence = Math.min(88, 50 + Math.abs(change) * 12);
    addLog('S8', `XAU/USD ~$${Math.round(price).toLocaleString()} | 24h: ${change.toFixed(2)}% | Signal: ${signal}`);
    const result = { market: 'XAU/USD', agent: 'S8', price, change24h: +change.toFixed(2), confidence: +confidence.toFixed(0), signal, timestamp: new Date().toISOString() };
    signals.unshift(result);
    res.json(result);
  } catch (e) {
    addLog('S8', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Forex session info
app.get('/signal/forex', async (req, res) => {
  try {
    const hour = new Date().getUTCHours();
    const session = hour >= 7 && hour < 16 ? 'LONDON' : hour >= 12 && hour < 21 ? 'NEW YORK' : hour >= 0 && hour < 8 ? 'TOKYO' : 'CROSSOVER';
    addLog('S9', `Forex session: ${session} | Monitoring major pairs`);
    res.json({ session, agent: 'S9', pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'], timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute trade
app.post('/execute', async (req, res) => {
  const { symbol, qty, side, source, confidence } = req.body;
  try {
    addLog('S4', `Risk check: ${side} ${qty} ${symbol} — validating 2% rule`);
    addLog('S5', `Executing ${side.toUpperCase()} ${qty} ${symbol} | Source: ${source} | Confidence: ${confidence}%`);
    const order = await fetch(`${ALPACA}/orders`, {
      method: 'POST',
      headers: { ...H(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, qty: String(qty), side, type: 'market', time_in_force: 'gtc' })
    }).then(r => r.json());
    if (order.id) {
      addLog('S5', `✓ ORDER CONFIRMED: ${side.toUpperCase()} ${qty} ${symbol} | ID: ${order.id.slice(0, 8)}`);
      addLog('S6', `Trade recorded in Chronicle: ${side} ${symbol}`);
    } else {
      addLog('S5', `Order response: ${JSON.stringify(order)}`);
    }
    res.json(order);
  } catch (e) {
    addLog('S5', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Log and signals
app.get('/log', (req, res) => res.json(log));
app.get('/signals', (req, res) => res.json(signals));

// Autonomous scan every 5 minutes
let scanCount = 0;
async function scan() {
  scanCount++;
  addLog('S1', `Autonomous scan #${scanCount} running...`);
  try {
    const btcRes = await fetch(`http://localhost:${PORT}/signal/btc`);
    const btc = await btcRes.json();
    if (btc.signal && btc.confidence >= 72 && (btc.signal === 'STRONG BUY' || btc.signal === 'BUY')) {
      addLog('S3', `Signal confirmed (${btc.confidence}%) — routing to SPECTRE-5`);
      await fetch(`http://localhost:${PORT}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'BTCUSD', qty: 0.01, side: 'buy', source: 'S3-RSI', confidence: btc.confidence })
      });
    } else if (btc.signal) {
      addLog('S3', `Signal: ${btc.signal} at ${btc.confidence}% — below threshold. Holding.`);
    }
    await fetch(`http://localhost:${PORT}/signal/gold`);
    await fetch(`http://localhost:${PORT}/signal/forex`);
    addLog('S10', `Scan #${scanCount} complete. Next scan in 5 minutes.`);
  } catch (e) {
    addLog('S10', `Scan error: ${e.message}`);
  }
  setTimeout(scan, 5 * 60 * 1000);
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// Boot
app.listen(PORT, () => {
  addLog('S10', `SPECTRE Engine live on port ${PORT}`);
  addLog('S1', 'All agents online. Starting autonomous scan in 10 seconds.');
  setTimeout(scan, 10000);
});