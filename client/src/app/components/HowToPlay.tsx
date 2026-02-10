import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./HowToPlay.css";

type Props = { preStealEnabled: boolean };

/* ───────────────────────────────────────────────────────────── */
/* Scene components (pure CSS animation — no state)             */
/* ───────────────────────────────────────────────────────────── */

function FlipScene() {
  // 3 already-revealed tiles + 1 face-down tile that flips to reveal "E"
  const revealed = ["H", "O", "P"];
  const left = (i: number) => 42 + i * 52;
  const top = 55;
  return (
    <div className="htp-scene">
      {revealed.map((ch, i) => (
        <div
          key={i}
          className="htp-tile"
          style={{ left: left(i), top }}
        >
          {ch}
        </div>
      ))}
      {/* Face-down tile that flips to reveal "E" */}
      <div
        className="htp-tile htp-tile-facedown"
        style={{
          left: left(3),
          top,
          animation: "htp-flip 700ms ease-in-out 1.2s both, htp-flip-to-revealed 700ms ease-in-out 1.2s both",
          transformStyle: "preserve-3d",
        }}
      >
        <span
          style={{
            position: "absolute",
            transform: "scaleX(-1)",
            animation: "htp-flip-show-letter 700ms ease-in-out 1.2s both",
          }}
        >
          E
        </span>
        <span
          style={{
            position: "absolute",
            animation: "htp-flip-hide-pattern 700ms ease-in-out 1.2s both",
          }}
        >
          ?
        </span>
      </div>
    </div>
  );
}

function ClaimScene() {
  // 5 tiles in a row at top: L I M E S
  // After delay: L I M E highlight + slide down to bottom row (claimed), S fades
  const letters = ["L", "I", "M", "E", "S"];
  const claimed = [true, true, true, true, false];
  const baseLeft = 30;
  const spacing = 50;
  const topRow = 25;
  const delay = 1.0;

  return (
    <div className="htp-scene">
      {letters.map((ch, i) => {
        const isClaimed = claimed[i];
        const stagger = i * 0.06;
        return (
          <div
            key={i}
            className="htp-tile"
            style={{
              left: baseLeft + i * spacing,
              top: topRow,
              animation: isClaimed
                ? `htp-highlight 300ms ease ${delay + stagger}s both, htp-slide-down-claim 500ms ease ${delay + 0.35 + stagger}s both`
                : `htp-fade-out 400ms ease ${delay + 0.3}s both`,
            }}
          >
            {ch}
          </div>
        );
      })}
      {/* "claimed!" label appears at bottom */}
      <div
        className="htp-label"
        style={{
          left: baseLeft,
          top: topRow + 105,
          animation: `htp-steal-appear 400ms ease ${delay + 0.7}s both`,
        }}
      >
        LIME — claimed!
      </div>
    </div>
  );
}

function StealScene() {
  // Top: opponent's word "LIME" in small tiles
  // Center: free tile "S"
  // Animation: S flies up, opponent word disappears, "SMILE" appears at bottom

  const opponentWord = ["L", "I", "M", "E"];
  const resultWord = ["S", "M", "I", "L", "E"];
  const opLeft = 95;
  const opTop = 18;
  const tileSize = 30;
  const gap = 3;

  const centerTileLeft = 150;
  const centerTileTop = 72;

  const resultLeft = 75;
  const resultTop = 118;

  const stealDelay = 1.2;

  return (
    <div className="htp-scene">
      {/* Opponent label */}
      <div className="htp-label" style={{ left: 50, top: opTop + 6 }}>
        Opp.
      </div>

      {/* Opponent word tiles */}
      {opponentWord.map((ch, i) => (
        <div
          key={`op-${i}`}
          className="htp-tile htp-tile-small htp-tile-opponent"
          style={{
            left: opLeft + i * (tileSize + gap),
            top: opTop,
            animation: `htp-shuffle-out 350ms ease ${stealDelay + 0.25}s both`,
          }}
        >
          {ch}
        </div>
      ))}

      {/* Center free tile "S" */}
      <div
        className="htp-tile"
        style={{
          left: centerTileLeft,
          top: centerTileTop,
          "--fly-x": "-10px",
          "--fly-y": "-45px",
          animation: `htp-fly-to-word 450ms ease ${stealDelay}s both`,
        } as React.CSSProperties}
      >
        S
      </div>

      {/* Result label */}
      <div className="htp-label" style={{ left: 42, top: resultTop + 6 }}>
        You
      </div>

      {/* Result word "SMILE" */}
      {resultWord.map((ch, i) => (
        <div
          key={`res-${i}`}
          className="htp-tile htp-tile-small htp-tile-claimed"
          style={{
            left: resultLeft + i * (tileSize + gap),
            top: resultTop,
            animation: `htp-steal-appear 400ms ease ${stealDelay + 0.55 + i * 0.06}s both`,
            opacity: 0,
          }}
        >
          {ch}
        </div>
      ))}
    </div>
  );
}

