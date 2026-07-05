// CF Pages Function - 净值历史数据API
// 从 KV 读取基金的历史预估净值和实际净值
// 需要 Cloudflare Pages Dashboard 中配置 KV 绑定：FUNDS_KV
// 调用方式: /api/nav-history?code=161127
// 注意: CF Pages v2 中 nav-history.js 只匹配 /api/nav-history 精确路径
//        子路径模式 /api/nav-history/{code} 不匹配，故使用查询参数

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fundCode = url.searchParams.get('code');

  if (!fundCode) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const key = `nav_hist:${fundCode}`;
    const data = await env.FUNDS_KV?.get(key, 'json') || [];
    const hist = data.slice(-15).sort((a, b) => a.date.localeCompare(b.date));
    return new Response(JSON.stringify(hist), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}