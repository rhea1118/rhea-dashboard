/* ===== Rhea Dashboard - App Logic ===== */

// ===== GitHub Raw 数据源（Netlify 跳过部署时，前端直接从 GitHub 读取最新 JSON） =====
const GH_DATA = {
  RAW_BASE: 'https://raw.githubusercontent.com/rhea1118/rhea-dashboard/main/data',
  JSDELIVR_BASE: 'https://cdn.jsdelivr.net/gh/rhea1118/rhea-dashboard@main/data',
  // 读取简报 JSON（多源回退：GitHub raw → jsDelivr CDN → 本地 API → Netlify 静态文件）
  async fetchBriefing() {
    const urls = [
      this.RAW_BASE + '/daily-brief.json?t=' + Date.now(),
      this.JSDELIVR_BASE + '/daily-brief.json?t=' + Date.now(),
      '/api/briefing',
      'data/daily-brief.json?t=' + Date.now(),
      'data/briefing.json?t=' + Date.now()
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) return await resp.json();
      } catch(e) { /* 网络错误，尝试下一个 URL */ }
    }
    return null;
  },
  // 读取学习内容 JSON（多源回退）
  async fetchLearning() {
    const urls = [
      this.RAW_BASE + '/learning.json?t=' + Date.now(),
      this.JSDELIVR_BASE + '/learning.json?t=' + Date.now(),
      'data/learning.json?t=' + Date.now()
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) return await resp.json();
      } catch(e) { /* 网络错误，尝试下一个 URL */ }
    }
    return null;
  }
};

// ===== Storage =====
const Store = {
  KEY: 'rhea_data_v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; }
    catch { return {}; }
  },
  // 本地保存：打时间戳并上传到云端。
  // 注意：不再用 INITIAL_PULL_DONE 限制上传。服务端已改为「按 id 并集 + 删除墓碑」合并，
  // 即使本端尚未拉取过云端基线，上传也只会做并集、绝不会覆盖他人数据。
  // 若仍用 INITIAL_PULL_DONE 限制，则「没完成首次拉取」的设备只能收不能发，
  // 表现为「一端删除不同步」——这正是此前电脑删手机看不到、手机删电脑能看到的根因。
  save(data) {
    if (data && typeof data === 'object') data._syncUpdatedAt = Date.now();
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch (_) {}
    if (typeof App !== 'undefined' && App._syncPush) App._syncPush(data);
  },
  // 静默写入本地（用于套用云端数据，不再触发上传，避免回环）
  replaceAll(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch (_) {}
  },
  get(key, def) {
    const d = this.load();
    return d[key] !== undefined ? d[key] : def;
  },
  set(key, val) {
    const d = this.load();
    d[key] = val;
    d['_ts_' + key] = Date.now();
    this.save(d);
  },
  // 删除某个列表模块中的条目，并记录「删除墓碑」（deleted_<key>），
  // 以便该删除能跨设备同步（另一端合并时据此剔除对应 id）。
  markDeleted(moduleKey, id) {
    const d = this.load();
    const arr = Array.isArray(d[moduleKey]) ? d[moduleKey] : [];
    d[moduleKey] = arr.filter(x => x.id !== id);
    const delKey = 'deleted_' + moduleKey;
    const del = Array.isArray(d[delKey]) ? d[delKey] : [];
    if (!del.some(x => String(x.id) === String(id))) del.push({ id, ts: Date.now() });
    d[delKey] = del;
    d['_ts_' + moduleKey] = Date.now();
    this.save(d);
  },
  // 一次性迁移：旧数据只有根 _syncUpdatedAt、没有各模块 _ts_。
  // 升级后把根时间戳拆到各模块，避免未改动模块借根时间戳反向覆盖云端真实数据。
  normalizeTimestamps() {
    const d = this.load();
    if (!d._syncUpdatedAt) return;
    let changed = false;
    for (const k in d) {
      if (k.startsWith('_')) continue;
      if (!('_ts_' + k in d)) { d['_ts_' + k] = d._syncUpdatedAt; changed = true; }
    }
    if (changed) {
      this.replaceAll(d);
      if (typeof App !== 'undefined' && App._syncPush) App._syncPush(d);
    }
  }
};

// ===== 跨设备同步合并 =====
// 两层策略：
// 1) 对「对象数组（元素带 id）」的模块（客户/待办/日程等）：按 id 做【并集】合并，
//    同一 id 冲突时取条目级时间戳（updated||created）较新的一方。
//    —— 这能彻底解决「两台设备各自新增不同客户却互相覆盖」的问题。
// 2) 对其余模块（标量 / 普通对象）：沿用「按模块时间戳取较新方」的整模块策略。
// 通用防御：模块值为「空」（undefined / 空数组 / 空对象）时时间戳记 0，
// 绝不反向覆盖云端真实数据——杜绝「某端空数据」把另一端真实数据清空。
function modTs(d, k) {
  const v = d[k];
  const empty = v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
  return empty ? 0 : (d['_ts_' + k] || 0);
}
// 已知「元素带 id 的对象数组」模块：统一按 id 并集 + 删除墓碑合并。
// 注意：netlify/functions/sync.js 中有一份完全相同的 LIST_MODULES 与合并逻辑，改此处务必同步改服务端。
const LIST_MODULES = new Set([
  'custNew', 'custQuote', 'custKey',
  'todos', 'schedule', 'anniversaries', 'periods', 'health', 'social_data'
]);
function isListModule(k) { return LIST_MODULES.has(k); }
// 是否为「可逐条合并的对象数组」：数组且每个元素都是带 id 的对象
function isMergeableList(v) {
  return Array.isArray(v) && v.length > 0 &&
    v.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'id' in x &&
      (typeof x.id === 'string' || typeof x.id === 'number'));
}
// 条目级时间戳：编辑时间优先，其次创建时间
function itemTs(it) { return it.updated || it.created || 0; }
// 合并两份删除墓碑数组（按 id 去重）
function unionDeleted(a, b) {
  const m = new Map();
  const add = (arr) => { if (!Array.isArray(arr)) return; arr.forEach(d => { if (d && d.id != null) m.set(String(d.id), d); }); };
  add(a); add(b);
  return Array.from(m.values());
}
// 按 id 求并集；同 id 取较新者；最后剔除出现在任一墓碑中的 id（删除跨端生效）
function mergeList(localArr, remoteArr, delL, delR) {
  const map = new Map();
  localArr.forEach(it => map.set(String(it.id), it));
  remoteArr.forEach(it => {
    const id = String(it.id);
    const cur = map.get(id);
    if (!cur) map.set(id, it);
    else if (itemTs(it) > itemTs(cur)) map.set(id, it);
  });
  const del = unionDeleted(delL, delR);
  const delIds = new Set(del.map(d => String(d.id)));
  return Array.from(map.values()).filter(it => !delIds.has(String(it.id)));
}
function mergeSyncData(local, remote) {
  const merged = {};
  for (const k in local) merged[k] = local[k]; // 先拷本地全部（含元数据）
  const keys = new Set();
  for (const k in local) if (!k.startsWith('_')) keys.add(k);
  for (const k in remote) if (!k.startsWith('_')) keys.add(k);
  for (const k of keys) {
    if (k.startsWith('deleted_')) continue; // 墓碑数组本身不参与「模块级」合并，避免被另一端空墓碑覆盖而丢失删除记录
    const lHas = Object.prototype.hasOwnProperty.call(local, k);
    const rHas = Object.prototype.hasOwnProperty.call(remote, k);
    const tsL = modTs(local, k);
    const tsR = modTs(remote, k);
    const listMerge = isListModule(k) && Array.isArray(local[k]) && Array.isArray(remote[k]);
    if (listMerge || (isMergeableList(local[k]) && isMergeableList(remote[k]))) {
      // 列表模块：逐条按 id 并集（两端各自新增都保留），同 id 取较新，再剔除墓碑 id
      merged[k] = mergeList(local[k], remote[k], local['deleted_' + k], remote['deleted_' + k]);
      merged['deleted_' + k] = unionDeleted(local['deleted_' + k], remote['deleted_' + k]);
      merged['_ts_' + k] = Math.max(tsL, tsR);
    } else if (rHas && (!lHas || tsR >= tsL)) {
      merged[k] = remote[k];
      merged['_ts_' + k] = tsR;
    } else if (lHas) {
      merged[k] = local[k];
      merged['_ts_' + k] = tsL;
    }
  }
  // 防御性保留任意一侧存在的墓碑数组
  for (const k in local) if (k.startsWith('deleted_') && !(k in merged)) merged[k] = local[k];
  for (const k in remote) if (k.startsWith('deleted_') && !(k in merged)) merged[k] = remote[k];
  // 迁移兜底：根时间戳取各模块最大，便于未升级的设备过渡
  let max = 0;
  for (const k in merged) if (k.startsWith('_ts_')) max = Math.max(max, merged[k]);
  merged._syncUpdatedAt = max;
  return merged;
}

