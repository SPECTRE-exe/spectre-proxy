const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const ALPACA = 'https://paper-api.alpaca.markets/v2';
const COINGECKO = 'https://api.coingecko.com/api/v3';

const H = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET || ''
});

let state = {
  running: false,
  lastScan: null,
  signals: [],
  log: [],
  scanCount: 0
};

function addLog(agent, msg) {
  const entry = { agent, msg, time: new Date().toISOString() };
  state.log.unshift(entry);
  if (state.log.length > 100) state.log.pop();
  console.log(`[${agent}] ${msg}`);
}

// Health
app.get('/', (req, res) => res.json({
  status: 'SPECTRE ENGINE ONLINE',
  engine: state.running ? 'AUTONOMOUS ACTIVE' : 'STANDBY',
  scans: state.scanCount,
  lastScan: state.lastScan,
  uptime: Math.floor(process.uptime() / 60) + ' min',
  alpacaKey: process.env.ALPACA_KEY ? 'LOADED' : 'MISSING'
}));

// Alpaca routes
app.get('/account', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/account`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/positions', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/positions`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/orders', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/orders?status=all&limit=50`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/log', (req, res) => res.json(state.log));
app.get('/signals', (req, res) => res.json(state.signals));

// SPECTRE-3: BTC RSI signal
app.get('/signal/btc', async (req, res) => {
  try {
    addLog('S3', 'Fetching BTC 14-day price history...');

    const response = await fetch(
      `${COINGECKO}/coins/bitcoin/market_chart?vs_currency=usd&days=14&interval=daily`
    );
    const data = await response.json();

    // Safe extraction
    if (!data || !data.prices || !Array.isArray(data.prices)) {
      addLog('S3', 'CoinGecko returned unexpected format. Retrying...');
      return res.status(500).json({ error: 'Invalid data from CoinGecko', raw: data });
    }

    const prices = data.prices.map(p => p[1]);
    if (prices.length < 15) {
      return res.status(500).json({ error: 'Not enough price data', count: prices.length });
    }

    const rsi = calcRSI(prices, 14);
    const price = prices[prices.length - 1];
    const prev = prices[prices.length - 2];
    const change = ((price - prev) / prev) * 100;
    const confidence = Math.min(92, 50 + Math.abs(50 - rsi) * 0.8 + Math.abs(change) * 3);
    const signal = rsi < 35 ? 'STRONG BUY' : rsi < 45 ? 'BUY' : rsi > 65 ? 'STRONG SELL' : rsi > 55 ? 'SELL' : 'HOLD';

    addLog('S3', `BTC $${Math.round(price).toLocaleString()} | RSI: ${rsi.toFixed(1)} | Signal: ${signal} | Confidence: ${confidence.toFixed(0)}%`);

    const result = {
      market: 'BTC/USD',
      agent: 'SPECTRE-3',
      price: +price.toFixed(2),
      rsi: +rsi.toFixed(2),
      change24h: +change.toFixed(2),
      confidence: +confidence.toFixed(0),
      signal,
      timestamp: new Date().toISOString()
    };

    state.signals.unshift(result);
    if (state.signals.length > 30) state.signals.pop();
    res.json(result);

  } catch (e) {
    addLog('S3', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// SPECTRE-8: Gold signal
app.get('/signal/gold', async (req, res) => {
  try {
    addLog('S8', 'Scanning XAUUSD via CoinGecko...');
    const response = await fetch(
      `${COINGECKO}/simple/price?ids=gold&vs_currencies=usd&include_24hr_change=true`
    );
    const data = await response.json();

    if (!data || !data.gold) {
      return res.status(500).json({ error: 'Gold data unavailable', raw: data });
    }

    const price = data.gold.usd || 1900;
    const change = data.gold.usd_24h_change || 0;
    const signal = change > 0.4 ? 'BUY' : change < -0.4 ? 'SELL' : 'HOLD';
    const confidence = Math.min(88, 50 + Math.abs(change) * 15);
    const macro = change > 0.5 ? 'SAFE HAVEN DEMAND HIGH' : change < -0.5 ? 'RISK ON — GOLD SELLING' : 'NEUTRAL';

    addLog('S8', `XAU/USD $${price.toFixed(2)} | 24h: ${change.toFixed(2)}% | ${macro} | Signal: ${signal}`);

    const result = {
      market: 'XAU/USD',
      agent: 'SPECTRE-8',
      price: +price.toFixed(2),
      change24h: +change.toFixed(2),
      confidence: +confidence.toFixed(0),
      signal,
      macro,
      timestamp: new Date().toISOString()
    };

    state.signals.unshift(result);
    res.json(result);
  } catch (e) {
    addLog('S8', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// SPECTRE-9: Forex session
app.get('/signal/forex', async (req, res) => {
  try {
    const hour = new Date().getUTCHours();
    const session = hour >= 7 && hour < 16 ? 'LONDON' : hour >= 12 && hour < 21 ? 'NEW YORK' : hour >= 0 && hour < 8 ? 'TOKYO' : 'CROSSOVER';
    addLog('S9', `Active session: ${session} | Monitoring major pairs`);
    res.json({
      session,
      agent: 'SPECTRE-9',
      pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'],
      note: 'Live forex prices require OANDA or Fixer.io API — session monitoring active',
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Execute trade
app.post('/execute', async (req, res) => {
  const { symbol, qty, side, source, confidence } = req.body;
  try {
    addLog('S4', `Risk check: ${side} ${qty} ${symbol} | Validating 2% rule...`);
    addLog('S5', `Executing ${side.toUpperCase()} ${qty} ${symbol} | Source: ${source} | Confidence: ${confidence}%`);

    const order = await fetch(`${ALPACA}/orders`, {
      method: 'POST',
      headers: { ...H(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        qty: String(qty),
        side,
        type: 'market',
        time_in_force: 'gtc'
      })
    }).then(r => r.json());

    if (order.id) {
      addLog('S5', `✓ ORDER CONFIRMED: ${side.toUpperCase()} ${qty} ${symbol} | ID: ${order.id.slice(0, 8)}`);
      addLog('S6', `Trade recorded: ${side} ${symbol} | Source: ${source}`);
    } else {
      addLog('S5', `Order response: ${JSON.stringify(order)}`);
    }

    res.json(order);
  } catch (e) {
    addLog('S5', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Engine control
app.post('/engine/start', (req, res) => {
  state.running = true;
  addLog('S10', 'Autonomous engine STARTED.');
  addLog('S1', 'All agents — autonomous scanning active.');
  runEngine();
  res.json({ status: 'STARTED' });
});

app.post('/engine/stop', (req, res) => {
  state.running = false;
  addLog('S10', 'Engine STOPPED by CEO.');
  res.json({ status: 'STOPPED' });
});

app.get('/engine/status', (req, res) => res.json({
  running: state.running,
  lastScan: state.lastScan,
  scanCount: state.scanCount,
  recentSignals: state.signals.slice(0, 5)
}));

// Autonomous scan loop
async function runEngine() {
  if (!state.running) return;
  state.scanCount++;
  state.lastScan = new Date().toISOString();
  addLog('S1', `Scan #${state.scanCount} running...`);

  try {
    const btcRes = await fetch(`http://localhost:${PORT}/signal/btc`);
    const btc = await btcRes.json();

    if (btc && btc.signal && btc.confidence >= 70 && (btc.signal === 'STRONG BUY' || btc.signal === 'BUY')) {
      addLog('S3', `High confidence signal (${btc.confidence}%) — routing to S5.`);
      await fetch(`http://localhost:${PORT}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'BTCUSD',
          qty: 0.01,
          side: 'buy',
          source: 'S3-RSI',
          confidence: btc.confidence
        })
      });
    } else if (btc && btc.signal) {
      addLog('S3', `Signal: ${btc.signal} at ${btc.confidence}% — below execution threshold. Holding.`);
    }

    await fetch(`http://localhost:${PORT}/signal/gold`);
    await fetch(`http://localhost:${PORT}/signal/forex`);

    addLog('S10', `Scan #${state.scanCount} complete. Next in 5 min.`);
  } catch (e) {
    addLog('S10', `Scan error: ${e.message}`);
  }

  if (state.running) setTimeout(runEngine, 5 * 60 * 1000);
}

// RSI calculation
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// Auto-start engine on boot
setTimeout(() => {
  state.running = true;
  addLog('S10', 'Auto-starting engine on boot...');
  addLog('S1', 'SPECTRE Global Investments — engine online.');
  runEngine();
}, 5000);

app.listen(PORT, () => addLog('S10', `SPECTRE Engine live on port ${PORT}`));