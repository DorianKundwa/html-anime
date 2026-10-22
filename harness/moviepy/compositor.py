#!/usr/bin/env python3
"""
MoviePy Multi-Layer Video & Audio Compositor for html-anime.
Supports:
- Multi-layer video compositing (base video + alpha overlays + overlays at timestamps)
- Audio mixing: narration track + BGM bed with automatic volume ducking + SFX cues
- 24 fps master delivery export
"""

import sys
import json
import os
from pathlib import Path
from moviepy import (
    VideoFileClip,
    AudioFileClip,
    CompositeVideoClip,
    CompositeAudioClip,
)
from moviepy.audio.fx import MultiplyVolume

# Import shared palette
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from palette import PALETTE, TONES


def composite_project(config_path):
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    fps = cfg.get("fps", 24)
    out_path = cfg.get("output", "out/master.mp4")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    video_clips = []
    audio_clips = []

    # 1. Base Video
    base_path = cfg.get("base_video")
    if base_path and os.path.exists(base_path):
        base_clip = VideoFileClip(base_path)
        video_clips.append(base_clip)
        total_duration = base_clip.duration
    else:
        total_duration = cfg.get("duration", 10.0)
        base_clip = None

    # 2. Overlays (e.g. Manim or Remotion clips)
    for ov in cfg.get("overlays", []):
        ov_path = ov.get("file")
        if not ov_path or not os.path.exists(ov_path):
            continue
        start_time = ov.get("start", 0.0)
        c = VideoFileClip(ov_path, has_mask=ov.get("transparent", True))
        c = c.with_start(start_time)
        if "position" in ov:
            c = c.with_position(ov["position"])
        if "duration" in ov:
            c = c.with_duration(ov["duration"])
        video_clips.append(c)

    # 3. Audio Mixing
    # Primary narration audio
    narration_path = cfg.get("narration_audio")
    if narration_path and os.path.exists(narration_path):
        narr_clip = AudioFileClip(narration_path)
        audio_clips.append(narr_clip)
        if total_duration is None:
            total_duration = narr_clip.duration

    # Background music (BGM) with ducking
    bgm_path = cfg.get("bgm_audio")
    if bgm_path and os.path.exists(bgm_path):
        bgm_clip = AudioFileClip(bgm_path)
        if total_duration and bgm_clip.duration < total_duration:
            # loop bgm if shorter than video
            loops = int(total_duration // bgm_clip.duration) + 1
            from moviepy.audio.AudioClip import concatenate_audioclips
            bgm_clip = concatenate_audioclips([bgm_clip] * loops)
        if total_duration:
            bgm_clip = bgm_clip.with_duration(total_duration)

        # Ducking volume (e.g. 0.15 volume so voiceover cuts cleanly)
        bgm_volume = cfg.get("bgm_volume", 0.18)
        bgm_clip = bgm_clip.with_effects([MultiplyVolume(bgm_volume)])
        audio_clips.append(bgm_clip)

    # Sound effects (SFX) placed at specific beat timestamps
    for sfx in cfg.get("sfx", []):
        sfx_path = sfx.get("file")
        if sfx_path and os.path.exists(sfx_path):
            s_time = sfx.get("time", 0.0)
            sc = AudioFileClip(sfx_path).with_start(s_time)
            if "volume" in sfx:
                sc = sc.with_effects([MultiplyVolume(sfx["volume"])])
            audio_clips.append(sc)

    # Assemble video
    if video_clips:
        final_video = CompositeVideoClip(video_clips, size=cfg.get("size", (1920, 1080)))
        if total_duration:
            final_video = final_video.with_duration(total_duration)
    else:
        raise ValueError("No valid video clips to composite")

    # Attach composite audio if present
    if audio_clips:
        final_audio = CompositeAudioClip(audio_clips)
        if total_duration:
            final_audio = final_audio.with_duration(total_duration)
        final_video = final_video.with_audio(final_audio)

    # Export 24 fps master MP4
    final_video.write_videofile(
        out_path,
        fps=fps,
        codec="libx264",
        audio_codec="aac",
        logger="bar",
    )
    print(f"Compositor wrote {out_path} ({total_duration}s, {fps} fps)")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python compositor.py <config.json>")
        sys.exit(1)
    composite_project(sys.argv[1])
