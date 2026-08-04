// Netlify Blobs 同步接口
// GET  /api/sync  -> 返回云端最新数据 { data }
// POST /api/sync  -> 将请求体中的 { data } 写入云端（覆盖式保存）
//
// 数据存于 site 级 Blob 存储（跨部署持久化），强一致性保证多设备读到的都是最新写入。
import { getStore } from '@netlify/blobs';

const KEY = 'rhea_data_v1';

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
    const data = body && typeof body.data === 'object' ? body.data : {};
    await store.set(KEY, JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  return new Response('Method Not Allowed', { status: 405, headers });
};

export const config = {
  path: '/api/sync'
};
