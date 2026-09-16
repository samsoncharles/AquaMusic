import os
import math
import wave
import struct
import hashlib
import random
import subprocess

def _generate_synthetic_waveform(seed_key: str, num_samples: int = 200) -> list[float]:
    """Generate a highly aesthetic, deterministic visual waveform shape from any key."""
    path_hash = hashlib.md5(seed_key.encode('utf-8')).hexdigest()
    seed = int(path_hash, 16) & 0xFFFFFFFF
    random.seed(seed)

    samples = []
    for i in range(num_samples):
        progress = i / num_samples
        envelope = 1.0
        # Fade envelope on edges for professional audio waveform look
        if progress < 0.08:
            envelope = progress / 0.08
        elif progress > 0.85:
            envelope = (1.0 - progress) / 0.15

        # Audio-frequency harmonic overlay
        base = 0.35 + 0.25 * math.sin(progress * 12) + 0.15 * math.sin(progress * 35) + 0.1 * math.sin(progress * 90)
        noise = random.uniform(0.0, 0.3)
        val = (base + noise) * envelope
        samples.append(min(0.95, max(0.05, val)))

    return samples


def generate_waveform_samples(file_path_or_id: str, num_samples: int = 200) -> list[float]:
    """
    Generates an array of `num_samples` normalized float amplitude values [0.0..1.0].
    If file exists on disk, reads WAV or decodes with FFmpeg.
    If it's an online track or if decoding fails, generates a deterministic aesthetic waveform.
    """
    if not file_path_or_id:
        return [0.5] * num_samples

    # If it's not a local file on disk, generate from ID
    if not os.path.exists(file_path_or_id):
        return _generate_synthetic_waveform(file_path_or_id, num_samples)

    file_path = file_path_or_id

    try:
        # 1. Direct WAV file parsing
        if file_path.lower().endswith('.wav'):
            try:
                with wave.open(file_path, 'rb') as w:
                    frames = w.getnframes()
                    if frames > 0:
                        block_size = max(1, frames // num_samples)
                        samples = []
                        for _ in range(num_samples):
                            data = w.readframes(block_size)
                            if not data:
                                break
                            count = len(data) // 2
                            if count == 0:
                                samples.append(0.0)
                                continue
                            if w.getsampwidth() == 2:
                                shorts = struct.unpack(f"<{count}h", data[:count*2])
                                peak = max(abs(x) for x in shorts) / 32768.0
                            elif w.getsampwidth() == 1:
                                bytes_data = struct.unpack(f"<{count}B", data[:count])
                                peak = max(abs(x - 128) for x in bytes_data) / 128.0
                            else:
                                peak = 0.5
                            samples.append(peak)

                        while len(samples) < num_samples:
                            samples.append(0.0)

                        max_val = max(samples) if samples else 0
                        if max_val > 0:
                            samples = [min(1.0, (x / max_val) * 0.9 + 0.05) for x in samples]
                        return samples
            except Exception as e:
                print(f"[Waveform Decoder] WAV parse exception: {e}")

        # 2. Attempt decoding with FFmpeg
        cmd = [
            'ffmpeg', '-y', '-i', file_path,
            '-f', 's16le', '-ac', '1', '-ar', '4000', '-'
        ]
        
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        try:
            stdout, _ = process.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, _ = process.communicate()

        if process.returncode == 0 and stdout:
            total_shorts = len(stdout) // 2
            if total_shorts > 0:
                chunk_size = max(1, total_shorts // num_samples)
                samples = []
                for i in range(num_samples):
                    start = i * chunk_size
                    end = min(total_shorts, (i + 1) * chunk_size)
                    block = stdout[start * 2 : end * 2]
                    if not block:
                        samples.append(0.0)
                        continue
                    count = len(block) // 2
                    shorts = struct.unpack(f"<{count}h", block)
                    rms = math.sqrt(sum(x*x for x in shorts) / count) / 32768.0 if count > 0 else 0.0
                    samples.append(rms)

                max_val = max(samples) if samples else 0
                if max_val > 0:
                    samples = [min(1.0, (x / max_val) * 0.9 + 0.05) for x in samples]
                return samples

    except Exception as e:
        print(f"[Waveform Decoder] FFmpeg processing failed: {e}")

    # Fallback: Deterministic synthetic waveform
    return _generate_synthetic_waveform(file_path, num_samples)
