"""
Mix the narration clips into the (silent) demo video.

Each clip is anchored to the moment its caption appears. If the previous clip is still
speaking at that moment, the stretch of video just before that caption is played more slowly
(continuous motion, no freeze) until the speaker has finished, so captions and narration
always change together.

usage: python3 mix_narration.py <silent.mp4> <clips_dir> <out.mp4>
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import soundfile as sf
import librosa

SRC, CLIPS, OUT = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
ITEMS = json.load(open(Path(__file__).with_name("narration.json")))
SR = 48000
LEAD = 0.15      # speech starts this long after the caption appears
GAP = 0.3        # minimum pause between two clips
TAIL = 1.0       # silence kept before the end of the video
FREEZE_BEFORE = 0.02   # cut just before the caption change

dur_src = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC]))

def load(path):
    w, sr = sf.read(path, dtype="float32")
    if w.ndim > 1:
        w = w.mean(1)
    w = librosa.resample(w, orig_sr=sr, target_sr=SR)
    idx = np.where(np.abs(w) > 0.01)[0]
    a, b = max(0, idx[0] - int(0.06 * SR)), min(len(w), idx[-1] + int(0.12 * SR))
    w = w[a:b]
    rms = np.sqrt(np.mean(w[np.abs(w) > 0.01] ** 2))
    w = w * (0.1 / rms)                    # equal loudness between clips (≈ −20 dBFS speech RMS)
    peak = np.abs(w).max()
    if peak > 0.89:
        w *= 0.89 / peak
    fade = int(0.01 * SR)
    w[:fade] *= np.linspace(0, 1, fade)
    w[-fade:] *= np.linspace(1, 0, fade)
    return w

clips = [(it, load(CLIPS / f"{it['id']}.wav")) for it in ITEMS]
# lag[i] = how much longer the stretch just before caption i must last so that clip i-1 can finish
shift, prev_end, placed, lags = 0.0, 0.0, [], []
for it, w in clips:
    a_new = it["at"] + shift
    start = max(a_new + LEAD, prev_end + GAP)
    lag = max(0.0, start - (a_new + LEAD))
    lag = lag if lag > 0.02 else 0.0
    shift += lag
    start = it["at"] + shift + LEAD
    lags.append(lag)
    placed.append((start, w, it["id"]))
    prev_end = start + len(w) / SR
end_pad = max(0.0, prev_end + TAIL - (dur_src + shift))
total = dur_src + shift + end_pad

# ---- video: cut just before every caption change; the stretch before caption i is played slower by lags[i] ----
cuts = [0.0] + [it["at"] - FREEZE_BEFORE for it in ITEMS] + [dur_src]
extra = lags + [end_pad]          # extra[k] belongs to the segment that ends at cuts[k + 1]
tmp = Path(OUT).parent / "segs"
tmp.mkdir(exist_ok=True)
lst, t_new = [], 0.0
for k in range(len(cuts) - 1):
    a, b = cuts[k], cuts[k + 1]
    if b - a < 1e-3:
        continue
    length = b - a + extra[k]
    n_frames = round((t_new + length) * 30) - round(t_new * 30)   # exact frame count: no cumulative drift
    t_new += length
    f = length / (b - a)
    seg = tmp / f"s{k:02d}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.4f}", "-to", f"{b:.4f}", "-i", SRC, "-an",
                    "-vf", f"setpts={f:.6f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=2",
                    "-frames:v", str(n_frames), "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-threads", "2", str(seg)], check=True)
    lst.append(f"file '{seg.name}'")
(tmp / "list.txt").write_text("\n".join(lst) + "\n")
video_only = tmp / "video.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c", "copy", str(video_only)], check=True)
freezes = [(it["at"], l) for it, l in zip(ITEMS, lags) if l > 0] + ([(dur_src, end_pad)] if end_pad > 0 else [])

# ---- audio track ----
track = np.zeros(int((total + 0.5) * SR), dtype=np.float32)
for start, w, _ in placed:
    i = int(round(start * SR))
    track[i:i + len(w)] += w
wav = Path(OUT).with_suffix(".narration.wav")
sf.write(wav, track, SR)

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video_only), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT], check=True)

report = {"source_s": round(dur_src, 2), "output_s": round(total, 2), "slowed_before_caption_at": [(round(t, 2), round(d, 2)) for t, d in freezes],
          "clips": [(i, round(s, 2), round(len(w) / SR, 2)) for s, w, i in placed]}
json.dump(report, open(Path(OUT).with_suffix(".timing.json"), "w"), indent=1)
print(json.dumps({k: report[k] for k in ("source_s", "output_s")}))
