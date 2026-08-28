# CPU image — works on Windows Docker Desktop without NVIDIA.
FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PADDLE_OCR_LANG=latin \
    PADDLE_OCR_USE_GPU=0

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

COPY app.py check_logic.py ./

EXPOSE 8100

# First request downloads detection/recognition models into the image user cache.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100"]
