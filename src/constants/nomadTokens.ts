import {
  getNomadColors,
  nomadDarkColors,
  nomadFonts,
  nomadLightColors,
  type NomadColors,
} from "@/constants/theme";

export const NOMAD_LIGHT = nomadLightColors;
export const NOMAD_DARK = nomadDarkColors;
export const NOMAD_FONTS = nomadFonts;

export type NomadTheme = NomadColors;

export function getNomadTheme(dark: boolean): NomadTheme {
  return getNomadColors(dark);
}
