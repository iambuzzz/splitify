import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './kit';

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
      <View
        style={[
          { width: size + 12, height: size + 12, borderRadius: 11, backgroundColor: theme.c.primary, alignItems: 'center', justifyContent: 'center' },
          theme.glow ? ({ boxShadow: `0 0 18px ${theme.glow}` } as ViewStyle) : null,
        ]}
      >
        <MaterialCommunityIcons name="currency-inr" size={size} color={theme.c.onPrimary} />
      </View>
      <T size={size} weight="heavy" style={{ letterSpacing: -0.3 }}>
        Splitify
      </T>
    </View>
  );
}
