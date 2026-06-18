export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  defaultCurrency: string;
}

export type ThemeMode = "light" | "dark" | "system";

export interface OnboardingSlide {
  id: string;
  title: string;
  description: string;
  icon: string;
}
