// 使用ESM模块导入
import fetch from 'node-fetch';

// 从HTML文件中提取的基金数据
const FUNDS = [
  {code:'160140', ocode:'160140', name:'美国REIT精选LOF', tq:'sz160140', category:'us', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'501021', ocode:'501021', name:'香港中小LOF', tq:'sz501021', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'161124', ocode:'161124', name:'港股小盘LOF', tq:'sz161124', category:'hk', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'164701', ocode:'164701', name:'黄金LOF', tq:'sz164701', category:'cm', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'165513', ocode:'165513', name:'中信保诚商品LOF', tq:'sz165513', category:'cm', quota:'开放', fee:'1.20%', rfee:'1.50%'},
  {code:'161217', ocode:'161217', name:'国投上游资源LOF', tq:'sz161217', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'},
  {code:'161715', ocode:'161715', name:'招商大宗商品LOF', tq:'sz161715', category:'cm', quota:'开放', fee:'1.50%', rfee:'0.50%'}
];

// 基准指数
const BENCH = {
  '160140': 'usRWR', // 道琼斯美国精选REIT指数
  '501021': 'hkHSTECH', // 恒生科技指数
  '161124': 'hkHSSI', // 恒生综合小型股指数
  '164701': 'usGLD', // 黄金ETF
  '165513': 'usGLD', // 黄金ETF
  '161217': 'sh000945', // 中证上游资源产业指数
  '161715': 'sh000066' // 上证大宗商品股票指数
};

// 检查溢价率异常
async function checkAbnormalPremium() {
  const threshold = 3; // 3%的阈值
  const abnormalFunds = [];
  
  // 模拟获取基金数据（实际项目中可以调用API）
  for (const fund of FUNDS) {
    try {
      // 模拟获取场内价格
      const price = 1 + Math.random() * 0.5;
      // 模拟获取预估净值
      const nav = price * (1 + (Math.random() - 0.5) * 0.1);
      // 计算溢价率
      const premium = ((price - nav) / nav) * 100;
      
      console.log(`${fund.code} ${fund.name}: 价格=${price.toFixed(4)}, 净值=${nav.toFixed(4)}, 溢价率=${premium.toFixed(2)}%`);
      
      // 检查是否异常
      if (Math.abs(premium) >= threshold) {
        abnormalFunds.push({
          code: fund.code,
          name: fund.name,
          premium: premium
        });
      }
    } catch (error) {
      console.error(`获取${fund.code} ${fund.name}数据失败:`, error);
    }
  }
  
  return abnormalFunds;
}

// 构建推送消息
function buildPushMessage(funds) {
  const now = new Date().toLocaleString('zh-CN');
  let message = `【LOF基金溢价率异常提醒】\n\n`;
  message += `检测时间: ${now}\n\n`;
  message += `溢价率异常的基金:\n\n`;
  
  funds.forEach(fund => {
    const premiumStr = fund.premium >= 0 ? `+${fund.premium.toFixed(2)}%` : `${fund.premium.toFixed(2)}%`;
    message += `• ${fund.code} ${fund.name}: ${premiumStr}\n`;
  });
  
  message += `\n数据来源: LOF基金监控系统`;
  return message;
}

// 发送消息到飞书机器人
async function sendToFeishu(message) {
  const webhookUrl = process.env.FEISHU_WEBHOOK;
  
  if (!webhookUrl) {
    console.error('飞书webhook地址未配置');
    return;
  }
  
  const feishuMessage = {
    msg_type: 'text',
    content: {
      text: message
    }
  };
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(feishuMessage)
    });
    
    const data = await response.json();
    console.log('飞书消息推送结果:', data);
  } catch (error) {
    console.error('飞书消息推送失败:', error);
  }
}

// 主函数
async function main() {
  console.log('开始检查基金溢价率...');
  
  const abnormalFunds = await checkAbnormalPremium();
  
  if (abnormalFunds.length > 0) {
    console.log(`发现${abnormalFunds.length}只基金溢价率异常`);
    const message = buildPushMessage(abnormalFunds);
    await sendToFeishu(message);
  } else {
    console.log('未发现溢价率异常的基金');
  }
  
  console.log('检查完成');
}

// 运行主函数
main();