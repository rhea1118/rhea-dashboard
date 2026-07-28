/* ===== Rhea Dashboard - App Logic ===== */

// ===== Storage =====
const Store = {
  KEY: 'rhea_data_v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  save(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); },
  get(key, def) {
    const d = this.load();
    return d[key] !== undefined ? d[key] : def;
  },
  set(key, val) {
    const d = this.load();
    d[key] = val;
    this.save(d);
  }
};

// ===== Utils =====
const U = {
  today() { return new Date().toISOString().slice(0,10); },
  now() { return new Date().toISOString().slice(11,16); },
  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return `${dt.getMonth()+1}月${dt.getDate()}日`;
  },
  fmtDateFull(d) {
    if (!d) return '';
    const dt = new Date(d);
    const wk = ['日','一','二','三','四','五','六'][dt.getDay()];
    return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日 周${wk}`;
  },
  fmtMoney(n) { return '¥' + (n || 0).toLocaleString('zh-CN', {minimumFractionDigits:0, maximumFractionDigits:2}); },
  daysBetween(a, b) {
    const d1 = new Date(a), d2 = new Date(b);
    return Math.round((d2 - d1) / 86400000);
  },
  daysUntil(date) {
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(date); target.setHours(0,0,0,0);
    return Math.round((target - today) / 86400000);
  },
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); },
  escape(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },
  lunarToSolar(year, month, day) {
    // Simplified: just return the date as-is for display purposes
    // Full lunar calendar conversion is complex; we store the original date
    return null;
  }
};

// ===== Toast =====
function toast(msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(() => t.remove(), 3000);
}

// ===== App =====
const App = {
  current: 'dashboard',
  
  init() {
    this.bindNav();
    this.bindSidebar();
    this.updateTopbar();
    this.registerSW();
    this.switch('dashboard');
    // Update time every minute
    setInterval(() => this.updateTopbar(), 60000);
  },
  
  bindNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.switch(item.dataset.module);
        if (window.innerWidth <= 768) this.closeSidebar();
      });
    });
  },
  
  bindSidebar() {
    document.getElementById('menuToggle').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('sidebarOverlay').addEventListener('click', () => this.closeSidebar());
  },
  
  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
  },
  
  updateTopbar() {
    const now = new Date();
    const wk = ['日','一','二','三','四','五','六'][now.getDay()];
    const dateStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${wk}`;
    document.getElementById('topbarDate').textContent = dateStr;
    document.getElementById('sidebarDate').textContent = dateStr;
    const h = now.getHours();
    let g = '晚上好';
    if (h < 6) g = '夜深了'; else if (h < 9) g = '早上好'; else if (h < 12) g = '上午好'; else if (h < 14) g = '中午好'; else if (h < 18) g = '下午好';
    document.getElementById('topbarGreeting').textContent = g + '，Rhea 为你服务';
  },
  
  switch(module) {
    this.current = module;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.module === module));
    const titles = {
      dashboard: '首页概览', todos: '每日待办', social: '外贸运营', learning: '学习阅读',
      expenses: '收支记账', health: '减脂记录', schedule: '日程安排', anniversaries: '纪念日', periods: '经期记录'
    };
    document.getElementById('pageTitle').textContent = titles[module] || '';
    const area = document.getElementById('contentArea');
    area.innerHTML = '';
    area.classList.add('fade-in');
    setTimeout(() => area.classList.remove('fade-in'), 300);
    const fn = this.modules[module];
    if (fn) fn.call(this, area);
  },
  
  registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },
  
  modules: {}
};

/* ============================================================
   MODULE: Dashboard
   ============================================================ */
App.modules.dashboard = function(el) {
  const todos = Store.get('todos', []);
  const todayTodos = todos.filter(t => t.date === U.today() && !t.completed);
  const expenses = Store.get('expenses', []);
  const now = new Date();
  const monthExp = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthIncome = monthExp.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const monthExpense = monthExp.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  
  const schedule = Store.get('schedule', []);
  const todaySched = schedule.filter(s => s.date === U.today()).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  
  const annis = Store.get('anniversaries', []);
  const upcoming = annis.map(a => {
    const next = this.nextAnniversaryDate(a);
    return { ...a, daysUntil: U.daysUntil(next), nextDate: next };
  }).filter(a => a.daysUntil <= 30 && a.daysUntil >= -1).sort((a, b) => a.daysUntil - b.daysUntil);
  
  const periods = Store.get('periods', []);
  const periodInfo = this.getPeriodInfo(periods);
  
  const learning = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  const todayLearn = learning.english.filter(l => l.date === U.today()).length +
    learning.reading.filter(l => l.date === U.today()).length +
    learning.finance.filter(l => l.date === U.today()).length +
    learning.chat.filter(l => l.date === U.today()).length;
  
  let html = `
    <div class="welcome-banner">
      <h2>${this.greeting()}, 这是今天的概览</h2>
      <p>${U.fmtDateFull(U.today())}</p>
    </div>
    <div class="grid-4">
      <div class="stat-card">
        <span class="stat-label">今日待办</span>
        <span class="stat-value primary">${todayTodos.length}</span>
        <span class="stat-sub">共 ${todos.filter(t => t.date === U.today()).length} 项</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">本月收入</span>
        <span class="stat-value success">${U.fmtMoney(monthIncome)}</span>
        <span class="stat-sub">支出 ${U.fmtMoney(monthExpense)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">本月结余</span>
        <span class="stat-value ${monthIncome - monthExpense >= 0 ? 'success' : 'danger'}">${U.fmtMoney(monthIncome - monthExpense)}</span>
        <span class="stat-sub">${now.getMonth()+1}月数据</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">今日日程</span>
        <span class="stat-value primary">${todaySched.length}</span>
        <span class="stat-sub">${todaySched.length > 0 ? '有安排' : '暂无'}</span>
      </div>
    </div>
    <div class="grid-2 mt-16">
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>今日待办</div>
        ${todayTodos.length > 0 ? todayTodos.map(t => `
          <div class="todo-item">
            <div class="todo-checkbox" onclick="App.toggleTodo('${t.id}')"></div>
            <div class="todo-content">
              <div class="todo-text">${U.escape(t.text)}</div>
              <div class="todo-meta"><span class="badge ${t.category === 'work' ? 'badge-work' : 'badge-life'}">${t.category === 'work' ? '工作' : '生活'}</span></div>
            </div>
          </div>
        `).join('') : '<div class="empty-state"><p>今日暂无待办，享受生活吧！</p></div>'}
        <button class="btn btn-soft btn-sm mt-12" onclick="App.switch('todos')">查看全部待办 →</button>
      </div>
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>今日日程</div>
        ${todaySched.length > 0 ? todaySched.map(s => `
          <div class="sched-entry">
            <div class="sched-time">
              <div class="time">${s.time || '全天'}</div>
            </div>
            <div class="sched-content">
              <div class="title">${U.escape(s.title)}</div>
              ${s.desc ? `<div class="desc">${U.escape(s.desc)}</div>` : ''}
            </div>
          </div>
        `).join('') : '<div class="empty-state"><p>今日暂无日程安排</p></div>'}
      </div>
    </div>
    <div class="grid-2 mt-16">
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>近期纪念日</div>
        ${upcoming.length > 0 ? upcoming.slice(0, 5).map(a => `
          <div class="anni-entry">
            <div class="anni-icon" style="background:${a.type === 'birthday' ? '#FEF3C7' : '#E0E7FF'};color:${a.type === 'birthday' ? '#D97706' : '#6366F1'}">${a.type === 'birthday' ? '🎂' : '💝'}</div>
            <div class="anni-info">
              <div class="anni-name">${U.escape(a.name)}</div>
              <div class="anni-date">${a.isLunar ? '农历 ' : ''}${a.date}</div>
            </div>
            <div class="anni-countdown">
              ${a.daysUntil === 0 ? '<strong>今天</strong><div class="text-light text-sm">就是今天！</div>' : 
                a.daysUntil > 0 ? `<strong>${a.daysUntil}</strong><div class="text-light text-sm">天后</div>` :
                `<strong>${-a.daysUntil}</strong><div class="text-light text-sm">天前</div>`}
            </div>
          </div>
        `).join('') : '<div class="empty-state"><p>暂无近期纪念日</p></div>'}
      </div>
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>经期 & 学习状态</div>
        ${periodInfo.nextDate ? `
          <div class="mini-item">
            <div class="dot" style="background:var(--accent)"></div>
            <span>下次经期预计：${U.fmtDate(periodInfo.nextDate)}（${periodInfo.daysUntil >= 0 ? '还有 ' + periodInfo.daysUntil + ' 天' : '已过 ' + (-periodInfo.daysUntil) + ' 天'}）</span>
          </div>
        ` : '<div class="mini-item"><div class="dot" style="background:var(--text-light)"></div><span>暂无经期记录</span></div>'}
        <div class="mini-item mt-8">
          <div class="dot" style="background:${todayLearn > 0 ? 'var(--success)' : 'var(--text-light)'}"></div>
          <span>今日学习记录：${todayLearn > 0 ? todayLearn + ' 条' : '暂无记录'}</span>
        </div>
        <div class="mini-item mt-8">
          <div class="dot" style="background:var(--primary)"></div>
          <span>本周学习：英语 ${this.weekCount(learning.english)} / 阅读 ${this.weekCount(learning.reading)} / 理财 ${this.weekCount(learning.finance)} / 聊天 ${this.weekCount(learning.chat)}</span>
        </div>
      </div>
    </div>
  `;
  el.innerHTML = html;
};