// ===== 跨设备同步（Netlify Blobs）=====
// 策略：编辑即上传（事件驱动，无定时器）；切回页面/切标签页时拉一次；手动按钮可双向同步。
// 注意：SYNC 配置在此声明；App 的三个同步方法定义在下方的 App 对象之后，避免 TDZ 引用未初始化的 App。
const SYNC = { ENABLED: true, ENDPOINT: '/api/sync', PULLING: false, INITIAL_PULL_DONE: false };

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
  addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  },
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); },
  escape(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },

  lunarToSolar(year, month, day, isLeap) {
    const r = Lunar.toSolar(year, month, day, isLeap);
    return r ? r.y + '-' + String(r.m).padStart(2,'0') + '-' + String(r.d).padStart(2,'0') : null;
  },
  solarToLunar(y, m, d) { return Lunar.toLunar(y, m, d); },
  nextLunarDate(m, d, isLeap) { return Lunar.nextDate(m, d, isLeap); },
  prevLunarDate(m, d, isLeap) {
    const t = new Date(); t.setHours(0,0,0,0);
    for (let y = t.getFullYear(); y >= t.getFullYear() - 3; y--) {
      if (isLeap && Lunar.leapMonth(y) !== m) continue;
      const s = Lunar.toSolar(y, m, d, isLeap);
      if (!s) continue;
      const dt = new Date(s.y, s.m - 1, s.d);
      if (dt <= t) return s.y + '-' + String(s.m).padStart(2,'0') + '-' + String(s.d).padStart(2,'0');
    }
    return null;
  },
  lunarMonthName(m, isLeap) { return Lunar.monthName(m, isLeap); },
  lunarDayName(d) { return Lunar.dayName(d); }
};

// ===== Chinese Lunar Calendar (1900-2099) =====
const Lunar = (function() {
  const lunarInfo = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a0,0x096d5,0x04af0,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,0x0a2e0,0x0d2e0,0x0c960,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,0x0d520];
  const months = ['正','二','三','四','五','六','七','八','九','十','冬','腊'];
  const day1 = ['初','十','廿','三'];
  const day2 = ['十','一','二','三','四','五','六','七','八','九'];
  function leapMonth(y){return lunarInfo[y-1900]&0xf;}
  function leapDays(y){return leapMonth(y)?((lunarInfo[y-1900]&0x10000)?30:29):0;}
  function monthDays(y,m){return ((lunarInfo[y-1900]&(0x10000>>m))?30:29);}
  function yearDays(y){let s=348;for(let i=0x8000;i>0x8;i>>=1)s+=(lunarInfo[y-1900]&i)?1:0;return s+leapDays(y);}
  function monthsOfYear(ly){const lp=leapMonth(ly);const arr=[];for(let m=1;m<=12;m++){arr.push({m,isLeap:false,days:monthDays(ly,m)});if(lp>0&&m===lp)arr.push({m,isLeap:true,days:leapDays(ly)});}return arr;}
  function toLunar(y,m,d){const base=Date.UTC(1900,0,31);let offset=Math.round((Date.UTC(y,m-1,d)-base)/86400000);let ly=1900;while(offset>=yearDays(ly)){offset-=yearDays(ly);ly++;}const arr=monthsOfYear(ly);let isLeap=false,lm=1;for(const mo of arr){if(offset<mo.days){isLeap=mo.isLeap;lm=mo.m;break;}offset-=mo.days;}return {lYear:ly,lMonth:lm,lDay:offset+1,isLeap};}
  function toSolar(ly,lm,ld,isLeap){if(ly<1900||ly>2099)return null;let offset=0;for(let i=1900;i<ly;i++)offset+=yearDays(i);const arr=monthsOfYear(ly);let found=false;for(const mo of arr){if(mo.m===lm&&mo.isLeap===isLeap){found=true;break;}offset+=mo.days;}if(!found)return null;offset+=ld-1;const r=new Date(Date.UTC(1900,0,31)+offset*86400000);return {y:r.getUTCFullYear(),m:r.getUTCMonth()+1,d:r.getUTCDate()};}
  function nextDate(lm,ld,isLeap){const t=new Date();t.setHours(0,0,0,0);for(let y=t.getFullYear();y<=t.getFullYear()+3;y++){if(isLeap&&leapMonth(y)!==lm)continue;const s=toSolar(y,lm,ld,isLeap);if(!s)continue;if(new Date(s.y,s.m-1,s.d)>=t)return s.y+'-'+String(s.m).padStart(2,'0')+'-'+String(s.d).padStart(2,'0');}return null;}
  function monthName(m,isLeap){return (isLeap?'闰':'')+months[m-1]+'月';}
  function dayName(d){if(d===10)return '初十';if(d===20)return '二十';if(d===30)return '三十';const t=Math.floor(d/10),o=d%10;return day1[t]+(o===0?'':day2[o]);}
  function monthLength(y,m,isLeap){return isLeap?leapDays(y):monthDays(y,m);}
  return {toLunar,toSolar,nextDate,leapMonth,monthName,dayName,monthLength};
})();


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
  
  async init() {
    this.restoreNavOrder();
    this.bindNav();
    this.bindSidebar();
    this.updateTopbar();
    this.registerSW();
    this.switch('dashboard');
    this.bindSync();
    // 先拉取云端基线（await），确保本地先拿到其他设备数据，再解除上传封锁，避免覆盖
    await this._syncPull();
    Store.normalizeTimestamps(); // 升级迁移：旧数据拆出各模块时间戳
    this.syncQuoteTodos();
    this.syncNewTodos();
    // Update time every minute
    setInterval(() => { this.updateTopbar(); this.syncQuoteTodos(); this.syncNewTodos(); if (this.current === 'todos') this.renderTodoList(); }, 60000);
  },

  // 同步按钮 + 切回页面/切标签页时拉取（无定时器）
  bindSync() {
    const btn = document.getElementById('syncBtn');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.classList.add('syncing');
        btn.disabled = true;
        await App._syncNow();
        btn.disabled = false;
        btn.classList.remove('syncing');
      });
    }
    // 标签页切回 / 窗口重新获得焦点时拉取一次
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') App._syncPull();
    });
    window.addEventListener('focus', () => App._syncPull());
    window.addEventListener('pageshow', (e) => { if (e.persisted) App._syncPull(); });
    // 恢复联网时，把因离线/失败而缓冲的上传（含删除墓碑）补发出去
    window.addEventListener('online', () => { _pushAttempts = 0; _pushTimer = null; _flushPush(); });
  },
  
  bindNav() {
    const nav = document.getElementById('sidebarNav');
    this.saveNavOrder();
    nav.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('pointerdown', (e) => this._navPointerDown(e, item));
    });
  },

  _navPointerDown(e, item) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const nav = document.getElementById('sidebarNav');
    const startX = e.clientX, startY = e.clientY;
    const THRESHOLD = 6;
    let dragging = false;

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
        dragging = true;
        item.classList.add('dragging');
        nav.classList.add('is-dragging');
      }
      ev.preventDefault();
      const after = this.getDragAfterElement(nav, ev.clientY);
      if (after == null) nav.appendChild(item);
      else if (after !== item) nav.insertBefore(item, after);
    };
    const onUp = (ev) => {
      try { item.releasePointerCapture(ev.pointerId); } catch (_) {}
      item.removeEventListener('pointermove', onMove);
      item.removeEventListener('pointerup', onUp);
      item.removeEventListener('pointercancel', onUp);
      if (dragging) {
        item.classList.remove('dragging');
        nav.classList.remove('is-dragging');
        this.saveNavOrder();
        toast('已保存导航顺序');
      } else {
        this.switch(item.dataset.module);
        if (window.innerWidth <= 768) this.closeSidebar();
      }
    };
    try { item.setPointerCapture(e.pointerId); } catch (_) {}
    item.addEventListener('pointermove', onMove);
    item.addEventListener('pointerup', onUp);
    item.addEventListener('pointercancel', onUp);
  },

  restoreNavOrder() {
    const order = Store.get('navOrder', null);
    if (!order || !Array.isArray(order)) return;
    const nav = document.getElementById('sidebarNav');
    const items = [...nav.querySelectorAll('.nav-item')];
    const byModule = {};
    items.forEach(it => byModule[it.dataset.module] = it);
    order.forEach(mod => { const it = byModule[mod]; if (it) nav.appendChild(it); });
    items.forEach(it => { if (!order.includes(it.dataset.module)) nav.appendChild(it); });
  },

  saveNavOrder() {
    const order = [...document.querySelectorAll('#sidebarNav .nav-item')].map(el => el.dataset.module);
    Store.set('navOrder', order);
  },

  getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.nav-item:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
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
      customers: '客户进展', health: '减脂记录', schedule: '日程安排', anniversaries: '纪念日', periods: '经期记录'
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
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
      // 新 Service Worker 接管时自动刷新一次，确保加载到最新的 app.js / sw.js
      let _reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_reloading) return;
        _reloading = true;
        location.reload();
      });
    }
  },
  
  modules: {}
};

