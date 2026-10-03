import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioSource } from "expo-audio";

const TARGET_VOLUME = 0.2;
const FADE_OUT_MS = 900;
const STEP_MS = 50;

// expo-audio exposes volume/loop as native properties; writing them outside the hook keeps the React Compiler happy.
function configure(player: AudioPlayer, volume: number) {
  player.loop = true;
  player.volume = volume;
}

/** Quiet looping ambience while `enabled` and foregrounded; fades, respects silent mode, mixes with other audio. */
export function useAmbientLoop(source: AudioSource, enabled: boolean, fadeInMs = 2500) {
  const player = useAudioPlayer(source);
  const [foreground, setForeground] = useState(AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setForeground(next === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false });
  }, []);

  useEffect(() => {
    const audio = player;

    if (!foreground) {
      audio.pause();
      return;
    }

    const from = audio.playing ? audio.volume : 0;
    const to = enabled ? TARGET_VOLUME : 0;
    if (enabled) {
      configure(audio, from);
      audio.play();
    } else if (!audio.playing) {
      return;
    }

    const duration = enabled ? fadeInMs : FADE_OUT_MS;
    const start = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / duration);
      configure(audio, from + (to - from) * k);
      if (k < 1) return;
      clearInterval(id);
      if (!enabled) audio.pause();
    }, STEP_MS);
    return () => clearInterval(id);
  }, [enabled, fadeInMs, foreground, player]);
}
