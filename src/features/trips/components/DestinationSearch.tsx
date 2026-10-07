import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { AuraField, AuraSkeletonGroup, AuraSkeletonRow, Icon, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import {
  DESTINATION_RESULT_LIMIT,
  foldSearchText,
  searchOfflineDestinations,
  warmDestinationIndex,
  type DestinationOption,
} from "@/features/trips/data/destinations";
import { useOnlineDestinationSearch } from "@/features/trips/hooks/useOnlineDestinationSearch";

interface DestinationSearchProps {
  selected: string[];
  onSelect: (destination: string) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  large?: boolean;
}

/**
 * City/country search: instant matches from the bundled cities, topped up with Google suggestions
 * when those run short. A pick's coordinates are remembered for geocoding. Clears itself after a pick.
 */
export function DestinationSearch({ selected, onSelect, label, placeholder, autoFocus, large }: DestinationSearchProps) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const [query, setQuery] = useState("");
  // Typing stays responsive; results follow a frame behind under load.
  const searchQuery = useDeferredValue(query);
  const offline = useMemo(() => searchOfflineDestinations(searchQuery, locale, selected), [locale, searchQuery, selected]);
  const online = useOnlineDestinationSearch(searchQuery, offline.length, locale);

  useEffect(() => {
    const timer = setTimeout(() => warmDestinationIndex(locale), 0);
    return () => clearTimeout(timer);
  }, [locale]);

  const options = useMemo(() => {
    const taken = new Set([...selected, ...offline.map((option) => option.label)].map(foldSearchText));
    const extra = online.results.filter((option) => !taken.has(foldSearchText(option.label)));
    return [...offline, ...extra].slice(0, DESTINATION_RESULT_LIMIT);
  }, [offline, online.results, selected]);
  const showsOnline = options.some((option) => option.kind === "online");

  const typed = query.trim().length >= 2;
  const empty = options.length === 0;
  const searching = empty && online.status === "loading";
  const message =
    !empty ? null
    : online.status === "error" ? t("trip.destinationSearchUnavailable")
    : online.status === "done" ? t("trip.noDestinationMatches")
    : null;

  const pick = (option: DestinationOption) => {
    online.choose(option);
    onSelect(option.label);
    setQuery("");
  };

  return (
    <View style={styles.wrap}>
      <AuraField
        label={label}
        large={large}
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder ?? t("trip.destinationPlaceholder")}
        autoCapitalize="words"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={(event) => {
          // The field's own text: the deferred results can lag a render behind fast typing.
          const best = searchOfflineDestinations(event.nativeEvent.text, locale, selected, 1)[0] ?? options[0];
          if (best) pick(best);
        }}
        prefix={<Icon name="search" size={large ? 20 : 16} color={c.textMuted} />}
      />
      {typed && (!empty || message || searching) ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.dropdown, { backgroundColor: c.card, borderColor: c.hairline }]}>
          {options.map((option) => (
            <OptionRow key={option.id} option={option} onPress={() => pick(option)} />
          ))}
          {searching ? (
            <AuraSkeletonGroup label={t("trip.searchingDestinations")}>
              {[0, 1].map((i) => (
                <AuraSkeletonRow key={i} leading="square" size={34} style={styles.row} />
              ))}
            </AuraSkeletonGroup>
          ) : null}
          {message ? (
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: c.surfaceStrong }]}>
                <Icon name="globe" size={16} color={c.textSoft} />
              </View>
              <Text numberOfLines={2} style={[styles.rowSub, styles.rowText, { color: c.textMuted, fontFamily: f.regular }]}>
                {message}
              </Text>
            </View>
          ) : null}
          {showsOnline ? <Text style={[styles.attribution, { color: c.textMuted, fontFamily: f.medium }]}>Google Maps</Text> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const KIND_LABELS = {
  city: "trip.destinationCity",
  place: "trip.destinationPlace",
  country: "trip.destinationCountry",
  online: "trip.destinationOnline",
} as const;

function OptionRow({ option, onPress }: { option: DestinationOption; onPress: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} style={styles.row} accessibilityRole="button" accessibilityLabel={option.label}>
      <View style={[styles.rowIcon, { backgroundColor: c.surfaceStrong }]}>
        <Icon name={option.kind === "country" ? "globe" : "mapPin"} size={16} color={c.textSoft} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: c.text, fontFamily: f.semibold }]}>
          {option.label}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSub, { color: c.textMuted, fontFamily: f.regular }]}>
          {option.detail ?? t(KIND_LABELS[option.kind])}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  dropdown: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, flexShrink: 1 },
  rowSub: { fontSize: 12.5 },
  attribution: { fontSize: 11, textAlign: "right", paddingHorizontal: 14, paddingBottom: 8 },
});