App.greeting = function() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了'; if (h < 9) return '早上好'; if (h < 12) return '上午好';
  if (h < 14) return '中午好'; if (h < 18) return '下午好'; return '晚上好';
};

App.weekCount = function(arr) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return arr.filter(l => new Date(l.date) >= weekStart).length;
};

/* ============================================================
   MODULE: Todos
   ============================================================ */
App.modules.todos = function(el) {
  const todos = Store.get('todos', []);
  const today = U.today();
  let filter = 'all'; // all, work, life, today
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>添加待办</div>
      <div class="form-row">
        <div class="form-group" style="flex:3">
          <input type="text" id="todoInput" placeholder="输入待办事项..." onkeydown="if(event.key==='Enter')App.addTodo()">
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <select id="todoCat">
            <option value="work">工作</option>
            <option value="life">生活</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:120px">
          <input type="date" id="todoDate" value="${today}">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addTodo()">添加</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="filter-tabs">
        <button class="filter-tab active" data-filter="all" onclick="App.filterTodos('all')">全部</button>
        <button class="filter-tab" data-filter="today" onclick="App.filterTodos('today')">今日</button>
        <button class="filter-tab" data-filter="work" onclick="App.filterTodos('work')">工作</button>
        <button class="filter-tab" data-filter="life" onclick="App.filterTodos('life')">生活</button>
      </div>
      <div id="todoList"></div>
    </div>
  `;
  App._todoFilter = 'all';
  App.renderTodoList();
};

App.filterTodos = function(f) {
  App._todoFilter = f;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === f));
  App.renderTodoList();
};

App.renderTodoList = function() {
  const todos = Store.get('todos', []);
  const f = App._todoFilter || 'all';
  let list = todos.slice().sort((a, b) => (a.completed - b.completed) || (b.date < a.date ? -1 : 1));
  if (f === 'today') list = list.filter(t => t.date === U.today());
  if (f === 'work') list = list.filter(t => t.category === 'work');
  if (f === 'life') list = list.filter(t => t.category === 'life');
  
  const container = document.getElementById('todoList');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>暂无待办事项</p></div>';
    return;
  }
  container.innerHTML = list.map(t => `
    <div class="todo-item ${t.completed ? 'completed' : ''}">
      <div class="todo-checkbox ${t.completed ? 'checked' : ''}" onclick="App.toggleTodo('${t.id}')"></div>
      <div class="todo-content">
        <div class="todo-text">${U.escape(t.text)}</div>
        <div class="todo-meta">
          <span class="badge ${t.category === 'work' ? 'badge-work' : 'badge-life'}">${t.category === 'work' ? '工作' : '生活'}</span>
          <span class="text-sm text-light">${U.fmtDate(t.date)}${t.date === U.today() ? '（今天）' : ''}</span>
        </div>
      </div>
      <div class="todo-actions">
        <button class="todo-delete" onclick="App.deleteTodo('${t.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
};

App.addTodo = function() {
  const text = document.getElementById('todoInput').value.trim();
  const cat = document.getElementById('todoCat').value;
  const date = document.getElementById('todoDate').value || U.today();
  if (!text) { toast('请输入待办内容'); return; }
  const todos = Store.get('todos', []);
  todos.push({ id: U.uid(), text, category: cat, date, completed: false, created: Date.now() });
  Store.set('todos', todos);
  document.getElementById('todoInput').value = '';
  App.renderTodoList();
  toast('待办已添加');
};

App.toggleTodo = function(id) {
  const todos = Store.get('todos', []);
  const t = todos.find(t => t.id === id);
  if (t) { t.completed = !t.completed; Store.set('todos', todos); App.renderTodoList(); }
};

App.deleteTodo = function(id) {
  let todos = Store.get('todos', []);
  todos = todos.filter(t => t.id !== id);
  Store.set('todos', todos);
  App.renderTodoList();
  toast('已删除');
};

/* ============================================================
   MODULE: Social Media Operations
   ============================================================ */
App.modules.social = function(el) {
  el.innerHTML = `
    <div class="content-tabs">
      <button class="content-tab active" data-tab="news" onclick="App.socialTab('news')">热点速报</button>
      <button class="content-tab" data-tab="topics" onclick="App.socialTab('topics')">选题策划</button>
      <button class="content-tab" data-tab="data" onclick="App.socialTab('data')">数据复盘</button>
      <button class="content-tab" data-tab="monthly" onclick="App.socialTab('monthly')">月度报表</button>
      <button class="content-tab" data-tab="quarterly" onclick="App.socialTab('quarterly')">季度报表</button>
    </div>
    <a class="briefing-banner" href="briefing.html" target="_blank" rel="noopener">
      <span class="briefing-banner__icon">📄</span>
      <span class="briefing-banner__text">
        <strong>打开今日独立简报页</strong>
        <span class="briefing-banner__hint">清爽阅读模式，适合转发分享，不受 App 缓存影响</span>
      </span>
      <span class="briefing-banner__arrow">↗</span>
    </a>
    <div id="socialContent"></div>
  `;
  App._socialTab = 'news';
  App.socialTab('news');
  // 进入模块时自动从服务器加载最新简报（如果本地还没有今天的数据）
  App.autoLoadBriefing();
};

// 自动从服务器缓存加载简报到 localStorage
App.autoLoadBriefing = async function() {
  const today = U.today();
  const saved = Store.get('social_news', {});
  const hasToday = saved[today] && saved[today].aiGenerated;
  if (hasToday) return; // 本地已有今天数据，无需加载
  try {
    const resp = await fetch('/api/briefing');
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || !data.africa) return;
    const s = Store.get('social_news', {});
    s[today] = {
      africa: data.africa || '',
      southamerica: data.southamerica || '',
      fx: data.fx || '',
      competitor: data.competitor || '',
      topics: data.topics || '',
      aiGenerated: true,
      generatedAt: data.generatedAt || '',
      savedAt: Date.now()
    };
    Store.set('social_news', s);
    // 同步选题建议
    if (data.topicSuggestions) {
      const topics = Store.get('social_topics', {});
      topics[today] = topics[today] || {};
      if (!topics[today]._aiGenerated) {
        Object.assign(topics[today], data.topicSuggestions);
        topics[today]._aiGenerated = true;
      }
      Store.set('social_topics', topics);
    }
    // 如果当前还在热点速报 tab，切回 AI 视图并刷新显示
    if (App._socialTab === 'news') {
      App._newsManual = false;
      App.socialTab('news');
    }
  } catch (e) {
    console.log('autoLoadBriefing skip:', e.message);
  }
};

