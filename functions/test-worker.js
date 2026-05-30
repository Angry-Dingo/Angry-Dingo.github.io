export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(monitor(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/test') {
      console.log('测试飞书推送');
      ctx.waitUntil(monitor(env, true));
      return new Response('测试已触发，请查看飞书', {
        status: 200,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });
    }
    
    return new Response('LOF 测试', {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  },
};

async function monitor(env, isTestMode = false) {
  try {
    console.log('开始发送飞书测试消息');
    const now = new Date();
    const time = now.toLocaleString('zh-CN');
    
    await sendFeishuAlert(env, `🔔 测试消息\n发送时间：${time}\nWorker ID: ${Math.random()}`);
    
    console.log('飞书消息发送成功');
  } catch (error) {
    console.error('发送失败:', error);
    await sendFeishuAlert(env, `❌ 错误: ${error.message}`);
  }
}

async function sendFeishuAlert(env, content) {
  const webhook = env.FEISHU_WEBHOOK;
  if (!webhook) {
    console.error('未配置 FEISHU_WEBHOOK 环境变量');
    throw new Error('未配置 FEISHU_WEBHOOK');
  }
  
  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: content,
      },
    }),
  });
  
  console.log('飞书响应:', response.status, response.statusText);
  
  const respText = await response.text();
  console.log('飞书响应内容:', respText);
  
  if (!response.ok) {
    throw new Error(`飞书发送失败: ${response.status} ${respText}`);
  }
}
