/**
 * The four tabs (SPEC.md §13.2), styled to match the prototype's `.tabbar`: a hairline on
 * top, the screen background underneath, 11 pt labels, and the active tab in ink rather
 * than a brand colour -- the tab bar is not where this app shouts.
 */

import { Tabs } from 'expo-router';
import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/theme';
import { hitSize, space } from '@/design/tokens';
import { fonts } from '@/design/typography';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'today', title: 'Today', icon: 'today' },
  { name: 'signals', title: 'Signals', icon: 'signals' },
  { name: 'mutuals', title: 'Mutuals', icon: 'mutuals' },
  { name: 'you', title: 'You', icon: 'you' },
];

export default function TabsLayout(): ReactNode {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.ink,
        tabBarInactiveTintColor: theme.colors.inkMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.hairline,
          borderTopWidth: 1,
          paddingTop: space.sm - 2,
          height: hitSize + space.xl,
        },
        tabBarLabelStyle: { fontFamily: fonts.uiMedium, fontSize: 11 },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <Icon
                name={icon}
                size={24}
                strokeWidth={focused ? 1.9 : 1.6}
                // The navigator types this as ColorValue; ours is always one of our
                // own token strings, set in screenOptions just above.
                color={String(color)}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
