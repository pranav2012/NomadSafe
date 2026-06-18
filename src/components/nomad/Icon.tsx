import React from "react";
import Svg, { G, Path, Circle, Rect } from "react-native-svg";

export type IconName =
  | "home"
  | "shield"
  | "compass"
  | "wallet"
  | "sparkle"
  | "users"
  | "settings"
  | "bell"
  | "plus"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "close"
  | "check"
  | "mapPin"
  | "clock"
  | "battery"
  | "wifi"
  | "lock"
  | "camera"
  | "receipt"
  | "send"
  | "pause"
  | "play"
  | "phone"
  | "mail"
  | "flag"
  | "heart"
  | "trendDown"
  | "trendUp"
  | "x";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 22,
  color = "currentColor",
  strokeWidth = 1.7,
}: IconProps) {
  const sw = strokeWidth;
  const p = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  let body: React.ReactNode = null;

  switch (name) {
    case "home":
      body = (
        <G {...p}>
          <Path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1v-9.5z" />
        </G>
      );
      break;
    case "shield":
      body = (
        <G {...p}>
          <Path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z" />
          <Path d="M9 12l2 2 4-4" />
        </G>
      );
      break;
    case "compass":
      body = (
        <G {...p}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
        </G>
      );
      break;
    case "wallet":
      body = (
        <G {...p}>
          <Path d="M3 7a2 2 0 012-2h13a1 1 0 011 1v3H5a2 2 0 00-2 2V7z" />
          <Path d="M3 11a2 2 0 012-2h15v10a1 1 0 01-1 1H5a2 2 0 01-2-2V11z" />
          <Circle cx="16" cy="14" r="1.3" fill={color} stroke="none" />
        </G>
      );
      break;
    case "sparkle":
      body = (
        <G {...p}>
          <Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
        </G>
      );
      break;
    case "users":
      body = (
        <G {...p}>
          <Circle cx="9" cy="8" r="3" />
          <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <Circle cx="17" cy="7" r="2.5" />
          <Path d="M15 14c3.3 0 6 2 6 5" />
        </G>
      );
      break;
    case "settings":
      body = (
        <G {...p}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </G>
      );
      break;
    case "bell":
      body = (
        <G {...p}>
          <Path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3V9z" />
          <Path d="M10 19a2 2 0 004 0" />
        </G>
      );
      break;
    case "plus":
      body = (
        <G {...p}>
          <Path d="M12 5v14M5 12h14" />
        </G>
      );
      break;
    case "chevronRight":
      body = (
        <G {...p}>
          <Path d="M9 6l6 6-6 6" />
        </G>
      );
      break;
    case "chevronLeft":
      body = (
        <G {...p}>
          <Path d="M15 6l-6 6 6 6" />
        </G>
      );
      break;
    case "chevronDown":
      body = (
        <G {...p}>
          <Path d="M6 9l6 6 6-6" />
        </G>
      );
      break;
    case "close":
    case "x":
      body = (
        <G {...p}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </G>
      );
      break;
    case "check":
      body = (
        <G {...p}>
          <Path d="M5 12l5 5 9-10" />
        </G>
      );
      break;
    case "mapPin":
      body = (
        <G {...p}>
          <Path d="M12 22s-7-7.5-7-13a7 7 0 0114 0c0 5.5-7 13-7 13z" />
          <Circle cx="12" cy="9" r="2.5" />
        </G>
      );
      break;
    case "clock":
      body = (
        <G {...p}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 7v5l3 2" />
        </G>
      );
      break;
    case "battery":
      body = (
        <G {...p}>
          <Rect x="3" y="8" width="16" height="9" rx="1.5" />
          <Path d="M20 11v3" />
          <Rect x="5" y="10" width="9" height="5" rx="0.5" fill={color} stroke="none" />
        </G>
      );
      break;
    case "wifi":
      body = (
        <G {...p}>
          <Path d="M2 9a15 15 0 0120 0M5 13a10 10 0 0114 0M8 16.5a5 5 0 018 0" />
          <Circle cx="12" cy="20" r="1" fill={color} stroke="none" />
        </G>
      );
      break;
    case "lock":
      body = (
        <G {...p}>
          <Rect x="4" y="10" width="16" height="11" rx="2" />
          <Path d="M8 10V7a4 4 0 018 0v3" />
        </G>
      );
      break;
    case "camera":
      body = (
        <G {...p}>
          <Path d="M3 7h4l2-2h6l2 2h4v13H3V7z" />
          <Circle cx="12" cy="13" r="4" />
        </G>
      );
      break;
    case "receipt":
      body = (
        <G {...p}>
          <Path d="M5 3h14v18l-3-2-3 2-4-2-4 2V3z" />
          <Path d="M8 8h8M8 12h8M8 16h5" />
        </G>
      );
      break;
    case "send":
      body = (
        <G {...p}>
          <Path d="M3 12L21 3l-6 18-4-8-8-1z" />
        </G>
      );
      break;
    case "pause":
      body = (
        <G {...p}>
          <Rect x="6" y="5" width="4" height="14" rx="1" />
          <Rect x="14" y="5" width="4" height="14" rx="1" />
        </G>
      );
      break;
    case "play":
      body = (
        <G {...p}>
          <Path d="M6 4l14 8-14 8V4z" />
        </G>
      );
      break;
    case "phone":
      body = (
        <G {...p}>
          <Path d="M5 4h4l2 5-3 2c1.2 2.4 3.6 4.8 6 6l2-3 5 2v4c0 1.1-.9 2-2 2A15 15 0 013 6c0-1.1.9-2 2-2z" />
        </G>
      );
      break;
    case "mail":
      body = (
        <G {...p}>
          <Rect x="3" y="5" width="18" height="14" rx="2" />
          <Path d="M3.5 7l8.5 6 8.5-6" />
        </G>
      );
      break;
    case "flag":
      body = (
        <G {...p}>
          <Path d="M5 21V4c4-2 8 2 12 0v10c-4 2-8-2-12 0" />
        </G>
      );
      break;
    case "heart":
      body = (
        <G {...p}>
          <Path d="M12 20s-7-4.5-9-9.5a5 5 0 019-3 5 5 0 019 3c-2 5-9 9.5-9 9.5z" />
        </G>
      );
      break;
    case "trendDown":
      body = (
        <G {...p}>
          <Path d="M3 7l6 6 4-4 8 8" />
          <Path d="M21 17v-4h-4" />
        </G>
      );
      break;
    case "trendUp":
      body = (
        <G {...p}>
          <Path d="M3 17l6-6 4 4 8-8" />
          <Path d="M21 7v4h-4" />
        </G>
      );
      break;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
