# PaddleOCR-VL 0.9B for Transitix

Sidecar on **:8101** — document VLM (Romanian + handwriting-friendly), CPU only.
Runs **beside** classic PaddleOCR on :8100 (do not merge the images: Paddle 2.9 vs 3.x).

## Why a second service?

Classic OCR is fast line text. VL 0.9B understands layout / faint handwriting better
but is slower on CPU. Node calls VL only when classic text looks weak.

## Start

```bash
docker compose -f docker-compose.paddle-ocr-vl.yml up -d --build
```

- Health: http://127.0.0.1:8101/health  
- OCR: `POST /ocr/json` with `{ "image_base64": "...", "mime_type": "image/jpeg" }`

First request downloads models into the Docker volumes (several minutes).

## Wire Transitix

In `server/.env`:

```env
PADDLE_OCR_URL=http://127.0.0.1:8100
PADDLE_OCR_VL_URL=http://127.0.0.1:8101
```

Optional Qwen corrector (host GPU via Ollama / Vulkan on AMD):

```env
VLM_URL=http://127.0.0.1:11434
VLM_MODEL=qwen2.5vl:3b
```

```bash
ollama pull qwen2.5vl:3b
```

## Hardware note

This PC has an AMD GPU. Official PaddleOCR-VL NVIDIA/vLLM images are not used.
VL runs on **CPU** in Docker; Qwen can use the GPU through Ollama on the host.
