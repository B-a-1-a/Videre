"""
Whisper transcription on Qualcomm Snapdragon NPU via onnxruntime-qnn.

Uses pre-compiled ONNX models with embedded QNN context binaries.
Downloads from Qualcomm AI Hub if models are not found locally.

Install:  pip install onnxruntime-qnn transformers
Run:      python -m nexa_caption_lab.whisper_npu path/to/video.mp4
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np

from nexa_caption_lab.caption_video import (
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
    CaptionSegment,
    extract_audio_with_ffmpeg,
    normalize_segments,
    to_plain_data,
    write_caption_files,
)
from nexa_caption_lab.whisper_qai import _subdivide_segments_by_words

MODEL_DIR_NAME = "whisper_small_quantized-precompiled_qnn_onnx-w8a16-qualcomm_snapdragon_x_elite"
MODEL_ZIP_URL = (
    "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/"
    "models/whisper_small_quantized/releases/v0.46.0/"
    "whisper_small_quantized-precompiled_qnn_onnx-w8a16-qualcomm_snapdragon_x_elite.zip"
)
HF_WHISPER_ID = "openai/whisper-small"

NUM_DECODER_BLOCKS = 12
NUM_HEADS = 12
HEAD_DIM = 64
ATTENTION_DIM = NUM_HEADS * HEAD_DIM  # 768
AUDIO_EMB_LEN = 1500
MEAN_DECODE_LEN = 200
MASK_NEG_UINT16 = 0       # float -100.0 quantizes to uint16 0
UNMASK_UINT16 = 65535     # float 0.0 quantizes to uint16 65535
SAMPLE_RATE = 16000


QNN_CTX_ZIP_URL = (
    "https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/"
    "models/whisper_small_quantized/releases/v0.46.0/"
    "whisper_small_quantized-qnn_context_binary-w8a16-qualcomm_snapdragon_x_elite.zip"
)
QNN_CTX_DIR_NAME = "whisper_small_quantized-qnn_context_binary-w8a16-qualcomm_snapdragon_x_elite"


def _find_model_dir(models_root: Path) -> Path:
    """Locate or download the pre-compiled ONNX model directory.

    Each ONNX wrapper needs its context binary as ``model.bin`` in the same
    directory.  The layout is:
        models_root/whisper-small-npu/encoder/WhisperSmallEncoderQuantizable.onnx
        models_root/whisper-small-npu/encoder/model.bin
        models_root/whisper-small-npu/decoder/WhisperSmallDecoderQuantizable.onnx
        models_root/whisper-small-npu/decoder/model.bin
    """
    model_dir = models_root / "whisper-small-npu"
    encoder_onnx = model_dir / "encoder" / "WhisperSmallEncoderQuantizable.onnx"
    if encoder_onnx.exists():
        return model_dir

    print("Pre-compiled NPU models not found. Downloading...", file=sys.stderr)
    import io
    import shutil
    import urllib.request
    import zipfile

    model_dir.mkdir(parents=True, exist_ok=True)

    # Download both archives
    onnx_zip_data = _download(MODEL_ZIP_URL)
    ctx_zip_data = _download(QNN_CTX_ZIP_URL)

    # Extract ONNX wrappers
    with zipfile.ZipFile(io.BytesIO(onnx_zip_data)) as zf:
        zf.extractall(model_dir)
    # Extract QNN context binaries
    with zipfile.ZipFile(io.BytesIO(ctx_zip_data)) as zf:
        zf.extractall(model_dir)

    # Assemble encoder/ and decoder/ subdirectories
    onnx_src = model_dir / MODEL_DIR_NAME
    ctx_src = model_dir / QNN_CTX_DIR_NAME

    for role, onnx_name, bin_name in [
        ("encoder", "WhisperSmallEncoderQuantizable.onnx", "WhisperSmallEncoderQuantizable.bin"),
        ("decoder", "WhisperSmallDecoderQuantizable.onnx", "WhisperSmallDecoderQuantizable.bin"),
    ]:
        dest = model_dir / role
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(onnx_src / onnx_name, dest / onnx_name)
        shutil.copy2(ctx_src / bin_name, dest / "model.bin")

    print(f"Models ready at {model_dir}", file=sys.stderr)
    return model_dir


def _download(url: str) -> bytes:
    import urllib.request
    print(f"  Downloading {url.split('/')[-1]}...", file=sys.stderr)
    with urllib.request.urlopen(url) as resp:
        return resp.read()


def _create_session(onnx_path: Path, backend: str = "htp"):
    """Create an ONNX Runtime inference session with QNN EP."""
    import onnxruntime as ort

    providers = [
        (
            "QNNExecutionProvider",
            {
                "backend_type": backend,
            },
        ),
        "CPUExecutionProvider",
    ]
    sess_options = ort.SessionOptions()
    sess_options.log_severity_level = 3  # suppress verbose logs
    session = ort.InferenceSession(
        str(onnx_path),
        sess_options=sess_options,
        providers=providers,
    )
    active_providers = session.get_providers()
    print(f"  {onnx_path.name}: providers={active_providers}", file=sys.stderr)
    return session


def transcribe_with_npu(
    audio_path: Path,
    models_root: Path,
    chunk_size: int | None = None,
    backend: str = "htp",
) -> dict:
    """
    Transcribe audio using Whisper on the Snapdragon NPU.
    """
    from transformers import WhisperProcessor

    model_dir = _find_model_dir(models_root)
    encoder_path = model_dir / "encoder" / "WhisperSmallEncoderQuantizable.onnx"
    decoder_path = model_dir / "decoder" / "WhisperSmallDecoderQuantizable.onnx"

    print(f"Loading NPU sessions ({backend} backend)...", file=sys.stderr)
    enc_session = _create_session(encoder_path, backend)
    dec_session = _create_session(decoder_path, backend)

    processor = WhisperProcessor.from_pretrained(HF_WHISPER_ID)
    tokenizer = processor.tokenizer

    # Load and preprocess audio
    import scipy.io.wavfile as wavfile
    sr, audio_data = wavfile.read(str(audio_path))
    audio_data = audio_data.astype(np.float32)
    if audio_data.ndim == 2:
        audio_data = audio_data.mean(-1)
    if audio_data.max() > 1.0 or audio_data.min() < -1.0:
        audio_data = audio_data / 32768.0

    audio_duration = len(audio_data) / sr

    # Extract mel features
    features = processor(
        audio_data, sampling_rate=sr, return_tensors="np"
    )
    input_features = features.input_features.astype(np.float32)

    # Quantize encoder input to uint16 per metadata
    enc_meta = _read_quant_params("input_features", is_encoder=True)
    input_features_q = _quantize(input_features, enc_meta["scale"], enc_meta["zp"], np.uint16)

    print("Running encoder on NPU...", file=sys.stderr)
    enc_outputs = enc_session.run(None, {"input_features": input_features_q})

    # Map encoder output names
    enc_output_names = [o.name for o in enc_session.get_outputs()]
    kv_cache_cross = {}
    for name, val in zip(enc_output_names, enc_outputs):
        kv_cache_cross[name] = val

    # Decoder autoregressive loop
    sot_token = processor.tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
    eot_token = processor.tokenizer.eos_token_id
    transcribe_token = processor.tokenizer.convert_tokens_to_ids("<|transcribe|>")
    notimestamps_token = processor.tokenizer.convert_tokens_to_ids("<|notimestamps|>")

    # Whisper decoder start sequence: SOT, language, transcribe, notimestamps
    # For simplicity, start with SOT and let the model handle the rest
    current_token = sot_token

    # Init self-attention KV caches (zeros, uint8, zero_point=128)
    kv_cache_self = {}
    for i in range(NUM_DECODER_BLOCKS):
        kv_cache_self[f"k_cache_self_{i}_in"] = np.full(
            (NUM_HEADS, 1, HEAD_DIM, MEAN_DECODE_LEN - 1),
            128, dtype=np.uint8,
        )
        kv_cache_self[f"v_cache_self_{i}_in"] = np.full(
            (NUM_HEADS, 1, MEAN_DECODE_LEN - 1, HEAD_DIM),
            128, dtype=np.uint8,
        )

    # Attention mask: start fully masked (0 = float -100.0)
    attention_mask = np.zeros(
        (1, 1, 1, MEAN_DECODE_LEN), dtype=np.uint16
    )

    position_ids = np.array([0], dtype=np.int32)
    output_token_ids = [current_token]

    print("Running decoder on NPU...", file=sys.stderr)
    for n in range(MEAN_DECODE_LEN - 1):
        input_ids = np.array([[current_token]], dtype=np.int32)

        # Unmask current position (65535 = float 0.0 = "attend here")
        attention_mask[0, 0, 0, MEAN_DECODE_LEN - n - 1] = UNMASK_UINT16

        # Build decoder feed dict
        feed = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            **kv_cache_self,
            **kv_cache_cross,
            "position_ids": position_ids,
        }

        dec_outputs = dec_session.run(None, feed)

        # Parse outputs: logits + updated self KV caches
        dec_output_names = [o.name for o in dec_session.get_outputs()]
        outputs_map = dict(zip(dec_output_names, dec_outputs))

        # Dequantize logits from uint16
        logits_q = outputs_map["logits"]  # [1, 51865, 1, 1]
        logits_scale = 0.0012925398768857121
        logits_zp = 17867
        logits = (logits_q.astype(np.float32) - logits_zp) * logits_scale
        logits = logits.squeeze()  # [51865]

        next_token = int(np.argmax(logits))
        output_token_ids.append(next_token)

        if next_token == eot_token:
            break

        # Update self KV caches from decoder outputs
        for i in range(NUM_DECODER_BLOCKS):
            kv_cache_self[f"k_cache_self_{i}_in"] = outputs_map[f"k_cache_self_{i}_out"]
            kv_cache_self[f"v_cache_self_{i}_in"] = outputs_map[f"v_cache_self_{i}_out"]

        current_token = next_token
        position_ids = np.array([n + 1], dtype=np.int32)

    # Decode tokens to text
    full_text = tokenizer.decode(output_token_ids, skip_special_tokens=True).strip()

    # Build segments using timestamp tokens if present
    timestamp_begin = tokenizer.convert_tokens_to_ids("<|0.00|>")
    segments = _parse_timestamp_tokens(
        output_token_ids, tokenizer, timestamp_begin, audio_duration
    )

    if not segments and full_text:
        segments = [CaptionSegment(start=0.0, end=audio_duration, text=full_text)]

    if chunk_size and segments:
        segments = _subdivide_segments_by_words(segments, chunk_size)

    return {
        "segments": [
            {"start": s.start, "end": s.end, "text": s.text}
            for s in segments
        ],
        "text": full_text,
        "model": HF_WHISPER_ID,
        "backend": f"onnxruntime-qnn ({backend})",
        "token_count": len(output_token_ids),
    }


def _read_quant_params(name: str, is_encoder: bool = True) -> dict:
    """Hardcoded quantization parameters from metadata.yaml."""
    if name == "input_features":
        return {"scale": 4.677007018472068e-05, "zp": 32072}
    return {"scale": 1.0, "zp": 0}


def _quantize(data: np.ndarray, scale: float, zp: int, dtype) -> np.ndarray:
    """Quantize float data to integer representation."""
    quantized = np.round(data / scale + zp).clip(
        np.iinfo(dtype).min, np.iinfo(dtype).max
    ).astype(dtype)
    return quantized


def _parse_timestamp_tokens(
    token_ids: list[int],
    tokenizer,
    timestamp_begin: int,
    audio_duration: float = 0.0,
) -> list[CaptionSegment]:
    """Parse Whisper timestamp tokens to build timed segments."""
    segments = []
    current_text_tokens = []
    seg_start = 0.0
    special_ids = set(tokenizer.all_special_ids)

    for tid in token_ids:
        if tid >= timestamp_begin:
            ts = (tid - timestamp_begin) * 0.02
            if current_text_tokens:
                text = tokenizer.decode(
                    current_text_tokens, skip_special_tokens=True
                ).strip()
                if text:
                    segments.append(CaptionSegment(start=seg_start, end=ts, text=text))
                current_text_tokens = []
            seg_start = ts
        elif tid not in special_ids:
            current_text_tokens.append(tid)

    if current_text_tokens:
        text = tokenizer.decode(
            current_text_tokens, skip_special_tokens=True
        ).strip()
        if text:
            end = audio_duration if audio_duration > seg_start else seg_start + 1.0
            segments.append(CaptionSegment(start=seg_start, end=end, text=text))

    return segments


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Transcribe video/audio on Snapdragon NPU via onnxruntime-qnn."
    )
    parser.add_argument("input", type=Path, help="Path to video or audio file.")
    parser.add_argument(
        "--models-root",
        type=Path,
        default=None,
        help="Root directory containing downloaded NPU models. "
             "Defaults to nexa-caption-lab/models.",
    )
    parser.add_argument(
        "--backend",
        default="htp",
        choices=("htp", "cpu"),
        help="QNN backend: htp for NPU, cpu for testing (default: htp).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory for caption files (default: outputs).",
    )
    parser.add_argument(
        "--output-format",
        choices=("all", "srt", "vtt", "json"),
        default="all",
        help="Output format (default: all).",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=None,
        help="Words per segment (omit for sentence-level).",
    )
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg binary for video.")
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=16_000,
        help="Sample rate when extracting audio from video.",
    )
    args = parser.parse_args()

    input_path = args.input.expanduser().resolve()
    if not input_path.exists():
        parser.error(f"Input file does not exist: {input_path}")

    # Default models root: sibling 'models' directory of the package
    if args.models_root:
        models_root = args.models_root.expanduser().resolve()
    else:
        models_root = Path(__file__).resolve().parent.parent.parent.parent / "models"

    output_dir = args.output_dir.expanduser().resolve()

    try:
        with tempfile.TemporaryDirectory(prefix="nexa-npu-whisper-") as tmp_name:
            temp_dir = Path(tmp_name)
            suffix = input_path.suffix.lower()
            needs_extract = suffix in VIDEO_EXTENSIONS or suffix not in AUDIO_EXTENSIONS
            if needs_extract:
                audio_path = extract_audio_with_ffmpeg(
                    input_path=input_path,
                    ffmpeg_bin=args.ffmpeg_bin,
                    temp_dir=temp_dir,
                    sample_rate=args.sample_rate,
                )
            else:
                audio_path = input_path

            result = transcribe_with_npu(
                audio_path=audio_path,
                models_root=models_root,
                chunk_size=args.chunk_size,
                backend=args.backend,
            )
            segments = normalize_segments([
                CaptionSegment(s["start"], s["end"], s["text"])
                for s in result["segments"]
            ])

            if not segments:
                print("No speech segments detected.", file=sys.stderr)
                return 0

            output_base = output_dir / input_path.stem
            written = write_caption_files(
                output_base=output_base,
                segments=segments,
                raw_result=to_plain_data(result),
                output_format=args.output_format,
            )
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    for path in written:
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
