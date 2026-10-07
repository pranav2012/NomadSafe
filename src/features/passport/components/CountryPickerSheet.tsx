import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { AuraField, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { countryCodes } from "@/features/recap/utils/countryShapes";
import { countryDisplayName, foldSearchText } from "@/features/trips/data/destinations";
import { useLocalization } from "@/localization";
import { selectionChanged } from "@/utils/haptics";

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Shown first, e.g. "Automatic · India"; null hides it. */
  automaticLabel: string | null;
  selected: string | null;
  onSelect: (code: string | null) => void;
}

/** Searchable list of every country, with an optional "automatic" row on top. */
export function CountryPickerSheet({ visible, onClose, title, automaticLabel, selected, onSelect }: Props) {
  const { c, f, accent } = useAura();
  const { t, locale } = useLocalization();
  const [query, setQuery] = useState("");
  const countries = useMemo(
    () =>
      countryCodes()
        .map((code) => ({ code, name: countryDisplayName(code, locale) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locale],
  );
  const folded = foldSearchText(query);
  const rows = folded ? countries.filter((country) => foldSearchText(country.name).includes(folded) || country.code.toLowerCase() === folded) : countries;
  const choose = (code: string | null) => {
    selectionChanged();
    onSelect(code);
    setQuery("");
    onClose();
  };

  const row = (code: string | null, label: string) => (
    <PressableScale onPress={() => choose(code)} haptic={false} accessibilityRole="button" accessibilityState={{ selected: selected === code }} style={[styles.row, { borderColor: c.hairline }]}>
      <Text numberOfLines={1} style={[styles.label, { color: c.text, fontFamily: f.medium }]}>
        {label}
      </Text>
      {selected === code ? <Icon name="check" size={16} color={accent} /> : null}
    </PressableScale>
  );

  return (
    <AuraSheet visible={visible} onClose={onClose} title={title} full>
      <View style={styles.search}>
        <AuraField value={query} onChangeText={setQuery} placeholder={t("passport.searchCountries")} autoCorrect={false} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.code}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={automaticLabel && !folded ? row(null, automaticLabel) : null}
        renderItem={({ item }) => row(item.code, item.name)}
        contentContainerStyle={styles.list}
      />
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 20, paddingBottom: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 16 },
});
