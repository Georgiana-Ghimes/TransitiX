#!/usr/bin/env python3
"""Export microsoft/trocr-small-handwritten to ONNX (greedy decode only).

ONNX does not support complex beam search easily — greedy is intentional for demo.
Requires torch + transformers + optimum on the *export* machine (not the serve image).

Also writes tokenizer.json (BPE) — required at runtime; without it the decoder
cannot produce text. Pin the same `tokenizers` version in requirements.txt.

Output (OCR_ONNX_DIR, default ~/.paddleocr/onnx):
  trocr-small-handwritten-v1-encoder.onnx
  trocr-small-handwritten-v1-decoder.onnx
  tokenizer.json
  trocr-small-handwritten-v1.sha256

Usage:
  pip install torch transformers optimum onnx onnxruntime tokenizers==0.20.3 sentencepiece pillow
  python scripts/export_trocr_onnx.py
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path


def main() -> int:
    out_dir = Path(
        os.environ.get(
            "OCR_ONNX_DIR",
            Path.home() / ".paddleocr" / "onnx",
        )
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    base = os.environ.get("TROCR_ONNX", "trocr-small-handwritten-v1").strip()
    if base.endswith(".onnx"):
        base = base[: -len(".onnx")]

    print("NOTE: Export uses GREEDY decoding only (no beam search).")
    print("      Slightly lower accuracy than PyTorch beam — acceptable for demo.")
    print(f"Output dir: {out_dir}")

    try:
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    except ImportError as exc:
        print(f"FAIL: need torch+transformers for export: {exc}", file=sys.stderr)
        return 2

    model_id = os.environ.get("TROCR_HF_ID", "microsoft/trocr-small-handwritten")
    print(f"Loading {model_id} …")
    # Slow tokenizer + sentencepiece avoids tiktoken conversion failures on some versions
    try:
        processor = TrOCRProcessor.from_pretrained(model_id)
    except Exception as first:  # noqa: BLE001
        print(f"TrOCRProcessor fast path failed ({first}); retry use_fast=False")
        from transformers import AutoImageProcessor, AutoTokenizer

        image_processor = AutoImageProcessor.from_pretrained(model_id)
        tokenizer = AutoTokenizer.from_pretrained(model_id, use_fast=False)
        processor = TrOCRProcessor(image_processor=image_processor, tokenizer=tokenizer)

    model = VisionEncoderDecoderModel.from_pretrained(model_id)
    model.eval()

    # Save tokenizer (BPE / SentencePiece) — runtime pin tokenizers==0.20.3
    tok_path = out_dir / "tokenizer.json"
    processor.tokenizer.save_pretrained(str(out_dir))
    if not tok_path.is_file():
        # Convert slow → fast json if only sentencepiece artefacts exist
        try:
            from transformers import AutoTokenizer

            fast = AutoTokenizer.from_pretrained(str(out_dir), use_fast=True)
            fast.save_pretrained(str(out_dir))
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: could not force tokenizer.json: {exc}")
    if not tok_path.is_file():
        alt = list(out_dir.glob("tokenizer*.json"))
        if not alt:
            print("FAIL: tokenizer.json not written — decoder cannot produce text", file=sys.stderr)
            return 3
        # Prefer tokenizer.json name for runtime
        if alt[0].name != "tokenizer.json":
            tok_path.write_bytes(alt[0].read_bytes())
    print(f"tokenizer → {tok_path}")

    # Dummy forward for export shapes
    pixel = torch.randn(1, 3, 384, 384)
    with torch.no_grad():
        enc_out = model.encoder(pixel_values=pixel)
        hidden = enc_out.last_hidden_state
        decoder_input = torch.tensor([[model.config.decoder_start_token_id or 0]])
        model.decoder(input_ids=decoder_input, encoder_hidden_states=hidden)

    enc_path = out_dir / f"{base}-encoder.onnx"
    dec_path = out_dir / f"{base}-decoder.onnx"

    print(f"Exporting encoder → {enc_path}")
    torch.onnx.export(
        model.encoder,
        (pixel,),
        str(enc_path),
        input_names=["pixel_values"],
        output_names=["last_hidden_state"],
        dynamic_axes={"pixel_values": {0: "batch"}, "last_hidden_state": {0: "batch", 1: "seq"}},
        opset_version=17,
        dynamo=False,
    )

    class DecWrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, encoder_hidden_states):
            out = self.m.decoder(
                input_ids=input_ids,
                encoder_hidden_states=encoder_hidden_states,
            )
            return out.logits

    print(f"Exporting decoder → {dec_path} (greedy-friendly)")
    wrapped = DecWrapper(model)
    wrapped.eval()
    torch.onnx.export(
        wrapped,
        (decoder_input, hidden),
        str(dec_path),
        input_names=["input_ids", "encoder_hidden_states"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "encoder_hidden_states": {0: "batch", 1: "enc_seq"},
            "logits": {0: "batch", 1: "seq"},
        },
        opset_version=17,
        dynamo=False,
    )

    h = hashlib.sha256()
    for p in (enc_path, dec_path, tok_path):
        h.update(p.read_bytes())
    sha_path = out_dir / f"{base}.sha256"
    sha_path.write_text(h.hexdigest() + "\n", encoding="utf-8")
    print(f"sha256 → {sha_path}")
    print("DONE — copy this folder into the serve volume (OCR_ONNX_DIR).")
    print("Pin tokenizers==0.20.3 in requirements.txt (same as export).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
