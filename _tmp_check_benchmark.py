import json
with open('data/method_comparison.json','r') as f:
    data = json.load(f)
for r in data['results']:
    if not r.get('sameBenchmark'):
        jm = r.get('jisiluBenchmark','')
        mm = r.get('myBenchmark','')
        jn = r.get('jisiluBenchmarkName','')
        mn = r.get('myBenchmarkName','')
        w = r.get('winner','')
        print(f"{r['code']} {r['name'][:18]:18s} 集思录={jm:12s}({jn[:16]:16s}) 当前={mm:12s}({mn[:16]:16s}) 判定={w}")