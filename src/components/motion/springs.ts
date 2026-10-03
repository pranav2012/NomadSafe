import { ReduceMotion, type WithSpringConfig } from "react-native-reanimated";

/** Shared spring presets so every surface moves with the same physics. */
export const springs = {
  press: { damping: 22, stiffness: 420, mass: 0.6, reduceMotion: ReduceMotion.System },
  snappy: { damping: 18, stiffness: 260, mass: 0.8, reduceMotion: ReduceMotion.System },
  sheet: { damping: 30, stiffness: 260, mass: 1, reduceMotion: ReduceMotion.System },
  bouncy: { damping: 10, stiffness: 180, mass: 0.7, reduceMotion: ReduceMotion.System },
} satisfies Record<string, WithSpringConfig>;
