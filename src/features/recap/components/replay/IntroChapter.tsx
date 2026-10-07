import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useLocalization } from "@/localization";
import { FlapBoard } from "../FlapBoard";
import { placeCode, type TripRecap } from "../../hooks/useTripRecap";
import { rise, rs } from "./replayStyles";

export function IntroChapter({ recap, top }: { recap: TripRecap; top: number }) {
  const { t } = useLocalization();
  const { places } = recap;
  const { width } = useWindowDimensions();
  const codes = places.length > 1 ? [placeCode(places[0]), placeCode(places[places.length - 1])] : [placeCode(places[0] ?? "")];
  const cells = codes.join("").length + (codes.length > 1 ? 1 : 0);
  const tile = Math.min(44, Math.floor((width - 48 - (cells - 1) * 6) / Math.max(1, cells)));
  return (
    <View style={[rs.block, { top }]}>
      <Text style={rs.kicker}>{t("recap.introKicker")}</Text>
      <Animated.Text entering={rise(150, 420)} numberOfLines={3} style={rs.headline}>
        {recap.headline}
      </Animated.Text>
      <View style={{ marginVertical: 12 }}>
        <FlapBoard codes={codes} tile={tile} />
      </View>
      <Text style={rs.sub}>{[recap.title, recap.via].filter(Boolean).join(", ")}</Text>
      <Text style={[rs.sub, rs.muted]}>{recap.dates}</Text>
    </View>
  );
}
