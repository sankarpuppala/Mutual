/**
 * The dev panel (SPEC.md §13.2). Present only when the app is built against a dev server;
 * it renders a refusal otherwise, and `/v1/dev/*` does not exist on a non-dev server anyway
 * (CLAUDE.md invariant 11).
 *
 * What it is for: driving the parts of the loop that normally take a day. Travelling the
 * clock past a release time, manufacturing a crossing, and running the nightly work on
 * demand are what make `docs/E2E_CHECKLIST.md` runnable in an afternoon instead of a week.
 *
 * It also shows tonight's randomly chosen upload minute. That is dev-only on purpose:
 * knowing the minute in advance is exactly the predictable schedule the random draw exists
 * to prevent (SPEC §6.11).
 */

import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { isDev } from "@/api/client";
import { dev, getConfig, type DemoAccount } from "@/api/endpoints";
import {
  runProtocolSelfTest,
  type SelfTestResult,
} from "@/dev/protocolSelfTest";
import { Icon } from "@/design/icons";
import {
  AppText,
  BarButton,
  Button,
  Card,
  Screen,
  ScreenHeader,
  SectionHeading,
  Stack,
  TextField,
} from "@/design/primitives";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";
import { FakeBle } from "@/presence/fakeBle";
import { buildSchedule, ensureLookahead } from "@/presence/dailyKeys";
import { drainInto } from "@/presence/drain";
import { plannedUploadMinute, runNightlyWork } from "@/presence/schedule";
import { localDay } from "@/signals/scheduler";
import {
  getUserId,
  setIdentity,
  setSessionToken,
  setUserId,
} from "@/storage/secure";

interface SelfTestState {
  result: SelfTestResult | null;
  error: string | null;
}

