const API = {
  getProxies() { return fetch('/api/proxies').then(r => r.json()); },
  start() { return fetch('/api/start', { method: 'POST' }).then(r => r.json()); },
  stop() { return fetch('/api/stop', { method: 'POST' }).then(r => r.json()); },
  refresh() { return fetch('/api/refresh', { method: 'POST' }).then(r => r.json()); },
  getMT() { return fetch('/api/mtproto').then(r => r.json()); },
  startMT() { return fetch('/api/mtproto/start', { method: 'POST' }).then(r => r.json()); },
  stopMT() { return fetch('/api/mtproto/stop', { method: 'POST' }).then(r => r.json()); },
  refreshMT() { return fetch('/api/mtproto/refresh', { method: 'POST' }).then(r => r.json()); },
};

const $ = id => document.getElementById(id);

function renderList(list, proxies) {
  if (!proxies || proxies.length === 0) {
    list.innerHTML = '<div class="proxy-card placeholder">Нет прокси.</div>';
    return;
  }
  list.innerHTML = proxies.map(p => {
    const pingText = p.ping ? p.ping + 'ms' : '—';
    if (p.type === 'MTProto') {
      const [host, port] = p.proxy.split(':');
      return `<div class="proxy-card mtproto-card">
        <div class="mtproto-info">
          <span class="proxy-addr">${host}:${port}</span>
          <span class="proxy-secret" title="Secret">Secret: ${p.secret}</span>
        </div>
        <span class="proxy-status ok">&#10003;</span>
        <span class="proxy-ping">${pingText}</span>
        <button class="copy-btn" data-proxy="${p.link || p.proxy}">Копировать</button>
      </div>`;
    }
    return `<div class="proxy-card">
      <span class="proxy-addr">${p.proxy}</span>
      <span class="proxy-type ${p.type}">${p.type}</span>
      <span class="proxy-status ok">&#10003;</span>
      <span class="proxy-ping">${pingText}</span>
      <button class="copy-btn" data-proxy="${p.link || p.proxy}">Копировать</button>
    </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.proxy).then(() => {
    btn.textContent = 'Готово';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Копировать'; btn.classList.remove('copied'); }, 1800);
  });
});

function setUI(running, dot, text, startBtn, stopBtn) {
  if (running) {
    dot.className = 'dot active';
    text.textContent = 'Поиск...';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    dot.className = 'dot';
    text.textContent = 'Остановлено';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// HTTP/SOCKS5 controls
$('startBtn').addEventListener('click', async () => { $('startBtn').disabled = true; await API.start(); });
$('stopBtn').addEventListener('click', async () => { $('stopBtn').disabled = true; await API.stop(); });
$('refreshBtn').addEventListener('click', async () => {
  $('refreshBtn').disabled = true; $('refreshBtn').textContent = 'Поиск...';
  await API.refresh(); $('refreshBtn').textContent = 'Обновить'; $('refreshBtn').disabled = false;
});

// MTProto controls
$('mtStartBtn').addEventListener('click', async () => { $('mtStartBtn').disabled = true; await API.startMT(); });
$('mtStopBtn').addEventListener('click', async () => { $('mtStopBtn').disabled = true; await API.stopMT(); });
$('mtRefreshBtn').addEventListener('click', async () => {
  $('mtRefreshBtn').disabled = true; $('mtRefreshBtn').textContent = 'Поиск...';
  await API.refreshMT(); $('mtRefreshBtn').textContent = 'Обновить'; $('mtRefreshBtn').disabled = false;
});

async function poll() {
  try {
    const d1 = await API.getProxies();
    renderList($('proxyList'), d1.proxies);
    setUI(d1.isRunning, $('statusDot'), $('statusText'), $('startBtn'), $('stopBtn'));
    if (d1.proxies && d1.proxies.length > 0) {
      $('counter').style.display = 'block';
      $('foundCount').textContent = d1.proxies.length;
    } else { $('counter').style.display = 'none'; }
  } catch {}

  try {
    const d2 = await API.getMT();
    renderList($('mtProxyList'), d2.proxies);
    setUI(d2.isRunning, $('mtDot'), $('mtStatusText'), $('mtStartBtn'), $('mtStopBtn'));
    if (d2.proxies && d2.proxies.length > 0) {
      $('mtCounter').style.display = 'block';
      $('mtFoundCount').textContent = d2.proxies.length;
    } else { $('mtCounter').style.display = 'none'; }
  } catch {}
}

setInterval(poll, 4000);
poll();
