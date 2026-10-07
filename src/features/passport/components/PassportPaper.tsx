import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Fill, Path, Shader, Skia } from "react-native-skia";
import { auraFonts as f } from "@/constants/aura";
import { HOSKINS_HASH, lazyEffect, markPaths } from "./PassportCover";

/** Ink colours for text on the light passport paper. */
export const INK = {
  text: "#1D2230",
  soft: "#454C5E",
  muted: "#787D8C",
  line: "rgba(29,34,48,0.14)",
  field: "rgba(29,34,48,0.05)",
};

export const PAPER_RGB = [0.95, 0.937, 0.9];

// Security paper: cream, fine wavy lines and a guilloché rosette (two interfering sets of wavy rings).
const PAPER = lazyEffect(`
uniform float2 res;
uniform float2 rosette;
${HOSKINS_HASH}

float lines(float v, float period) {
  float d = abs(fract(v / period) - 0.5) * period;
  return 1.0 - smoothstep(0.0, 0.75, d);
}

half4 main(float2 xy) {
  float2 uv = xy / res;
  float3 col = mix(float3(0.957, 0.945, 0.91), float3(0.925, 0.91, 0.863), uv.y);
  float edge = min(min(xy.x, res.x - xy.x), min(xy.y, res.y - xy.y));
  col = mix(float3(0.88, 0.91, 0.93), col, smoothstep(0.0, 70.0, edge));

  float w1 = lines(xy.y + sin(xy.x * 0.031) * 10.0 + sin(xy.x * 0.012 + 1.0) * 18.0, 10.0);
  float w2 = lines(xy.y + sin(xy.x * 0.027 + 2.0) * 12.0 + sin(xy.x * 0.009) * 22.0 + 5.0, 10.0);

  float2 q = xy - rosette;
  float r = length(q);
  float th = atan(q.y, q.x);
  float ring = smoothstep(res.x * 0.42, res.x * 0.36, r) * smoothstep(res.x * 0.06, res.x * 0.12, r);
  float ra = lines(r + 7.0 * sin(14.0 * th), 7.0);
  float rb = lines(r + 7.0 * sin(14.0 * th + 1.5708) + 3.5, 7.0);

  float3 teal = float3(0.12, 0.52, 0.52);
  float3 indigo = float3(0.3, 0.33, 0.68);
  col = mix(col, teal, w1 * 0.08 + ra * ring * 0.15);
  col = mix(col, indigo, w2 * 0.06 + rb * ring * 0.12);
  col += (hash(floor(xy * 1.3)) - 0.5) * 0.018;
  return half4(half3(col), 1.0);
}
`);

// 5×7 dot digits for the perforated serial number.
const DIGITS = [
  "01110100011001110101110011000101110",
  "00100011000010000100001000010001110",
  "01110100010000100010001000100011111",
  "11110000010000101110000010000111110",
  "00010001100101010010111110001000010",
  "11111100001111000001000011000101110",
  "00110010001000011110100011000101110",
  "11111000010001000100010000100001000",
  "01110100011000101110100011000101110",
  "01110100011000101111000010001001100",
];
const PITCH = 2.3;

/** Dots for `serial` (digits only), read top to bottom down the right edge, punched as small holes. */
function perforation(serial: string, x: number, y: number) {
  const path = Skia.PathBuilder.Make();
  [...serial.replace(/\D/g, "")].forEach((ch, k) => {
    const bits = DIGITS[Number(ch)];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (bits[row * 5 + col] !== "1") continue;
        path.addCircle(x + (6 - row) * PITCH, y + k * PITCH * 7 + col * PITCH, 0.75);
      }
    }
  });
  return path.build();
}

interface Props {
  width: number;
  height: number;
  page: number;
  serial: string;
  children: React.ReactNode;
}

/** A light security-paper passport page: guilloché, a watermark N, page number and perforated serial. */
export function PassportPaper({ width, height, page, serial, children }: Props) {
  const uniforms = useMemo(() => ({ res: [width, height], rosette: [width / 2, height * 0.52] }), [width, height]);
  const mark = useMemo(() => markPaths(width / 2 - width * 0.3, height * 0.52 - width * 0.3, width * 0.6), [width, height]);
  const holes = useMemo(() => perforation(serial, width - 26, height * 0.36), [serial, width, height]);
  return (
    <View style={styles.flex}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={PAPER()} uniforms={uniforms} />
        </Fill>
        <Path path={mark.n} style="stroke" strokeWidth={46 * mark.scale} strokeCap="round" strokeJoin="round" color="rgba(76,84,170,0.07)" />
        <Path path={holes} color="rgba(95,82,58,0.42)" />
      </Canvas>
      {children}
      <Text style={styles.page}>{page}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { position: "absolute", right: 24, bottom: 14, fontFamily: f.medium, fontSize: 11, color: INK.muted },
});
