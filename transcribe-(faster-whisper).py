# transcribe.py - Faster Whisper transcription module

import sys
import io
import torch
import warnings
import os
import json
import logging
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Get environment variables - strict loading, no defaults
WHISPER_MODEL = os.getenv('WHISPER_MODEL')
TRANSCRIPTION_DEVICE = os.getenv('TRANSCRIPTION_DEVICE')

# Validate required environment variables
required_vars = ['WHISPER_MODEL', 'TRANSCRIPTION_DEVICE']
missing_vars = [var for var in required_vars if os.getenv(var) is None]

if missing_vars:
    error_msg = f"ERROR: Missing required environment variables: {', '.join(missing_vars)}"
    print(error_msg, file=sys.stderr)
    sys.exit(1)

# Configure logging to send INFO and above to stderr
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)  # Send INFO and above to stderr
    ]
)

logger = logging.getLogger(__name__)

warnings.filterwarnings("ignore")

def main():
    if len(sys.argv) < 2:
        error_response = {"error": "Usage: python transcribe.py <audio_file_path>"}
        print(json.dumps(error_response))
        sys.exit(1)

    audio_file_path = sys.argv[1]

    # Validate audio file path
    if not os.path.isfile(audio_file_path):
        error_response = {"error": f"Audio file does not exist: {audio_file_path}"}
        print(json.dumps(error_response))
        sys.exit(1)

    # Check device availability
    device = TRANSCRIPTION_DEVICE
    if device == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested but not available. Falling back to CPU.")
        device = "cpu"
        
    logger.info(f"Using device: {device}")  # Log to stderr

    # Import faster_whisper here
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        error_response = {"error": "faster_whisper not installed. Run: pip install faster-whisper"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

    # Determine computation type
    compute_type = "float16" if device == "cuda" else "int8"
    
    # Load the Faster Whisper model
    try:
        model = WhisperModel(
            WHISPER_MODEL,
            device=device,
            compute_type=compute_type,
            download_root="./models"  # Cache models locally
        )
        logger.info(f"Loaded model: {WHISPER_MODEL}")
    except Exception as e:
        error_response = {"error": f"Error loading model: {str(e)}"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

    # Transcribe the audio with English as the specified language
    try:
        segments, info = model.transcribe(
            audio_file_path, 
            language='en', 
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500}
        )
        
        # Gather all segment texts
        segments_text = []
        for segment in segments:
            segments_text.append(segment.text)
        
        transcription = " ".join(segments_text).strip()
        
        # If transcription is empty after VAD filtering, try without VAD
        if not transcription:
            segments, info = model.transcribe(
                audio_file_path,
                language='en',
                beam_size=5,
                vad_filter=False
            )
            segments_text = [segment.text for segment in segments]
            transcription = " ".join(segments_text).strip()
        
        success_response = {"transcription": transcription}
        print(json.dumps(success_response))  # Send JSON to stdout
    except Exception as e:
        error_response = {"error": f"Error during transcription: {str(e)}"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()