/** Runs the self-test, turning a thrown error into a displayable message. */
function runSafely(): SelfTestState {
  try {
    return { result: runProtocolSelfTest(), error: null };
  } catch (e) {
    return {
      result: null,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

/** "21:47" from a minute-of-day. */
function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export default function DevScreen(): ReactNode {
  const theme = useTheme();
  // The self-test is synchronous and pure, so it runs as the initial state rather than in
  // an effect: no cascading render, and the panel is correct on its very first frame.
  const [{ result, error }, setState] = useState(runSafely);
  const run = useCallback(() => setState(runSafely()), []);

  const config = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    enabled: isDev(),
  });
  const plannedQuery = useQuery({
    queryKey: ["planned-upload-minute"],
    queryFn: () => plannedUploadMinute(),
    enabled: isDev(),
  });
  const demo = useQuery({
    queryKey: ["demo-accounts"],
    queryFn: () => dev.demoAccounts(),
    enabled: isDev(),
    retry: false,
  });
  const [offsetHours, setOffsetHours] = useState("24");
  const [peerId, setPeerId] = useState("");
  const [seedUserId, setSeedUserId] = useState("");
  const [seedSessionToken, setSeedSessionToken] = useState("");
  const [seedIdentitySk, setSeedIdentitySk] = useState("");
  const [seedIdentityPk, setSeedIdentityPk] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const say = (line: string): void =>
    setLog((previous) => [line, ...previous].slice(0, 8));

  if (!isDev()) {
    return (
      <Screen testID="dev">
        <AppText variant="title">Not available</AppText>
        <AppText variant="body" tone="muted">
          The dev panel exists only in a dev build.
        </AppText>
      </Screen>
    );
  }

  const failures = result?.cases.filter((c) => !c.passed) ?? [];
  const planned = plannedQuery.data ?? null;

  const actions = {
    travel: async () => {
      const hours = Number(offsetHours);
      if (!Number.isFinite(hours)) {
        say("Offset must be a number of hours.");
        return;
      }
      await dev.setClockOffset(hours * 3600);
      await config.refetch();
      say(`Clock offset set to ${hours} h.`);
    },
    reset: async () => {
      await dev.setClockOffset(0);
      await config.refetch();
      say("Clock offset cleared.");
    },
    crossing: async () => {
      const me = await getUserId();
      if (!me) {
        say("No account on this device yet.");
        return;
      }
      if (!peerId.trim()) {
        say("Paste the other account’s user id first.");
        return;
      }
      // Yesterday: a crossing for today would not be visible until tomorrow anyway (C5).
      const yesterday = localDay(new Date(Date.now() - 86_400_000));
      await dev.makeCrossing(me, peerId.trim(), yesterday);
      say(`Crossing created for ${yesterday}.`);
    },
    fakeSightings: async () => {
      const today = localDay(new Date());
      await ensureLookahead(today);
      const ble = new FakeBle({ seed: Date.now() % 100000, peers: 6 });
      await ble.setSchedule(await buildSchedule(today));
      const produced = ble.generateDay(today);
      const stored = await drainInto(ble);
      say(`Generated ${produced.length} fake sightings, stored ${stored}.`);
    },
    nightly: async () => {
      const outcome = await runNightlyWork();
      await plannedQuery.refetch();
      say(
        `Nightly work: signals ${outcome.signals}; presence ${
          outcome.presence?.presence
            .map((p) => `${p.day}:${p.status}`)
            .join(", ") ?? "none"
        }.`,
      );
    },
    loginAs: async (account: DemoAccount) => {
      await actions.become(
        account.user_id,
        account.session_token,
        account.identity_sk,
        account.identity_pk,
      );
    },
    loginAsSeeded: async () => {
      const userId = seedUserId.trim();
      const sessionToken = seedSessionToken.trim();
      const sk = seedIdentitySk.trim();
      const pk = seedIdentityPk.trim();
      if (!userId || !sessionToken || !sk || !pk) {
        say("Fill in all four fields from one user in demo_accounts.json.");
        return;
      }
      await actions.become(userId, sessionToken, sk, pk);
    },
    become: async (
      userId: string,
      sessionToken: string,
      sk: string,
      pk: string,
    ) => {
      // The same three writes onboarding's code/basics screens make on success -- this
      // panel is a shortcut to the end of onboarding, not a different path through it.
      await setSessionToken(sessionToken);
      await setIdentity({ sk, pk });
      await setUserId(userId);
      say(`Logged in as ${userId}. Reopening at Today…`);
      router.replace("/(tabs)/today");
    },
  };

  return (
    <Screen testID="dev">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader title="Dev panel" />

      <SectionHeading>Protocol self-test</SectionHeading>
      <Card>
        {error ? (
          <AppText variant="bodySemiBold" tone="danger">
            Self-test could not run: {error}
          </AppText>
        ) : result ? (
          <>
            <AppText
              variant="nameSmall"
              tone={result.ok ? "mutual" : "danger"}
              testID="selftest-headline"
            >
              {result.ok
                ? "Protocol OK"
                : `${failures.length} vector(s) FAILED`}
            </AppText>
            <AppText variant="small" tone="muted">
              {result.cases.length} vectors from
              packages/protocol-spec/vectors.json, run here under Hermes.
              Protocol version {result.protocolVersion}.
            </AppText>
            <View style={styles.list}>
              {result.cases.map((c) => (
                <View key={c.name} style={styles.caseRow}>
                  <Icon
                    name={c.passed ? "check" : "close"}
                    size={16}
                    strokeWidth={2.2}
                    color={c.passed ? theme.colors.mutual : theme.colors.danger}
                  />
                  <AppText
                    variant="tiny"
                    tone={c.passed ? "muted" : "danger"}
                    style={styles.flex}
                  >
                    {c.name}
                    {c.detail ? ` — ${c.detail}` : ""}
                  </AppText>
                </View>
              ))}
            </View>
          </>
        ) : null}
        <Button label="Run again" kind="ghost" onPress={run} />
      </Card>

      <SectionHeading>Server state</SectionHeading>
      <Card>
        <AppText variant="small" tone="muted">
          {config.data
            ? [
                `epoch ${config.data.epoch}`,
                `policy ${config.data.reveal_policy}`,
                `release ${config.data.digest_release_time}`,
                `batch ${config.data.match_batch_time}`,
                `signals ${config.data.signal_upload_window.start}–${config.data.signal_upload_window.end}`,
                `study ${config.data.study_enabled ? "on" : "off"}`,
                `server time ${config.data.server_time}`,
              ].join("\n")
            : "Fetching…"}
        </AppText>
        <AppText variant="small" tone="muted">
          {planned === null
            ? "Tonight’s upload minute has not been drawn yet. Run the nightly work once."
            : `Tonight’s upload minute: ${formatMinute(planned)} (dev only — this is deliberately unknowable in a real build).`}
        </AppText>
      </Card>

      <SectionHeading>Clock travel</SectionHeading>
      <Card>
        <TextField
          label="Offset in hours"
          value={offsetHours}
          onChangeText={setOffsetHours}
          keyboardType="numbers-and-punctuation"
          hint="Travel past a release time or a batch time to see the next step of the loop."
        />
        <Stack gap={space.sm}>
          <Button
            label="Apply offset"
            kind="ink"
            onPress={() => void actions.travel()}
          />
          <Button
            label="Back to real time"
            kind="ghost"
            onPress={() => void actions.reset()}
          />
        </Stack>
      </Card>

      <SectionHeading>Crossings and uploads</SectionHeading>
      <Card>
        <TextField
          label="Other account’s user id"
          value={peerId}
          onChangeText={setPeerId}
          autoCapitalize="none"
          autoCorrect={false}
          hint="From the other emulator's dev panel, or POST /v1/dev/seed."
        />
        <Stack gap={space.sm}>
          <Button
            label="Create a crossing for yesterday"
            kind="ink"
            onPress={() => void actions.crossing()}
          />
          <Button
            label="Generate fake BLE sightings"
            kind="ghost"
            onPress={() => void actions.fakeSightings()}
          />
          <Button
            label="Run the nightly work now"
            kind="ghost"
            onPress={() => void actions.nightly()}
          />
        </Stack>
      </Card>

      <SectionHeading>Demo accounts</SectionHeading>
      <Card>
        <AppText variant="small" tone="muted">
          {demo.data && demo.data.users.length > 0
            ? `Synthetic students at ${demo.data.campus}. Tap one to become them on this device.`
            : "No demo accounts on this server yet. Run python -m mutual_server.demo_seed, then come back."}
        </AppText>
        {demo.data && demo.data.users.length > 0 ? (
          <View style={styles.demoGrid}>
            {demo.data.users.map((account) => (
              <Button
                key={account.user_id}
                label={account.first_name}
                kind="ghost"
                small
                onPress={() => void actions.loginAs(account)}
              />
            ))}
          </View>
        ) : (
          <Button
            label="Check again"
            kind="ghost"
            onPress={() => void demo.refetch()}
          />
        )}
      </Card>

      <SectionHeading>Log in as a seeded account</SectionHeading>
      <Card>
        <AppText variant="small" tone="muted">
          For a demo, not a test: this swaps the whole device over to one of
          `python -m mutual_server.demo_seed`&rsquo;s synthetic students, the
          same three writes onboarding makes on success, so the Today and
          Mutuals tabs are populated straight away instead of starting from a
          blank account. Copy the four fields below from one user in that
          run&rsquo;s `server/demo_accounts.json`.
        </AppText>
        <TextField
          label="user_id"
          value={seedUserId}
          onChangeText={setSeedUserId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="session_token"
          value={seedSessionToken}
          onChangeText={setSeedSessionToken}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="identity_sk"
          value={seedIdentitySk}
          onChangeText={setSeedIdentitySk}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="identity_pk"
          value={seedIdentityPk}
          onChangeText={setSeedIdentityPk}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Log in as this account"
          kind="ink"
          onPress={() => void actions.loginAsSeeded()}
        />
      </Card>

      {log.length > 0 ? (
        <>
          <SectionHeading>Log</SectionHeading>
          <Card>
            {log.map((line, i) => (
              <AppText key={`${i}-${line}`} variant="tiny" tone="muted">
                {line}
              </AppText>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs + 2 },
  caseRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  flex: { flex: 1 },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
