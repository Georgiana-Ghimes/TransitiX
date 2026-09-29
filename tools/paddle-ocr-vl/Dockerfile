# PaddleOCR-VL 0.9B on CPU — works on Windows Docker Desktop without NVIDIA.
# Keep separate from tools/paddle-ocr (Paddle 2.9 classic); the two stacks cannot share one image.
FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PADDLE_OCR_VL_DEVICE=cpu

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install paddlepaddle==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
 && pip install -r requirements.txt

COPY app.py ./

EXPOSE 8101

# First request downloads VL + layout models into the cache volume.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8101"]
