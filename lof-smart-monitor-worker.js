export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay();
    const cron = event.cron;

    const beijingHour = (hour + 8) % 24;
    const beijingDay = (hour + 8 >= 24) ? (day + 1) % 7 : day;

    console.log(`[LOG] UTC: ${hour}:${minute}, 星期: ${day}, 北京: ${beijingHour}:${minute}, 星期: ${beijingDay}, Cron: ${cron}`);

    // 收盘快照：北京时间 15:00（UTC 07:00），交易日执行
    if (cron.startsWith('0 7') && beijingDay >= 1 && beijingDay <= 5) {
      console.log('[LOG] 执行收盘快照任务');
      ctx.waitUntil(saveDailySnapshot(env));
      return;
    }

    // 使用 startsWith 前缀匹配，兼容 Dashboard 上的各种 cron 变体（如 0 23 * * 0-4 / 0 23 * * *）
    if (cron.startsWith('0 23') || cron.startsWith('10 13')) {
      console.log('[LOG] 执行数据同步任务');
      ctx.waitUntil(syncDataFromGitHub(env));
    } else {
      console.log('[LOG] 执行溢价监控任务');
      ctx.waitUntil(smartMonitor(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/test') {
      ctx.waitUntil(smartMonitor(env, true));
      return new Response('\u6d4b\u8bd5\u5df2\u89e6\u53d1', { status: 200 });
    }
    if (url.pathname === '/sync') {
      ctx.waitUntil(syncDataFromGitHub(env));
      return new Response('\u6570\u636e\u540c\u6b65\u5df2\u89e6\u53d1', { status: 200 });
    }
    if (url.pathname === '/snapshot') {
      ctx.waitUntil(saveDailySnapshot(env));
      return new Response('\u6536\u76d8\u5feb\u7167\u5df2\u89e6\u53d1', { status: 200 });
    }
    return new Response('LOF \u57fa\u91d1\u76d1\u63a7\u670d\u52a1', { status: 200 });
  }
};
