/**
 * App entry point. The CSPRNG polyfill is imported FIRST, before any protocol code can run
 * (CLAUDE.md invariant 7, PLAN.md Phase 8 task 3): @mutual/protocol throws loudly rather
 * than falling back to a weak source, and Hermes has no crypto.getRandomValues of its own.
 */
import 'react-native-get-random-values';

import 'expo-router/entry';
