import os, base64, json, requests, socket

# Test DNS
try:
    ip = socket.getaddrinfo('api.github.com', 443)[0][4][0]
    print(f'DNS resolved: {ip}')
except:
    print('DNS failed, trying alternative...')
    # Force IPv4
    import urllib3.util.connection as urllib_connection
    original_connect = urllib_connection.create_connection
    def ipv4_connect(address, **kwargs):
        host, port = address
        for res in socket.getaddrinfo(host, port, socket.AF_INET):
            af, socktype, proto, canonname, sa = res
            sock = socket.socket(af, socktype, proto)
            sock.settimeout(10)
            try:
                sock.connect(sa)
                return sock
            except:
                sock.close()
        return original_connect(address, **kwargs)
    urllib_connection.create_connection = ipv4_connect

# Read the index.html file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
print(f'File size: {len(content)} chars')

# Update via API
owner = "Angry-Dingo"
repo = "Angry-Dingo.github.io"
path = "index.html"
branch = "dev"
token = os.environ.get("GITHUB_TOKEN", "")

url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json"}

try:
    resp = requests.get(url, headers=headers, timeout=15)
    print(f'GET status: {resp.status_code}')
    if resp.status_code == 200:
        sha = resp.json()["sha"]
        print(f'Current SHA: {sha}')
        payload = {
            "message": "fix: 东财EM_CODES添加hkHSI恒生指数作为降级后备，东财返回null时不覆盖腾讯有效数据",
            "content": base64.b64encode(content.encode('utf-8')).decode('utf-8'),
            "sha": sha,
            "branch": branch
        }
        put_resp = requests.put(url, headers=headers, json=payload, timeout=30)
        print(f'PUT status: {put_resp.status_code}')
        if put_resp.status_code in [200, 201]:
            print('Success!')
            print(json.dumps(put_resp.json(), indent=2)[:500])
        else:
            print(f'Error: {put_resp.text[:500]}')
    else:
        print(f'GET error: {resp.text[:500]}')
except Exception as e:
    print(f'Exception: {e}')
    # Print more details
    import traceback
    traceback.print_exc()