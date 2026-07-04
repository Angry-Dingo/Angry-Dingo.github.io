import json
with open('data/fund_holdings.json','r') as f:
    data = json.load(f)
funds = data.get('results',{})
print(f"共有 {data.get('totalFunds')} 只基金有持仓数据")
for code, h in sorted(funds.items()):
    hold = h.get('holdings',[])
    names = [x.get('name','') for x in hold[:3]]
    total_holdings = h.get('totalHoldings',0)
    print(f"{code} {h.get('codeName',''):20s} 持仓数={total_holdings} 前3={names}")