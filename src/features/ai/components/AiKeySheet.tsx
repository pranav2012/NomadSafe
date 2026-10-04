import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PrivateView, track } from "@/modules/analytics";
import { AuraButton, AuraChip, AuraField, AuraSheet, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";
import { successNotification } from "@/utils/haptics";
import {
  BYOK_PROVIDER_DEFAULTS,
  RemoteAiError,
  byokProviderName,
  clearByokConfig,
  getByokConfig,
  isByokConfigComplete,
  saveByokConfig,
  testByokConfig,
  useByokStore,
  type ByokConfig,
  type ByokProvider,
} from "@/modules/ai";

const PROVIDERS: ByokProvider[] = ["openai", "anthropic", "gemini", "openai_compatible"];

/** Bring-your-own API key: provider, key and model, checked with a tiny request before saving. */
export function AiKeySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const saved = useByokStore((s) => s.summary);
  const [provider, setProvider] = useState<ByokProvider>(saved?.provider ?? "openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(saved?.model ?? BYOK_PROVIDER_DEFAULTS.openai.model);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);

  const keepsSavedKey = saved?.provider === provider && !apiKey.trim();
  const providerLabel = (id: ByokProvider) => (id === "openai_compatible" ? t("aiKey.providerOther") : byokProviderName({ provider: id }));

  const pickProvider = (next: ByokProvider) => {
    setProvider(next);
    setModel(saved?.provider === next ? saved.model : BYOK_PROVIDER_DEFAULTS[next].model);
  };

  const handleSave = async () => {
    const config: Partial<ByokConfig> = {
      provider,
      apiKey: keepsSavedKey ? getByokConfig()?.apiKey : apiKey.trim(),
      model: model.trim(),
      baseUrl: provider === "openai_compatible" ? baseUrl.trim() : undefined,
    };
    if (!isByokConfigComplete(config)) {
      showAlert(t("aiKey.incompleteTitle"), t(provider === "openai_compatible" ? "aiKey.incompleteBodyUrl" : "aiKey.incompleteBody"));
      return;
    }
    setBusy(true);
    try {
      await testByokConfig(config);
      await saveByokConfig(config);
      track("ai_key_saved", { provider });
      successNotification();
      setApiKey("");
      onClose();
    } catch (error) {
      logger.warn("aiKey", "key check failed", error);
      const status = error instanceof RemoteAiError ? error.status : undefined;
      const body =
        status === 401 || status === 403
          ? t("aiKey.invalidKey")
          : status === 404 || status === 400
            ? t("aiKey.invalidModel")
            : status === 429
              ? t("aiKey.rateLimited")
              : t("aiKey.checkFailed");
      showAlert(t("aiKey.checkFailedTitle"), body);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    showAlert(t("aiKey.removeTitle"), t("aiKey.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("aiKey.remove"),
        style: "destructive",
        onPress: async () => {
          await clearByokConfig();
          setApiKey("");
          onClose();
        },
      },
    ]);
  };

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={t("aiKey.title")}
      subtitle={t("aiKey.subtitle")}
      footer={
        <View style={styles.footer}>
          <AuraButton label={t("aiKey.testAndSave")} onPress={() => void handleSave()} loading={busy} />
          {saved ? <AuraButton label={t("aiKey.remove")} variant="ghost" size="md" onPress={handleRemove} disabled={busy} /> : null}
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {PROVIDERS.map((id) => (
            <AuraChip key={id} label={providerLabel(id)} selected={provider === id} onPress={() => pickProvider(id)} />
          ))}
        </View>

        {provider === "openai_compatible" ? (
          <AuraField
            label={t("aiKey.baseUrl")}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://openrouter.ai/api/v1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        ) : null}

        <PrivateView>
          <AuraField
            label={t("aiKey.apiKey")}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={saved?.provider === provider ? t("aiKey.savedKeyPlaceholder") : t("aiKey.apiKeyPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
          />
        </PrivateView>

        <AuraField
          label={t("aiKey.model")}
          value={model}
          onChangeText={setModel}
          placeholder={t("aiKey.modelPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {BYOK_PROVIDER_DEFAULTS[provider].suggestions.length > 0 ? (
          <View style={styles.chips}>
            {BYOK_PROVIDER_DEFAULTS[provider].suggestions.map((id) => (
              <AuraChip key={id} label={id} selected={model.trim() === id} onPress={() => setModel(id)} />
            ))}
          </View>
        ) : null}

        <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("aiKey.privacy")}</Text>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  note: { fontSize: 12.5, lineHeight: 18 },
  footer: { gap: 6 },
});
