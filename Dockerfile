# Rhea Dashboard - Docker 部署
# Node.js (server.js) + Python (generate_briefing.py) 双运行时
FROM node:22-slim

# 安装 Python 3 和 pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制所有项目文件（.dockerignore 已排除 .venv/node_modules 等）
COPY . .

# 创建 Python 虚拟环境并安装依赖
RUN python3 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir requests feedparser beautifulsoup4

# 确保数据目录和初始文件存在
RUN mkdir -p /app/data

# 如果有 briefing.json 则保留，否则创建占位文件
RUN if [ ! -f /app/data/briefing.json ]; then \
      echo '{"date":"init","message":"等待首次生成"}' > /app/data/briefing.json; \
    fi

EXPOSE 8888

CMD ["node", "server.js"]
