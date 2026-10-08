import { useId } from "react";

export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg className={className} viewBox="80 140 352 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="96" y1="420" x2="416" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22C7B8" />
          <stop offset="0.55" stopColor="#5B6CFF" />
          <stop offset="1" stopColor="#9B7BFF" />
        </linearGradient>
      </defs>
      <path
        d="M184 340 V172 L328 340 V172"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="46"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M92 380 C170 430 342 430 420 380"
        fill="none"
        stroke="#EDEFF5"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray="2 22"
        opacity="0.6"
      />
    </svg>
  );
}
