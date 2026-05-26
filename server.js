const express = require('express');
const net = require('net');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

let verifiedProxies = [];
let isRunning = false;
let intervalId = null;

let mtProtoProxies = [];
let mtRunning = false;
let mtIntervalId = null;

function getText(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { clearTimeout(timer); resolve(d); });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeout);
    req.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

const RAW_URLS = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt',
  'https://raw.githubusercontent.com/almroot/proxylist/master/list.txt',
  'https://api.openproxylist.xyz/http.txt',
  'https://www.proxy-list.download/api/v1/get?type=http',
];

const MTPROTO_SOURCES = [
  'https://www.mtproto.ru/',
  'https://www.mtproto.ru/personal.php',
  'https://www.mtproto.ru/example-other.php',
  'https://www.mtproto.ru/example-other.php',
  'https://www.mtproto.ru/example-other.php',
  'https://www.mtproto.ru/example-other.php',
  'https://www.mtproto.ru/example-other.php',
  'https://www.mtproto.ru/example-other.php',
];

function isIpPort(s) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(s);
}

async function collectProxies() {
  const results = await Promise.all(RAW_URLS.map(async (url) => {
    try {
      const text = await getText(url);
      return text.split('\n').map(l => l.trim()).filter(isIpPort).map(p => ({ proxy: p, type: 'HTTP' }));
    } catch { return []; }
  }));
  const seen = new Set();
  const all = [];
  for (const batch of results) {
    for (const entry of batch) {
      if (!seen.has(entry.proxy)) { seen.add(entry.proxy); all.push(entry); }
    }
  }
  return all.sort(() => Math.random() - 0.5);
}

function parseMTProto(text) {
  const results = [];
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    let m = line.match(/server=([^&]+)&port=(\d+)&secret=([^\s&]+)/);
    if (m) {
      results.push({ proxy: m[1] + ':' + m[2], secret: m[3], type: 'MTProto', link: line.startsWith('http') ? line : 'tg://proxy?' + line });
      continue;
    }
    m = line.match(/tg:\/\/proxy\?server=([^&]+)&port=(\d+)&secret=([^\s&]+)/);
    if (m) {
      results.push({ proxy: m[1] + ':' + m[2], secret: m[3], type: 'MTProto', link: line });
      continue;
    }
    m = line.match(/https:\/\/t\.me\/proxy\?server=([^&]+)&port=(\d+)&secret=([^\s&]+)/);
    if (m) {
      results.push({ proxy: m[1] + ':' + m[2], secret: m[3], type: 'MTProto', link: 'tg://proxy?server=' + m[1] + '&port=' + m[2] + '&secret=' + m[3] });
      continue;
    }
    m = line.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}):([a-fA-F0-9]+)$/);
    if (m) {
      results.push({ proxy: m[1], secret: m[2], type: 'MTProto', link: 'tg://proxy?server=' + m[1].split(':')[0] + '&port=' + m[1].split(':')[1] + '&secret=' + m[2] });
    }
  }
  return results;
}

async function collectMTProto() {
  const results = await Promise.all(MTPROTO_SOURCES.map(async (url) => {
    try {
      return parseMTProto(await getText(url));
    } catch { return []; }
  }));
  const seen = new Set();
  const all = [];
  for (const batch of results) {
    for (const entry of batch) {
      if (!seen.has(entry.proxy + entry.secret)) { seen.add(entry.proxy + entry.secret); all.push(entry); }
    }
  }
  return all.sort(() => Math.random() - 0.5);
}

function tcpPing(host, port, ms = 3000) {
  return new Promise(r => {
    const s = new net.Socket();
    const start = Date.now();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; s.destroy(); r({ ok: false, ping: 0 }); } }, ms);
    const finish = v => { if (done) return; done = true; clearTimeout(timer); s.destroy(); r({ ok: v, ping: Date.now() - start }); };
    s.on('connect', () => finish(true));
    s.on('error', () => finish(false));
    s.on('timeout', () => finish(false));
    s.connect(port, host);
  });
}

async function checkHttp(host, port, ms = 5000) {
  const start = Date.now();
  return new Promise(r => {
    const s = new net.Socket();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; s.destroy(); r({ ok: false, ping: 0 }); } }, ms);
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); s.destroy(); r({ ok, ping: Date.now() - start }); };
    s.on('connect', () => s.write(`CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\n\r\n`));
    s.on('data', d => finish(d.toString().includes('200')));
    s.on('error', () => finish(false));
    s.on('timeout', () => finish(false));
    s.connect(port, host);
  });
}

async function checkMTProto(host, port, secret, ms = 3000) {
  const start = Date.now();
  return new Promise(r => {
    const s = new net.Socket();
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; s.destroy(); r({ ok: false, ping: 0 }); } }, ms);
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); s.destroy(); r({ ok, ping: Date.now() - start }); };
    s.on('connect', () => {
      try {
        const raw = Buffer.from(secret, 'hex');
        const probe = Buffer.concat([Buffer.from([0xef]), crypto.randomBytes(8), raw]);
        s.write(probe);
      } catch { finish(false); }
    });
    s.on('data', () => finish(true));
    s.on('error', () => finish(false));
    s.on('timeout', () => finish(false));
    s.connect(port, host);
  });
}