function PreStealScene() {
  // Pre-steal box at top, face-down tile flips to "S", LIME word to the right,
  // then S flies to LIME, LIME disappears, SMILE appears at bottom (like StealScene)
  const flipDelay = 1.2;
  const matchDelay = flipDelay + 0.75;
  const stealDelay = matchDelay + 0.5;

  const limeWord = ["L", "I", "M", "E"];
  const resultWord = ["S", "M", "I", "L", "E"];
  const tileSize = 30;
  const gap = 3;

  const sTileLeft = 80;
  const sTileTop = 68;
  const limeLeft = 140;
  const limeTop = 73;
  const resultLeft = 75;
  const resultTop = 128;

  return (
    <div className="htp-scene">
      {/* Pre-steal rule box */}
      <div
        className="htp-presteal-box"
        style={{
          left: 40,
          top: 15,
          animation: `htp-match-flash 500ms ease ${matchDelay}s both`,
        }}
      >
        <span className="htp-keyword">If</span> S flipped
        <span className="htp-keyword">&rarr;</span> LIME + S = SMILE
      </div>

      {/* Outer wrapper handles positioning + fly animation */}
      <div
        style={{
          position: "absolute",
          left: sTileLeft,
          top: sTileTop,
          width: 40,
          height: 40,
          "--fly-x": `${limeLeft - sTileLeft}px`,
          "--fly-y": `${limeTop - sTileTop}px`,
          animation: `htp-fly-to-word 400ms ease ${stealDelay}s both`,
        } as React.CSSProperties}
      >
        {/* Inner tile handles flip (separate element so transforms don't conflict) */}
        <div
          className="htp-tile htp-tile-facedown"
          style={{
            left: 0,
            top: 0,
            animation: `htp-flip 700ms ease-in-out ${flipDelay}s both, htp-flip-to-revealed 700ms ease-in-out ${flipDelay}s both`,
            transformStyle: "preserve-3d",
          }}
        >
          <span
            style={{
              position: "absolute",
              transform: "scaleX(-1)",
              animation: `htp-flip-show-letter 700ms ease-in-out ${flipDelay}s both`,
            }}
          >
            S
          </span>
          <span
            style={{
              position: "absolute",
              animation: `htp-flip-hide-pattern 700ms ease-in-out ${flipDelay}s both`,
            }}
          >
            ?
          </span>
        </div>
      </div>

      {/* LIME word tiles to the right */}
      {limeWord.map((ch, i) => (
        <div
          key={`lime-${i}`}
          className="htp-tile htp-tile-small htp-tile-opponent"
          style={{
            left: limeLeft + i * (tileSize + gap),
            top: limeTop,
            animation: `htp-shuffle-out 350ms ease ${stealDelay + 0.15}s both`,
          }}
        >
          {ch}
        </div>
      ))}

      {/* Result word "SMILE" */}
      {resultWord.map((ch, i) => (
        <div
          key={`res-${i}`}
          className="htp-tile htp-tile-small htp-tile-claimed"
          style={{
            left: resultLeft + i * (tileSize + gap),
            top: resultTop,
            animation: `htp-steal-appear 400ms ease ${stealDelay + 0.4 + i * 0.06}s both`,
            opacity: 0,
          }}
        >
          {ch}
        </div>
      ))}
    </div>
  );
}

