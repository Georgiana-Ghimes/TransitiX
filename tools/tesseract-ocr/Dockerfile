# CPU Tesseract sidecar with Romanian tessdata (ron).
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata \
    TESSERACT_LANG=ron+eng

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-ron \
      tesseract-ocr-eng \
      libgl1 \
      libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

COPY app.py ./

EXPOSE 8102

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8102"]
