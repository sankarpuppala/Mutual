/**
 * The You tab (SPEC.md §13.2, §13.9): a preview of how you appear, then the four settings
 * rows and account deletion with an inline confirmation.
 *
 * Three details matter more than they look:
 *
 *  - **Discovery pause** is a switch, not buried in a menu (safety requirement S6). Someone
 *    who wants to stop being noticed should be able to do it in two taps.
 *  - **The notifications row makes a promise** -- one kind of notification only -- and it is
 *    a row rather than a toggle because there is nothing to configure.
 *  - **Deleting the account confirms inline**, not in a system dialog, so the consequence
 *    can be written out in full.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { isDev } from "@/api/client";
import {
  deleteAccount,
  getMe,
  pauseDiscovery,
  resumeDiscovery,
} from "@/api/endpoints";
import { GenerativeAvatar } from "@/components/GenerativeAvatar";
import { Icon } from "@/design/icons";
import {
  AppText,
  Button,
  Card,
  Hairline,
  Screen,
  ScreenHeader,
  Stack,
} from "@/design/primitives";
import { useTheme } from "@/design/theme";
import { radius, space } from "@/design/tokens";
import { NativeBle } from "@/presence/nativeBle";
import { runNightlyWork } from "@/presence/schedule";
import { clearAll, getIdentity } from "@/storage/secure";

export default function YouScreen(): ReactNode {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: getMe });

  // The avatar is a hash of the identity public key, so "a preview of how you appear" has
  // to hash the same value every peer hashes. It used to be given `user_id`, which is a
  // different string and therefore a different blob: the one thing this card promises to
  // show was the one thing it got wrong. The key is on the device already -- asking the
  // server for it would be a request that exists only because this screen was opened.
  const [identityPk, setIdentityPk] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getIdentity().then((identity) => {
      if (!cancelled) setIdentityPk(identity?.pk ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePause = useMutation({
    mutationFn: async (paused: boolean) => {
      // Stop the radio first when pausing: the user asked to stop being noticed, and the
      // server call only stops them appearing in other people's letters.
      if (paused) await new NativeBle().stop().catch(() => undefined);
      await (paused ? pauseDiscovery() : resumeDiscovery());
      // Resuming goes through the nightly pass rather than `start()` directly: that is
      // what fetches `GET /v1/config` and applies the server's `ble.*` settings to the
      // radio, and what hands native a fresh schedule. Calling `start()` here would run
      // the radio on nativeBle.ts's compiled-in defaults instead (CLAUDE.md §6: no
      // tunable number inline in code).
      if (!paused) await runNightlyWork().catch(() => undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await new NativeBle().stop().catch(() => undefined);
      await deleteAccount();
      await clearAll();
    },
    onSuccess: () => {
      queryClient.clear();
      router.replace("/(onboarding)/welcome");
    },
  });

  const paused = me.data?.discovery_paused ?? false;
  const lookingFor = me.data?.profile?.prompts.find(
    (p) => p.prompt_id === "looking_for",
  );
  const photoCount = me.data?.profile?.photos.length ?? 0;

  return (
    <Screen testID="you">
      <ScreenHeader title="You" />

      <Card>
        <View style={styles.head}>
          {me.data ? (
            <GenerativeAvatar
              identityPk={identityPk ?? me.data.user_id}
              size={60}
            />
          ) : (
            <View
              style={[
                styles.avatarPlaceholder,
                { backgroundColor: theme.colors.surfaceSunk },
              ]}
            />
          )}
          <View style={styles.who}>
            <AppText variant="nameSmall">{me.data?.first_name ?? " "}</AppText>
            <AppText variant="small" tone="muted">
              {me.data
                ? [
                    me.data.year_of_study
                      ? `Year ${me.data.year_of_study}`
                      : null,
                    me.data.campus.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : " "}
            </AppText>
          </View>
        </View>

        {lookingFor ? (
          <View style={styles.prompt}>
            <AppText variant="promptQuestion" tone="muted">
              I&rsquo;m looking for
            </AppText>
            <AppText variant="promptAnswer">{lookingFor.text}</AppText>
          </View>
        ) : (
          <AppText variant="body" tone="muted">
            Your three answers are how people meet you. Add them next.
          </AppText>
        )}

        <Button
          label={lookingFor ? "Edit answers" : "Write your answers"}
          kind="ghost"
          onPress={() => router.push("/(onboarding)/prompts")}
        />
      </Card>

      <View
        style={[
          styles.settings,
          { backgroundColor: theme.colors.surface },
          theme.shadow,
        ]}
      >
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <AppText variant="listTitle">Discovery</AppText>
            <AppText variant="small" tone="muted">
              {paused
                ? "Paused. You won’t appear in anyone’s letter."
                : "Mutual is on. Pause any time."}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Discovery"
            accessibilityState={{ checked: !paused }}
            onPress={() => togglePause.mutate(!paused)}
            style={[
              styles.switch,
              {
                backgroundColor: paused
                  ? theme.colors.hairline
                  : theme.colors.ink,
              },
            ]}
          >
            <View
              style={[
                styles.knob,
                { backgroundColor: theme.colors.surface },
                !paused && styles.knobOn,
              ]}
            />
          </Pressable>
        </View>
        <Hairline />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Photos"
          onPress={() => router.push("/(onboarding)/photos")}
          style={styles.row}
        >
          <View style={styles.rowMain}>
            <AppText variant="listTitle">Photos</AppText>
            <AppText variant="small" tone="muted">
              {photoCount === 0
                ? "None yet · shown only after a mutual"
                : `${photoCount} added · shown only after a mutual`}
            </AppText>
          </View>
          <Icon name="right" size={20} color={theme.colors.inkMuted} />
        </Pressable>
        <Hairline />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What Mutual can and can never see"
          onPress={() => router.push("/privacy")}
          style={styles.row}
        >
          <View style={styles.rowMain}>
            <AppText variant="listTitle">
              What Mutual can and can never see
            </AppText>
            <AppText variant="small" tone="muted">
              In plain words
            </AppText>
          </View>
          <Icon name="right" size={20} color={theme.colors.inkMuted} />
        </Pressable>
        <Hairline />

        <View style={styles.row}>
          <View style={styles.rowMain}>
            <AppText variant="listTitle">Notifications</AppText>
            <AppText variant="small" tone="muted">
              Only one kind: &ldquo;Your morning letter is here.&rdquo;
            </AppText>
          </View>
        </View>
        <Hairline />

        {/* Dev builds only (invariant 11); never rendered in a production build. */}
        {isDev() ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dev panel"
              onPress={() => router.push("/dev")}
              style={styles.row}
            >
              <View style={styles.rowMain}>
                <AppText variant="listTitle">Dev panel</AppText>
                <AppText variant="small" tone="muted">
                  Demo accounts, clock travel · dev builds only
                </AppText>
              </View>
              <Icon name="right" size={20} color={theme.colors.inkMuted} />
            </Pressable>
            <Hairline />
          </>
        ) : null}

        {confirmDelete ? (
          <Stack gap={space.md} style={styles.confirm}>
            <AppText variant="listTitle">Delete your account?</AppText>
            <AppText variant="small" tone="muted">
              Your profile, mutuals and messages are removed within 24 hours.
              Anyone you have matched with keeps the match as ended, with no
              chat and no photos — that is deliberate, so nobody can erase a
              mutual for the other person. This cannot be undone.
            </AppText>
            <View style={styles.confirmActions}>
              <Button
                label={remove.isPending ? "Deleting…" : "Delete account"}
                kind="danger"
                small
                disabled={remove.isPending}
                onPress={() => remove.mutate()}
              />
              <Button
                label="Keep my account"
                kind="ghost"
                small
                onPress={() => setConfirmDelete(false)}
              />
            </View>
          </Stack>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            onPress={() => setConfirmDelete(true)}
            style={styles.row}
          >
            <View style={styles.rowMain}>
              <AppText variant="listTitle" tone="danger">
                Delete account
              </AppText>
            </View>
          </Pressable>
        )}
      </View>

      <AppText variant="small" tone="muted" center style={styles.footnote}>
        Mutual is an unaudited research prototype.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  avatarPlaceholder: { width: 60, height: 60, borderRadius: 30 },
  who: { flex: 1, gap: 2 },
  prompt: { gap: space.xs + 2 },
  settings: {
    marginTop: space.xl - 4,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    minHeight: 64,
  },
  rowMain: { flex: 1, gap: 2 },
  switch: { width: 50, height: 30, borderRadius: radius.pill, padding: 3 },
  knob: { width: 24, height: 24, borderRadius: 12 },
  knobOn: { transform: [{ translateX: 20 }] },
  confirm: { padding: space.lg },
  confirmActions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  footnote: { marginTop: space.xl + space.xs },
});
