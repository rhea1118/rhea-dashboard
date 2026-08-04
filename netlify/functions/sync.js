// Netlify Blobs 同步接口
// GET  /api/sync  -> 返回云端最新数据 { data }
// POST /api/sync  -> 将请求体中的 { data } 与云端现有数据【按 id 并集合并】后写回，
//                    而不是整份覆盖。这是多设备同步正确性的关键：云端始终是所有设备贡献的并集，
//                    不受"谁最后推送"影响，彻底消除「一端新增被另一端覆盖 / 单向不同步」的问题。
//
// 数据存于 site 级 Blob 存储（跨部署持久化），强一致性保证多设备读到的都是最新写入。
import { getStore } from '@netlify/blobs';

const KEY = 'rhea_data_v1';

// 已知「元素带 id 的对象数组」模块：统一按 id 并集 + 删除墓碑合并。
// 注意：客户端（js/app.js）中有一份完全相同的 LIST_MODULES 与合并逻辑，改此处务必同步改客户端。
const LIST_MODULES = new Set([
  'custNew', 'custQuote', 'custKey',
  'todos', 'schedule', 'anniversaries', 'periods', 'health', 'social_data'
]);

function isListModule(k) { return LIST_MODULES.has(k); }
function isMergeableList(v) {
  return Array.isArray(v) && v.length > 0 &&
    v.every(x => x && typeof x === 'object' && !Array.isArray(x) && 'id' in x &&
      (typeof x.id === 'string' || typeof x.id === 'number'));
}
// 条目级时间戳：编辑时间优先，其次创建时间
function itemTs(it) { return it.updated || it.created || 0; }
// 模块级时间戳；模块值为「空」时记 0，绝不反向覆盖真实数据
function modTs(d, k) {
  const v = d[k];
  const empty = v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
  return empty ? 0 : (d['_ts_' + k] || 0);
}
// 合并两份删除墓碑数组（按 id 去重）
function unionDeleted(a, b) {
  const m = new Map();
  const add = (arr) => { if (!Array.isArray(arr)) return; arr.forEach(d => { if (d && d.id != null) m.set(String(d.id), d); }); };
  add(a); add(b);
  return Array.from(m.values());
}
// 按 id 求并集；同 id 取条目级较新者；最后剔除出现在任一墓碑中的 id（删除跨端生效）
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

// 合并两份数据（对称：local/remote 谁是云端、谁是请求方都不影响并集结果）
function mergeData(local, remote) {
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
  // 根时间戳取各模块最大，便于未升级设备过渡
  let max = 0;
  for (const k in merged) if (k.startsWith('_ts_')) max = Math.max(max, merged[k]);
  merged._syncUpdatedAt = max;
  return merged;
}

export default async (req) => {
  const store = getStore('rhea-sync', { consistency: 'strong' });
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (req.method === 'GET') {
    const data = await store.get(KEY, { type: 'json' });
    return new Response(JSON.stringify({ data: data || {} }), { headers });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers });
    }
    const incoming = body && typeof body.data === 'object' ? body.data : {};
    const existing = (await store.get(KEY, { type: 'json' })) || {};
    // 关键：把请求方数据【合并】进云端，而非覆盖。
    // 云端因此始终是所有设备贡献的并集，不会再出现「一端覆盖另一端」。
    const merged = mergeData(existing, incoming);
    await store.set(KEY, JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, merged: true }), { headers });
  }

  return new Response('Method Not Allowed', { status: 405, headers });
};

export const config = {
  path: '/api/sync'
};
