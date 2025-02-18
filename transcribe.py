# transcribe.py

import sys
import io
import whisper
import torch
import warnings
import os
import json
import logging

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

    # Ensure CUDA is available
    if not torch.cuda.is_available():
        error_response = {"error": "CUDA is not available. Please ensure a compatible GPU is installed and CUDA drivers are properly configured."}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

    device = "cuda"
    logger.info(f"Using device: {device}")  # Log to stderr

    # Load the Whisper model on GPU
    try:
        model = whisper.load_model("large-v3-turbo", device=device)  # Ensure the model is loaded on CUDA
    except Exception as e:
        error_response = {"error": f"Error loading model: {str(e)}"}
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)

    # Transcribe the audio with English as the specified language
    try:
        # Remove the 'device' parameter from transcribe
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
