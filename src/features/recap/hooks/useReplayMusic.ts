import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";

const VOLUME = 0.55;
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 700;
const STEP_MS = 50;

/** The replay's tracks (CC0, see assets/audio/CREDITS.md); a trip always gets the same one. */
export const RECAP_TRACKS = [require("../../../../assets/audio/recap-flight.m4a"), require("../../../../assets/audio/recap-inspiration.m4a")];

export function recapTrack(tripId: string) {
  let hash = 0;
  for (let i = 0; i < tripId.length; i += 1) hash = (hash * 31 + tripId.charCodeAt(i)) >>> 0;
  return RECAP_TRACKS[hash % RECAP_TRACKS.length];
}

// expo-audio exposes volume/loop as native properties; writing them outside the hook keeps the React Compiler happy.
function configure(player: AudioPlayer, volume: number) {
  player.loop = true;
  player.volume = volume;
}

/**
 * Music under the replay while `playing`: fades in and out, pauses with the replay and in the
 * background, stays silent when the iPhone's ring switch is off, and stops when the screen closes.
 */
export function useReplayMusic(tripId: string, playing: boolean) {
  const player = useAudioPlayer(recapTrack(tripId));
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
    const on = playing;
    if (!on && !audio.playing) return;
    const from = audio.playing ? audio.volume : 0;
    const to = on ? VOLUME : 0;
    if (on) {
      configure(audio, from);
      audio.play();
    }
    const duration = on ? FADE_IN_MS : FADE_OUT_MS;
    const start = Date.now();
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / duration);
      configure(audio, from + (to - from) * k);
      if (k < 1) return;
      clearInterval(id);
      if (!on) audio.pause();
    }, STEP_MS);
    return () => clearInterval(id);
  }, [foreground, playing, player]);
}
