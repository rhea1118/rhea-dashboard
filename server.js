/* ===== Rhea Dashboard - Server ===== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8888;
const ROOT = __dirname;

// Python 路径（自动检测 Windows/Linux/Docker）
const PYTHON = (() => {
  // 优先使用环境变量
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  // Windows 虚拟环境
  const winPath = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winPath)) return winPath;
  // Linux/Docker 虚拟环境
  const linuxPath = path.join(ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(linuxPath)) return linuxPath;
  // 回退到系统 python3
  return process.platform === 'win32' ? 'python' : 'python3';
})();
const GENERATE_SCRIPT = path.join(ROOT, 'scripts', 'generate_briefing.py');

// ===== 定时兜底：每天 8:30 检查，如果今天还没简报就自动生成 =====
const BRIEFING_PATH = path.join(ROOT, 'data', 'briefing.json');
let _fallbackRanToday = ''; // 记录今天是否已跑过兜底，格式 'YYYY-MM-DD'

function getBeijingDate() {
  const now = new Date();
  // 北京时间 = UTC+8
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getBeijingHourMin() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.getUTCHours() * 100 + bj.getUTCMinutes(); // HHMM 整数
}

function getBriefingDate() {
  try {
    const data = JSON.parse(fs.readFileSync(BRIEFING_PATH, 'utf8'));
    return data.date || '';
  } catch {
    return '';
  }
}

function runFallbackGeneration() {
  const today = getBeijingDate();
  if (_fallbackRanToday === today) return; // 今天已跑过

  const briefingDate = getBriefingDate();
  if (briefingDate === today) {
    _fallbackRanToday = today; // 已有今天数据，标记跳过
    return;
  }

  console.log(`[Fallback] 今天(${today})简报缺失(现有: ${briefingDate})，启动兜底生成...`);
  _fallbackRanToday = today;

  const proc = spawn(PYTHON, [GENERATE_SCRIPT], {
    cwd: ROOT,
    timeout: 120000,
    env: { ...process.env }
  });

  let stdout = '';
  proc.stdout.on('data', chunk => stdout += chunk);
  proc.stderr.on('data', chunk => process.stderr.write(chunk));

  proc.on('close', (code) => {
    if (code === 0 && stdout.trim()) {
      try {
        const data = JSON.parse(stdout.trim());
        fs.writeFileSync(BRIEFING_PATH, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[Fallback] ✓ 兜底简报已生成并保存 (${today})`);
      } catch (e) {
        console.error('[Fallback] JSON 解析失败:', e.message);
      }
    } else {
      console.error(`[Fallback] ✗ 生成失败，退出码 ${code}`);
      _fallbackRanToday = ''; // 失败了允许重试
    }
  });

  proc.on('error', (err) => {
    console.error('[Fallback] Python 进程启动失败:', err.message);
    _fallbackRanToday = ''; // 失败了允许重试
  });
}

// 每 5 分钟检查一次
setInterval(() => {
  const hm = getBeijingHourMin();
  // 8:30 ~ 23:59 之间检查（太晚了就不跑了）
  if (hm >= 830 && hm < 2359) {
    runFallbackGeneration();
  }
}, 5 * 60 * 1000);

// 启动时立即检查一次
setTimeout(runFallbackGeneration, 5000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4'
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  let filePath = url.pathname;

  // === API Endpoints ===

  // GET /api/briefing - 获取最新简报
  if (filePath === '/api/briefing' && req.method === 'GET') {
    const briefingPath = path.join(ROOT, 'data', 'briefing.json');
    fs.readFile(briefingPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '暂无简报数据，请先生成' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  // GET /api/briefing-status - 快速检查简报新鲜度
  if (filePath === '/api/briefing-status' && req.method === 'GET') {
    const today = getBeijingDate();
    const briefingDate = getBriefingDate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      today,
      briefingDate,
      isFresh: briefingDate === today,
      source: briefingDate ? 'cached' : 'none'
    }));
    return;
  }

  // POST /api/briefing - 触发简报生成（由 WorkBuddy 自动化写入）
  if (filePath === '/api/briefing' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const briefingPath = path.join(ROOT, 'data', 'briefing.json');
        fs.writeFile(briefingPath, JSON.stringify(data, null, 2), 'utf8', (err) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '保存失败' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: '简报已保存' }));
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的JSON数据' }));
      }
    });
    return;
  }

  // POST /api/generate-briefing - 实时生成简报（调用 Python 抓取脚本）
  if (filePath === '/api/generate-briefing' && req.method === 'POST') {
    console.log('[API] 开始实时生成简报...');
    
    const proc = spawn(PYTHON, [GENERATE_SCRIPT], {
      cwd: ROOT,
      timeout: 60000,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => stdout += chunk);
    proc.stderr.on('data', chunk => stderr += chunk);

    proc.on('error', (err) => {
      console.error('[API] Python 进程启动失败:', err.message);
      // Fallback: 返回已有简报文件
      const briefingPath = path.join(ROOT, 'data', 'briefing.json');
      fs.readFile(briefingPath, 'utf8', (readErr, data) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '生成失败，且无缓存数据', detail: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    proc.on('close', (code) => {
      console.log(`[API] Python 进程退出码: ${code}`);
      if (code === 0 && stdout.trim()) {
        // 成功：保存到文件 + 返回 JSON
        try {
          fs.writeFileSync(BRIEFING_PATH, stdout.trim(), 'utf8');
          console.log('[API] ✓ 实时简报已保存到文件');
        } catch (e) {
          console.error('[API] 保存文件失败:', e.message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(stdout.trim());
      } else {
        // 失败：尝试返回缓存
        console.error('[API] 生成失败:', stderr.slice(-300));
        const briefingPath = path.join(ROOT, 'data', 'briefing.json');
        fs.readFile(briefingPath, 'utf8', (readErr, data) => {
          if (readErr) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '生成失败，且无缓存', detail: stderr.slice(-200) }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      }
    });
    return;
  }

  // GET /api/health - 健康检查
  if (filePath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // === Static Files ===
  if (filePath === '/') filePath = '/index.html';

  const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(ROOT, safePath);

  // Security: ensure we're within ROOT
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback: serve index.html for unknown routes
        fs.readFile(path.join(ROOT, 'index.html'), (err2, indexContent) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexContent);
        });
        return;
      }
      res.writeHead(500);
      res.end('Server Error');
      return;
    }

    // Cache control
    if (ext === '.html' || ext === '.js' || filePath === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (ext === '.json') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Rhea Dashboard running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/briefing`);
  console.log(`API: http://localhost:${PORT}/api/health`);
});