App.socialTab = function(tab) {
  App._socialTab = tab;
  document.querySelectorAll('.content-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const c = document.getElementById('socialContent');
  if (!c) return;
  const fn = { news: 'socialNews', topics: 'socialTopics', data: 'socialData', monthly: 'socialMonthly', quarterly: 'socialQuarterly' }[tab];
  if (App[fn]) App[fn](c);
};

// AI real-time generate briefing from server
App.fetchBriefing = async function() {
  const today = U.today();
  const c = document.getElementById('socialContent');
  if (c) c.innerHTML = `<div class="card"><div class="empty-state"><div class="loading-spinner"></div><p class="mt-8">🤖 AI 正在从网络实时抓取今日热点...</p><p class="text-sm text-light mt-8">搜索中：汇率数据 → 非洲新闻 → 南美市场 → 竞品动态 → 社媒热点</p><p class="text-xs text-light mt-8">预计 10-30 秒，请稍候...</p></div></div>`;
  
  try {
    // 第一步：调用实时生成接口
    const generateResp = await fetch('/api/generate-briefing', { method: 'POST' });
    if (generateResp.ok) {
      const data = await generateResp.json();
      if (data.error) throw new Error(data.error);
      
      // 保存 AI 数据到 localStorage
      const saved = Store.get('social_news', {});
      saved[today] = {
        africa: data.africa || '',
        southamerica: data.southamerica || '',
        fx: data.fx || '',
        competitor: data.competitor || '',
        topics: data.topics || '',
        aiGenerated: true,
        generatedAt: data.generatedAt || '',
        savedAt: Date.now()
      };
      Store.set('social_news', saved);
      
      // 保存选题建议
      if (data.topicSuggestions) {
        const topics = Store.get('social_topics', {});
        topics[today] = topics[today] || {};
        if (!topics[today]._aiGenerated) {
          Object.assign(topics[today], data.topicSuggestions);
          topics[today]._aiGenerated = true;
        }
        Store.set('social_topics', topics);
      }
      toast('✅ AI 简报已实时生成！（数据来源：' + (data.source || '网络抓取') + '）');
      App.socialTab('news');
      return;
    }
    
    // 第二步：生成接口失败，尝试读取缓存简报
    if (generateResp.status === 404) {
      toast('⚠️ 生成服务不可用，尝试读取缓存...');
    }
    const cacheResp = await fetch('/api/briefing');
    if (cacheResp.ok) {
      const data = await cacheResp.json();
      const saved = Store.get('social_news', {});
      saved[today] = {
        africa: data.africa || '',
        southamerica: data.southamerica || '',
        fx: data.fx || '',
        competitor: data.competitor || '',
        topics: data.topics || '',
        aiGenerated: true,
        savedAt: Date.now()
      };
      Store.set('social_news', saved);
      if (data.topicSuggestions) {
        const topics = Store.get('social_topics', {});
        topics[today] = topics[today] || {};
        if (!topics[today]._aiGenerated) {
          Object.assign(topics[today], data.topicSuggestions);
          topics[today]._aiGenerated = true;
        }
        Store.set('social_topics', topics);
      }
      toast('📋 已加载缓存简报');
      App.socialTab('news');
    } else {
      toast('❌ 暂无简报数据，请稍后重试或切换到手动编辑模式');
      App.socialTab('news');
    }
  } catch (e) {
    console.error('fetchBriefing error:', e);
    // 网络错误：尝试读取缓存
    try {
      const cacheResp = await fetch('/api/briefing');
      if (cacheResp.ok) {
        const data = await cacheResp.json();
        const saved = Store.get('social_news', {});
        saved[today] = { ...data, aiGenerated: true, savedAt: Date.now() };
        Store.set('social_news', saved);
        toast('📋 生成超时，已加载昨日缓存');
        App.socialTab('news');
        return;
      }
    } catch (_) {}
    toast('⚠️ 无法连接服务器，切换为手动编辑模式');
    App._newsManual = true;
    App.socialTab('news');
  }
};

App.socialNews = function(el) {
  const saved = Store.get('social_news', {});
  const today = U.today();
  const todayData = saved[today] || {};
  const hasAiData = todayData.aiGenerated;
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span><span class="icon-dot"></span>📰 今日热点速报（${U.fmtDateFull(today)}）</span>
        <div style="display:flex;gap:8px">
          ${hasAiData ? '<span class="badge badge-accent" style="background:#10B981">🤖 AI 生成</span>' : ''}
          <button class="btn btn-primary btn-sm" onclick="App.fetchBriefing()" style="padding:6px 14px;font-size:13px">🔍 实时搜索生成简报</button>
          <button class="btn btn-soft btn-sm" onclick="App.toggleNewsMode()" style="padding:6px 14px;font-size:13px">${App._newsManual ? 'AI 视图' : '手动编辑'}</button>
        </div>
      </div>
      <p class="text-sm text-light mb-8">🤖 AI 自动抓取网络信息 | 产品关键词：中国品牌卡车、工程机械及配件 | 主力市场：非洲、南美、东南亚</p>
      ${!hasAiData ? `
        <div class="empty-state" style="background:var(--bg-soft);border-radius:8px;padding:24px;text-align:center">
          <p class="mb-8">📡 点击上方 <strong>"实时搜索生成简报"</strong> 按钮</p>
          <p class="text-sm text-light mb-4">系统将实时从网络抓取：非洲市场动态 · 南美需求/关税 · 汇率运费 · 竞品动向 · 社媒热点</p>
          <p class="text-xs text-light">⚡ 生成约需 10-30 秒，数据来自公开网络</p>
        </div>
      ` : ''}
      ${App._newsManual ? `
        <div class="form-group mb-8"><label>一、目标市场动态 - 非洲</label><textarea id="news_africa" placeholder="提炼1条关于非洲基建/矿业/进口政策的热点新闻...">${U.escape(todayData.africa || '')}</textarea></div>
        <div class="form-group mb-8"><label>一、目标市场动态 - 南美</label><textarea id="news_southamerica" placeholder="提炼1条关于南美（墨西哥/智利/等国家）工程机械和卡车需求或关税变化的热点...">${U.escape(todayData.southamerica || '')}</textarea></div>
        <div class="form-group mb-8"><label>一、目标市场动态 - 汇率/运费</label><textarea id="news_fx" placeholder="今日人民币兑美元中间价 + 非洲/南美航线40尺柜运费概览...">${U.escape(todayData.fx || '')}</textarea></div>
        <div class="form-group mb-8"><label>二、行业竞品动态</label><textarea id="news_competitor" placeholder="提炼1条徐工/三一/重汽/中联重科/陕汽等竞品在海外市场的近期动作...">${U.escape(todayData.competitor || '')}</textarea></div>
        <div class="form-group mb-8"><label>三、社交媒体热门话题</label><textarea id="news_topics" placeholder="在Facebook/LinkedIn上，目标客户群体正在讨论的热门话题/痛点...">${U.escape(todayData.topics || '')}</textarea></div>
        <button class="btn btn-primary" onclick="App.saveNews()">💾 保存修改</button>
      ` : (hasAiData ? `
        <div class="briefing-display">
          <div class="briefing-item"><div class="briefing-label">🌍 非洲</div><div class="briefing-text">${U.escape(todayData.africa)}</div></div>
          <div class="briefing-item"><div class="briefing-label">🌎 南美</div><div class="briefing-text">${U.escape(todayData.southamerica)}</div></div>
          <div class="briefing-item"><div class="briefing-label">💱 汇率/运费</div><div class="briefing-text">${U.escape(todayData.fx)}</div></div>
          <div class="briefing-item"><div class="briefing-label">🏭 竞品动态</div><div class="briefing-text">${U.escape(todayData.competitor)}</div></div>
          <div class="briefing-item"><div class="briefing-label">💬 社媒热点</div><div class="briefing-text">${U.escape(todayData.topics)}</div></div>
        </div>
      ` : '')}
    </div>
    <div id="newsHistory"></div>
  `;
  if (!App._newsManual && hasAiData) {
    App.loadNewsHistory();
  }
};

App._newsManual = false;
App.toggleNewsMode = function() {
  App._newsManual = !App._newsManual;
  App.socialTab('news');
};

App.saveNews = function() {
  const saved = Store.get('social_news', {});
  const today = U.today();
  saved[today] = {
    africa: document.getElementById('news_africa').value,
    southamerica: document.getElementById('news_southamerica').value,
    fx: document.getElementById('news_fx').value,
    competitor: document.getElementById('news_competitor').value,
    topics: document.getElementById('news_topics').value,
    aiGenerated: App._newsManual ? false : true,
    savedAt: Date.now()
  };
  Store.set('social_news', saved);
  App._newsManual = false;
  toast('今日热点速报已保存');
  App.socialTab('news');
};

App.loadNewsHistory = function() {
  const saved = Store.get('social_news', {});
  const dates = Object.keys(saved).sort().reverse();
  const c = document.getElementById('newsHistory');
  if (dates.length === 0) {
    c.innerHTML = '<div class="card"><div class="empty-state"><p>暂无历史速报</p></div></div>';
    return;
  }
  c.innerHTML = dates.slice(0, 7).map(d => {
    const n = saved[d];
    return `<div class="card">
      <div class="card-title"><span class="icon-dot"></span>📰 ${U.fmtDateFull(d)}</div>
      ${n.africa ? `<p class="mb-8"><strong>非洲：</strong>${U.escape(n.africa)}</p>` : ''}
      ${n.southamerica ? `<p class="mb-8"><strong>南美：</strong>${U.escape(n.southamerica)}</p>` : ''}
      ${n.fx ? `<p class="mb-8"><strong>汇率/运费：</strong>${U.escape(n.fx)}</p>` : ''}
      ${n.competitor ? `<p class="mb-8"><strong>竞品动态：</strong>${U.escape(n.competitor)}</p>` : ''}
      ${n.topics ? `<p><strong>社媒话题：</strong>${U.escape(n.topics)}</p>` : ''}
    </div>`;
  }).join('');
};

App.socialTopics = function(el) {
  const saved = Store.get('social_topics', {});
  const today = U.today();
  const t = saved[today] || {};
  const hasAiSuggestions = t._aiGenerated;
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span><span class="icon-dot"></span>📝 今日选题策划（${U.fmtDateFull(today)}）</span>
        ${hasAiSuggestions ? '<span class="badge badge-accent" style="background:#10B981">🤖 AI 基于热点自动生成</span>' : '<button class="btn btn-soft btn-sm" onclick="App.autoFillTopics()" style="padding:6px 14px;font-size:13px">🔄 尝试 AI 生成选题</button>'}
      </div>
      <p class="text-sm text-light mb-8">${hasAiSuggestions ? 'AI 已基于今日热点自动填充选题建议，可直接修改后保存' : '基于今日热点，结合产品生成发帖选题表格'}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th style="min-width:90px">平台</th><th style="min-width:70px">发帖时间</th><th style="min-width:90px">主题类型</th><th>标题/文案草稿</th><th style="min-width:100px">配图需求</th><th style="min-width:100px">关联热点</th></tr></thead>
          <tbody>
            <tr>
              <td>Facebook</td>
              <td><input type="time" value="${t.fb1_time || '14:30'}" data-key="fb1_time"></td>
              <td>配件单品</td>
              <td><textarea data-key="fb1_title" placeholder="生成1条适配今日热点的配件帖子标题...">${U.escape(t.fb1_title || '')}</textarea></td>
              <td><input type="text" data-key="fb1_img" placeholder="配图要求" value="${U.escape(t.fb1_img || '')}"></td>
              <td><input type="text" data-key="fb1_hot" placeholder="关联热点" value="${U.escape(t.fb1_hot || '')}"></td>
            </tr>
            <tr>
              <td>Facebook</td>
              <td><input type="time" value="${t.fb2_time || '14:30'}" data-key="fb2_time"></td>
              <td>整车/实力展示</td>
              <td><textarea data-key="fb2_title" placeholder="生成1条整车或装柜视频标题...">${U.escape(t.fb2_title || '')}</textarea></td>
              <td><input type="text" data-key="fb2_img" placeholder="配图要求" value="${U.escape(t.fb2_img || '')}"></td>
              <td><input type="text" data-key="fb2_hot" placeholder="关联热点" value="${U.escape(t.fb2_hot || '')}"></td>
            </tr>
            <tr>
              <td>LinkedIn</td>
              <td><input type="time" value="${t.li_time || '14:30'}" data-key="li_time"></td>
              <td>行业洞察</td>
              <td><textarea data-key="li_title" placeholder="生成1条体现专业度的短文...">${U.escape(t.li_title || '')}</textarea></td>
              <td><input type="text" data-key="li_img" placeholder="配图要求" value="${U.escape(t.li_img || '')}"></td>
              <td><input type="text" data-key="li_hot" placeholder="关联热点" value="${U.escape(t.li_hot || '')}"></td>
            </tr>
            <tr>
              <td>WhatsApp Status</td>
              <td><input type="text" value="${t.wa_time || '全天碎片'}" data-key="wa_time"></td>
              <td>即时动态</td>
              <td><textarea data-key="wa_title" placeholder="生成1条适合发WhatsApp状态的短文案...">${U.escape(t.wa_title || '')}</textarea></td>
              <td><input type="text" data-key="wa_img" placeholder="配图要求" value="${U.escape(t.wa_img || '')}"></td>
              <td>-</td>
            </tr>
            <tr>
              <td>YouTube</td>
              <td><input type="time" value="${t.yt_time || '14:30'}" data-key="yt_time"></td>
              <td>视频内容</td>
              <td><textarea data-key="yt_title" placeholder="生成1条YouTube视频标题...">${U.escape(t.yt_title || '')}</textarea></td>
              <td><input type="text" data-key="yt_img" placeholder="封面要求" value="${U.escape(t.yt_img || '')}"></td>
              <td><input type="text" data-key="yt_hot" placeholder="关联热点" value="${U.escape(t.yt_hot || '')}"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="btn btn-primary mt-12" onclick="App.saveTopics()">💾 保存今日选题</button>
      ${hasAiSuggestions ? `<button class="btn btn-soft mt-12" onclick="App.clearAiTopics()">🗑 清除 AI 建议（恢复空白）</button>` : ''}
    </div>
  `;
  // Auto-save on input
  el.querySelectorAll('[data-key]').forEach(inp => {
    inp.addEventListener('change', () => App.saveTopics());
  });
};

App.autoFillTopics = function() {
  // Try to fetch briefing and get topic suggestions
  fetch('/api/briefing').then(r => r.json()).then(data => {
    if (data.topicSuggestions) {
      const topics = Store.get('social_topics', {});
      const today = U.today();
      topics[today] = Object.assign({}, data.topicSuggestions, { _aiGenerated: true });
      Store.set('social_topics', topics);
      toast('选题已根据热点自动填充！');
      App.socialTab('topics');
    } else {
      toast('暂无 AI 选题建议，请先点击"AI 生成今日简报"');
    }
  }).catch(() => {
    toast('无法连接服务器');
  });
};

App.clearAiTopics = function() {
  const topics = Store.get('social_topics', {});
  delete topics[U.today()];
  Store.set('social_topics', topics);
  toast('AI 建议已清除');
  App.socialTab('topics');
};

App.saveTopics = function() {
  const saved = Store.get('social_topics', {});
  const today = U.today();
  const data = {};
  document.querySelectorAll('[data-key]').forEach(inp => {
    data[inp.dataset.key] = inp.value;
  });
  saved[today] = data;
  Store.set('social_topics', saved);
  toast('选题已保存');
};

App.socialData = function(el) {
  const records = Store.get('social_data', []);
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>📊 录入昨日运营数据</div>
      <div class="form-row">
        <div class="form-group" style="min-width:120px">
          <label>日期</label>
          <input type="date" id="sd_date" value="${U.today()}">
        </div>
        <div class="form-group">
          <label>平台</label>
          <select id="sd_platform">
            <option value="Facebook">Facebook</option>
            <option value="LinkedIn">LinkedIn</option>
            <option value="YouTube">YouTube</option>
            <option value="Alibaba">阿里巴巴</option>
            <option value="WhatsApp">WhatsApp</option>
          </select>
        </div>
        <div class="form-group">
          <label>新增粉丝</label>
          <input type="number" id="sd_followers" placeholder="0" value="0">
        </div>
        <div class="form-group">
          <label>曝光量</label>
          <input type="number" id="sd_reach" placeholder="0" value="0">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>互动量</label>
          <input type="number" id="sd_engagement" placeholder="0" value="0">
        </div>
        <div class="form-group">
          <label>私信咨询</label>
          <input type="number" id="sd_inquiries" placeholder="0" value="0">
        </div>
        <div class="form-group">
          <label>有效询盘</label>
          <input type="number" id="sd_leads" placeholder="0" value="0">
        </div>
        <div class="form-group" style="flex:2">
          <label>爆款帖子</label>
          <input type="text" id="sd_toppost" placeholder="帖子标题">
        </div>
      </div>
      <button class="btn btn-primary" onclick="App.addSocialData()">保存数据</button>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>📊 数据可视化（近7天）</div>
      <div id="socialChart"></div>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>数据记录</div>
      <div id="socialRecords"></div>
    </div>
  `;
  App.renderSocialChart();
  App.renderSocialRecords();
};

App.addSocialData = function() {
  const records = Store.get('social_data', []);
  records.push({
    id: U.uid(),
    date: document.getElementById('sd_date').value,
    platform: document.getElementById('sd_platform').value,
    followers: +document.getElementById('sd_followers').value || 0,
    reach: +document.getElementById('sd_reach').value || 0,
    engagement: +document.getElementById('sd_engagement').value || 0,
    inquiries: +document.getElementById('sd_inquiries').value || 0,
    leads: +document.getElementById('sd_leads').value || 0,
    toppost: document.getElementById('sd_toppost').value
  });
  Store.set('social_data', records);
  toast('数据已保存');
  // Reset form
  document.getElementById('sd_followers').value = 0;
  document.getElementById('sd_reach').value = 0;
  document.getElementById('sd_engagement').value = 0;
  document.getElementById('sd_inquiries').value = 0;
  document.getElementById('sd_leads').value = 0;
  document.getElementById('sd_toppost').value = '';
  App.renderSocialChart();
  App.renderSocialRecords();
};

App.renderSocialChart = function() {
  const records = Store.get('social_data', []);
  const platforms = ['Facebook', 'LinkedIn', 'YouTube', 'Alibaba', 'WhatsApp'];
  const now = new Date();
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    last7.push(d.toISOString().slice(0, 10));
  }
  const c = document.getElementById('socialChart');
  if (!c) return;
  
  let html = '';
  platforms.forEach(p => {
    const pData = last7.map(d => {
      const r = records.find(r => r.date === d && r.platform === p);
      return r ? r.reach : 0;
    });
    const max = Math.max(...pData, 1);
    if (pData.every(v => v === 0)) return;
    html += `<div class="mb-8"><div class="flex justify-between mb-8"><span class="font-bold text-sm">${p} - 曝光量</span><span class="text-sm text-light">7天总计 ${pData.reduce((a,b)=>a+b,0)}</span></div>`;
    html += '<div class="bar-chart">';
    pData.forEach((v, i) => {
      const h = (v / max * 100);
      html += `<div class="bar-item"><div class="bar-fill" style="height:${h}%;background:var(--primary)">${v > 0 ? `<span class="bar-value">${v}</span>` : ''}</div><div class="bar-label">${last7[i].slice(5)}</div></div>`;
    });
    html += '</div></div>';
  });
  if (!html) html = '<div class="empty-state"><p>暂无数据，请先录入运营数据</p></div>';
  c.innerHTML = html;
};

App.renderSocialRecords = function() {
  const records = Store.get('social_data', []).slice().reverse().slice(0, 20);
  const c = document.getElementById('socialRecords');
  if (!c) return;
  if (records.length === 0) { c.innerHTML = '<div class="empty-state"><p>暂无数据记录</p></div>'; return; }
  c.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>日期</th><th>平台</th><th>新增粉丝</th><th>曝光</th><th>互动</th><th>询盘</th><th>操作</th></tr></thead>
    <tbody>${records.map(r => `<tr>
      <td>${U.fmtDate(r.date)}</td><td><span class="badge badge-primary">${r.platform}</span></td>
      <td>${r.followers}</td><td>${r.reach}</td><td>${r.engagement}</td>
      <td>${r.leads}</td><td><button class="btn btn-danger-soft btn-sm" onclick="App.delSocialData('${r.id}')">删除</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
};

App.delSocialData = function(id) {
  let records = Store.get('social_data', []);
  records = records.filter(r => r.id !== id);
  Store.set('social_data', records);
  App.renderSocialChart();
  App.renderSocialRecords();
  toast('已删除');
};

App.socialMonthly = function(el) {
  const records = Store.get('social_data', []);
  const now = new Date();
  const platforms = ['Facebook', 'LinkedIn', 'YouTube', 'Alibaba', 'WhatsApp'];
  
  // Group by month
  const monthly = {};
  records.forEach(r => {
    const m = r.date.slice(0, 7);
    if (!monthly[m]) monthly[m] = {};
    if (!monthly[m][r.platform]) monthly[m][r.platform] = { followers: 0, reach: 0, engagement: 0, inquiries: 0, leads: 0, posts: [] };
    monthly[m][r.platform].followers += r.followers;
    monthly[m][r.platform].reach += r.reach;
    monthly[m][r.platform].engagement += r.engagement;
    monthly[m][r.platform].inquiries += r.inquiries;
    monthly[m][r.platform].leads += r.leads;
    if (r.toppost) monthly[m][r.platform].posts.push(r.toppost);
  });
  
  const months = Object.keys(monthly).sort().reverse();
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>📈 月度运营简报</div>
      ${months.length === 0 ? '<div class="empty-state"><p>暂无月度数据</p></div>' : months.map(m => {
        const data = monthly[m];
        return `<div class="mb-16"><h3 class="mb-8">${m} 月度数据</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>平台</th><th>月新增粉丝</th><th>月总曝光</th><th>月总互动</th><th>有效询盘</th><th>爆款内容</th></tr></thead>
          <tbody>${platforms.map(p => {
            if (!data[p]) return '';
            const d = data[p];
            return `<tr><td><span class="badge badge-primary">${p}</span></td><td>${d.followers}</td><td>${d.reach}</td><td>${d.engagement}</td><td>${d.leads}</td><td>${d.posts.slice(0, 3).map((p, i) => `${i+1}. ${U.escape(p)}`).join('<br>') || '-'}</td></tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
      }).join('')}
    </div>
  `;
};

App.socialQuarterly = function(el) {
  const records = Store.get('social_data', []);
  const platforms = ['Facebook', 'LinkedIn', 'YouTube', 'Alibaba', 'WhatsApp'];
  
  const quarterly = {};
  records.forEach(r => {
    const [y, m] = r.date.slice(0, 7).split('-');
    const q = Math.ceil(+m / 3);
    const key = `${y}Q${q}`;
    if (!quarterly[key]) quarterly[key] = {};
    if (!quarterly[key][r.platform]) quarterly[key][r.platform] = { followers: 0, reach: 0, engagement: 0, inquiries: 0, leads: 0, posts: [] };
    quarterly[key][r.platform].followers += r.followers;
    quarterly[key][r.platform].reach += r.reach;
    quarterly[key][r.platform].engagement += r.engagement;
    quarterly[key][r.platform].inquiries += r.inquiries;
    quarterly[key][r.platform].leads += r.leads;
    if (r.toppost) quarterly[key][r.platform].posts.push(r.toppost);
  });
  
  const quarters = Object.keys(quarterly).sort().reverse();
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>📊 季度运营报表</div>
      ${quarters.length === 0 ? '<div class="empty-state"><p>暂无季度数据</p></div>' : quarters.map(q => {
        const data = quarterly[q];
        const [year, qNum] = [q.slice(0, 4), q.slice(5)];
        return `<div class="mb-16"><h3 class="mb-8">${year}年${qNum}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>平台</th><th>季净增粉丝</th><th>季度总曝光</th><th>季度总互动</th><th>有效询盘</th><th>季度爆款TOP5</th></tr></thead>
          <tbody>${platforms.map(p => {
            if (!data[p]) return '';
            const d = data[p];
            const convRate = d.reach > 0 ? (d.leads / d.reach * 100).toFixed(2) : '0';
            return `<tr><td><span class="badge badge-primary">${p}</span></td><td>${d.followers}</td><td>${d.reach}</td><td>${d.engagement}</td><td>${d.leads}（转化率${convRate}%）</td><td>${d.posts.slice(0, 5).map((p, i) => `${i+1}. ${U.escape(p)}`).join('<br>') || '-'}</td></tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
      }).join('')}
    </div>
  `;
};

/* ============================================================
   MODULE: Learning
   ============================================================ */
App.modules.learning = function(el) {
  const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  el.innerHTML = `
    <div class="content-tabs">
      <button class="content-tab active" data-ltab="english" onclick="App.learnTab('english')">每日英语</button>
      <button class="content-tab" data-ltab="reading" onclick="App.learnTab('reading')">每日阅读</button>
      <button class="content-tab" data-ltab="finance" onclick="App.learnTab('finance')">理财知识</button>
      <button class="content-tab" data-ltab="chat" onclick="App.learnTab('chat')">每日外贸聊天小技巧</button>
    </div>
    <div id="learnContent"></div>
  `;
  App._learnTab = 'english';
  // 拉取自动推送内容（english/finance/chat 三项联网抓取）
  App.loadLearningFeed().then(() => App.learnTab('english'));
};

// ===== 拉取 /data/learning.json 自动推送内容，合并到本地 Store =====
App.loadLearningFeed = async function() {
  const AUTO_TABS = ['english', 'finance', 'chat'];
  try {
    const resp = await fetch('data/learning.json?t=' + Date.now());
    if (!resp.ok) return;
    const feed = await resp.json();
    if (!feed) return;
    const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
    let changed = false;
    AUTO_TABS.forEach(tab => {
      const items = feed[tab] || [];
      items.forEach(item => {
        // 避免重复：同日期+同内容不重复插入
        const exists = (data[tab] || []).some(l => l.date === item.date && l.content === item.content);
        if (!exists) {
          data[tab] = data[tab] || [];
          data[tab].push({ id: U.uid(), date: item.date, content: item.content, created: item.created || Date.now(), auto: true });
          changed = true;
        }
      });
    });
    if (changed) Store.set('learning', data);
    App._learningFeed = feed;
  } catch (e) {
    console.log('learning feed 暂未就绪:', e.message);
  }
};

App.learnTab = function(tab) {
  App._learnTab = tab;
  document.querySelectorAll('[data-ltab]').forEach(t => t.classList.toggle('active', t.dataset.ltab === tab));
  const c = document.getElementById('learnContent');
  if (!c) return;
  const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  const list = data[tab] || [];
  const titles = { english: '每日英语学习', reading: '每日阅读', finance: '理财知识学习', chat: '每日外贸聊天小技巧' };
  const ph = { english: '今天学了什么英语？单词、句子、语法...', reading: '今天读了什么书/文章？', finance: '今天学了什么理财知识？', chat: '今天和客户聊了什么？记录沟通技巧...' };
  const isAuto = tab === 'english' || tab === 'finance' || tab === 'chat';

  // 自动推送的最新一条
  let feedCard = '';
  if (isAuto && App._learningFeed) {
    const feedItems = (App._learningFeed[tab] || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (feedItems.length > 0) {
      const latest = feedItems[0];
      feedCard = `
        <div class="card feed-card">
          <div class="card-title"><span class="icon-dot" style="background:var(--success)"></span>📡 今日推送（自动抓取）</div>
          <div class="feed-date text-sm text-light">${U.fmtDateFull(latest.date)}</div>
          <div class="feed-content">${U.escape(latest.content).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }
  }

  c.innerHTML = `
    ${feedCard}
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>${titles[tab]}</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;min-width:120px">
          <label>日期</label>
          <input type="date" id="learn_date" value="${U.today()}">
        </div>
        <div class="form-group" style="flex:4">
          <label>内容</label>
          <textarea id="learn_content" placeholder="${ph[tab]}" rows="3"></textarea>
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addLearn('${tab}')">记录</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>学习记录（${list.length}条）</div>
      <div class="grid-4 mb-8">
        <div class="stat-card"><span class="stat-label">本周</span><span class="stat-value primary">${App.weekCount(list)}</span></div>
        <div class="stat-card"><span class="stat-label">本月</span><span class="stat-value primary">${App.monthCount(list)}</span></div>
        <div class="stat-card"><span class="stat-label">总计</span><span class="stat-value primary">${list.length}</span></div>
        <div class="stat-card"><span class="stat-label">连续天数</span><span class="stat-value success">${App.streakCount(list)}</span></div>
      </div>
      <div id="learnList"></div>
    </div>
  `;
  App.renderLearnList(tab);
};

App.monthCount = function(arr) {
  const now = new Date();
  return arr.filter(l => { const d = new Date(l.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
};

App.streakCount = function(arr) {
  if (arr.length === 0) return 0;
  const dates = arr.map(l => l.date).sort().reverse();
  let streak = 0;
  let check = new Date();
  for (let i = 0; i < 365; i++) {
    const ds = check.toISOString().slice(0, 10);
    if (dates.includes(ds)) { streak++; check.setDate(check.getDate() - 1); }
    else if (i === 0) { check.setDate(check.getDate() - 1); }
    else break;
  }
  return streak;
};

App.addLearn = function(tab) {
  const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  const content = document.getElementById('learn_content').value.trim();
  const date = document.getElementById('learn_date').value;
  if (!content) { toast('请输入学习内容'); return; }
  data[tab] = data[tab] || [];
  data[tab].push({ id: U.uid(), date, content, created: Date.now() });
  Store.set('learning', data);
  document.getElementById('learn_content').value = '';
  App.learnTab(tab);
  toast('学习记录已保存');
};

App.renderLearnList = function(tab) {
  const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  const list = (data[tab] || []).slice().reverse().slice(0, 30);
  const c = document.getElementById('learnList');
  if (!c) return;
  if (list.length === 0) { c.innerHTML = '<div class="empty-state"><p>暂无学习记录</p></div>'; return; }
  c.innerHTML = list.map(l => `
    <div class="mini-item">
      <div class="dot" style="background:${l.auto ? 'var(--success)' : 'var(--primary)'}"></div>
      <div style="flex:1">
        <div class="text-sm text-light">${U.fmtDateFull(l.date)}${l.auto ? '<span class="badge-auto">自动推送</span>' : ''}</div>
        <div>${U.escape(l.content)}</div>
      </div>
      <button class="todo-delete" onclick="App.delLearn('${tab}','${l.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `).join('');
};

App.delLearn = function(tab, id) {
  const data = Store.get('learning', { english: [], reading: [], finance: [], chat: [] });
  data[tab] = (data[tab] || []).filter(l => l.id !== id);
  Store.set('learning', data);
  App.learnTab(tab);
  toast('已删除');
};

/* ============================================================
   MODULE: Expenses
   ============================================================ */
App.modules.expenses = function(el) {
  const records = Store.get('expenses', []);
  const now = new Date();
  const monthRec = records.filter(r => r.date.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const yearRec = records.filter(r => r.date.slice(0, 4) === String(now.getFullYear()));
  const monthIn = monthRec.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const monthOut = monthRec.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const yearIn = yearRec.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const yearOut = yearRec.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  
  el.innerHTML = `
    <div class="grid-4">
      <div class="stat-card"><span class="stat-label">本月收入</span><span class="stat-value success">${U.fmtMoney(monthIn)}</span></div>
      <div class="stat-card"><span class="stat-label">本月支出</span><span class="stat-value danger">${U.fmtMoney(monthOut)}</span></div>
      <div class="stat-card"><span class="stat-label">本月结余</span><span class="stat-value ${monthIn-monthOut>=0?'success':'danger'}">${U.fmtMoney(monthIn-monthOut)}</span></div>
      <div class="stat-card"><span class="stat-label">本年结余</span><span class="stat-value ${yearIn-yearOut>=0?'success':'danger'}">${U.fmtMoney(yearIn-yearOut)}</span></div>
    </div>
    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>记一笔</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;min-width:100px">
          <label>类型</label>
          <select id="ie_type">
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <label>日期</label>
          <input type="date" id="ie_date" value="${U.today()}">
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <label>类别</label>
          <select id="ie_cat">
            <optgroup label="支出">
              <option value="餐饮">餐饮</option>
              <option value="交通">交通</option>
              <option value="购物">购物</option>
              <option value="生活">生活</option>
              <option value="娱乐">娱乐</option>
              <option value="医疗">医疗</option>
              <option value="教育">教育</option>
              <option value="其他支出">其他</option>
            </optgroup>
            <optgroup label="收入">
              <option value="工资">工资</option>
              <option value="兼职">兼职</option>
              <option value="投资">投资</option>
              <option value="其他收入">其他</option>
            </optgroup>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <label>金额</label>
          <input type="number" id="ie_amount" placeholder="0.00" step="0.01">
        </div>
        <div class="form-group" style="flex:2">
          <label>备注</label>
          <input type="text" id="ie_note" placeholder="备注（可选）">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addExpense()">记一笔</button>
        </div>
      </div>
    </div>
    <div class="grid-2 mt-16">
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>本月支出分类</div>
        <div id="expenseChart"></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>收支记录</div>
        <div id="expenseRecords"></div>
      </div>
    </div>
  `;
  App.renderExpenseChart();
  App.renderExpenseRecords();
};

App.addExpense = function() {
  const records = Store.get('expenses', []);
  const amount = +document.getElementById('ie_amount').value;
  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
  records.push({
    id: U.uid(),
    type: document.getElementById('ie_type').value,
    date: document.getElementById('ie_date').value,
    category: document.getElementById('ie_cat').value,
    amount,
    note: document.getElementById('ie_note').value,
    created: Date.now()
  });
  Store.set('expenses', records);
  document.getElementById('ie_amount').value = '';
  document.getElementById('ie_note').value = '';
  App.modules.expenses(document.getElementById('contentArea'));
  toast('记账成功');
};

App.renderExpenseChart = function() {
  const records = Store.get('expenses', []);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthExp = records.filter(r => r.type === 'expense' && r.date.slice(0, 7) === monthKey);
  const cats = {};
  monthExp.forEach(r => { cats[r.category] = (cats[r.category] || 0) + r.amount; });
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const c = document.getElementById('expenseChart');
  if (!c) return;
  if (sorted.length === 0) { c.innerHTML = '<div class="empty-state"><p>本月暂无支出</p></div>'; return; }
  const colors = ['#6B8AFE', '#8B7FE8', '#93B4FF', '#B4A9F5', '#F59E0B', '#10B981', '#EF4444', '#6366F1'];
  c.innerHTML = sorted.map(([cat, amt], i) => {
    const pct = (amt / total * 100).toFixed(1);
    return `<div class="mb-8">
      <div class="flex justify-between text-sm mb-8"><span>${cat}</span><span class="font-bold">${U.fmtMoney(amt)} (${pct}%)</span></div>
      <div style="background:var(--bg-soft);height:8px;border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${colors[i % colors.length]};border-radius:4px;transition:width 0.5s"></div>
      </div>
    </div>`;
  }).join('') + `<div class="text-center mt-12 text-sm text-light">本月总支出 ${U.fmtMoney(total)}</div>`;
};

App.renderExpenseRecords = function() {
  const records = Store.get('expenses', []).slice().reverse().slice(0, 20);
  const c = document.getElementById('expenseRecords');
  if (!c) return;
  if (records.length === 0) { c.innerHTML = '<div class="empty-state"><p>暂无记录</p></div>'; return; }
  c.innerHTML = records.map(r => `
    <div class="ie-entry">
      <div class="ie-entry-date">${U.fmtDate(r.date)}</div>
      <div class="ie-entry-cat">${U.escape(r.category)}${r.note ? '<br><span class="text-sm text-light">' + U.escape(r.note) + '</span>' : ''}</div>
      <div class="ie-entry-amount ${r.type}">${r.type === 'income' ? '+' : '-'}${U.fmtMoney(r.amount)}</div>
      <button class="todo-delete" onclick="App.delExpense('${r.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `).join('');
};

App.delExpense = function(id) {
  let records = Store.get('expenses', []);
  records = records.filter(r => r.id !== id);
  Store.set('expenses', records);
  App.modules.expenses(document.getElementById('contentArea'));
  toast('已删除');
};

/* ============================================================
   MODULE: Health (Fat Loss)
   ============================================================ */
App.modules.health = function(el) {
  const records = Store.get('health', []).sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = records[records.length - 1];
  
  el.innerHTML = `
    <div class="grid-3">
      <div class="stat-card">
        <span class="stat-label">最新体重</span>
        <span class="stat-value primary">${latest ? latest.weight + ' kg' : '-'}</span>
        <span class="stat-sub">${latest ? U.fmtDate(latest.date) : '暂无记录'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">最新体脂率</span>
        <span class="stat-value primary">${latest ? latest.bodyFat + '%' : '-'}</span>
        <span class="stat-sub">${latest ? U.fmtDate(latest.date) : '暂无记录'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">本周运动</span>
        <span class="stat-value success">${App.weekCount(records)}</span>
        <span class="stat-sub">天有运动记录</span>
      </div>
    </div>
    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>记录今日数据</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;min-width:100px">
          <label>日期</label>
          <input type="date" id="h_date" value="${U.today()}">
        </div>
        <div class="form-group" style="flex:1;min-width:80px">
          <label>体重(kg)</label>
          <input type="number" id="h_weight" placeholder="0.0" step="0.1">
        </div>
        <div class="form-group" style="flex:1;min-width:80px">
          <label>体脂率(%)</label>
          <input type="number" id="h_bodyfat" placeholder="0.0" step="0.1">
        </div>
        <div class="form-group" style="flex:1;min-width:100px">
          <label>运动项目</label>
          <input type="text" id="h_exercise" placeholder="跑步/游泳/瑜伽...">
        </div>
        <div class="form-group" style="flex:1;min-width:60px">
          <label>时长(分钟)</label>
          <input type="number" id="h_duration" placeholder="0">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addHealth()">记录</button>
        </div>
      </div>
    </div>
    <div class="grid-2 mt-16">
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>体重趋势</div>
        <div id="weightChart"></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="icon-dot"></span>体脂趋势</div>
        <div id="bodyFatChart"></div>
      </div>
    </div>
    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>运动记录</div>
      <div id="healthRecords"></div>
    </div>
  `;
  App.renderWeightChart();
  App.renderBodyFatChart();
  App.renderHealthRecords();
};

App.addHealth = function() {
  const records = Store.get('health', []);
  const weight = +document.getElementById('h_weight').value;
  const bodyFat = +document.getElementById('h_bodyfat').value;
  const exercise = document.getElementById('h_exercise').value.trim();
  const duration = +document.getElementById('h_duration').value;
  const date = document.getElementById('h_date').value;
  if (!weight && !bodyFat && !exercise) { toast('请至少填写一项数据'); return; }
  records.push({ id: U.uid(), date, weight: weight || null, bodyFat: bodyFat || null, exercise, duration: duration || null, created: Date.now() });
  Store.set('health', records);
  App.modules.health(document.getElementById('contentArea'));
  toast('已记录');
};

App.renderWeightChart = function() {
  const records = Store.get('health', []).filter(r => r.weight).sort((a, b) => a.date < b.date ? -1 : 1);
  const c = document.getElementById('weightChart');
  if (!c) return;
  if (records.length < 2) { c.innerHTML = '<div class="empty-state"><p>至少需要2条体重记录才能显示趋势</p></div>'; return; }
  const data = records.slice(-14);
  const weights = data.map(r => r.weight);
  const min = Math.min(...weights) - 1;
  const max = Math.max(...weights) + 1;
  const range = max - min || 1;
  const w = 100, h = 40;
  const points = data.map((r, i) => `${(i / (data.length - 1)) * w},${h - ((r.weight - min) / range) * (h - 4) - 2}`).join(' ');
  c.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${w} ${h+8}" preserveAspectRatio="none" style="height:160px">
    <polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${data.map((r, i) => `<circle cx="${(i / (data.length - 1)) * w}" cy="${h - ((r.weight - min) / range) * (h - 4) - 2}" r="0.8" fill="var(--primary)"/>`).join('')}
  </svg>
  <div class="flex justify-between text-sm mt-8"><span class="text-light">${U.fmtDate(data[0].date)}: ${data[0].weight}kg</span><span class="font-bold text-primary">最新: ${data[data.length-1].weight}kg</span></div>
  <div class="text-center text-sm text-light mt-8">${data[data.length-1].weight - data[0].weight >= 0 ? '↑' : '↓'} ${Math.abs(data[data.length-1].weight - data[0].weight).toFixed(1)}kg 变化</div>`;
};

App.renderBodyFatChart = function() {
  const records = Store.get('health', []).filter(r => r.bodyFat).sort((a, b) => a.date < b.date ? -1 : 1);
  const c = document.getElementById('bodyFatChart');
  if (!c) return;
  if (records.length < 2) { c.innerHTML = '<div class="empty-state"><p>至少需要2条体脂数据才能显示趋势</p></div>'; return; }
  const data = records.slice(-14);
  const vals = data.map(r => r.bodyFat);
  const min = Math.min(...vals) - 1;
  const max = Math.max(...vals) + 1;
  const range = max - min || 1;
  const w = 100, h = 40;
  const points = data.map((r, i) => `${(i / (data.length - 1)) * w},${h - ((r.bodyFat - min) / range) * (h - 4) - 2}`).join(' ');
  c.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${w} ${h+8}" preserveAspectRatio="none" style="height:160px">
    <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${data.map((r, i) => `<circle cx="${(i / (data.length - 1)) * w}" cy="${h - ((r.bodyFat - min) / range) * (h - 4) - 2}" r="0.8" fill="var(--accent)"/>`).join('')}
  </svg>
  <div class="flex justify-between text-sm mt-8"><span class="text-light">${U.fmtDate(data[0].date)}: ${data[0].bodyFat}%</span><span class="font-bold" style="color:var(--accent)">最新: ${data[data.length-1].bodyFat}%</span></div>
  <div class="text-center text-sm text-light mt-8">${data[data.length-1].bodyFat - data[0].bodyFat >= 0 ? '↑' : '↓'} ${Math.abs(data[data.length-1].bodyFat - data[0].bodyFat).toFixed(1)}% 变化</div>`;
};

App.renderHealthRecords = function() {
  const records = Store.get('health', []).slice().reverse().slice(0, 20);
  const c = document.getElementById('healthRecords');
  if (!c) return;
  if (records.length === 0) { c.innerHTML = '<div class="empty-state"><p>暂无记录</p></div>'; return; }
  c.innerHTML = records.map(r => `
    <div class="health-entry">
      <div class="health-entry-date">${U.fmtDate(r.date)}</div>
      <div class="health-entry-data">
        ${r.weight ? `<span>体重: ${r.weight}kg</span>` : ''}
        ${r.bodyFat ? `<span>体脂: ${r.bodyFat}%</span>` : ''}
        ${r.exercise ? `<span>运动: ${U.escape(r.exercise)}</span>` : ''}
        ${r.duration ? `<span>${r.duration}min</span>` : ''}
      </div>
      <button class="todo-delete" onclick="App.delHealth('${r.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
  `).join('');
};

App.delHealth = function(id) {
  let records = Store.get('health', []);
  records = records.filter(r => r.id !== id);
  Store.set('health', records);
  App.modules.health(document.getElementById('contentArea'));
  toast('已删除');
};

/* ============================================================
   MODULE: Schedule
   ============================================================ */
App.modules.schedule = function(el) {
  const records = Store.get('schedule', []).sort((a, b) => (a.date + (a.time || '') < b.date + (b.time || '') ? -1 : 1));
  const today = U.today();
  const todayList = records.filter(r => r.date === today);
  const upcoming = records.filter(r => r.date > today).slice(0, 10);
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>添加日程</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;min-width:120px">
          <label>日期</label>
          <input type="date" id="s_date" value="${today}">
        </div>
        <div class="form-group" style="flex:1;min-width:80px">
          <label>时间</label>
          <input type="time" id="s_time">
        </div>
        <div class="form-group" style="flex:3">
          <label>事项</label>
          <input type="text" id="s_title" placeholder="日程标题">
        </div>
        <div class="form-group" style="flex:3">
          <label>描述（可选）</label>
          <input type="text" id="s_desc" placeholder="备注">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addSchedule()">添加</button>
        </div>
      </div>
    </div>
    ${todayList.length > 0 ? `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>今日日程</div>
      ${todayList.map(s => `
        <div class="sched-entry">
          <div class="sched-time"><div class="time">${s.time || '全天'}</div></div>
          <div class="sched-content">
            <div class="title">${U.escape(s.title)}</div>
            ${s.desc ? `<div class="desc">${U.escape(s.desc)}</div>` : ''}
          </div>
          <button class="todo-delete" onclick="App.delSchedule('${s.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `).join('')}
    </div>` : ''}
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>即将到来</div>
      ${upcoming.length > 0 ? upcoming.map(s => `
        <div class="sched-entry">
          <div class="sched-time">
            <div class="time">${s.time || '全天'}</div>
            <div class="date">${U.fmtDate(s.date)}</div>
          </div>
          <div class="sched-content">
            <div class="title">${U.escape(s.title)}</div>
            ${s.desc ? `<div class="desc">${U.escape(s.desc)}</div>` : ''}
          </div>
          <div class="text-right text-sm text-light">${U.daysUntil(s.date)}天后</div>
          <button class="todo-delete" onclick="App.delSchedule('${s.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `).join('') : '<div class="empty-state"><p>暂无即将到来的日程</p></div>'}
    </div>
  `;
};

App.addSchedule = function() {
  const records = Store.get('schedule', []);
  const title = document.getElementById('s_title').value.trim();
  const date = document.getElementById('s_date').value;
  if (!title) { toast('请输入日程标题'); return; }
  records.push({
    id: U.uid(),
    date,
    time: document.getElementById('s_time').value,
    title,
    desc: document.getElementById('s_desc').value,
    created: Date.now()
  });
  Store.set('schedule', records);
  App.modules.schedule(document.getElementById('contentArea'));
  toast('日程已添加');
};

App.delSchedule = function(id) {
  let records = Store.get('schedule', []);
  records = records.filter(r => r.id !== id);
  Store.set('schedule', records);
  App.modules.schedule(document.getElementById('contentArea'));
  toast('已删除');
};

/* ============================================================
   MODULE: Anniversaries
   ============================================================ */
App.modules.anniversaries = function(el) {
  const records = Store.get('anniversaries', []);
  const withCountdown = records.map(a => {
    const next = App.nextAnniversaryDate(a);
    return { ...a, daysUntil: U.daysUntil(next), nextDate: next };
  }).sort((a, b) => a.daysUntil - b.daysUntil);
  
  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>添加纪念日/生日</div>
      <div class="form-row">
        <div class="form-group" style="flex:2">
          <label>姓名/名称</label>
          <input type="text" id="a_name" placeholder="如：妈妈的生日">
        </div>
        <div class="form-group" style="flex:1">
          <label>类型</label>
          <select id="a_type">
            <option value="birthday">生日</option>
            <option value="anniversary">纪念日</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:120px">
          <label>日期</label>
          <input type="date" id="a_date">
        </div>
        <div class="form-group" style="flex:1">
          <label>历法</label>
          <select id="a_lunar">
            <option value="false">公历</option>
            <option value="true">农历</option>
          </select>
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addAnniversary()">添加</button>
        </div>
      </div>
      <p class="text-sm text-light">提示：提前3天会提醒你哦！</p>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>纪念日列表</div>
      ${withCountdown.length > 0 ? withCountdown.map(a => `
        <div class="anni-entry">
          <div class="anni-icon" style="background:${a.type === 'birthday' ? '#FEF3C7' : '#E0E7FF'};color:${a.type === 'birthday' ? '#D97706' : '#6366F1'}">${a.type === 'birthday' ? '🎂' : '💝'}</div>
          <div class="anni-info">
            <div class="anni-name">${U.escape(a.name)}</div>
            <div class="anni-date">${a.isLunar ? '农历 ' : ''}${a.date}（${a.type === 'birthday' ? '生日' : '纪念日'}）</div>
          </div>
          <div class="anni-countdown">
            ${a.daysUntil === 0 ? '<strong>今天</strong><div class="text-light text-sm">就是今天！</div>' :
              a.daysUntil > 0 ? `<strong>${a.daysUntil}</strong><div class="text-light text-sm">天后</div>` :
              `<strong>${-a.daysUntil}</strong><div class="text-light text-sm">天前</div>`}
          </div>
          <button class="todo-delete" onclick="App.delAnniversary('${a.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `).join('') : '<div class="empty-state"><p>暂无纪念日记录</p></div>'}
    </div>
  `;
};

App.nextAnniversaryDate = function(a) {
  const now = new Date();
  const [y, m, d] = a.date.split('-').map(Number);
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
  return next.toISOString().slice(0, 10);
};

App.addAnniversary = function() {
  const records = Store.get('anniversaries', []);
  const name = document.getElementById('a_name').value.trim();
  const date = document.getElementById('a_date').value;
  if (!name) { toast('请输入名称'); return; }
  if (!date) { toast('请选择日期'); return; }
  records.push({
    id: U.uid(),
    name,
    type: document.getElementById('a_type').value,
    date,
    isLunar: document.getElementById('a_lunar').value === 'true',
    created: Date.now()
  });
  Store.set('anniversaries', records);
  App.modules.anniversaries(document.getElementById('contentArea'));
  toast('纪念日已添加');
};

App.delAnniversary = function(id) {
  let records = Store.get('anniversaries', []);
  records = records.filter(r => r.id !== id);
  Store.set('anniversaries', records);
  App.modules.anniversaries(document.getElementById('contentArea'));
  toast('已删除');
};

/* ============================================================
   MODULE: Periods
   ============================================================ */
App.modules.periods = function(el) {
  const records = Store.get('periods', []).sort((a, b) => a.startDate < b.startDate ? -1 : 1);
  const info = App.getPeriodInfo(records);
  
  // Build calendar
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = now.getDate();
  
  // Mark period days and predicted days
  const periodDays = new Set();
  const predictedDays = new Set();
  records.forEach(r => {
    const start = new Date(r.startDate);
    const end = r.endDate ? new Date(r.endDate) : new Date(r.startDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year && d.getMonth() === month) periodDays.add(d.getDate());
    }
  });
  if (info.predictedStart) {
    const ps = new Date(info.predictedStart);
    const pe = new Date(info.predictedEnd || info.predictedStart);
    for (let d = new Date(ps); d <= pe; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year && d.getMonth() === month) predictedDays.add(d.getDate());
    }
  }
  
  let calHtml = '';
  ['日','一','二','三','四','五','六'].forEach(w => calHtml += `<div class="period-cal-header">${w}</div>`);
  for (let i = 0; i < startWeekday; i++) calHtml += '<div class="period-cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    let cls = 'period-cal-day';
    if (d === today) cls += ' today';
    if (periodDays.has(d)) cls += ' period';
    if (predictedDays.has(d)) cls += ' predicted';
    calHtml += `<div class="${cls}">${d}</div>`;
  }
  
  el.innerHTML = `
    <div class="grid-4">
      <div class="stat-card">
        <span class="stat-label">平均周期</span>
        <span class="stat-value primary">${info.avgCycle || '-'}天</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">平均经期</span>
        <span class="stat-value primary">${info.avgDuration || '-'}天</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">下次预计</span>
        <span class="stat-value primary">${info.nextDate ? U.fmtDate(info.nextDate) : '-'}</span>
        <span class="stat-sub">${info.daysUntil >= 0 ? '还有 ' + info.daysUntil + ' 天' : '已过 ' + (-info.daysUntil) + ' 天'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">总记录数</span>
        <span class="stat-value primary">${records.length}</span>
      </div>
    </div>
    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>记录经期</div>
      <div class="form-row">
        <div class="form-group" style="flex:1;min-width:120px">
          <label>开始日期</label>
          <input type="date" id="p_start">
        </div>
        <div class="form-group" style="flex:1;min-width:120px">
          <label>结束日期（可选）</label>
          <input type="date" id="p_end">
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addPeriod()">记录</button>
        </div>
      </div>
      <p class="text-sm text-light">提示：预测下次经期并提前2天提醒你！</p>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>${now.getFullYear()}年${now.getMonth()+1}月</div>
      <div class="period-calendar">${calHtml}</div>
      <div class="flex gap-12 mt-12 text-sm text-light">
        <span class="flex align-center gap-8"><span style="width:12px;height:12px;background:var(--accent);border-radius:3px;display:inline-block"></span> 经期</span>
        <span class="flex align-center gap-8"><span style="width:12px;height:12px;background:var(--accent-light);border-radius:3px;display:inline-block;opacity:0.6"></span> 预测</span>
        <span class="flex align-center gap-8"><span style="width:12px;height:12px;border:2px solid var(--primary);border-radius:3px;display:inline-block"></span> 今天</span>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>历史记录</div>
      ${records.length > 0 ? records.slice().reverse().map(r => {
        const dur = r.endDate ? U.daysBetween(r.startDate, r.endDate) + 1 : 1;
        return `<div class="mini-item">
          <div class="dot" style="background:var(--accent)"></div>
          <div style="flex:1">
            <span class="font-bold">${U.fmtDateFull(r.startDate)}</span>
            ${r.endDate ? ` ~ ${U.fmtDateFull(r.endDate)}` : ''}
            <span class="badge badge-accent ml-8">${dur}天</span>
          </div>
          <button class="todo-delete" onclick="App.delPeriod('${r.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>`;
      }).join('') : '<div class="empty-state"><p>暂无经期记录</p></div>'}
    </div>
  `;
};

App.getPeriodInfo = function(records) {
  if (!records || records.length === 0) return { avgCycle: null, avgDuration: null, nextDate: null, daysUntil: null, predictedStart: null, predictedEnd: null };
  const sorted = records.slice().sort((a, b) => a.startDate < b.startDate ? -1 : 1);
  
  // Calculate average cycle (days between starts)
  let cycleSum = 0, cycleCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = U.daysBetween(sorted[i-1].startDate, sorted[i].startDate);
    if (diff > 15 && diff < 60) { cycleSum += diff; cycleCount++; }
  }
  const avgCycle = cycleCount > 0 ? Math.round(cycleSum / cycleCount) : 28;
  
  // Calculate average duration
  let durSum = 0, durCount = 0;
  sorted.forEach(r => {
    if (r.endDate) { durSum += U.daysBetween(r.startDate, r.endDate) + 1; durCount++; }
  });
  const avgDuration = durCount > 0 ? Math.round(durSum / durCount) : (sorted[sorted.length-1].endDate ? U.daysBetween(sorted[sorted.length-1].startDate, sorted[sorted.length-1].endDate) + 1 : 5);
  
  // Predict next period
  const last = sorted[sorted.length - 1];
  const lastStart = new Date(last.startDate);
  const nextStart = new Date(lastStart);
  nextStart.setDate(nextStart.getDate() + avgCycle);
  const nextEnd = new Date(nextStart);
  nextEnd.setDate(nextEnd.getDate() + avgDuration - 1);
  
  const nextDateStr = nextStart.toISOString().slice(0, 10);
  const daysUntil = U.daysUntil(nextDateStr);
  
  return {
    avgCycle,
    avgDuration,
    nextDate: nextDateStr,
    daysUntil,
    predictedStart: nextStart.toISOString().slice(0, 10),
    predictedEnd: nextEnd.toISOString().slice(0, 10)
  };
};

App.addPeriod = function() {
  const records = Store.get('periods', []);
  const startDate = document.getElementById('p_start').value;
  const endDate = document.getElementById('p_end').value;
  if (!startDate) { toast('请选择开始日期'); return; }
  if (endDate && endDate < startDate) { toast('结束日期不能早于开始日期'); return; }
  records.push({ id: U.uid(), startDate, endDate: endDate || null, created: Date.now() });
  Store.set('periods', records);
  App.modules.periods(document.getElementById('contentArea'));
  toast('经期已记录');
};

App.delPeriod = function(id) {
  let records = Store.get('periods', []);
  records = records.filter(r => r.id !== id);
  Store.set('periods', records);
  App.modules.periods(document.getElementById('contentArea'));
  toast('已删除');
};

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
