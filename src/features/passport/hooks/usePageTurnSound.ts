import { useEffect } from "react";
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer } from "expo-audio";

const PAGE_TURN = require("../../../../assets/audio/page-turn.m4a");
const VOLUME = 0.35;

// expo-audio exposes volume as a native property; writing it outside the hook keeps the React Compiler happy.
function playFromStart(player: AudioPlayer) {
  player.volume = VOLUME;
  void player.seekTo(0);
  player.play();
}

/** A soft paper sound for each page turn; quiet, mixes with other audio and obeys the iOS silent switch. */
export function usePageTurnSound() {
  const player = useAudioPlayer(PAGE_TURN);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false });
  }, []);

  return () => playFromStart(player);
}
