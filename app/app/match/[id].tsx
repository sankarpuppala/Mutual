/**
 * The conversation inside a mutual (SPEC.md §13.9; journey J6).
 *
 * It opens with the peer's first prompt as context, because the thing you know about this
 * person is what they wrote, and a blank chat with a stranger's name is the hardest screen
 * in any app of this kind to start on.
 *
 * Polling rather than sockets: a socket would hold a connection whose timing reflects
 * attention, and a five-second poll is indistinguishable from idle traffic. There is no
 * typing indicator and no read receipt, for the same reason (SPEC §13.5).
 *
 * Under policy C the header shows how many more messages each side needs before photos
 * appear, and when the count reaches zero the reveal happens here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  blockPeer,
  getMatches,
  getMessages,
  getPromptLibrary,
  reportPeer,
  sendMessage,
  unmatch,
} from '@/api/endpoints';
import { INTENT_LABELS, type ReportReason } from '@/api/types';
import { ChatBubble } from '@/components/ChatBubble';
import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import { SafetySheet } from '@/components/SafetySheet';
import { Icon } from '@/design/icons';
import { AppText, Pill } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';
import { type } from '@/design/typography';
import { matchPhotoSource, type PhotoSource } from '@/matches/photo';
import {
  messagesStillNeeded,
  photosAvailable,
  resolveMatch,
  type ResolvedMatch,
} from '@/matches/resolve';
import { getUserId } from '@/storage/secure';

/** `messages.max_length` in server/config.yaml. */
const MAX_MESSAGE_LENGTH = 1000;

