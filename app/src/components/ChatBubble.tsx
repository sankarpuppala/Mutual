/**
 * ChatBubble (SPEC.md §13.5, §13.9): one message.
 *
 * Own messages are indigo (`mutual`) because a conversation only exists inside a mutual;
 * the peer's sit on `surface` with the one soft shadow. The asymmetric corner on each is the
 * prototype's, and it carries the sender without relying on colour (SPEC §13.7).
 *
 * There is no read receipt and no typing indicator. Both would make one person's attention
 * observable to the other in real time, which is the habit this product is built against --
 * and chat is not end-to-end encrypted (decision D10), so the fewer behavioural signals it
 * carries, the less there is to read.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export interface ChatBubbleProps {
  body: string;
  fromMe: boolean;
}

export function ChatBubble({ body, fromMe }: ChatBubbleProps): ReactNode {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${fromMe ? 'You said' : 'They said'}: ${body}`}
      style={[
        styles.bubble,
        fromMe
          ? [styles.mine, { backgroundColor: theme.colors.mutual }]
          : [styles.theirs, { backgroundColor: theme.colors.surface }, theme.shadow],
      ]}
    >
      <AppText variant="body" tone={fromMe ? 'onMutual' : 'ink'}>
        {body}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm + 2,
    borderRadius: radius.bubble,
  },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
});
