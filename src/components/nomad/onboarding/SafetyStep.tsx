import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Line, Path, Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { NomadCard } from "../Card";
import { TravelMap } from "../TravelMap";
import { Icon } from "../Icon";
import { PermissionRow } from "../PermissionRow";
import {
  Eyebrow,
  HugeHeadline,
  HeadlineItalic,
  SectionLabel,
} from "../Typography";

interface Props {
  theme: NomadTheme;
  dark: boolean;
  totalSteps: number;
  selectedContacts: number[];
  setSelectedContacts: React.Dispatch<React.SetStateAction<number[]>>;
}

const contacts = [
  { n: "Mum", init: "M", colorKey: "teal", sub: "+44 · London" },
  { n: "Jamie", init: "J", colorKey: "mustard", sub: "+44 · Brighton" },
  { n: "Priya", init: "P", colorKey: "sky", sub: "+91 · Bangalore" },
  { n: "Dad", init: "D", colorKey: "stamp", sub: "+44 · Leeds" },
  { n: "Ravi", init: "R", colorKey: "teal", sub: "+61 · Melbourne" },
] as const;

export function SafetyStep({
  theme,
  dark,
  totalSteps,
  selectedContacts,
  setSelectedContacts,
}: Props) {
  const resolvedContacts = contacts.map((c) => ({
    ...c,
    color: theme[c.colorKey as keyof NomadTheme] as string,
  }));

  const toggle = (i: number) => {
    setSelectedContacts((sc) => {
      if (sc.includes(i)) return sc.filter((x) => x !== i);
      if (sc.length >= 3) return [sc[1], sc[2], i];
      return [...sc, i];
    });
  };

  const mapPins = [
    { x: 110, y: 120, color: theme.stamp, pulse: true },
    { x: 220, y: 85, color: theme.teal },
    { x: 280, y: 160, color: theme.mustard },
  ];

  const slotNames =
    selectedContacts.map((i) => resolvedContacts[i].n).join(" · ") ||
    "Pick up to three";

  return (
    <View style={{ flex: 1 }}>
      {/* Headline */}
      <View style={{ paddingHorizontal: 26, paddingTop: 6, paddingBottom: 18 }}>
        <Eyebrow color={theme.teal}>Step 1 of {totalSteps - 1}</Eyebrow>
        <HugeHeadline color={theme.inkDeep}>
          Your <HeadlineItalic>safety net</HeadlineItalic>.
        </HugeHeadline>
        <Text style={[styles.lede, { color: theme.inkSoft }]}>
          Location, trusted three, and an offline fallback — set up in one pass.
        </Text>
      </View>

      {/* 01 · LOCATION */}
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel step={1} color={theme.teal} title="Live location" theme={theme} />
        </View>
        <NomadCard theme={theme} padding={10} style={{ position: "relative", overflow: "hidden" }}>
          <TravelMap theme={theme} dark={dark} pins={mapPins} height={148}
            route={[{x:110,y:120},{x:160,y:100},{x:220,y:85},{x:250,y:120},{x:280,y:160}]}/>
          <View
            style={{
              position: "absolute",
              left: 18,
              bottom: 18,
              right: 18,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <View style={[styles.gpsPill, { backgroundColor: "rgba(26,22,18,0.88)" }]}>
              <Text style={[styles.gpsPillText, { color: theme.paperSoft }]}>
                ±8 m · GPS + Wi-Fi
              </Text>
            </View>
            <View style={[styles.livePill, { backgroundColor: theme.tealSoft }]}>
              <Text style={[styles.livePillText, { color: theme.teal }]}>● Live</Text>
            </View>
          </View>
        </NomadCard>
        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          {"Powers check-in timers, geofences, and emergency broadcasts. Adapts to save battery when you're still."}
        </Text>
      </View>

      {/* 02 · TRUSTED THREE */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel
            step={2}
            color={theme.mustard}
            title={`Trusted three · ${selectedContacts.length}/3`}
            theme={theme}
          />
        </View>

        {/* Selected slots */}
        <View
          style={[
            styles.slotRow,
            {
              backgroundColor: theme.paperSoft,
              borderColor: theme.mustard,
            },
          ]}
        >
          {[0, 1, 2].map((slot) => {
            const c = resolvedContacts[selectedContacts[slot]];
            if (!c) {
              return (
                <View
                  key={slot}
                  style={[styles.slotEmpty, { borderColor: theme.hairline }]}
                >
                  <Text style={{ color: theme.inkMuted, fontSize: 16 }}>+</Text>
                </View>
              );
            }
            return (
              <View
                key={slot}
                style={[
                  styles.slotFilled,
                  {
                    backgroundColor: c.color,
                    borderColor: theme.paperSoft,
                  },
                ]}
              >
                <Text style={styles.slotInit}>{c.init}</Text>
              </View>
            );
          })}
          <View style={{ flex: 1, marginLeft: 4 }}>
            <Text
              numberOfLines={1}
              style={[styles.slotName, { color: theme.inkDeep }]}
            >
              {slotNames}
            </Text>
            <Text style={[styles.slotSub, { color: theme.inkSoft }]}>
              SMS if you miss a check-in
            </Text>
          </View>
        </View>

        {/* Contact list */}
        <View style={{ gap: 6 }}>
          {resolvedContacts.map((c, i) => {
            const on = selectedContacts.includes(i);
            return (
              <Pressable
                key={i}
                onPress={() => toggle(i)}
                style={[
                  styles.contactRow,
                  {
                    backgroundColor: on ? theme.paperSoft : "transparent",
                    borderColor: on ? theme.mustard : theme.hairline,
                  },
                ]}
              >
                <View
                  style={[
                    styles.contactAvatar,
                    { backgroundColor: c.color },
                  ]}
                >
                  <Text style={styles.contactAvatarText}>{c.init}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.contactName, { color: theme.inkDeep }]}>
                    {c.n}
                  </Text>
                  <Text style={[styles.contactSub, { color: theme.inkSoft }]}>
                    {c.sub}
                  </Text>
                </View>
                <View
                  style={[
                    styles.checkBox,
                    {
                      borderColor: on ? theme.mustard : theme.hairline,
                      backgroundColor: on ? theme.mustard : "transparent",
                    },
                  ]}
                >
                  {on ? (
                    <Icon name="check" size={10} color="#fff" strokeWidth={3} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 03 · OFFLINE FALLBACK */}
      <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel step={3} color={theme.stamp} title="Offline fallback" theme={theme} />
        </View>

        <View style={styles.offlineHero}>
          <LinearGradient
            colors={[theme.inkDeep, "#2A332E"]}
            style={StyleSheet.absoluteFill}
          />
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 358 140"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.1 }]}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1="0"
                x2="358"
                y1={i * 20}
                y2={i * 20}
                stroke={theme.paperSoft}
                strokeWidth="0.4"
              />
            ))}
            {Array.from({ length: 18 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={i * 20}
                x2={i * 20}
                y1="0"
                y2="140"
                stroke={theme.paperSoft}
                strokeWidth="0.4"
              />
            ))}
          </Svg>

          {/* phone (you) */}
          <View
            style={[
              styles.offlinePhone,
              { backgroundColor: theme.stamp },
            ]}
          >
            <Icon name="shield" size={24} color="#fff" />
          </View>
          <Text style={[styles.offlineLabelLeft, { color: "rgba(255,255,255,0.65)" }]}>OFFLINE</Text>

          {/* arc */}
          <View style={styles.offlineArc}>
            <Svg width="200" height="34" viewBox="0 0 200 34">
              <Path
                d="M0,17 Q100,-10 200,17"
                fill="none"
                stroke={theme.mustard}
                strokeWidth="1.6"
                strokeDasharray="5 4"
              />
              <Polygon points="194,15 200,17 194,23" fill={theme.mustard} />
            </Svg>
          </View>

          <View
            style={[
              styles.smsBadge,
              { backgroundColor: theme.mustard },
            ]}
          >
            <Text style={[styles.smsBadgeText, { color: theme.inkDeep }]}>
              SMS · no data
            </Text>
          </View>

          {/* contact */}
          <View
            style={[styles.offlineContact, { backgroundColor: theme.teal }]}
          >
            <Text style={styles.offlineContactInit}>M</Text>
          </View>
          <Text style={[styles.offlineLabelRight, { color: "rgba(255,255,255,0.65)" }]}>MUM</Text>
        </View>

        <Text style={[styles.bodyCopy, { color: theme.inkSoft }]}>
          Lost signal mid-trek? We fall back to SMS — alerts still reach your three with your last GPS fix.
        </Text>
      </View>

      {/* Consolidated permissions */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ paddingHorizontal: 10 }}>
          <SectionLabel step={4} color={theme.sky} title="Permissions" theme={theme} />
        </View>
        <View style={{ gap: 6 }}>
          <PermissionRow theme={theme} title="Location · Always" sub="SOS, sharing, geofences" on />
          <PermissionRow theme={theme} title="Contacts + SMS" sub="Pick your three · offline fallback" on />
          <PermissionRow theme={theme} title="Offline maps" sub="Pre-caches current region · 1.2 GB" on />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lede: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.5,
    fontFamily: NOMAD_FONTS.ui,
  },
  bodyCopy: {
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 10,
    lineHeight: 12 * 1.45,
    fontFamily: NOMAD_FONTS.ui,
  },
  gpsPill: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  gpsPillText: {
    fontSize: 9.5,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.5,
  },
  livePill: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  livePillText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  slotRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 10,
  },
  slotEmpty: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  slotFilled: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  slotInit: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 13,
  },
  slotName: {
    fontSize: 11.5,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  slotSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: NOMAD_FONTS.ui,
  },
  contactRow: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  contactAvatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 12,
  },
  contactName: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: NOMAD_FONTS.uiSemi,
  },
  contactSub: {
    fontSize: 10.5,
    fontFamily: NOMAD_FONTS.ui,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineHero: {
    height: 140,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
  },
  offlinePhone: {
    position: "absolute",
    left: 20,
    top: 34,
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#C6432A",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  offlineLabelLeft: {
    position: "absolute",
    left: 20,
    top: 98,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
    width: 58,
    textAlign: "center",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  offlineArc: {
    position: "absolute",
    left: 76,
    top: 50,
  },
  smsBadge: {
    position: "absolute",
    left: 132,
    top: 22,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 7,
  },
  smsBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: NOMAD_FONTS.uiBold,
  },
  offlineContact: {
    position: "absolute",
    right: 20,
    top: 34,
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B6C5F",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  offlineContactInit: {
    color: "#fff",
    fontFamily: NOMAD_FONTS.uiBold,
    fontWeight: "700",
    fontSize: 22,
  },
  offlineLabelRight: {
    position: "absolute",
    right: 20,
    top: 98,
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
    textAlign: "center",
    width: 58,
    fontFamily: NOMAD_FONTS.uiBold,
  },
});
