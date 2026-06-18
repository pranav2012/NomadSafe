import React, { useMemo } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { palette } from "@/constants/theme";

interface AvatarProps {
  name?: string;
  imageUri?: string;
  size?: number;
}

const AVATAR_COLORS = [
  palette.blue[500],
  palette.green[500],
  palette.orange[500],
  palette.red[500],
  palette.blue[700],
  palette.green[700],
];

/** Generates initials and a deterministic background color from a name */
function getAvatarData(name: string) {
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];

  return { initials, color };
}

export function Avatar({ name, imageUri, size = 40 }: AvatarProps) {
  const { typography } = useTheme();
  const avatarData = useMemo(
    () => (name ? getAvatarData(name) : null),
    [name],
  );

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: avatarData?.color ?? palette.gray[400],
  };

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={[styles.image, containerStyle]}
      />
    );
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <Text
        style={{
          color: palette.white,
          fontSize: size * 0.4,
          fontWeight: typography.weights.semibold,
        }}
      >
        {avatarData?.initials ?? "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  image: { overflow: "hidden" },
});