// ===== 跨设备同步方法（定义于 App 之后，避免 TDZ）=====
// 上传队列：始终只保留「最新一份完整数据」，发送失败自动退避重试，
// 联网后补发。这能从根上解决「删除/编辑的推送因网络抖动丢失，
// 导致被删项在另一端复活 / 改动丢失」的问题——之前是 fire-and-forget，
// 手机端一次失败就把删除墓碑弄丢了。
let _pushBuf = null;     // 最近一次待上传的完整数据（覆盖式缓冲）
let _pushTimer = null;   // 退避重试定时器
let _pushAttempts = 0;   // 当前连续失败次数
let _pushing = false;    // 是否正在发送

function _flushPush() {
  if (_pushBuf == null || _pushing || !SYNC.ENABLED) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 离线：等 online 事件再发
  _pushing = true;
  const data = _pushBuf;
  fetch(SYNC.ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  })
    .then(() => { _pushBuf = null; _pushTimer = null; _pushAttempts = 0; _pushing = false; })
    .catch(() => {
      _pushing = false;
      _pushAttempts++;
      if (_pushAttempts <= 12) {
        const delay = Math.min(800 * Math.pow(2, _pushAttempts), 30000);
        _pushTimer = setTimeout(_flushPush, delay);
      }
    });
}

App._syncPush = function(data) {
  if (!SYNC.ENABLED) return;
  _pushBuf = data; // 始终持有最新数据（覆盖式），重试时发的是最新态而非过期态
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // 离线：仅缓冲，等 online 补发
  if (!_pushTimer && !_pushing) _flushPush();
};

// 显式同步时使用的「可靠上传」：在按钮点击的同步上下文里 await 完成（有限重试），
// 保证本次的删除/新增一定落到云端，而不依赖后台退避定时器——
// 移动端切后台会停掉定时器，导致 fire-and-forget 的自动上传被丢弃，
// 这正是此前「删除后对方收不到、只有硬刷才会同步」的根因。
async function _pushAwait(data, attempts = 5) {
  if (!SYNC.ENABLED) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _pushBuf = data; return false; // 离线：交回后台缓冲，联网后再补发
  }
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(SYNC.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      _pushBuf = null; _pushTimer = null; _pushAttempts = 0;
      return true;
    } catch (_) {
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  _pushBuf = data; _flushPush(); // 仍失败：后台缓冲 + 退避重试兜底
  return false;
}

App._syncPull = async function() {
  if (!SYNC.ENABLED || SYNC.PULLING) return false;
  SYNC.PULLING = true;
  try {
    let remote = null;
    // 短暂重试，吸收偶发网络抖动，避免「首次拉取失败→本端永远不上传」
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(SYNC.ENDPOINT, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });
        if (res.ok) { const payload = await res.json(); remote = payload && payload.data ? payload.data : null; break; }
      } catch (_) {}
      if (attempt < 2) await new Promise(r => setTimeout(r, 700));
    }
    if (!remote) {
      // 拉取失败：5 秒后台重试一次，期间不上传（避免用未合并的本地数据覆盖云端）
      if (!SYNC._retryTimer) {
        SYNC._retryTimer = setTimeout(() => { SYNC._retryTimer = null; App._syncPull(); }, 5000);
      }
      return false;
    }
    SYNC.INITIAL_PULL_DONE = true; // 已成功拉取云端基线，此后本地编辑才可安全上传
    const local = Store.load();
    // 逐模块合并：列表按 id 并集、其余按时间戳取较新方；空/旧模块不会反向抹掉真实数据
    const merged = mergeSyncData(local, remote);
    const changed = JSON.stringify(merged) !== JSON.stringify(local);
    if (changed) {
      Store.replaceAll(merged); // 静默写入，避免回环上传
      if (this.current) this.switch(this.current);
      this._syncPush(merged); // 把合并结果（含本地较新模块/条目）写回云端，让另一端也能拿到
      if (typeof toast === 'function') toast('已同步最新数据');
      return true;
    }
    return false;
  } catch (_) {
    return false;
  } finally {
    SYNC.PULLING = false;
  }
};

App._syncNow = async function() {
  // 同步按钮 = 提交键：先把本地的（新增 / 删除墓碑）可靠地上传到云端，
  // 再拉取云端并集（已含对方数据）套用到本地，最后把合并后的完整最新态写回云端，
  // 三步全部 await，确保「点击即同步、删除/新增双向生效」，不再依赖后台定时器。
  await _pushAwait(Store.load());   // 1) 上传我方变更（删除/新增）
  await this._syncPull();           // 2) 拉取并集并套用对方数据（合并 + 必要时回写）
  await _pushAwait(Store.load());   // 3) 把合并后的最新态可靠写回云端，确保对方也能拿到
  if (typeof toast === 'function') toast('同步完成');
};

/* ============================================================
   MODULE: Dashboard
   ============================================================ */
