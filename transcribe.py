# transcribe.py - Whisper transcription module

import sys
import io
import whisper
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

    # Load the Whisper model
    try:
        model = whisper.load_model(WHISPER_MODEL, device=device)
        logger.info(f"Loaded model: {WHISPER_MODEL}")
    except Exception as e:
        error_response = {"error": f"Error loading model: {str(e)}"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

    # Transcribe the audio with English as the specified language
    try:
        result = model.transcribe(audio_file_path, language='en')
        transcription = result["text"].strip()
        success_response = {"transcription": transcription}
        print(json.dumps(success_response))  # Send JSON to stdout
    except Exception as e:
        error_response = {"error": f"Error during transcription: {str(e)}"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()