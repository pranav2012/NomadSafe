import React from "react";
import Svg, { G, Path, Rect } from "react-native-svg";

export const BRAND_NAVY = "#072B40";

interface Props {
  size?: number;
  /** Draw the navy tile behind the mark (app-icon style). */
  tile?: boolean;
}

export function NomadLogo({ size = 64, tile = true }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="NomadSafe">
      {tile && <Rect x="0" y="0" width="512" height="512" rx="120" fill={BRAND_NAVY} />}
      <Path
        d="M80 300 C140 200 200 200 256 260 C320 330 360 320 400 260"
        fill="none"
        stroke="#22D3EE"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeDasharray="3 12"
        opacity={0.75}
      />
      <G transform="translate(400,260) rotate(-50)">
        <Path d="M-14 -10 L14 0 L-14 10 L-6 0 Z" fill="#E6F6FF" />
      </G>
      <Path d="M196 184 L316 360" stroke="#E6F6FF" strokeWidth={40} strokeLinecap="round" opacity={0.32} />
      <Rect x="176" y="168" width="44" height="176" rx="22" fill="#E6F6FF" />
      <Rect x="292" y="168" width="44" height="176" rx="22" fill="#E6F6FF" />
      <Path d="M200 168 L320 344" stroke="#E6F6FF" strokeWidth={40} strokeLinecap="round" />
    </Svg>
  );
}
