# NVIDIA Whisper 영어 → 한글 번역 프로토타입

## 실행

프로젝트 루트에서 다음을 실행합니다.

```bash
.venv/bin/pip install -r test/requirements.txt
# 프로젝트 최상위 .env에 NVIDIA_API_KEY 입력
chmod +x start.sh stop.sh
./start.sh
```

브라우저에서 <http://127.0.0.1:5000>을 열고 마이크 권한을 허용한 뒤 영어로 말하세요. 중지는 `./stop.sh`입니다.

녹음 중 4초마다 음성 세그먼트를 NVIDIA Whisper에 전송하며, 결과 원문과 한글 번역을 화면에 누적합니다.

무음 구간은 WAV 음량을 먼저 검사해 Whisper에 전송하지 않습니다. 따라서 무음에서 Whisper가 생성하는 `Thank you` 같은 반복적인 환각 문장을 대화 기록에 추가하지 않습니다.

Whisper 원문 생성은 NVIDIA Build의 `openai/whisper-large-v3` Riva gRPC API를 사용합니다. 환경변수는 프로젝트 최상위 `.env`의 `NVIDIA_API_KEY` 또는 `NVIDIA_WHISPER_API`에서 읽습니다. NVIDIA 문서에서 제공하는 Function ID를 기본값으로 넣었으며, 필요하면 `NVIDIA_WHISPER_FUNCTION_ID`로 변경할 수 있습니다. 현재 NVIDIA hosted endpoint에서 Meta Llama 3.1/3.3 70B 모델은 retired 상태이므로, 기본 번역 모델은 현재 동작하는 `nvidia/nemotron-3-super-120b-a12b`로 설정했습니다. 번역 모델은 `NVIDIA_TRANSLATION_MODEL`로 변경할 수 있습니다.
