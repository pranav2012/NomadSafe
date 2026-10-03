import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import type { BiometricPresentation } from "@/features/auth/hooks/useBiometricPresentation";

export type BiometricKind = BiometricPresentation["kind"];

/** Face ID style frame for "face" and "generic", whorl lines for "fingerprint". Drawn on a 48pt grid. */
export function BiometricGlyph({ kind, size, color }: { kind: BiometricKind; size: number; color: string }) {
  const stroke = { stroke: color, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

  if (kind === "fingerprint") {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path d="M12.5 17.5C15 12.6 19.2 10 24 10s9 2.6 11.5 7.5" {...stroke} opacity={0.7} />
        <Path d="M15 32.5c-1-2.6-1.5-5.2-1.5-7.8 0-6 4.7-10.7 10.5-10.7s10.5 4.7 10.5 10.7c0 1.4-.2 2.8-.5 4.1" {...stroke} />
        <Path d="M19.4 36.6c-1.3-3.4-1.9-7-1.9-10.8 0-3.6 2.9-6.3 6.5-6.3s6.5 2.7 6.5 6.3c0 3.8-.9 7.6-2.6 11" {...stroke} />
        <Path d="M24 25.6c0 5-1 8.9-3 12.4" {...stroke} />
        <Path d="M33.2 34.8c-.5 1.3-1 2.5-1.7 3.6" {...stroke} opacity={0.7} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M8 16v-3a5 5 0 0 1 5-5h3M32 8h3a5 5 0 0 1 5 5v3M40 32v3a5 5 0 0 1-5 5h-3M16 40h-3a5 5 0 0 1-5-5v-3" {...stroke} />
      <Circle cx={18} cy={20} r={1.7} fill={color} />
      <Circle cx={30} cy={20} r={1.7} fill={color} />
      <Path d="M24 19.5v6.5h-1.6" {...stroke} strokeWidth={2} />
      <Path d="M18.5 31c1.5 1.4 3.4 2.1 5.5 2.1s4-.7 5.5-2.1" {...stroke} />
    </Svg>
  );
}
