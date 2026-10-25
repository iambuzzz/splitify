import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './kit';

/**
 * The mark, as on the landing page and the app icon: a circle cut on the diagonal, one half in the
 * theme's "you owe" colour and the other in its "you get" colour. The cut is a see-through gap.
 */
export function Mark({ size }: { size: number }) {
  const { theme } = useTheme();
  const gap = Math.max(2, Math.round(size * 0.1));
  const half = (size - gap) / 2;
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', flexDirection: 'row', gap, transform: [{ rotate: '45deg' }] }}
    >
      <View style={{ width: half, height: size, backgroundColor: theme.c.owe }} />
      <View style={{ width: half, height: size, backgroundColor: theme.c.get }} />
    </View>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  const { theme } = useTheme();
  if (theme.family === 'receipt') {
    return (
      <T size={size + 8} weight="heavy" style={{ letterSpacing: -1 }}>
        Splitify<T size={size + 8} weight="heavy" color={theme.c.get}>.</T>
      </T>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Mark size={size + 10} />
      <T size={size} weight="heavy" style={{ letterSpacing: -0.3 }}>
        Splitify
      </T>
    </View>
  );
}