async function checkProxy(entry) {
  try {
    const t0 = Date.now();
    const [host, port] = entry.proxy.split(':');
    const p = parseInt(port, 10);
    const tcp = await tcpPing(host, p);
    if (!tcp.ok) return null;
    const res = await checkHttp(host, p);
    return res.ok ? { ...entry, ping: Date.now() - t0 } : null;
  } catch {
    return null;
  }
}

async function refreshProxies() {
  try {
    console.log('[Proxy] Fetching...');
    const all = await collectProxies();
    console.log(`[Proxy] ${all.length} unique`);
    const batch = all.slice(0, 80);
    const MAX = 15;
    const working = [];
    for (let i = 0; i < batch.length && working.length < 10; i += MAX) {
      const chunk = batch.slice(i, i + MAX);
      console.log(`[Proxy] Batch ${i / MAX + 1}...`);
      const results = await Promise.all(chunk.map(checkProxy));
      for (const r of results) {
        if (r && working.length < 10) { working.push(r); console.log(`[Proxy] OK ${r.type} ${r.proxy} ${r.ping}ms`); }
      }
    }
    if (working.length > 0 || verifiedProxies.length === 0) verifiedProxies = working.length > 0 ? working : verifiedProxies;
    console.log(`[Proxy] Working: ${working.length}`);
  } catch (e) { console.error('[Proxy] Error:', e.message); }
}

async function refreshMTProto() {
  try {
    console.log('[MTProto] Fetching...');
    const all = await collectMTProto();
    console.log(`[MTProto] ${all.length} candidates`);
    const batch = all.slice(0, 20);
    const MAX = 20;
    const working = [];
    for (let i = 0; i < batch.length && working.length < 10; i += MAX) {
      const chunk = batch.slice(i, i + MAX);
      console.log(`[MTProto] Batch ${i / MAX + 1}...`);
      const results = await Promise.all(chunk.map(async (e) => {
        try {
          const t0 = Date.now();
          const [host, port] = e.proxy.split(':');
          const res = await checkMTProto(host, parseInt(port), e.secret);
          return res.ok ? { ...e, ping: Date.now() - t0 } : null;
        } catch { return null; }
      }));
      for (const r of results) {
        if (r && working.length < 10) { working.push(r); console.log(`[MTProto] OK ${r.proxy} ${r.ping}ms`); }
      }
    }
    if (working.length > 0 || mtProtoProxies.length === 0) mtProtoProxies = working.length > 0 ? working : mtProtoProxies;
    console.log(`[MTProto] Working: ${working.length}`);
  } catch (e) { console.error('[MTProto] Error:', e.message); }
}

app.use(express.static(__dirname + '/public'));
app.use(express.json());

app.get('/api/proxies', (req, res) => res.json({ proxies: verifiedProxies, isRunning }));
app.get('/api/mtproto', (req, res) => res.json({ proxies: mtProtoProxies, isRunning: mtRunning }));

app.post('/api/start', (req, res) => {
  if (isRunning) return res.json({ status: 'already_running' });
  isRunning = true;
  res.json({ status: 'started' });
  refreshProxies().then(() => {
    intervalId = setInterval(() => refreshProxies().catch(e => console.error('[Interval]', e.message)), 120000);
  }).catch(e => { console.error('[Start]', e.message); isRunning = false; });
});

app.post('/api/stop', (req, res) => {
  isRunning = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  res.json({ status: 'stopped' });
});

app.post('/api/refresh', (req, res) => {
  res.json({ status: 'refreshing' });
  refreshProxies().catch(e => console.error('[Refresh]', e.message));
});

app.post('/api/mtproto/start', (req, res) => {
  if (mtRunning) return res.json({ status: 'already_running' });
  mtRunning = true;
  res.json({ status: 'started' });
  refreshMTProto().then(() => {
    mtIntervalId = setInterval(() => refreshMTProto().catch(e => console.error('[MT-Interval]', e.message)), 120000);
  }).catch(e => { console.error('[MT-Start]', e.message); mtRunning = false; });
});

app.post('/api/mtproto/stop', (req, res) => {
  mtRunning = false;
  if (mtIntervalId) { clearInterval(mtIntervalId); mtIntervalId = null; }
  res.json({ status: 'stopped' });
});

app.post('/api/mtproto/refresh', (req, res) => {
  res.json({ status: 'refreshing' });
  refreshMTProto().catch(e => console.error('[MT-Refresh]', e.message));
});

process.on('uncaughtException', e => console.error('[Fatal]', e.message));
process.on('unhandledRejection', e => console.error('[Fatal]', e?.message));

app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
