"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RealtimeSoundControlProps = {
  triggerId: string | null;
};

const SOUND_VOLUME = 1;
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 180;
const UNLOCK_GRACE_MS = 15 * 60 * 1000;

export function RealtimeSoundControl({ triggerId }: RealtimeSoundControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const loopAudioRef = useRef<HTMLAudioElement | null>(null);
  const fullAudioRef = useRef<HTMLAudioElement | null>(null);
  const inProgressRef = useRef(false);
  const pendingTriggerRef = useRef(false);
  const lastUnlockAtRef = useRef<number | null>(null);

  const ensureAudio = useCallback(() => {
    if (!loopAudioRef.current) {
      loopAudioRef.current = new Audio("/sounds/order_incoming_loop.mp3");
      loopAudioRef.current.volume = SOUND_VOLUME;
    }
    if (!fullAudioRef.current) {
      fullAudioRef.current = new Audio("/sounds/order_incoming_full.mp3");
      fullAudioRef.current.volume = SOUND_VOLUME;
    }
  }, []);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const playWithRetries = useCallback(
    async (audio: HTMLAudioElement, attempts = RETRY_ATTEMPTS) => {
      let lastError: unknown = null;
      for (let i = 0; i < attempts; i += 1) {
        try {
          await audio.play();
          return true;
        } catch (error) {
          lastError = error;
          if (i < attempts - 1) {
            await wait(RETRY_DELAY_MS);
          }
        }
      }
      if (lastError) {
        console.error("audio play failed after retries", lastError);
      }
      return false;
    },
    []
  );

  const unlockSilently = useCallback(async () => {
    const audio = new Audio("/sounds/order_incoming_loop.mp3");
    audio.volume = 0;
    try {
      audio.currentTime = 0;
      const ok = await playWithRetries(audio);
      if (!ok) {
        const stillInsideGrace =
          lastUnlockAtRef.current !== null &&
          Date.now() - lastUnlockAtRef.current < UNLOCK_GRACE_MS;
        if (!stillInsideGrace) {
          setUnlocked(false);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      audio.pause();
      audio.currentTime = 0;
      setUnlocked(true);
      lastUnlockAtRef.current = Date.now();
    } catch {
      const stillInsideGrace =
        lastUnlockAtRef.current !== null &&
        Date.now() - lastUnlockAtRef.current < UNLOCK_GRACE_MS;
      if (!stillInsideGrace) {
        setUnlocked(false);
      }
    }
  }, [ensureAudio, playWithRetries]);

  const playSequence = useCallback(async () => {
    if (!enabled || !unlocked) return;
    if (inProgressRef.current) {
      pendingTriggerRef.current = true;
      return;
    }
    ensureAudio();
    const loopAudio = loopAudioRef.current;
    const fullAudio = fullAudioRef.current;
    if (!loopAudio || !fullAudio) return;
    inProgressRef.current = true;

    const playOnce = (audio: HTMLAudioElement) =>
      new Promise<void>((resolve) => {
        audio.currentTime = 0;
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("pause", onPause);
          resolve();
        };
        const onEnded = () => cleanup();
        const onPause = () => cleanup();
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("pause", onPause);
        void playWithRetries(audio).then((ok) => {
          if (!ok) {
            const stillInsideGrace =
              lastUnlockAtRef.current !== null &&
              Date.now() - lastUnlockAtRef.current < UNLOCK_GRACE_MS;
            if (!stillInsideGrace) {
              setUnlocked(false);
            }
            cleanup();
          }
        });
      });

    for (let i = 0; i < 3; i += 1) {
      await playOnce(loopAudio);
    }
    await playOnce(fullAudio);
    inProgressRef.current = false;
    if (pendingTriggerRef.current) {
      pendingTriggerRef.current = false;
      void playSequence();
    }
  }, [enabled, unlocked, ensureAudio, playWithRetries]);

  useEffect(() => {
    // Try to unlock immediately when entering the page. If blocked, fallback listeners stay active.
    setEnabled(true);
    void unlockSilently();
  }, [unlockSilently]);

  useEffect(() => {
    if (triggerId) {
      void playSequence();
    }
  }, [triggerId, playSequence]);

  useEffect(() => {
    if (enabled && unlocked) return;
    const onUserGesture = () => {
      if (enabled && unlocked) return;
      setEnabled(true);
      void unlockSilently();
    };
    window.addEventListener("pointerdown", onUserGesture, { passive: true });
    window.addEventListener("keydown", onUserGesture);
    return () => {
      window.removeEventListener("pointerdown", onUserGesture);
      window.removeEventListener("keydown", onUserGesture);
    };
  }, [enabled, unlocked, unlockSilently]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setEnabled(true);
        void unlockSilently();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [unlockSilently]);

  return (
    <span
      className={
        enabled && unlocked
          ? "text-xs text-muted-foreground"
          : "text-xs text-red-600 font-medium"
      }
    >
      {enabled && unlocked ? "Sonido activado" : "Sonido desactivado"}
    </span>
  );
}
