import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraField, AuraSheet, useAura } from "@/atoms";
import { auraSignal } from "@/constants/aura";
import { authClient } from "@/modules/backend";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";

/** Email and password sign-in for the app review account (opened by tapping the title on the sign-in screen 10 times). */
export function ReviewerSignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { f } = useAura();
  const { t } = useLocalization();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result?.error) {
        track("sign_in_failed");
        setError(t("auth.reviewerFailed"));
        return;
      }
      // The root stack's guards leave sign-in once the session syncs.
      onClose();
    } catch {
      track("sign_in_failed");
      setError(t("auth.reviewerFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={t("auth.reviewerTitle")}
      footer={<AuraButton label={t("auth.reviewerSignIn")} onPress={submit} loading={busy} disabled={!email.trim() || !password} />}
    >
      <View style={styles.body}>
        <AuraField
          label={t("auth.reviewerEmail")}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
        />
        <AuraField
          label={t("auth.reviewerPassword")}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          onSubmitEditing={submit}
        />
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { fontFamily: f.medium }]}>
            {error}
          </Text>
        ) : null}
      </View>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12, gap: 14 },
  error: { color: auraSignal.danger, fontSize: 13, lineHeight: 18, textAlign: "center" },
});