App.modules.dashboard = function(el) {
  const todos = Store.get('todos', []);
  const todayTodos = todos.filter(t => t.date === U.today() && !t.completed);
  const custQuote = Store.get('custQuote', []);
  const custKey = Store.get('custKey', []);
  const today = U.today();
  const pendingQuotes = custQuote.filter(q => q.nextFollow && q.nextFollow <= today).length;
  
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
        <span class="stat-label">待跟进报价</span>
        <span class="stat-value ${pendingQuotes > 0 ? 'danger' : 'success'}">${pendingQuotes}</span>
        <span class="stat-sub">${pendingQuotes > 0 ? '需跟进' : '暂无'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">重点客户</span>
        <span class="stat-value primary">${custKey.length}</span>
        <span class="stat-sub">共 ${custKey.length} 个</span>
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
  App.syncQuoteTodos();
  App.syncNewTodos();
  const todos = Store.get('todos', []);
  const today = U.today();
  const doneCount = todos.filter(t => t.completed).length;
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
        ${doneCount > 0 ? `<button class="filter-toggle" id="todoShowDone" onclick="App.toggleShowCompleted()">显示已完成 (${doneCount})</button>` : ''}
      </div>
      <div id="todoList"></div>
    </div>
  `;
  App._showCompleted = App._showCompleted === undefined ? false : App._showCompleted;
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
  const showCompleted = !!App._showCompleted;
  let list = todos.slice().sort((a, b) => (a.completed - b.completed) || (b.date < a.date ? -1 : 1));
  if (!showCompleted) list = list.filter(t => !t.completed);
  if (f === 'today') list = list.filter(t => t.date === U.today());
  if (f === 'work') list = list.filter(t => t.category === 'work');
  if (f === 'life') list = list.filter(t => t.category === 'life');

  const container = document.getElementById('todoList');
  if (!container) return;
  if (list.length === 0) {
    const hasDone = todos.some(t => t.completed);
    if (!showCompleted && hasDone) {
      container.innerHTML = '<div class="empty-state"><p>已完成的待办已隐藏</p><button class="btn btn-soft btn-sm mt-12" onclick="App.toggleShowCompleted()">显示已完成 →</button></div>';
    } else {
      container.innerHTML = '<div class="empty-state"><p>暂无待办事项</p></div>';
    }
    return;
  }
  const editingId = App._editingTodoId;
  container.innerHTML = list.map(t => {
    if (t.id === editingId) {
      return `
    <div class="todo-item todo-editing">
      <div class="todo-edit-form">
        <input type="text" class="todo-edit-input" id="editText_${t.id}" value="${U.escape(t.text)}" placeholder="待办内容..." onkeydown="if(event.key==='Enter')App.saveTodoEdit('${t.id}');if(event.key==='Escape')App.cancelTodoEdit()">
        <div class="todo-edit-row">
          <select id="editCat_${t.id}">
            <option value="work" ${t.category==='work'?'selected':''}>工作</option>
            <option value="life" ${t.category==='life'?'selected':''}>生活</option>
          </select>
          <input type="date" id="editDate_${t.id}" value="${t.date || U.today()}">
          <div class="todo-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="App.saveTodoEdit('${t.id}')">保存</button>
            <button class="btn btn-soft btn-sm" onclick="App.cancelTodoEdit()">取消</button>
          </div>
        </div>
      </div>
    </div>`;
    }
    return `
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
        <button class="todo-edit" title="编辑" onclick="App.editTodo('${t.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="todo-delete" title="删除" onclick="App.deleteTodo('${t.id}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  if (editingId) {
    const inp = document.getElementById('editText_' + editingId);
    if (inp) { inp.focus(); inp.select(); }
  }
};

App.syncQuoteTodos = function() {
  const quotes = Store.get('custQuote', []);
  const todos = Store.get('todos', []);
  const today = U.today();
  let changed = false;
  const validSources = new Set();
  quotes.forEach(q => {
    if (!q.nextFollow || q.nextFollow > today) return;
    const src = 'quote:' + q.id;
    validSources.add(src);
    const text = '跟进报价客户：' + q.title + (q.phone ? '（' + q.phone + '）' : '');
    const existing = todos.find(t => t.source === src);
    if (existing) {
      if (existing.date !== q.nextFollow || existing.text !== text) {
        existing.date = q.nextFollow;
        existing.text = text;
        existing.completed = false;
        changed = true;
      }
    } else {
      todos.push({ id: U.uid(), text, category: 'work', date: q.nextFollow, completed: false, created: Date.now(), source: src });
      changed = true;
    }
  });
  const before = todos.length;
  const filtered = todos.filter(t => !(t.source && t.source.indexOf('quote:') === 0 && !validSources.has(t.source)));
  if (filtered.length !== before) changed = true;
  if (changed) Store.set('todos', filtered);
};

App.syncNewTodos = function() {
  const news = Store.get('custNew', []);
  const todos = Store.get('todos', []);
  const today = U.today();
  let changed = false;
  const validSources = new Set();
  news.forEach(n => {
    if (!n.nextFollow || n.nextFollow > today) return;
    const src = 'new:' + n.id;
    validSources.add(src);
    const text = '跟进新建联客户：' + n.title + (n.phone ? '（' + n.phone + '）' : '');
    const existing = todos.find(t => t.source === src);
    if (existing) {
      if (existing.date !== n.nextFollow || existing.text !== text) {
        existing.date = n.nextFollow;
        existing.text = text;
        existing.completed = false;
        changed = true;
      }
    } else {
      todos.push({ id: U.uid(), text, category: 'work', date: n.nextFollow, completed: false, created: Date.now(), source: src });
      changed = true;
    }
  });
  const before = todos.length;
  const filtered = todos.filter(t => !(t.source && t.source.indexOf('new:') === 0 && !validSources.has(t.source)));
  if (filtered.length !== before) changed = true;
  if (changed) Store.set('todos', filtered);
};

App.addTodo = function() {
  const text = document.getElementById('todoInput').value.trim();
  const cat = document.getElementById('todoCat').value;
  const date = document.getElementById('todoDate').value || U.today();
  if (!text) { toast('请输入待办内容'); return; }
  const todos = Store.get('todos', []);
  todos.push({ id: U.uid(), text, category: cat, date, completed: false, created: Date.now(), updated: Date.now() });
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
  Store.markDeleted('todos', id);
  if (App._editingTodoId === id) App._editingTodoId = null;
  App.renderTodoList();
  toast('已删除');
};

App.editTodo = function(id) {
  App._editingTodoId = id;
  App.renderTodoList();
};

App.cancelTodoEdit = function() {
  App._editingTodoId = null;
  App.renderTodoList();
};

App.toggleShowCompleted = function() {
  App._showCompleted = !App._showCompleted;
  const btn = document.getElementById('todoShowDone');
  if (btn) btn.classList.toggle('on', App._showCompleted);
  App.renderTodoList();
};

App.saveTodoEdit = function(id) {
  const textEl = document.getElementById('editText_' + id);
  const catEl = document.getElementById('editCat_' + id);
  const dateEl = document.getElementById('editDate_' + id);
  if (!textEl) return;
  const text = textEl.value.trim();
  const cat = catEl ? catEl.value : 'work';
  const date = (dateEl && dateEl.value) ? dateEl.value : U.today();
  if (!text) { toast('请输入待办内容'); textEl.focus(); return; }
  const todos = Store.get('todos', []);
  const t = todos.find(t => t.id === id);
  if (t) {
    t.text = text;
    t.category = cat;
    t.date = date;
    t.updated = Date.now();
    Store.set('todos', todos);
  }
  App._editingTodoId = null;
  App.renderTodoList();
  toast('已保存修改');
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
    const data = await GH_DATA.fetchBriefing();
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
    const data = await GH_DATA.fetchBriefing();
    if (data && data.africa) {
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
      const cacheData = await GH_DATA.fetchBriefing();
      if (cacheData && cacheData.africa) {
        const saved = Store.get('social_news', {});
        saved[today] = { ...cacheData, aiGenerated: true, savedAt: Date.now() };
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

App.autoFillTopics = async function() {
  // Try to fetch briefing and get topic suggestions
  const data = await GH_DATA.fetchBriefing();
  if (data && data.topicSuggestions) {
    const topics = Store.get('social_topics', {});
    const today = U.today();
    topics[today] = Object.assign({}, data.topicSuggestions, { _aiGenerated: true });
    Store.set('social_topics', topics);
    toast('选题已根据热点自动填充！');
    App.socialTab('topics');
  } else {
    toast('暂无 AI 选题建议，请先点击"AI 生成今日简报"');
  }
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
  Store.markDeleted('social_data', id);
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

// ===== 从 GitHub main 分支拉取每日学习推送内容 =====
// learning.json 由 GitHub Actions 写入 main 分支，前端通过 GitHub raw 读取（Netlify 跳过部署时仍能拿到最新数据）
App.loadLearningFeed = async function() {
  try {
    const feed = await GH_DATA.fetchLearning();
    if (!feed) return;
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

  // 自动推送内容（从 GitHub learning-data 分支拉取）
  let feedCard = '';
  if (isAuto && App._learningFeed) {
    const FEED_KEY = { english: 'english', finance: 'finance', chat: 'chatTips' };
    const feedItem = App._learningFeed[FEED_KEY[tab]];
    if (feedItem && feedItem.content) {
      const feedDate = App._learningFeed.date || U.today();
      feedCard = `
        <div class="card feed-card">
          <div class="card-title"><span class="icon-dot" style="background:var(--success)"></span>📡 今日推送（自动抓取）</div>
          <div class="feed-date text-sm text-light">${U.fmtDateFull(feedDate)}</div>
          <div class="feed-content">${U.escape(feedItem.content).replace(/\n/g, '<br>')}</div>
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
  Store.markDeleted('health', id);
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

  const PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  const rowHtml = (s, isToday) => {
    if (App._editingScheduleId === s.id) {
      const p = 'se_' + s.id;
      return `
      <div class="sched-entry sched-editing">
        <div class="todo-edit-form">
          <div class="todo-edit-row">
            <input type="date" id="${p}_date" value="${s.date}">
            <input type="time" id="${p}_time" value="${s.time || ''}">
          </div>
          <input class="todo-edit-input" id="${p}_title" value="${U.escape(s.title)}" placeholder="日程标题" onkeydown="if(event.key==='Enter')App.saveSchedule('${s.id}');if(event.key==='Escape')App.cancelScheduleEdit()">
          <input class="todo-edit-input" id="${p}_desc" value="${U.escape(s.desc || '')}" placeholder="描述（可选）">
          <div class="todo-edit-actions">
            <button class="btn btn-primary" onclick="App.saveSchedule('${s.id}')">保存</button>
            <button class="btn btn-ghost" onclick="App.cancelScheduleEdit()">取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
      <div class="sched-entry">
        <div class="sched-time"><div class="time">${s.time || '全天'}</div>${isToday ? '' : `<div class="date">${U.fmtDate(s.date)}</div>`}</div>
        <div class="sched-content">
          <div class="title">${U.escape(s.title)}</div>
          ${s.desc ? `<div class="desc">${U.escape(s.desc)}</div>` : ''}
        </div>
        ${isToday ? '' : `<div class="text-right text-sm text-light">${U.daysUntil(s.date)}天后</div>`}
        <button class="todo-edit" onclick="App.editSchedule('${s.id}')">${PENCIL}</button>
        <button class="todo-delete" onclick="App.delSchedule('${s.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`;
  };

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
      ${todayList.map(s => rowHtml(s, true)).join('')}
    </div>` : ''}
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>即将到来</div>
      ${upcoming.length > 0 ? upcoming.map(s => rowHtml(s, false)).join('') : '<div class="empty-state"><p>暂无即将到来的日程</p></div>'}
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

App.editSchedule = function(id) {
  this._editingScheduleId = id;
  this.modules.schedule(document.getElementById('contentArea'));
};

App.cancelScheduleEdit = function() {
  this._editingScheduleId = null;
  this.modules.schedule(document.getElementById('contentArea'));
};

App.saveSchedule = function(id) {
  const records = Store.get('schedule', []);
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  const p = 'se_' + id;
  const title = document.getElementById(p + '_title').value.trim();
  if (!title) { toast('请输入日程标题'); return; }
  rec.date = document.getElementById(p + '_date').value;
  rec.time = document.getElementById(p + '_time').value;
  rec.title = title;
  rec.desc = document.getElementById(p + '_desc').value;
  Store.set('schedule', records);
  this._editingScheduleId = null;
  App.modules.schedule(document.getElementById('contentArea'));
  toast('已保存修改');
};

App.delSchedule = function(id) {
  Store.markDeleted('schedule', id);
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
    const prev = App.prevAnniversaryDate(a);
    return { ...a, daysUntil: U.daysUntil(next), daysSince: U.daysBetween(prev, U.today()), nextDate: next };
  }).sort((a, b) => a.daysUntil - b.daysUntil);

  const PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  const lunarSelectHtml = (p, isLunar) => `<select id="${p}_lunar" onchange="App.toggleAnnivCalendar('${p}')"><option value="false"${!isLunar ? ' selected' : ''}>公历</option><option value="true"${isLunar ? ' selected' : ''}>农历</option></select>`;
  const lunarPickerHtml = (p, show) => `<div class="lunar-picker" id="${p}_lunarPicker" style="display:${show ? 'block' : 'none'}"><div class="lunar-picker-row"><select id="${p}_lyear"></select><select id="${p}_lmonth"></select><select id="${p}_lday"></select></div><div class="lunar-picker-hint" id="${p}_lunarSolar"></div></div>`;

  const dateDisplay = (a) => (a.isLunar && a.lunar)
    ? '农历 ' + U.lunarMonthName(a.lunar.m, a.lunar.isLeap) + U.lunarDayName(a.lunar.d)
    : a.date;

  const typeLabel = (t) => t === 'birthday' ? '生日' : t === 'countdown' ? '倒数日' : '纪念日';
  const typeIcon = (t) => t === 'birthday' ? '🎂' : t === 'countdown' ? '⏳' : '💝';
  const typeColor = (t) => t === 'birthday'
    ? { bg: '#FEF3C7', fg: '#D97706' }
    : t === 'countdown'
    ? { bg: '#CCFBF1', fg: '#0D9488' }
    : { bg: '#E0E7FF', fg: '#6366F1' };

  const countHtml = (a) => {
    if (a.type === 'countdown') {
      const u = a.daysUntil;
      const txt = u > 0 ? u + ' 天后' : u === 0 ? '就是今天' : '已过 ' + (-u) + ' 天';
      return `<div class="anni-count-item anni-count-wide">
        <span class="anni-count-label">倒数日</span>
        <span class="anni-count-val">${txt}</span>
      </div>`;
    }
    return `<div class="anni-count-item">
        <span class="anni-count-label">正数日</span>
        <span class="anni-count-val">${a.daysSince === 0 ? '今天' : a.daysSince + ' 天'}</span>
      </div>
      <div class="anni-count-item">
        <span class="anni-count-label">倒数日</span>
        <span class="anni-count-val">${a.daysUntil === 0 ? '今天' : a.daysUntil + ' 天'}</span>
      </div>`;
  };

  const rowHtml = (a) => {
    if (App._editingAnnivId === a.id) {
      const p = 'ae_' + a.id;
      const isLunar = !!a.isLunar;
      return `
      <div class="anni-entry anni-editing">
        <div class="todo-edit-form">
          <input class="todo-edit-input" id="${p}_name" value="${U.escape(a.name)}" placeholder="名称">
          <div class="todo-edit-row">
            <select id="${p}_type">
              <option value="birthday"${a.type === 'birthday' ? ' selected' : ''}>生日</option>
              <option value="anniversary"${a.type === 'anniversary' ? ' selected' : ''}>纪念日</option>
              <option value="countdown"${a.type === 'countdown' ? ' selected' : ''}>倒数日</option>
            </select>
            ${lunarSelectHtml(p, isLunar)}
          </div>
          <input type="date" id="${p}_date" value="${a.date}" style="display:${isLunar ? 'none' : ''}">
          ${lunarPickerHtml(p, isLunar)}
          <div class="todo-edit-actions">
            <button class="btn btn-primary" onclick="App.saveAnniversary('${a.id}')">保存</button>
            <button class="btn btn-ghost" onclick="App.cancelAnnivEdit()">取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
      <div class="anni-entry">
        <div class="anni-icon" style="background:${typeColor(a.type).bg};color:${typeColor(a.type).fg}">${typeIcon(a.type)}</div>
        <div class="anni-info">
          <div class="anni-name">${U.escape(a.name)}</div>
          <div class="anni-date">${dateDisplay(a)}（${typeLabel(a.type)}）</div>
        </div>
        <div class="anni-count">
          ${countHtml(a)}
        </div>
        <button class="todo-edit" onclick="App.editAnniversary('${a.id}')">${PENCIL}</button>
        <button class="todo-delete" onclick="App.delAnniversary('${a.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`;
  };

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
            <option value="countdown">倒数日</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;min-width:120px">
          <label>日期</label>
          <input type="date" id="a_date">
          <div class="mt-8">${lunarSelectHtml('a', false)}</div>
          ${lunarPickerHtml('a', false)}
        </div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" onclick="App.addAnniversary()">添加</button>
        </div>
      </div>
      <p class="text-sm text-light">提示：选择「农历」后日期将切换为农历日历；提前3天会提醒你哦！</p>
    </div>
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>纪念日列表</div>
      ${withCountdown.length > 0 ? withCountdown.map(rowHtml).join('') : '<div class="empty-state"><p>暂无纪念日记录</p></div>'}
    </div>
  `;

  if (App._editingAnnivId) {
    const rec = records.find(r => r.id === App._editingAnnivId);
    if (rec && rec.isLunar) App.initAnnivPicker('ae_' + rec.id, rec.lunar || null);
  }
};

App.prevAnniversaryDate = function(a) {
  if (a.type === 'countdown') return a.date; // 倒数日：固定目标，不按年回滚
  if (a.isLunar && a.lunar) {
    const pd = U.prevLunarDate(a.lunar.m, a.lunar.d, a.lunar.isLeap);
    if (pd) return pd;
  }
  const now = new Date(); now.setHours(0,0,0,0);
  const [y, m, d] = a.date.split('-').map(Number);
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
  const prev = new Date(next.getFullYear() - 1, m - 1, d);
  return prev.toISOString().slice(0, 10);
};

App.nextAnniversaryDate = function(a) {
  if (a.type === 'countdown') return a.date; // 倒数日：固定目标，不按年滚动
  if (a.isLunar && a.lunar) {
    const nd = U.nextLunarDate(a.lunar.m, a.lunar.d, a.lunar.isLeap);
    if (nd) return nd;
  }
  const now = new Date();
  const [y, m, d] = a.date.split('-').map(Number);
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < now) next = new Date(now.getFullYear() + 1, m - 1, d);
  return next.toISOString().slice(0, 10);
};

App.toggleAnnivCalendar = function(prefix) {
  const sel = document.getElementById(prefix + '_lunar');
  if (!sel) return;
  const isLunar = sel.value === 'true';
  const dateEl = document.getElementById(prefix + '_date');
  const picker = document.getElementById(prefix + '_lunarPicker');
  if (isLunar) {
    if (dateEl) dateEl.style.display = 'none';
    if (picker) picker.style.display = 'block';
    this.initAnnivPicker(prefix, null);
  } else {
    if (dateEl) dateEl.style.display = '';
    if (picker) picker.style.display = 'none';
  }
};

App.initAnnivPicker = function(prefix, sel) {
  const ySel = document.getElementById(prefix + '_lyear');
  const mSel = document.getElementById(prefix + '_lmonth');
  const dSel = document.getElementById(prefix + '_lday');
  if (!ySel || !mSel || !dSel) return;
  const cur = new Date().getFullYear();
  const startY = Math.max(1900, cur - 100), endY = cur;

  const fillMonths = (cm, cl) => {
    const y = +ySel.value;
    const lp = Lunar.leapMonth(y);
    mSel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const o = document.createElement('option'); o.value = m; o.textContent = Lunar.monthName(m, false); mSel.appendChild(o);
      if (lp > 0 && m === lp) { const lo = document.createElement('option'); lo.value = m; lo.dataset.leap = '1'; lo.textContent = Lunar.monthName(m, true); mSel.appendChild(lo); }
    }
    for (const o of mSel.options) { if (+o.value === cm && (o.dataset.leap === '1') === !!cl) { o.selected = true; break; } }
  };
  const fillDays = (cd) => {
    const mOpt = mSel.selectedOptions[0];
    const m = +mOpt.value, isLeap = mOpt.dataset.leap === '1';
    const len = Lunar.monthLength(+ySel.value, m, isLeap);
    dSel.innerHTML = '';
    for (let d = 1; d <= len; d++) { const o = document.createElement('option'); o.value = d; o.textContent = Lunar.dayName(d); dSel.appendChild(o); }
    dSel.value = cd > len ? len : cd;
  };
  const updateSolar = () => {
    const mOpt = mSel.selectedOptions[0];
    const m = +mOpt.value, isLeap = mOpt.dataset.leap === '1', d = +dSel.value;
    const s = Lunar.toSolar(+ySel.value, m, d, isLeap);
    const hint = document.getElementById(prefix + '_lunarSolar');
    if (s && hint) hint.textContent = '对应公历：' + s.y + '年' + s.m + '月' + s.d + '日';
  };

  ySel.innerHTML = '';
  for (let y = endY; y >= startY; y--) { const o = document.createElement('option'); o.value = y; o.textContent = y + '年'; ySel.appendChild(o); }
  if (sel && sel.y) ySel.value = sel.y;
  fillMonths(sel ? sel.m : 1, sel ? sel.isLeap : false);
  fillDays(sel ? sel.d : 1);
  updateSolar();

  ySel.addEventListener('change', () => { const mOpt = mSel.selectedOptions[0]; fillMonths(+mOpt.value, mOpt.dataset.leap === '1'); fillDays(+dSel.value); updateSolar(); });
  mSel.addEventListener('change', () => { fillDays(+dSel.value); updateSolar(); });
  dSel.addEventListener('change', updateSolar);
};

App.addAnniversary = function() {
  const records = Store.get('anniversaries', []);
  const name = document.getElementById('a_name').value.trim();
  if (!name) { toast('请输入名称'); return; }
  const isLunar = document.getElementById('a_lunar').value === 'true';
  let date, lunar = null;
  if (isLunar) {
    const ySel = document.getElementById('a_lyear');
    const mOpt = document.getElementById('a_lmonth').selectedOptions[0];
    const dSel = document.getElementById('a_lday');
    const m = +mOpt.value, isLeap = mOpt.dataset.leap === '1', d = +dSel.value;
    const s = Lunar.toSolar(+ySel.value, m, d, isLeap);
    if (!s) { toast('请选择有效的农历日期'); return; }
    date = s.y + '-' + String(s.m).padStart(2, '0') + '-' + String(s.d).padStart(2, '0');
    lunar = { y: +ySel.value, m, d, isLeap };
  } else {
    date = document.getElementById('a_date').value;
    if (!date) { toast('请选择日期'); return; }
  }
  records.push({ id: U.uid(), name, type: document.getElementById('a_type').value, date, isLunar, lunar, created: Date.now() });
  Store.set('anniversaries', records);
  App.modules.anniversaries(document.getElementById('contentArea'));
  toast('纪念日已添加');
};

App.editAnniversary = function(id) {
  this._editingAnnivId = id;
  this.modules.anniversaries(document.getElementById('contentArea'));
};

App.cancelAnnivEdit = function() {
  this._editingAnnivId = null;
  this.modules.anniversaries(document.getElementById('contentArea'));
};

App.saveAnniversary = function(id) {
  const records = Store.get('anniversaries', []);
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  const p = 'ae_' + id;
  const name = document.getElementById(p + '_name').value.trim();
  if (!name) { toast('请输入名称'); return; }
  const isLunar = document.getElementById(p + '_lunar').value === 'true';
  let date, lunar = null;
  if (isLunar) {
    const ySel = document.getElementById(p + '_lyear');
    const mOpt = document.getElementById(p + '_lmonth').selectedOptions[0];
    const dSel = document.getElementById(p + '_lday');
    const m = +mOpt.value, isLeap = mOpt.dataset.leap === '1', d = +dSel.value;
    const s = Lunar.toSolar(+ySel.value, m, d, isLeap);
    if (!s) { toast('请选择有效的农历日期'); return; }
    date = s.y + '-' + String(s.m).padStart(2, '0') + '-' + String(s.d).padStart(2, '0');
    lunar = { y: +ySel.value, m, d, isLeap };
  } else {
    date = document.getElementById(p + '_date').value;
    if (!date) { toast('请选择日期'); return; }
  }
  rec.name = name;
  rec.type = document.getElementById(p + '_type').value;
  rec.date = date;
  rec.isLunar = isLunar;
  rec.lunar = lunar;
  Store.set('anniversaries', records);
  this._editingAnnivId = null;
  App.modules.anniversaries(document.getElementById('contentArea'));
  toast('已保存修改');
};

App.delAnniversary = function(id) {
  Store.markDeleted('anniversaries', id);
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
        const PENCIL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
        if (App._editingPeriodId === r.id) {
          const p = 'pe_' + r.id;
          return `<div class="mini-item mini-editing">
            <div class="todo-edit-form" style="width:100%">
              <div class="todo-edit-row">
                <input type="date" id="${p}_start" value="${r.startDate}">
                <input type="date" id="${p}_end" value="${r.endDate || ''}">
              </div>
              <div class="todo-edit-actions">
                <button class="btn btn-primary" onclick="App.savePeriod('${r.id}')">保存</button>
                <button class="btn btn-ghost" onclick="App.cancelPeriodEdit()">取消</button>
              </div>
            </div>
          </div>`;
        }
        return `<div class="mini-item">
          <div class="dot" style="background:var(--accent)"></div>
          <div style="flex:1">
            <span class="font-bold">${U.fmtDateFull(r.startDate)}</span>
            ${r.endDate ? ` ~ ${U.fmtDateFull(r.endDate)}` : ''}
            <span class="badge badge-accent ml-8">${dur}天</span>
          </div>
          <button class="todo-edit" onclick="App.editPeriod('${r.id}')">${PENCIL}</button>
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
  Store.markDeleted('periods', id);
  App.modules.periods(document.getElementById('contentArea'));
  toast('已删除');
};

App.editPeriod = function(id) {
  this._editingPeriodId = id;
  this.modules.periods(document.getElementById('contentArea'));
};

App.cancelPeriodEdit = function() {
  this._editingPeriodId = null;
  this.modules.periods(document.getElementById('contentArea'));
};

App.savePeriod = function(id) {
  const records = Store.get('periods', []);
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  const p = 'pe_' + id;
  const startDate = document.getElementById(p + '_start').value;
  const endDate = document.getElementById(p + '_end').value;
  if (!startDate) { toast('请选择开始日期'); return; }
  if (endDate && endDate < startDate) { toast('结束日期不能早于开始日期'); return; }
  rec.startDate = startDate;
  rec.endDate = endDate || null;
  Store.set('periods', records);
  this._editingPeriodId = null;
  App.modules.periods(document.getElementById('contentArea'));
  toast('已保存修改');
};


/* ============================================================
   MODULE: Customers (客户进展)
   ============================================================ */
App.modules.customers = function(el) {
  const PENCIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>';
  App._showHandled = (App._showHandled === undefined) ? false : App._showHandled;
  const edit = App._editCust || null;

  const newList = Store.get('custNew', []);
  const quoteList = Store.get('custQuote', []);
  const keyList = Store.get('custKey', []);

  const statusText = s => (s === 'replied' ? '已回复' : s === 'called_no_reply' ? '打电话未回复' : '未回复');
  const statusBadge = s => (s === 'replied' ? 'badge-success' : s === 'called_no_reply' ? 'badge-accent' : 'badge-warning');
  const isHidden = c => (c.status === 'replied' || c.status === 'called_no_reply');

  const newRow = (c) => {
    if (edit && edit.kind === 'new' && edit.id === c.id) {
      return `
      <div class="cust-row cust-editing">
        <div class="todo-edit-form">
          <input class="todo-edit-input" id="cn_title" value="${U.escape(c.title)}" placeholder="标题">
          <div class="todo-edit-row">
            <input type="tel" id="cn_phone" value="${U.escape(c.phone || '')}" placeholder="电话">
            <input type="email" id="cn_email" value="${U.escape(c.email || '')}" placeholder="邮箱">
          </div>
          <div class="todo-edit-row">
            <input type="date" id="cn_first" value="${c.firstDate || U.today()}">
            <select id="cn_status" onchange="App.toggleNewFollowEdit()">
              <option value="unreplied"${c.status !== 'replied' && c.status !== 'called_no_reply' ? ' selected' : ''}>未回复</option>
              <option value="replied"${c.status === 'replied' ? ' selected' : ''}>已回复</option>
              <option value="called_no_reply"${c.status === 'called_no_reply' ? ' selected' : ''}>打电话未回复</option>
            </select>
            <select id="cn_follow" ${c.status !== 'unreplied' ? 'disabled' : ''}>
              <option value="3"${c.followDays == 3 ? ' selected' : ''}>3 天</option>
              <option value="7"${c.followDays == 7 ? ' selected' : ''}>7 天</option>
              <option value="15"${c.followDays == 15 ? ' selected' : ''}>15 天</option>
              <option value="30"${c.followDays == 30 ? ' selected' : ''}>30 天</option>
            </select>
          </div>
          <div class="todo-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="App.saveCustNew('${c.id}')">保存</button>
            <button class="btn btn-soft btn-sm" onclick="App.cancelCustEdit()">取消</button>
          </div>
        </div>
      </div>`;
    }
    const nf = c.nextFollow;
    const ndays = nf ? U.daysUntil(nf) : null;
    const nfText = nf ? U.fmtDate(nf) + (ndays === 0 ? '（今天）' : ndays > 0 ? `（剩 ${ndays} 天）` : `（已逾期 ${-ndays} 天）`) : '';
    return `
    <div class="cust-row">
      <div class="cust-main">
        <div class="cust-title">${U.escape(c.title)}</div>
        <div class="cust-meta">
          ${c.phone ? `<span class="text-sm text-light">电话 ${U.escape(c.phone)}</span>` : ''}
          ${c.email ? `<span class="text-sm text-light">邮箱 ${U.escape(c.email)}</span>` : ''}
          ${c.firstDate ? `<span class="text-sm text-light">首次联系 ${U.fmtDate(c.firstDate)}</span>` : ''}
          ${nfText ? `<span class="text-sm text-light">下次跟进 ${nfText}</span>` : ''}
        </div>
      </div>
      <span class="badge ${statusBadge(c.status)}">${statusText(c.status)}</span>
      <div class="cust-actions">
        <button class="todo-edit" title="编辑" onclick="App.editCust('new','${c.id}')">${PENCIL}</button>
        <button class="todo-delete" title="删除" onclick="App.delCust('new','${c.id}')">${TRASH}</button>
      </div>
    </div>`;
  };

  const quoteRow = (c) => {
    const nf = c.nextFollow;
    const days = nf ? U.daysUntil(nf) : null;
    const nfText = nf ? U.fmtDate(nf) + (days === 0 ? '（今天）' : days > 0 ? `（剩 ${days} 天）` : `（已逾期 ${-days} 天）`) : '—';
    if (edit && edit.kind === 'quote' && edit.id === c.id) {
      return `
      <div class="cust-row cust-editing">
        <div class="todo-edit-form">
          <input class="todo-edit-input" id="cq_title" value="${U.escape(c.title)}" placeholder="报价项目">
          <div class="todo-edit-row">
            <input type="tel" id="cq_phone" value="${U.escape(c.phone || '')}" placeholder="电话">
            <input type="email" id="cq_email" value="${U.escape(c.email || '')}" placeholder="邮箱">
          </div>
          <div class="todo-edit-row">
            <input type="date" id="cq_quote" value="${c.quoteDate || U.today()}">
            <select id="cq_follow">
              <option value="3"${c.followDays == 3 ? ' selected' : ''}>3 天</option>
              <option value="7"${c.followDays == 7 ? ' selected' : ''}>7 天</option>
              <option value="15"${c.followDays == 15 ? ' selected' : ''}>15 天</option>
              <option value="30"${c.followDays == 30 ? ' selected' : ''}>30 天</option>
            </select>
          </div>
          <div class="todo-edit-row">
            <input type="date" id="cq_last" value="${c.lastFollowDate || ''}">
            <input type="text" id="cq_fb" value="${U.escape(c.lastFeedback || '')}" placeholder="最新跟进反馈">
          </div>
          <div class="todo-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="App.saveCustQuote('${c.id}')">保存</button>
            <button class="btn btn-soft btn-sm" onclick="App.cancelCustEdit()">取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="cust-row">
      <div class="cust-main">
        <div class="cust-title">${U.escape(c.title)}</div>
        <div class="cust-meta">
          ${c.phone ? `<span class="text-sm text-light">电话 ${U.escape(c.phone)}</span>` : ''}
          ${c.email ? `<span class="text-sm text-light">邮箱 ${U.escape(c.email)}</span>` : ''}
          <span class="text-sm text-light">报价 ${c.quoteDate ? U.fmtDate(c.quoteDate) : '—'}</span>
          <span class="text-sm text-light">下次跟进 ${nfText}</span>
          ${c.lastFollowDate ? `<span class="text-sm text-light">最新跟进 ${U.fmtDate(c.lastFollowDate)}</span>` : ''}
          ${c.lastFeedback ? `<span class="text-sm text-light">反馈 ${U.escape(c.lastFeedback)}</span>` : ''}
        </div>
      </div>
      <div class="cust-actions">
        <button class="todo-edit" title="编辑" onclick="App.editCust('quote','${c.id}')">${PENCIL}</button>
        <button class="todo-delete" title="删除" onclick="App.delCust('quote','${c.id}')">${TRASH}</button>
      </div>
    </div>`;
  };

  const keyRow = (c) => {
    if (edit && edit.kind === 'key' && edit.id === c.id) {
      return `
      <div class="cust-row cust-editing">
        <div class="todo-edit-form">
          <input class="todo-edit-input" id="ck_title" value="${U.escape(c.title)}" placeholder="标题">
          <div class="todo-edit-row">
            <input type="tel" id="ck_phone" value="${U.escape(c.phone || '')}" placeholder="电话">
            <input type="email" id="ck_email" value="${U.escape(c.email || '')}" placeholder="邮箱">
          </div>
          <div class="todo-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="App.saveCustKey('${c.id}')">保存</button>
            <button class="btn btn-soft btn-sm" onclick="App.cancelCustEdit()">取消</button>
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="cust-row">
      <div class="cust-main">
        <div class="cust-title">${U.escape(c.title)}</div>
        <div class="cust-meta">
          ${c.phone ? `<span class="text-sm text-light">电话 ${U.escape(c.phone)}</span>` : ''}
          ${c.email ? `<span class="text-sm text-light">邮箱 ${U.escape(c.email)}</span>` : ''}
        </div>
      </div>
      <div class="cust-actions">
        <button class="todo-edit" title="编辑" onclick="App.editCust('key','${c.id}')">${PENCIL}</button>
        <button class="todo-delete" title="删除" onclick="App.delCust('key','${c.id}')">${TRASH}</button>
      </div>
    </div>`;
  };

  const visibleNew = newList.filter(c => !isHidden(c));
  const hiddenNew = newList.filter(isHidden);

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon-dot"></span>新建联客户</div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>标题</label><input type="text" id="n_title" placeholder="客户/公司名称"></div>
        <div class="form-group" style="flex:1"><label>电话</label><input type="tel" id="n_phone" placeholder="电话"></div>
        <div class="form-group" style="flex:1"><label>邮箱</label><input type="email" id="n_email" placeholder="邮箱"></div>
        <div class="form-group" style="flex:1"><label>首次联系日期</label><input type="date" id="n_first" value="${U.today()}"></div>
        <div class="form-group" style="flex:1"><label>状态</label><select id="n_status" onchange="App.toggleNewFollow()">
          <option value="unreplied" selected>未回复</option>
          <option value="replied">已回复</option>
          <option value="called_no_reply">打电话未回复</option>
        </select></div>
        <div class="form-group" style="flex:1"><label>下次跟进（天）</label><select id="n_follow">
          <option value="3">3 天</option>
          <option value="7" selected>7 天</option>
          <option value="15">15 天</option>
          <option value="30">30 天</option>
        </select></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="App.addCustNew()">添加</button></div>
      </div>
      <div class="mt-12">
        ${visibleNew.length || hiddenNew.length ? visibleNew.map(newRow).join('') + (App._showHandled ? hiddenNew.map(c => `<div class="cust-done">${newRow(c)}</div>`).join('') : '') : '<div class="empty-state"><p>暂无新建联客户</p></div>'}
        ${hiddenNew.length ? `<div class="mt-12"><button class="btn btn-soft btn-sm" onclick="App.toggleShowHandled()">${App._showHandled ? '隐藏已处理' : '显示已处理 (' + hiddenNew.length + ')'}</button></div>` : ''}
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>近期报价客户</div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>报价项目</label><input type="text" id="q_title" placeholder="报价项目"></div>
        <div class="form-group" style="flex:1"><label>电话</label><input type="tel" id="q_phone" placeholder="电话"></div>
        <div class="form-group" style="flex:1"><label>邮箱</label><input type="email" id="q_email" placeholder="邮箱"></div>
        <div class="form-group" style="flex:1"><label>报价日期</label><input type="date" id="q_quote" value="${U.today()}"></div>
        <div class="form-group" style="flex:1"><label>下次跟进（天）</label><select id="q_follow">
          <option value="3">3 天</option>
          <option value="7" selected>7 天</option>
          <option value="15">15 天</option>
          <option value="30">30 天</option>
        </select></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="App.addCustQuote()">添加</button></div>
      </div>
      <div class="mt-12">
        ${quoteList.length ? quoteList.map(quoteRow).join('') : '<div class="empty-state"><p>暂无报价客户</p></div>'}
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-title"><span class="icon-dot"></span>重点客户</div>
      <div class="form-row">
        <div class="form-group" style="flex:2"><label>标题</label><input type="text" id="k_title" placeholder="客户/公司名称"></div>
        <div class="form-group" style="flex:1"><label>电话</label><input type="tel" id="k_phone" placeholder="电话"></div>
        <div class="form-group" style="flex:1"><label>邮箱</label><input type="email" id="k_email" placeholder="邮箱"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="App.addCustKey()">添加</button></div>
      </div>
      <div class="mt-12">
        ${keyList.length ? keyList.map(keyRow).join('') : '<div class="empty-state"><p>暂无重点客户</p></div>'}
      </div>
    </div>
  `;
};

App.editCust = function(kind, id) {
  App._editCust = { kind, id };
  App.modules.customers(document.getElementById('contentArea'));
};
App.cancelCustEdit = function() {
  App._editCust = null;
  App.modules.customers(document.getElementById('contentArea'));
};
App.toggleShowHandled = function() {
  App._showHandled = !App._showHandled;
  App.modules.customers(document.getElementById('contentArea'));
};
App.toggleNewFollow = function() {
  const st = document.getElementById('n_status');
  const fl = document.getElementById('n_follow');
  if (st && fl) fl.disabled = (st.value !== 'unreplied');
};
App.toggleNewFollowEdit = function() {
  const st = document.getElementById('cn_status');
  const fl = document.getElementById('cn_follow');
  if (st && fl) fl.disabled = (st.value !== 'unreplied');
};
App.delCust = function(kind, id) {
  const map = { new: 'custNew', quote: 'custQuote', key: 'custKey' };
  Store.markDeleted(map[kind], id);
  App.syncNewTodos();
  App.syncQuoteTodos();
  App.modules.customers(document.getElementById('contentArea'));
  toast('已删除');
};
App.addCustNew = function() {
  const title = document.getElementById('n_title').value.trim();
  if (!title) { toast('请输入标题'); return; }
  const status = document.getElementById('n_status').value;
  const firstDate = document.getElementById('n_first').value;
  const followSel = document.getElementById('n_follow');
  const followDays = (status === 'unreplied' && followSel) ? +followSel.value : 0;
  const list = Store.get('custNew', []);
  list.push({
    id: U.uid(), title,
    phone: document.getElementById('n_phone').value.trim(),
    email: document.getElementById('n_email').value.trim(),
    firstDate, status, followDays,
    nextFollow: (status === 'unreplied' && followSel) ? U.addDays(firstDate, followDays) : '',
    created: Date.now(), updated: Date.now()
  });
  Store.set('custNew', list);
  App.syncNewTodos();
  App.modules.customers(document.getElementById('contentArea'));
  toast('已添加');
};
App.saveCustNew = function(id) {
  const list = Store.get('custNew', []);
  const c = list.find(x => x.id === id);
  if (!c) return;
  const title = document.getElementById('cn_title').value.trim();
  if (!title) { toast('请输入标题'); return; }
  const status = document.getElementById('cn_status').value;
  const firstDate = document.getElementById('cn_first').value;
  const followSel = document.getElementById('cn_follow');
  const followDays = (status === 'unreplied' && followSel) ? +followSel.value : 0;
  c.title = title;
  c.phone = document.getElementById('cn_phone').value.trim();
  c.email = document.getElementById('cn_email').value.trim();
  c.firstDate = firstDate;
  c.status = status;
  c.followDays = followDays;
  c.nextFollow = (status === 'unreplied' && followSel) ? U.addDays(firstDate, followDays) : '';
  c.updated = Date.now();
  Store.set('custNew', list);
  App.syncNewTodos();
  App._editCust = null;
  App.modules.customers(document.getElementById('contentArea'));
  toast('已保存修改');
};
App.addCustQuote = function() {
  const title = document.getElementById('q_title').value.trim();
  if (!title) { toast('请输入报价项目'); return; }
  const quoteDate = document.getElementById('q_quote').value || U.today();
  const followDays = +document.getElementById('q_follow').value;
  const list = Store.get('custQuote', []);
  list.push({
    id: U.uid(), title,
    phone: document.getElementById('q_phone').value.trim(),
    email: document.getElementById('q_email').value.trim(),
    quoteDate, followDays,
    nextFollow: U.addDays(quoteDate, followDays),
    lastFollowDate: '', lastFeedback: '',
    created: Date.now(), updated: Date.now()
  });
  Store.set('custQuote', list);
  App.syncQuoteTodos();
  App.modules.customers(document.getElementById('contentArea'));
  toast('已添加');
};
App.saveCustQuote = function(id) {
  const list = Store.get('custQuote', []);
  const c = list.find(x => x.id === id);
  if (!c) return;
  const title = document.getElementById('cq_title').value.trim();
  if (!title) { toast('请输入报价项目'); return; }
  const quoteDate = document.getElementById('cq_quote').value || U.today();
  const followDays = +document.getElementById('cq_follow').value;
  c.title = title;
  c.phone = document.getElementById('cq_phone').value.trim();
  c.email = document.getElementById('cq_email').value.trim();
  c.quoteDate = quoteDate;
  c.followDays = followDays;
  c.nextFollow = U.addDays(quoteDate, followDays);
  c.lastFollowDate = document.getElementById('cq_last').value;
  c.lastFeedback = document.getElementById('cq_fb').value.trim();
  c.updated = Date.now();
  Store.set('custQuote', list);
  App.syncQuoteTodos();
  App._editCust = null;
  App.modules.customers(document.getElementById('contentArea'));
  toast('已保存修改');
};
App.addCustKey = function() {
  const title = document.getElementById('k_title').value.trim();
  if (!title) { toast('请输入标题'); return; }
  const list = Store.get('custKey', []);
  list.push({
    id: U.uid(), title,
    phone: document.getElementById('k_phone').value.trim(),
    email: document.getElementById('k_email').value.trim(),
    created: Date.now(), updated: Date.now()
  });
  Store.set('custKey', list);
  App.modules.customers(document.getElementById('contentArea'));
  toast('已添加');
};
App.saveCustKey = function(id) {
  const list = Store.get('custKey', []);
  const c = list.find(x => x.id === id);
  if (!c) return;
  const title = document.getElementById('ck_title').value.trim();
  if (!title) { toast('请输入标题'); return; }
  c.title = title;
  c.phone = document.getElementById('ck_phone').value.trim();
  c.email = document.getElementById('ck_email').value.trim();
  c.updated = Date.now();
  Store.set('custKey', list);
  App._editCust = null;
  App.modules.customers(document.getElementById('contentArea'));
  toast('已保存修改');
};

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
