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
  | "x"
  | "alertTriangle"
  | "messageCircle"
  | "trash"
  | "calendar"
  | "edit"
  | "swap"
  | "search"
  | "globe"
  | "star"
  | "bookmark"
  | "info"
  | "ticket"
  | "building"
  | "car"
  | "utensils"
  | "plug"
  | "faceId"
  | "download"
  | "minus"
  | "cpu";

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
    case "alertTriangle":
      body = (
        <G {...p}>
          <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <Path d="M12 9v4M12 17h.01" />
        </G>
      );
      break;
    case "messageCircle":
      body = (
        <G {...p}>
          <Path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 014 11.5a8.5 8.5 0 0117 0z" />
        </G>
      );
      break;
    case "trash":
      body = (
        <G {...p}>
          <Path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        </G>
      );
      break;
    case "calendar":
      body = (
        <G {...p}>
          <Rect x="3" y="5" width="18" height="16" rx="2" />
          <Path d="M16 3v4M8 3v4M3 10h18" />
        </G>
      );
      break;
    case "edit":
      body = (
        <G {...p}>
          <Path d="M12 20h9M15.5 5.5l3 3L7 20H4v-3L15.5 5.5z" />
        </G>
      );
      break;
    case "swap":
      body = (
        <G {...p}>
          <Path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />
        </G>
      );
      break;
    case "search":
      body = (
        <G {...p}>
          <Circle cx="11" cy="11" r="7" />
          <Path d="M16.5 16.5L21 21" />
        </G>
      );
      break;
    case "globe":
      body = (
        <G {...p}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" />
        </G>
      );
      break;
    case "star":
      body = (
        <G {...p}>
          <Path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z" />
        </G>
      );
      break;
    case "bookmark":
      body = (
        <G {...p}>
          <Path d="M6 3h12v18l-6-4.5L6 21V3z" />
        </G>
      );
      break;
    case "info":
      body = (
        <G {...p}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M12 11v5" />
          <Circle cx="12" cy="8" r="0.6" fill={color} stroke={color} strokeWidth="1.4" />
        </G>
      );
      break;
    case "ticket":
      body = (
        <G {...p}>
          <Path d="M3 8a2 2 0 012-2h14a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H5a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4z" />
        </G>
      );
      break;
    case "building":
      body = (
        <G {...p}>
          <Path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M15 21V11h3a1 1 0 011 1v9M8 7h2M8 11h2M8 15h2" />
        </G>
      );
      break;
    case "car":
      body = (
        <G {...p}>
          <Path d="M3 13l2-6h14l2 6v6h-3v-2H6v2H3v-6z" />
          <Circle cx="7" cy="16" r="1.3" fill={color} stroke="none" />
          <Circle cx="17" cy="16" r="1.3" fill={color} stroke="none" />
        </G>
      );
      break;
    case "utensils":
      body = (
        <G {...p}>
          <Path d="M5 3v8a2 2 0 004 0V3M7 11v10M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4m0-9v18" />
        </G>
      );
      break;
    case "plug":
      body = (
        <G {...p}>
          <Path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8zM12 17v4" />
        </G>
      );
      break;
    case "faceId":
      body = (
        <G {...p}>
          <Path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" />
          <Path d="M9 10v1M15 10v1M12 9v4l-1 1" />
          <Path d="M9 15s1 1.2 3 1.2S15 15 15 15" />
        </G>
      );
      break;
    case "download":
      body = (
        <G {...p}>
          <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <Path d="M7 10l5 5 5-5" />
          <Path d="M12 15V3" />
        </G>
      );
      break;
    case "minus":
      body = (
        <G {...p}>
          <Path d="M5 12h14" />
        </G>
      );
      break;
    case "cpu":
      body = (
        <G {...p}>
          <Rect x="6" y="6" width="12" height="12" rx="2" />
          <Path d="M12 10v4M10 12h4" />
          <Path d="M4 8v8M8 4v4M16 4v4M20 8v8M8 20v4M16 20v4" />
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
