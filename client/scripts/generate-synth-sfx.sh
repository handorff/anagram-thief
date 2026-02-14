#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/client/public/audio"

mkdir -p "$OUT_DIR"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='(0.98*sin(2*PI*2200*t)*exp(-55*t))+(0.26*sin(2*PI*3400*t)*exp(-90*t))':s=44100:d=0.09" \
  -af "highpass=f=700,lowpass=f=7000,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/flip-reveal.mp3"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='(0.95*sin(2*PI*(640*t+2200*t*t))*exp(-8.5*t))+(0.32*sin(2*PI*(1280*t+4400*t*t))*exp(-10.5*t))':s=44100:d=0.2" \
  -af "highpass=f=250,lowpass=f=8000,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/claim-success.mp3"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='((1.1*sin(2*PI*(260*t+2100*t*t)))+(0.72*sin(2*PI*(520*t+4200*t*t)))+(0.45*sin(2*PI*(780*t+6300*t*t))))*exp(-6.2*t)':s=44100:d=0.28" \
  -af "highpass=f=140,lowpass=f=7800,volume=2.2,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/steal-success.mp3"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='(0.94*sin(2*PI*(1450*t-1700*t*t))*exp(-8.4*t))+(0.3*sin(2*PI*(280*t-320*t*t))*exp(-9.5*t))':s=44100:d=0.24" \
  -af "highpass=f=120,lowpass=f=6200,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/claim-expired.mp3"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='if(lt(t,0.08),(1.0*sin(2*PI*185*t)*exp(-38*t)),if(lt(t,0.14),(0.86*sin(2*PI*145*(t-0.08))*exp(-36*(t-0.08))),0))':s=44100:d=0.16" \
  -af "highpass=f=80,lowpass=f=2600,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/cooldown-self.mp3"

ffmpeg -y -f lavfi -i "aevalsrc=exprs='if(lt(t,0.24),((0.78*sin(2*PI*(390*t+340*t*t)))+(0.4*sin(2*PI*(780*t+680*t*t))))*exp(-3.2*t),((0.72*sin(2*PI*(520*(t-0.24)+160*(t-0.24)*(t-0.24))))+(0.34*sin(2*PI*(1040*(t-0.24)+320*(t-0.24)*(t-0.24)))))*exp(-2.9*(t-0.24)))':s=44100:d=0.58" \
  -af "highpass=f=120,lowpass=f=9000,alimiter=limit=0.95,volume=-1dB" \
  -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$OUT_DIR/game-end.mp3"

echo "Generated synthesized gameplay SFX into $OUT_DIR"