export default function ChatScreen(): ReactNode {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const matches = useQuery({ queryKey: ['matches'], queryFn: getMatches });
  const library = useQuery({ queryKey: ['prompts'], queryFn: getPromptLibrary });
  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => getMessages(id),
    refetchInterval: 5000,
  });

  const [resolved, setResolved] = useState<ResolvedMatch | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoSource | null>(null);
  const [draft, setDraft] = useState('');
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<ScrollView | null>(null);

  const match = matches.data?.find((m) => m.match_id === id);

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    void (async () => {
      const [entry, me, source] = await Promise.all([
        resolveMatch(match),
        getUserId(),
        photosAvailable(match) ? matchPhotoSource(match.match_id, 0) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setResolved(entry);
      setSelfId(me);
      setPhoto(source);
    })();
    return () => {
      cancelled = true;
    };
  }, [match]);

  // The reveal happens here under policy C, the moment the server says photos are available.
  const needed = match ? messagesStillNeeded(match) : null;
  const revealedJustNow = useRef(false);
  useEffect(() => {
    if (!match || match.reveal.policy !== 'C') return;
    if (match.reveal.state === 'revealed' && !revealedJustNow.current) {
      revealedJustNow.current = true;
      router.push(`/reveal/${match.match_id}`);
    }
  }, [match]);

  const send = useMutation({
    mutationFn: async (body: string) => sendMessage(id, body),
    onSuccess: () => {
      setDraft('');
      void messages.refetch();
      void matches.refetch();
    },
  });

  const act = {
    block: async () => {
      if (!match) return;
      setSafetyOpen(false);
      await blockPeer(match.peer.peer_id);
      queryClient.removeQueries({ queryKey: ['messages', id] });
      void matches.refetch();
      router.replace('/(tabs)/mutuals');
    },
    unmatch: async () => {
      if (!match) return;
      setSafetyOpen(false);
      await unmatch(match.match_id);
      void matches.refetch();
      router.replace('/(tabs)/mutuals');
    },
    report: async (reason: ReportReason) => {
      if (!match) return;
      setSafetyOpen(false);
      await reportPeer(match.peer.peer_id, reason);
      setNotice('Report sent. A moderator will look at it.');
    },
  };

  if (!match) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={styles.iconButton}
          >
            <Icon name="back" />
          </Pressable>
        </View>
        <View style={styles.centered}>
          <AppText variant="body" tone="muted">
            {matches.isLoading ? 'Opening…' : 'This conversation is no longer available.'}
          </AppText>
        </View>
      </View>
    );
  }

  const ended = match.state === 'ended';
  const firstPrompt = match.peer.prompts[0];
  const question = firstPrompt
    ? (library.data?.prompts.find((p) => p.id === firstPrompt.prompt_id)?.text ?? '')
    : '';

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="chat"
    >
      <View style={[styles.chatBar, { borderBottomColor: theme.colors.hairline }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Icon name="back" />
        </Pressable>
        <View style={styles.who}>
          {photo ? (
            <Image source={photo} style={styles.thumb} accessibilityIgnoresInvertColors />
          ) : (
            <GenerativeAvatar identityPk={match.peer.identity_pk} size={36} />
          )}
          <AppText variant="listTitle">{match.peer.first_name}</AppText>
          {(resolved?.intents ?? []).map((i) => (
            <Pill key={i.token} label={INTENT_LABELS[i.intent]} tint="mutual" />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Block, report or unmatch"
          onPress={() => setSafetyOpen(true)}
          style={styles.iconButton}
        >
          <Icon name="more" />
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {firstPrompt ? (
          <View style={styles.context}>
            <AppText variant="promptQuestion" tone="muted" center>
              {question}
            </AppText>
            <AppText style={type.chatContext} center>
              {firstPrompt.text}
            </AppText>
            {needed !== null && needed > 0 ? (
              <View style={styles.fine}>
                <Icon name="lock" size={14} color={theme.colors.inkMuted} />
                <AppText variant="tiny" tone="muted">
                  {`Photos after ${needed} more message${needed === 1 ? '' : 's'} each`}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}

        {ended ? (
          <AppText variant="body" tone="muted" center style={styles.ended}>
            This mutual has ended. The conversation has been deleted.
          </AppText>
        ) : (
          (messages.data ?? []).map((message) => (
            <ChatBubble
              key={message.message_id}
              body={message.body}
              fromMe={message.sender_id === selfId}
            />
          ))
        )}

        {notice ? (
          <AppText variant="small" tone="muted" center style={styles.ended}>
            {notice}
          </AppText>
        ) : null}
      </ScrollView>

      {ended ? null : (
        <View style={[styles.composer, { borderTopColor: theme.colors.hairline }]}>
          <TextInput
            accessibilityLabel={`Message ${match.peer.first_name}`}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={theme.colors.inkMuted}
            maxLength={MAX_MESSAGE_LENGTH}
            multiline
            style={[
              type.body,
              styles.input,
              {
                color: theme.colors.ink,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.hairline,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={draft.trim().length === 0 || send.isPending}
            onPress={() => send.mutate(draft.trim())}
            style={[
              styles.send,
              { backgroundColor: theme.colors.mutual },
              (draft.trim().length === 0 || send.isPending) && styles.disabled,
            ]}
          >
            <Icon name="send" size={20} strokeWidth={2} color={theme.colors.onMutual} />
          </Pressable>
        </View>
      )}

      <SafetySheet
        visible={safetyOpen}
        peerName={match.peer.first_name}
        canUnmatch={!ended}
        onClose={() => setSafetyOpen(false)}
        onBlock={() => void act.block()}
        onUnmatch={() => void act.unmatch()}
        onReport={(reason) => void act.report(reason)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', paddingHorizontal: space.sm, paddingTop: space.sm },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: 1,
  },
  iconButton: {
    width: hitSize,
    height: hitSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  thumb: { width: 36, height: 36, borderRadius: 18 },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm + 2,
    gap: space.xs + 2,
  },
  context: {
    gap: space.xs + 2,
    alignItems: 'center',
    paddingHorizontal: space.sm + 2,
    paddingBottom: space.xl - 4,
  },
  fine: { flexDirection: 'row', gap: space.xs + 2, alignItems: 'center' },
  ended: { marginVertical: space.xl },
  composer: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-end',
    paddingHorizontal: space.md,
    paddingTop: space.sm + 2,
    paddingBottom: space.md + 2,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: hitSize,
    maxHeight: 120,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  send: {
    width: hitSize,
    height: hitSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.38 },
});
