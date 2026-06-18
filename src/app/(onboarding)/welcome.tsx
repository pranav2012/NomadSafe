import React, { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  type ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsStore } from "@/stores/settingsStore";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/layout/Screen";
import { SCREEN_WIDTH } from "@/constants/layout";

interface Slide {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const slides: Slide[] = [
  {
    id: "1",
    title: "Track expenses, split costs",
    description:
      "Keep all your travel expenses organized and easily split bills with fellow travelers.",
    icon: "wallet-outline",
  },
  {
    id: "2",
    title: "Stay safe with SOS alerts",
    description:
      "Send emergency alerts with your location to trusted contacts instantly.",
    icon: "shield-checkmark-outline",
  },
  {
    id: "3",
    title: "AI-powered travel insights",
    description:
      "Get smart recommendations, safety tips, and local insights powered by AI.",
    icon: "sparkles-outline",
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const setOnboardingCompleted = useSettingsStore(
    (s) => s.setOnboardingCompleted,
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
  ).current;

  const handleGetStarted = () => {
    setOnboardingCompleted(true);
    router.replace("/(auth)/sign-in");
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    }
  };

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <Screen edges={["top", "bottom"]} padding={false}>
      <FlatList
        ref={flatListRef}
        data={slides}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <Ionicons
              name={item.icon}
              size={120}
              color={colors.primary}
              style={{ marginBottom: spacing["3xl"] }}
            />
            <Text
              style={[
                styles.title,
                {
                  color: colors.text,
                  fontSize: typography.sizes["3xl"],
                  fontWeight: typography.weights.bold,
                  marginBottom: spacing.md,
                },
              ]}
            >
              {item.title}
            </Text>
            <Text
              style={[
                styles.description,
                {
                  color: colors.textSecondary,
                  fontSize: typography.sizes.base,
                  lineHeight: typography.sizes.base * typography.lineHeights.relaxed,
                },
              ]}
            >
              {item.description}
            </Text>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingHorizontal: spacing.lg, paddingBottom: spacing["2xl"] }]}>
        <View style={styles.dots}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    index === currentIndex
                      ? colors.primary
                      : colors.border,
                },
              ]}
            />
          ))}
        </View>

        <Button
          title={isLastSlide ? "Get Started" : "Next"}
          onPress={isLastSlide ? handleGetStarted : handleNext}
          fullWidth
          size="lg"
        />

        {!isLastSlide && (
          <Button
            title="Skip"
            onPress={handleGetStarted}
            variant="ghost"
            fullWidth
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: { textAlign: "center" },
  description: { textAlign: "center", maxWidth: 300 },
  footer: { gap: 12 },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
