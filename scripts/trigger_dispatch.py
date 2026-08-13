"""手动触发 GitHub Actions repository_dispatch，把今日简报推到 GitHub。
Token 和 payload 都从本地文件读取，不硬编码任何敏感信息。
"""
import json
import sys
import urllib.request
import urllib.error

REPO = "rhea1118/rhea-dashboard"
EVENT_TYPE = "generate-trade-brief"
CONFIG_PATH = "deploy-config.json"
BRIEF_PATH = "data/daily-brief.json"


def main():
    # 读取 token
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        token = cfg.get("github", {}).get("token", "")
    except Exception as e:
        print(f"[SKIP] 无法读取 deploy-config.json: {e}")
        sys.exit(1)

    if not token or "REPLACE" in token:
        print("[SKIP] token 未配置，跳过触发")
        sys.exit(0)

    # 读取今日简报 payload
    try:
        with open(BRIEF_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        print(f"[ERROR] 无法读取 {BRIEF_PATH}: {e}")
        sys.exit(1)

    body = json.dumps({
        "event_type": EVENT_TYPE,
        "client_payload": payload
    }).encode("utf-8")

    url = f"https://api.github.com/repos/{REPO}/dispatches"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "WorkBuddy-Auto")
    req.add_header("Content-Type", "application/json")

    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"[GITHUB] ✅ 已触发 {EVENT_TYPE}，HTTP {resp.status}")
        print("[GITHUB] Actions 将在 1-2 分钟内写入 data/daily-brief.json 并推 main")
        print("[GITHUB] 前端读取 GitHub raw，刷新网页即可看到今日更新")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "ignore")[:300]
        print(f"[GITHUB] ❌ 触发失败 HTTP {e.code}: {err}")
        sys.exit(1)
    except Exception as e:
        print(f"[GITHUB] ❌ 触发异常: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
