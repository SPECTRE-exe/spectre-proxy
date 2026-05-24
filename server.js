const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Open CORS — allow all origins
app.use(cors({ origin: '*' }));
app.use(express.json());

const BASE = 'https://paper-api.alpaca.markets/v2';

const headers = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_KEY || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET || ''
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'SPECTRE-5 PROXY ONLINE',
    message: 'Where Intelligence Meets Capital',
    alpaca: process.env.ALPACA_KEY ? 'KEYS LOADED' : 'NO KEYS'
  });
});

// Account
app.get('/account', async (req, res) => {
  try {
    const r = await fetch(`${BASE}/account`, { headers: headers() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Positions
app.get('/positions', async (req, res) => {
  try {
    const r = await fetch(`${BASE}/positions`, { headers: headers() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Orders
app.get('/orders', async (req, res) => {
  try {
    const r = await fetch(`${BASE}/orders?status=all&limit=20`, { headers: headers() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Portfolio history
app.get('/history', async (req, res) => {
  try {
    const r = await fetch(`${BASE}/account/portfolio/history?period=1M&timeframe=1D`, { headers: headers() });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`SPECTRE-5 Proxy live on port ${PORT}`));