#!/usr/bin/env node
/**
 * Tiny local CORS proxy for the DexPaprika public REST API.
 *
 * Why this exists: api.dexpaprika.com does not send
 * Access-Control-Allow-Origin, so a browser page that calls it directly
 * gets blocked by CORS even though the request itself succeeds. This
 * proxy sits between your browser and DexPaprika, adds the CORS header,
 * and streams the JSON straight through.
 *
 * No dependencies — uses only Node's built-in http/https modules.
 *
 * Run:
 *   node proxy-server.js
 *
 * Then open dexpaprika-feed.html (it's already pointed at
 * http://localhost:8787/api/...).
 *
 * Optional: export DEXPAPRIKA_API_KEY=... before starting if you have a
 * free/pro key and want higher rate limits. Not required — the public
 * tier needs no key at all.
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM = 'https://api.dexpaprika.com';
const API_KEY = process.env.DEXPAPRIKA_API_KEY || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!req.url || !req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found. Proxy DexPaprika calls under /api/, e.g. /api/networks/polygon/multi/prices?tokens=0x...'
    }));
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only GET requests are proxied.' }));
    return;
  }

  const upstreamPath = req.url.slice('/api'.length); // keeps leading '/' and the query string
  let target;
  try {
    target = new URL(upstreamPath, UPSTREAM);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request path', detail: err.message }));
    return;
  }

  const upstreamReq = https.request(
    target,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(API_KEY ? { Authorization: API_KEY } : {})
      },
      timeout: 15000
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        'Content-Type': upstreamRes.headers['content-type'] || 'application/json'
      });
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('Upstream request timed out')));

  upstreamReq.on('error', (err) => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request to DexPaprika failed', detail: err.message }));
  });

  upstreamReq.end();
});

server.listen(PORT, () => {
  console.log(`DexPaprika CORS proxy listening on http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/api/networks/polygon/tokens/0xd8a28224358b4291cd09710969ececcafbdb2751`);
  if (!API_KEY) console.log('No DEXPAPRIKA_API_KEY set — using the public keyless tier (that\'s fine).');
});
