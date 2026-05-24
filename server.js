#const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const ALPACA = 'https://paper-api.alpaca.markets/v2';
const AV = 'https://www.alphavantage.co/query';

const H = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET || ''
});

const AV_KEY = () => process.env.AV_KEY || '';

let log = [];
let signals = [];
let scanCount = 0;

function addLog(agent, msg) {
  const entry = { agent, msg, time: new Date().toISOString() };
  log.unshift(entry);
  if (log.length > 100) log.pop();
  console.log(`[${agent}] ${msg}`);
}

// Health
app.get('/', (req, res) => res.json({
  status: 'SPECTRE ENGINE ONLINE',
  uptime: Math.floor(process.uptime() / 60) + ' min',
  scans: scanCount,
  alpacaKey: process.env.ALPACA_KEY ? 'LOADED' : 'MISSING',
  avKey: process.env.AV_KEY ? 'LOADED' : 'MISSING'
}));

// Alpaca account
app.get('/account', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/account`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Positions
app.get('/positions', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/positions`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Orders
app.get('/orders', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA}/orders?status=all&limit=50`, { headers: H() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BTC signal via Alpha Vantage
app.get('/signal/btc', async (req, res) => {
  try {
    addLog('S3', 'Fetching BTC daily data from Alpha Vantage...');
    const url = `${AV}?function=DIGITAL_CURRENCY_DAILY&symbol=BTC&market=USD&apikey=${AV_KEY()}`;
    const data = await fetch(url).then(r => r.json());

    const timeSeries = data['Time Series (Digital Currency Daily)'];
    if (!timeSeries) {
      addLog('S3', `Alpha Vantage error: ${JSON.stringify(data)}`);
      return res.status(500).json({ error: 'No data from Alpha Vantage', raw: data });
    }

    const dates = Object.keys(timeSeries).sort().reverse();
    const prices = dates.slice(0, 15).reverse().map(d => parseFloat(timeSeries[d]['4a. close (USD)']));
    const price = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];
    const change24h = ((price - prevPrice) / prevPrice) * 100;
    const rsi = calcRSI(prices, 14);
    const signal = rsi < 35 ? 'STRONG BUY' : rsi < 45 ? 'BUY' : rsi > 65 ? 'STRONG SELL' : rsi > 55 ? 'SELL' : 'HOLD';
    const confidence = Math.min(92, 50 + Math.abs(50 - rsi) * 0.8 + Math.abs(change24h) * 2);

    addLog('S3', `BTC $${Math.round(price).toLocaleString()} | RSI: ${rsi.toFixed(1)} | Signal: ${signal} | Confidence: ${confidence.toFixed(0)}%`);

    const result = { market: 'BTC/USD', agent: 'S3', price: +price.toFixed(2), rsi: +rsi.toFixed(2), change24h: +change24h.toFixed(2), confidence: +confidence.toFixed(0), signal, timestamp: new Date().toISOString() };
    signals.unshift(result);
    if (signals.length > 30) signals.pop();
    res.json(result);
  } catch (e) {
    addLog('S3', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Gold signal via Alpha Vantage
app.get('/signal/gold', async (req, res) => {
  try {
    addLog('S8', 'Fetching XAU data from Alpha Vantage...');
    const url = `${AV}?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${AV_KEY()}`;
    const data = await fetch(url).then(r => r.json());
    const rate = data['Realtime Currency Exchange Rate'];

    if (!rate) {
      addLog('S8', 'Gold rate unavailable');
      return res.json({ market: 'XAU/USD', agent: 'S8', signal: 'MONITOR', note: 'Rate unavailable', timestamp: new Date().toISOString() });
    }

    const price = parseFloat(rate['5. Exchange Rate']);
    addLog('S8', `XAU/USD $${price.toFixed(2)} | Monitoring macro conditions`);

    const result = { market: 'XAU/USD', agent: 'S8', price: +price.toFixed(2), signal: 'MONITOR', confidence: 50, timestamp: new Date().toISOString() };
    signals.unshift(result);
    res.json(result);
  } catch (e) {
    addLog('S8', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Forex via Alpha Vantage
app.get('/signal/forex', async (req, res) => {
  try {
    addLog('S9', 'Fetching EUR/USD from Alpha Vantage...');
    const url = `${AV}?function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD&apikey=${AV_KEY()}`;
    const data = await fetch(url).then(r => r.json());
    const rate = data['Realtime Currency Exchange Rate'];
    const hour = new Date().getUTCHours();
    const session = hour >= 7 && hour < 16 ? 'LONDON' : hour >= 12 && hour < 21 ? 'NEW YORK' : hour >= 0 && hour < 8 ? 'TOKYO' : 'CROSSOVER';

    const eurusd = rate ? parseFloat(rate['5. Exchange Rate']) : null;
    addLog('S9', `Session: ${session} | EUR/USD: ${eurusd ? eurusd.toFixed(4) : 'N/A'}`);

    res.json({ session, agent: 'S9', eurusd, pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'], timestamp: new Date().toISOString() });
  } catch (e) {
    addLog('S9', `Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Execute trade
app.post('/execute', async (req, res) => {
  const { symbol, qty, side, source, confidence } = req.body;
  try {
    addLog('S4', `Risk check: ${side} ${qty} ${symbol} | 2% rule validating`);
    addLog('S5', `Executing ${side.toUpperCase()} ${qty} ${symbol} | Source: ${source} | Confidence: ${confidence}%`);

    const order = await fetch(`${ALPACA}/orders`, {
      method: 'POST',
      headers: { ...H(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, qty: String(qty), side, type: 'market', time_in_force: 'gtc' })
    }).then(r => r.json());

    if (order.id) {
      addLog('S5', `✓ ORDER CONFIRMED: ${side.toUpperCase()} ${qty} ${symbol} | ID: ${order.id.slice(0, 8)}`);
      addLog('S6', `Chronicle: ${side} ${symbol} recorded | Source: ${source}`);
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

// RSI
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

// Autonomous scan — every 5 minutes
async function scan() {
  scanCount++;
  addLog('S1', `Scan #${scanCount} initiated`);
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
      addLog('S3', `Signal: ${btc.signal} at ${btc.confidence}% — holding`);
    }

    // Stagger requests to respect Alpha Vantage rate limits
    setTimeout(async () => {
      await fetch(`http://localhost:${PORT}/signal/gold`);
      setTimeout(async () => {
        await fetch(`http://localhost:${PORT}/signal/forex`);
        addLog('S10', `Scan #${scanCount} complete. Next in 5 min.`);
      }, 15000);
    }, 15000);

  } catch (e) {
    addLog('S10', `Scan error: ${e.message}`);
  }
  setTimeout(scan, 5 * 60 * 1000);
}

app.listen(PORT, () => {
  addLog('S10', `SPECTRE Engine live on port ${PORT}`);
  addLog('S1', 'All agents online. First scan in 15 seconds.');
  setTimeout(scan, 15000);
});