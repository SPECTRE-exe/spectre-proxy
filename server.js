const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow SPECTRE Command on Netlify to call this proxy
app.use(cors());
app.use(express.json());

const ALPACA_BASE = 'https://paper-api.alpaca.markets/v2';

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'SPECTRE-5 PROXY ONLINE', message: 'Where Intelligence Meets Capital' });
});

// Account data
app.get('/account', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA_BASE}/account`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Alpaca connection failed' });
  }
});

// Positions
app.get('/positions', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA_BASE}/positions`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Positions fetch failed' });
  }
});

// Orders
app.get('/orders', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA_BASE}/orders?status=all&limit=20`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Orders fetch failed' });
  }
});

// Portfolio history
app.get('/history', async (req, res) => {
  try {
    const r = await fetch(`${ALPACA_BASE}/account/portfolio/history?period=1M&timeframe=1D`, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET
      }
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'History fetch failed' });
  }
});

app.listen(PORT, () => {
  console.log(`SPECTRE-5 Proxy running on port ${PORT}`);
});