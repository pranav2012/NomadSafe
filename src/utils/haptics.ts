import * as Haptics from "expo-haptics";

export function lightImpact() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function mediumImpact() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function heavyImpact() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export function successNotification() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function errorNotification() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
