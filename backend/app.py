import os
import sys
import wave
import subprocess
import tempfile
from array import array
from functools import lru_cache
from pathlib import Path

import riva.client
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
load_dotenv(PROJECT_ROOT / ".env")

app = Flask(
    __name__,
    template_folder=str(FRONTEND_DIR),
    static_folder=str(FRONTEND_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024


def nvidia_api_key() -> str:
    key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_WHISPER_API")
    if not key:
        raise RuntimeError("NVIDIA_API_KEY 또는 NVIDIA_WHISPER_API가 최상위 .env에 필요합니다.")
    return key


@lru_cache(maxsize=1)
def nvidia_client() -> OpenAI:
    return OpenAI(
        api_key=nvidia_api_key(),
        base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        timeout=30,
        max_retries=1,
    )


@lru_cache(maxsize=1)
def riva_service() -> riva.client.ASRService:
    auth = riva.client.Auth(
        uri=os.getenv("NVIDIA_WHISPER_GRPC_URI", "grpc.nvcf.nvidia.com:443"),
        use_ssl=True,
        metadata_args=[
            ["function-id", os.getenv("NVIDIA_WHISPER_FUNCTION_ID", "b702f636-f60c-4a3d-a6f4-f3568c13bd7d")],
            ["authorization", f"Bearer {nvidia_api_key()}"],
        ],
    )
    return riva.client.ASRService(auth)


def transcribe_with_whisper(audio_path: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as wav_file:
        wav_path = wav_file.name
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", audio_path,
                "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wav_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        # Whisper can hallucinate phrases such as "Thank you" on silence.
        # Gate quiet chunks before sending them to the remote ASR service.
        if not has_speech(wav_path):
            return ""
        config = riva.client.RecognitionConfig(
            language_code=os.getenv("NVIDIA_WHISPER_LANGUAGE", "en-US"),
            max_alternatives=1,
            enable_automatic_punctuation=True,
            audio_channel_count=1,
            sample_rate_hertz=16000,
        )
        response = riva_service().offline_recognize(Path(wav_path).read_bytes(), config)
        if not response.results or not response.results[0].alternatives:
            return ""
        return response.results[0].alternatives[0].transcript.strip()
    finally:
        Path(wav_path).unlink(missing_ok=True)


def has_speech(wav_path: str) -> bool:
    with wave.open(wav_path, "rb") as wav_file:
        frames = wav_file.readframes(wav_file.getnframes())
    if not frames:
        return False
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    mean_square = sum(sample * sample for sample in samples) / len(samples)
    rms = mean_square ** 0.5
    peak = max(abs(sample) for sample in samples)
    return rms >= int(os.getenv("AUDIO_RMS_THRESHOLD", "320")) or peak >= int(os.getenv("AUDIO_PEAK_THRESHOLD", "1800"))


def translate_to_korean(english_text: str) -> str:
    response = nvidia_client().chat.completions.create(
        model=os.getenv("NVIDIA_TRANSLATION_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional English-to-Korean translator. "
                    "Translate naturally and preserve the original sentence boundaries. "
                    "Return only the Korean translation, with no explanation."
                ),
            },
            {"role": "user", "content": english_text},
        ],
        temperature=0,
        max_tokens=int(os.getenv("NVIDIA_TRANSLATION_MAX_TOKENS", "512")),
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    return (response.choices[0].message.content or "").strip()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/favicon.ico")
def favicon():
    return "", 204


@app.get("/api/health")
def health():
    return jsonify(status="ok")


@app.post("/api/transcribe")
def transcribe():
    audio = request.files.get("audio")
    if not audio or not audio.filename:
        return jsonify(error="녹음 파일이 없습니다."), 400

    temp_path = None
    try:
        suffix = Path(audio.filename).suffix or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            audio.save(temp_file)
            temp_path = temp_file.name

        english = transcribe_with_whisper(temp_path)
        if not english:
            return jsonify(english="", korean=""), 200
        korean = translate_to_korean(english)
        return jsonify(
            english=english,
            korean=korean,
            segment_index=request.form.get("segment_index", type=int),
            started_at=request.form.get("started_at", type=float),
        )
    except Exception as exc:
        app.logger.exception("transcription failed")
        return jsonify(error=str(exc)), 500
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="음성 구간이 너무 큽니다."), 413


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
        use_reloader=False,
        threaded=True,
    )
