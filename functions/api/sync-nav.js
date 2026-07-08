// CF Pages Function - 回填实际净值
// 从东方财富 fundgz 接口获取最新实际净值，回填到 KV nav_hist
// 调用方式: /api/sync-nav

export async function onRequest(context) {
  const { env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (!env.FUNDS_KV) {
    return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers });
  }

  try {
    // 从 KV 读取基金列表
    const fundsRaw = await env.FUNDS_KV.get('funds');
    if (!fundsRaw) {
      return new Response(JSON.stringify({ error: '无基金数据' }), { status: 404, headers });
    }
    const fundsData = JSON.parse(fundsRaw);
    const funds = fundsData.funds;

    let updated = 0;
    let failed = 0;
    const details = [];

    // 分批处理（每批10只，避免超时）
    const batchSize = 10;
    for (let i = 0; i < funds.length; i += batchSize) {
      const batch = funds.slice(i, i + batchSize);
      await Promise.all(batch.map(async (fund) => {
        try {
          // 从东方财富 fundgz 接口获取最新实际净值
          let actualNav = null;
          let navDate = null;

          const res = await fetch(`https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          const text = await res.text();
          const match = text.match(/jsonpgz\((.+)\)/);
          if (match) {
            const data = JSON.parse(match[1]);
            if (data.dwjz) actualNav = parseFloat(data.dwjz);
            if (data.jzrq) navDate = data.jzrq;
          }

          // 回退：使用 funds.json 中的 officialNav
          if (actualNav === null && fund.officialNav && fund.navDate) {
            actualNav = fund.officialNav;
            navDate = fund.navDate;
          }

          if (actualNav === null || !navDate) {
            failed++;
            details.push({ code: fund.code, name: fund.name, status: 'no_data' });
            return;
          }

          // 更新 KV 中的净值历史
          const key = `nav_hist:${fund.code}`;
          let history = [];
          try {
            const raw = await env.FUNDS_KV.get(key);
            if (raw) history = JSON.parse(raw);
          } catch (e) {}

          if (history.length === 0) {
            // 没有历史数据，创建新记录
            history.push({ date: navDate, estNav: null, actualNav: actualNav });
          } else {
            let found = false;
            for (const entry of history) {
              if (entry.date === navDate) {
                entry.actualNav = actualNav;
                found = true;
                break;
              }
            }
            if (!found) {
              history.push({ date: navDate, estNav: null, actualNav: actualNav });
            }
            // 保留最新15条
            if (history.length > 15) history = history.slice(-15);
          }

          await env.FUNDS_KV.put(key, JSON.stringify(history));
          updated++;
          details.push({ code: fund.code, name: fund.name, navDate, actualNav, status: 'ok' });
        } catch (e) {
          failed++;
          details.push({ code: fund.code, name: fund.name, status: 'error', error: e.message });
        }
      }));
    }

    return new Response(JSON.stringify({
      success: true,
      total: funds.length,
      updated,
      failed,
      details: details.slice(0, 10) // 只返回前10条详情
    }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
