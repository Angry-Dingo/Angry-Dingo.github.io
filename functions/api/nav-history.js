// CF Pages Function - 净值历史数据API
// 从 KV 读取基金的历史预估净值和实际净值
// 需要 Cloudflare Pages Dashboard 中配置 KV 绑定：FUNDS_KV

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fundCode = url.pathname.split('/').pop();

  if (!fundCode) {
    return new Response(JSON.stringify({ error: '缺少基金代码' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  try {
    const key = `nav_hist:${fundCode}`;
    const data = await env.FUNDS_KV?.get(key, 'json') || [];
    // 取最近15天，按日期升序排列
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