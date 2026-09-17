# Repository Rules

- After every `git push`, automatically check Railway deployment status and report the result.
  - Check immediately after push, then wait 30s and check again if still deploying
  - Use: `railway status --json | python3 -c "import sys,json; data=json.load(sys.stdin); [print(f\"{svc['node']['serviceName']}: {svc['node'].get('latestDeployment',{}).get('status','N/A')}\") for env in data['environments']['edges'] for svc in env['node']['serviceInstances']['edges']]"`
