import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { Icon, useAura } from "@/atoms";
import { selectionChanged } from "@/utils/haptics";
import { AURORA } from "./recapGeometry";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const STEP_MS = 55;
const STEPS = 7;
const STAGGER_MS = 70;

function FlapTile({ char, index, width, height }: { char: string; index: number; width: number; height: number }) {
  const { f } = useAura();
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(" ");
  const squash = useSharedValue(1);

  // Clatters through random letters before landing on `char`, like a departure board.
  useEffect(() => {
    if (reduceMotion) return;
    let step = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        step += 1;
        squash.set(withSequence(withTiming(0.55, { duration: STEP_MS / 3 }), withTiming(1, { duration: STEP_MS / 2 })));
        if (step < STEPS) {
          setShown(LETTERS[Math.floor(Math.random() * LETTERS.length)]);
          return;
        }
        setShown(char);
        selectionChanged();
        clearInterval(interval);
      }, STEP_MS);
    }, index * STAGGER_MS);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [char, index, reduceMotion, squash]);

  const letterStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: squash.get() }] }));

  return (
    <View style={[styles.tile, { width, height, borderRadius: width * 0.16 }]}>
      <LinearGradient colors={["#1C202B", "#12151D"]} style={StyleSheet.absoluteFill} />
      <Animated.Text style={[styles.letter, { fontFamily: f.semibold, fontSize: width * 0.98, lineHeight: height }, letterStyle]}>{reduceMotion ? char : shown}</Animated.Text>
      <View style={[styles.seam, { top: height / 2 - 1 }]} />
    </View>
  );
}

/** Departure-board tiles spelling `codes` ("TOK", "OSA"), with the aurora plane tile between two codes. */
export function FlapBoard({ codes, tile = 44, gap = 6 }: { codes: string[]; tile?: number; gap?: number }) {
  const height = Math.round(tile * 1.45);
  const cells: (string | null)[] = codes.length > 1 ? [...codes[0].split(""), null, ...codes[codes.length - 1].split("")] : (codes[0]?.split("") ?? []);
  return (
    <View style={[styles.row, { gap }]} accessible accessibilityLabel={codes.join(" → ")}>
      {cells.map((cell, i) =>
        cell === null ? (
          <View key={`plane-${i}`} style={[styles.tile, styles.plane, { width: tile, height, borderRadius: tile * 0.16 }]}>
            <LinearGradient colors={AURORA as [string, string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={styles.planeIcon}>
              <Icon name="plane" size={tile * 0.6} color="#FFFFFF" strokeWidth={2.1} />
            </View>
          </View>
        ) : (
          <FlapTile key={`${i}-${codes.join("")}`} char={cell} index={i} width={tile} height={height} />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  tile: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  plane: { borderWidth: 0 },
  planeIcon: { transform: [{ rotate: "90deg" }] },
  letter: { color: "#EDEFF5", textAlign: "center", letterSpacing: -1, includeFontPadding: false },
  seam: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: "rgba(0,0,0,0.55)" },
});