function GameEndScene() {
  // Static scene: empty bag, two player rows with tiles, winner badge
  const p1Words = [
    ["S", "M", "I", "L", "E"],
    ["C", "A", "R", "D"],
  ];
  const p2Words = [["L", "O", "T"]];

  const tileSize = 22;
  const gap = 2;
  const rowTop1 = 32;
  const rowTop2 = 100;
  const wordStart = 72;
  const wordGap = 10;

  return (
    <div className="htp-scene">
      {/* Empty bag icon */}
      <div className="htp-bag-icon" style={{ left: 16, top: 55 }}>
        0
      </div>

      {/* Player 1 row */}
      <div className="htp-label" style={{ left: wordStart, top: rowTop1 - 14 }}>
        Player 1
      </div>
      {p1Words.map((word, wi) => {
        let wordLeft = wordStart;
        for (let w = 0; w < wi; w++) {
          wordLeft += p1Words[w].length * (tileSize + gap) + wordGap;
        }
        return word.map((ch, ci) => (
          <div
            key={`p1-${wi}-${ci}`}
            className="htp-tile htp-tile-small htp-tile-claimed"
            style={{
              position: "absolute",
              left: wordLeft + ci * (tileSize + gap),
              top: rowTop1,
              width: tileSize,
              height: tileSize,
              fontSize: "0.65rem",
            }}
          >
            {ch}
          </div>
        ));
      })}
      {/* Winner badge — positioned after the last word */}
      {(() => {
        let badgeLeft = wordStart;
        for (const word of p1Words) {
          badgeLeft += word.length * (tileSize + gap) + wordGap;
        }
        return (
          <div
            className="htp-winner-badge"
            style={{ left: badgeLeft, top: rowTop1 + 2 }}
          >
            Winner
          </div>
        );
      })()}

      {/* Player 2 row */}
      <div className="htp-label" style={{ left: wordStart, top: rowTop2 - 14 }}>
        Player 2
      </div>
      {p2Words.map((word, wi) => {
        let wordLeft = wordStart;
        for (let w = 0; w < wi; w++) {
          wordLeft += p2Words[w].length * (tileSize + gap) + wordGap;
        }
        return word.map((ch, ci) => (
          <div
            key={`p2-${wi}-${ci}`}
            className="htp-tile htp-tile-small htp-tile-opponent"
            style={{
              position: "absolute",
              left: wordLeft + ci * (tileSize + gap),
              top: rowTop2,
              width: tileSize,
              height: tileSize,
              fontSize: "0.65rem",
            }}
          >
            {ch}
          </div>
        ));
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* Main component                                                */
/* ───────────────────────────────────────────────────────────── */

type Slide = {
  caption: string;
  Scene: () => JSX.Element;
};

const AUTO_ADVANCE_MS = 5500;
const RESUME_AFTER_MS = 8000;

export default function HowToPlay({ preStealEnabled }: Props) {
  const slides = useMemo<Slide[]>(() => {
    const base: Slide[] = [
      {
        caption: "Players take turns flipping tiles from the bag.",
        Scene: FlipScene,
      },
      {
        caption: "Spell a word of four or more letters to claim it.",
        Scene: ClaimScene,
      },
      {
        caption: "Combine center tiles with existing words to steal them.",
        Scene: StealScene,
      },
    ];

    if (preStealEnabled) {
      base.push({
        caption: "Pre-program steals that trigger when tiles are flipped.",
        Scene: PreStealScene,
      });
    }

    base.push({
      caption: "The bag empties. The player with the most tiles wins!",
      Scene: GameEndScene,
    });

    return base;
  }, [preStealEnabled]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);

  // Keep activeIndex in bounds if slides change (e.g. preSteal toggle)
  useEffect(() => {
    if (activeIndex >= slides.length) {
      setActiveIndex(0);
      setAnimationKey((k) => k + 1);
    }
  }, [slides.length, activeIndex]);

  // Auto-advance timer
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const startAutoAdvance = useCallback(() => {
    clearTimers();
    isPausedRef.current = false;
    autoTimerRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % slides.length;
        setAnimationKey((k) => k + 1);
        return next;
      });
    }, AUTO_ADVANCE_MS);
  }, [clearTimers, slides.length]);

  // Start auto-advance on mount and when slides change
  useEffect(() => {
    startAutoAdvance();
    return clearTimers;
  }, [startAutoAdvance, clearTimers]);

  const pauseAndScheduleResume = useCallback(() => {
    clearTimers();
    isPausedRef.current = true;
    resumeTimerRef.current = setTimeout(() => {
      startAutoAdvance();
    }, RESUME_AFTER_MS);
  }, [clearTimers, startAutoAdvance]);

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      setAnimationKey((k) => k + 1);
      pauseAndScheduleResume();
    },
    [pauseAndScheduleResume]
  );

  const goPrev = useCallback(() => {
    goTo((activeIndex - 1 + slides.length) % slides.length);
  }, [activeIndex, slides.length, goTo]);

  const goNext = useCallback(() => {
    goTo((activeIndex + 1) % slides.length);
  }, [activeIndex, slides.length, goTo]);

  const { Scene } = slides[activeIndex] ?? slides[0];

  return (
    <section className="panel how-to-play">
      <h2>How to Play</h2>
      <div className="htp-slideshow">
        <div className="htp-stage" key={animationKey}>
          <Scene />
        </div>
        <p className="htp-caption">{slides[activeIndex]?.caption}</p>
        <nav className="htp-nav">
          <button
            className="htp-arrow"
            onClick={goPrev}
            aria-label="Previous slide"
          >
            &#8249;
          </button>
          <div className="htp-dots">
            {slides.map((_, i) => (
              <button
                key={i}
                className={`htp-dot ${i === activeIndex ? "active" : ""}`}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
          <button
            className="htp-arrow"
            onClick={goNext}
            aria-label="Next slide"
          >
            &#8250;
          </button>
        </nav>
      </div>
    </section>
  );
}
