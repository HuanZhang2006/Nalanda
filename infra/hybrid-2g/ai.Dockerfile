# Python AI 微服务 —— FastAPI
# 构建上下文 = apps/ai（见 docker-compose.yml: ai.build.context = ../../apps/ai）
# 假设：入口为 app/main.py 中的 app；依赖在 requirements.txt
# apps/ai 已存在并可构建，但解析/生成仍为桩，尚未接入 NestJS 生产链路。

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# 文档解析常用系统依赖（图像/PDF 处理）
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000
# 2G 机器：单 worker，避免内存翻倍；并发靠 BullMQ 串行投递
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
