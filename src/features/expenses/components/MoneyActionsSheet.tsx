import React from "react";
import { StyleSheet, View } from "react-native";
import { AuraListGroup, AuraListRow, AuraSheet, type IconName } from "@/atoms";

export interface MoneyAction {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
}

/** The Money header's ⋯ menu; closes before running the picked action. */
export function MoneyActionsSheet({ visible, title, actions, onClose }: { visible: boolean; title: string; actions: MoneyAction[]; onClose: () => void }) {
  return (
    <AuraSheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.body}>
        <AuraListGroup>
          {actions.map((action) => (
            <AuraListRow
              key={action.label}
              icon={action.icon}
              label={action.label}
              detail={action.detail}
              onPress={() => {
                onClose();
                action.onPress();
              }}
            />
          ))}
        </AuraListGroup>
      </View>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 16 },
});
