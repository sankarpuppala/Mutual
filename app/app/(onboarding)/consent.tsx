/**
 * Research consent (SPEC.md §16, CLAUDE.md invariant 9) — **shown only when the server is
 * running in study mode on this campus**.
 *
 * The gate is mechanical on the server: it refuses to start in study mode without an
 * approval reference and `study/APPROVAL.md`. This screen is the user-facing half of that
 * gate, and it is deliberately not persuasive: it states what is collected, what is not,
 * that taking part is optional, and that withdrawal deletes the data.
 *
 * **Declining leads somewhere.** Both buttons go to the same next screen; the only
 * difference is whether a `consent_version` is carried forward. An earlier version made an
 * account impossible without consenting, which would have made consent the price of using
 * a campus social app -- and consent obtained that way is not freely given (SPEC §16,
 * DECISIONS_LOG 30). Nothing re-asks later in the block, because repeated asking is
 * pressure.
 *
 * If the server is not in study mode, the screen says so and sends the user on. It never
 * records consent that was not asked for.
 */

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { getConfig } from '@/api/endpoints';
import { PrivacyRow } from '@/components/PrivacyRow';
import {
  AppText,
  BarButton,
  Button,
  Card,
  LinkButton,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { useOnboarding } from '@/onboarding/store';

/** Bumped whenever the consent text changes; the server stores which version was accepted. */
const CONSENT_VERSION = '1';

const COLLECTED = [
  'Counts: how many crossings, signals, mutuals and messages you have, per week.',
  'Which photo-reveal setting your campus was on in each two-week block.',
  'Your answers to three optional questions at the end of each block.',
];

const NOT_COLLECTED = [
  'Your name, your answers, your photos, your voice notes or your messages.',
  'Who you signalled, or who you crossed paths with.',
  'Anything that could identify you: ids are replaced with a keyed hash before analysis.',
];

export default function ConsentScreen(): ReactNode {
  const { setConsentVersion } = useOnboarding();
  const [accepted, setAccepted] = useState(false);
  const config = useQuery({ queryKey: ['config'], queryFn: getConfig });

  const next = (): void => {
    router.push('/(onboarding)/age');
  };

  /** Carry no consent version forward, and carry on. */
  const decline = (): void => {
    setConsentVersion(null);
    next();
  };

  if (config.data && !config.data.study_enabled) {
    return (
      <Screen testID="consent">
        <BarButton kind="back" onPress={() => router.back()} />
        <ScreenHeader
          title="No study running"
          lede="This campus is not part of a research study, so there is nothing to consent to."
        />
        <Button label="Continue" kind="ink" wide onPress={next} />
      </Screen>
    );
  }

  return (
    <Screen testID="consent">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        eyebrow="Research"
        title="Taking part in the study"
        lede="This campus is running a study about when photos should be shown. Taking part is optional, and you can stop at any time."
      />

      <SectionHeading>What is collected</SectionHeading>
      <Card>
        {COLLECTED.map((text, i) => (
          <PrivacyRow key={text} text={text} kind="can" last={i === COLLECTED.length - 1} />
        ))}
      </Card>

      <SectionHeading>What is never collected</SectionHeading>
      <Card>
        {NOT_COLLECTED.map((text, i) => (
          <PrivacyRow key={text} text={text} kind="never" last={i === NOT_COLLECTED.length - 1} />
        ))}
      </Card>

      <View style={styles.body}>
        <AppText variant="body">
          You can withdraw whenever you like, from the You tab. Withdrawing deletes your
          study data; it does not delete your account unless you ask for that too.
        </AppText>
        <AppText variant="small" tone="muted">
          Mutual is an unaudited research prototype, built by a student. The approval
          reference and the conditions it was granted under are in the project&rsquo;s
          `study/APPROVAL.md`.
        </AppText>

        <Button
          label={accepted ? 'Consent given ✓' : 'I agree to take part'}
          kind={accepted ? 'ghost' : 'ink'}
          wide
          onPress={() => {
            setAccepted(true);
            setConsentVersion(CONSENT_VERSION);
          }}
        />
        {accepted ? <Button label="Continue" kind="ink" wide onPress={next} /> : null}

        <AppText variant="small" tone="muted">
          One thing that is true either way: the photo setting being studied is a campus
          setting, so it changes for everyone here during the study, whether or not you
          take part. Taking part only decides whether counts about your use are included
          in the research.
        </AppText>
        <LinkButton label="Use Mutual without taking part" center onPress={decline} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.xl, gap: space.lg },
});
