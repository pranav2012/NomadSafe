import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraField } from "@/components/aura/AuraField";
import { useAura } from "@/components/aura/useAura";
import { useLocalization } from "@/localization";
import { searchOfflineDestinations, type DestinationOption } from "@/features/trips/data/destinations";
import { useWebDestinationSearch } from "@/features/trips/hooks/useWebDestinationSearch";

interface DestinationSearchProps {
  selected: string[];
  onSelect: (destination: string) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  large?: boolean;
}

/**
 * City/country search: instant offline matches as you type, with a "search the web" fallback when
 * nothing matches. Clears itself after a pick.
 */
export function DestinationSearch({ selected, onSelect, label, placeholder, autoFocus, large }: DestinationSearchProps) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const [query, setQuery] = useState("");
  const web = useWebDestinationSearch(selected);
  const offline = useMemo(() => searchOfflineDestinations(query, locale, selected), [locale, query, selected]);
  const typed = query.trim().length >= 2;
  const showLookup = typed && offline.length === 0 && web.results.length === 0;
  const showDropdown = typed || web.results.length > 0 || Boolean(web.error);

  const pick = (destination: string) => {
    onSelect(destination);
    setQuery("");
    web.reset();
  };

  return (
    <Animated.View layout={LinearTransition.duration(200)} style={styles.wrap}>
      <AuraField
        label={label}
        large={large}
        value={query}
        onChangeText={(value) => {
          web.reset();
          setQuery(value);
        }}
        placeholder={placeholder ?? t("trip.destinationPlaceholder")}
        autoCapitalize="words"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={() => {
          if (offline[0]) pick(offline[0].label);
          else if (typed) web.search(query);
        }}
        prefix={<Icon name="search" size={large ? 20 : 16} color={c.textMuted} />}
      />
      {showDropdown ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.dropdown, { backgroundColor: c.card, borderColor: c.hairline }]}>
          {[...offline, ...web.results].map((option) => (
            <OptionRow key={option.id} option={option} onPress={() => pick(option.label)} />
          ))}
          {showLookup ? (
            <PressableScale onPress={() => web.search(query)} disabled={web.isSearching} pressedScale={0.98} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: c.surfaceStrong }]}>
                {web.isSearching ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="globe" size={16} color={c.textSoft} />}
              </View>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: c.text, fontFamily: f.medium }]}>
                {t("trip.searchWebForDestination", { query: query.trim() })}
              </Text>
            </PressableScale>
          ) : null}
          {web.error ? <Text style={[styles.error, { color: "#FF4D5E", fontFamily: f.regular }]}>{web.error}</Text> : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function OptionRow({ option, onPress }: { option: DestinationOption; onPress: () => void }) {
  const { c, f } = useAura();
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} style={styles.row} accessibilityRole="button" accessibilityLabel={option.label}>
      <View style={[styles.rowIcon, { backgroundColor: c.surfaceStrong }]}>
        <Icon name="mapPin" size={16} color={c.textSoft} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: c.text, fontFamily: f.semibold }]}>
          {option.label}
        </Text>
        {option.detail ? (
          <Text numberOfLines={1} style={[styles.rowSub, { color: c.textMuted, fontFamily: f.regular }]}>
            {option.detail}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  dropdown: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, flexShrink: 1 },
  rowSub: { fontSize: 12.5 },
  error: { fontSize: 12.5, paddingHorizontal: 14, paddingBottom: 8 },
});
