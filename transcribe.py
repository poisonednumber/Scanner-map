# persistent_transcribe.py
import sys
import io
import torch
import warnings
import os
import json
import logging
import base64
import numpy as np
from pydub import AudioSegment
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

# Import faster_whisper here
try:
    from faster_whisper import WhisperModel
except ImportError:
    error_msg = "faster_whisper not installed. Run: pip install faster-whisper"
    print(error_msg, file=sys.stderr)
    sys.exit(1)

# Check device availability
device = TRANSCRIPTION_DEVICE
# Check for MPS availability on macOS ARM
if device == "mps" and not torch.backends.mps.is_available():
    logger.warning("MPS requested but not available. Checking for CUDA...")
    if torch.cuda.is_available():
        logger.warning("CUDA is available, falling back to CUDA.")
        device = "cuda"
    else:
        logger.warning("CUDA not available, falling back to CPU.")
        device = "cpu"
elif device == "cuda" and not torch.cuda.is_available():
    logger.warning("CUDA requested but not available. Falling back to CPU.")
    device = "cpu"

logger.info(f"Using device: {device}")

# Determine computation type
# Use float32 for MPS, float16 for CUDA, int8 for CPU
if device == "mps":
    compute_type = "float32"
    logger.info("Using float32 compute type for MPS device.")
elif device == "cuda":
    compute_type = "float16"
    logger.info("Using float16 compute type for CUDA device.")
else:
    compute_type = "int8"
    logger.info("Using int8 compute type for CPU device.")

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
    error_msg = f"Error loading model: {str(e)}"
    print(error_msg, file=sys.stderr)
    sys.exit(1)

# Signal that the model is loaded and ready
print(json.dumps({"ready": True}))
sys.stdout.flush()

# Main loop to process commands
while True:
    try:
        # Read command from stdin
        line = sys.stdin.readline().strip()
        if not line:
            continue

        command = json.loads(line)
        request_id = command.get('id')

        if not request_id:
            logger.error(f"Command missing 'id': {line}")
            continue

        # Determine input type: path or base64 data
        audio_input = None
        input_type = None
        error_detail = None

        if command.get('command') == 'transcribe':
            if 'path' in command:
                audio_file_path = command['path']
                if not os.path.isfile(audio_file_path):
                    error_detail = f"Audio file does not exist: {audio_file_path}"
                else:
                    audio_input = audio_file_path
                    input_type = 'path'
            elif 'audio_data_base64' in command:
                try:
                    base64_data = command['audio_data_base64']
                    audio_bytes = base64.b64decode(base64_data)
                    if not audio_bytes:
                        error_detail = "Decoded audio data is empty."
                    else:
                        # Load audio from bytes using pydub
                        audio_segment = AudioSegment.from_file(io.BytesIO(audio_bytes))
                        # Convert to mono and set frame rate for Whisper (16kHz)
                        audio_segment = audio_segment.set_frame_rate(16000).set_channels(1)
                        # Convert to numpy array of floats
                        samples = np.array(audio_segment.get_array_of_samples()).astype(np.float32) / 32768.0
                        audio_input = samples
                        input_type = 'buffer'
                except base64.binascii.Error:
                    error_detail = "Invalid Base64 data received."
                except Exception as e:
                    error_detail = f"Error processing audio buffer: {str(e)}"
            else:
                error_detail = "Invalid command format: missing 'path' or 'audio_data_base64'."
        else:
             error_detail = f"Invalid command: {command.get('command')}"

        if error_detail:
            error_response = {"id": request_id, "error": error_detail}
            print(json.dumps(error_response))
            sys.stdout.flush()
            continue

        # --- Start Transcription ---
        logger.info(f"Starting transcription for ID: {request_id} (type: {input_type})")

        # File integrity check ONLY if input is a path
        if input_type == 'path':
            try:
                import subprocess
                result = subprocess.run(
                    ['ffprobe', audio_input], # audio_input is the path here
                    stderr=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    text=True,
                    timeout=10  # Add timeout to prevent hanging
                )
                if result.returncode != 0:
                    error_response = {"id": request_id, "error": f"Corrupt audio file (ffprobe check): {audio_input}"}
                    print(json.dumps(error_response))
                    sys.stdout.flush()
                    continue
            except Exception as probe_err:
                logger.warning(f"FFprobe check failed: {str(probe_err)}")
                # Continue with transcription attempt anyway

        # Transcribe the audio (from path or buffer) with English as the specified language
        try:
            # Try with VAD filtering first
            segments, info = model.transcribe(
                audio_input, # Can be path string or numpy array
                language='en',
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500}
            )

            segments_text = [segment.text for segment in segments]
            transcription = " ".join(segments_text).strip()

            # If transcription is empty after VAD filtering, try without VAD
            if not transcription:
                logger.info(f"Retrying transcription for ID {request_id} without VAD filter.")
                segments, info = model.transcribe(
                    audio_input,
                    language='en',
                    beam_size=5,
                    vad_filter=False
                )
                segments_text = [segment.text for segment in segments]
                transcription = " ".join(segments_text).strip()

            logger.info(f"Transcription successful for ID: {request_id}")
            success_response = {"id": request_id, "transcription": transcription}
            print(json.dumps(success_response))
            sys.stdout.flush()

        except Exception as e:
            error_str = str(e)
            # Detect specific FFmpeg/audio processing errors
            if "[Errno 1094995529]" in error_str or "Invalid data found" in error_str or "corrupt" in error_str.lower():
                 error_response = {"id": request_id, "error": f"Corrupt audio data for ID {request_id}."}
            else:
                 error_response = {"id": request_id, "error": f"Error during transcription for ID {request_id}: {error_str}"}
            logger.error(f"Transcription failed for ID {request_id}: {error_response['error']}")
            print(json.dumps(error_response))
            sys.stdout.flush()
            # --- End Transcription ---

    except json.JSONDecodeError as json_err:
        logger.error(f"Failed to decode JSON command: {line} - Error: {json_err}")
        continue # Skip this invalid command
    except Exception as e:
        # Catch broader exceptions in the loop to prevent crashing
        logger.error(f"Unexpected error in main loop: {str(e)}", exc_info=True)
        # Optionally send an error back if we can identify the ID
        if 'request_id' in locals() and request_id:
             error_response = {"id": request_id, "error": f"Unexpected server error: {str(e)}"}
             try:
                 print(json.dumps(error_response))
                 sys.stdout.flush()
             except Exception:
                 pass # Ignore errors trying to report errors
        continue