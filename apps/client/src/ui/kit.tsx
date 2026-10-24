import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useState } from 'react';
import {
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExpenseIcon } from '../data/model';
import { useTheme } from '../theme/ThemeProvider';

/** Components shared by every screen. Each one renders the "cards" or "receipt" look from the active theme. */

export const WIDE = 1024;
export function useWide() {
  return useWindowDimensions().width >= WIDE;
}

/** react-native-web reports hover in the Pressable state; native never does. */
export const isHovered = (state: PressableStateCallbackType) => !!(state as { hovered?: boolean }).hovered;

/** Web draws its own focus outline on inputs; our fields show focus with the border instead. */
export const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as TextStyle;

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';

export function T({
  children,
  size = 15,
  weight = 'regular',
  mono = false,
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  weight?: Weight;
  mono?: boolean;
  color?: string;
  style?: TextStyle | TextStyle[];
  numberOfLines?: number;
}) {
  const { theme } = useTheme();
  const bold = weight === 'bold' || weight === 'heavy';
  const fontFamily = mono ? (bold ? theme.f.monoBold : theme.f.mono) : theme.f[weight];
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily, fontSize: size, color: color ?? theme.c.text, fontVariant: ['tabular-nums'] }, style]}
    >
      {children}
    </Text>
  );
}

/** Small section label. Receipt themes write it like a till slip: mono, upper case, spaced out. */
export function Label({ children, color }: { children: string; color?: string }) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  return (
    <T
      size={12}
      weight={receipt ? 'regular' : 'bold'}
      mono={receipt}
      color={color ?? theme.c.muted}
      style={{ letterSpacing: receipt ? 2 : 0.5, textTransform: 'uppercase' }}
    >
      {children}
    </T>
  );
}

/** Shrinks long figures (₹75,03,900.37) so they stay on one line instead of wrapping mid-number. */
export const fitSize = (text: string, size: number, fits = 9) => (text.length <= fits ? size : Math.max(size * 0.55, (size * fits) / text.length));

/** Big money figure; glows in themes that have a glow. */
export function BigAmount({ children, color, size: requested = 44 }: { children: string; color?: string; size?: number }) {
  const { theme } = useTheme();
  const size = fitSize(children, requested);
  return (
    <T
      size={size}
      weight="heavy"
      numberOfLines={1}
      color={color ?? theme.c.get}
      style={[
        { letterSpacing: theme.family === 'receipt' ? -2 : -1, lineHeight: size * 1.12 },
        // One line clips its overflow, which cut the glow off in a hard box: room for it inside, same spot outside.
        theme.glow
          ? ({ textShadowColor: theme.glow, textShadowRadius: 24, padding: 24, margin: -24, alignSelf: 'flex-start', maxWidth: '100%', pointerEvents: 'none' } as TextStyle)
          : {},
      ]}
    >
      {children}
    </T>
  );
}

export function Screen({
  children,
  footer,
  maxWidth = 720,
  scroll = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  scroll?: boolean;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  // On laptops the main action sits right under the form; on phones it is pinned to the bottom edge.
  // Hooks run on every render, in the same order (a conditional call breaks React when `footer` comes and goes).
  const wide = useWide();
  const pinned = !!footer && !wide;
  const inner = (
    // Laptops line the first row up with the sidebar's logo; phones sit just under the status bar.
    <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: wide ? 32 : 20, paddingTop: wide ? 32 : insets.top + 12, paddingBottom: pinned ? 120 : 48, gap: 16 }}>
      {children}
      {footer && !pinned ? <View style={{ marginTop: 8 }}>{footer}</View> : null}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.c.bg }}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{inner}</ScrollView> : inner}
      {pinned ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 18, paddingTop: 12, backgroundColor: theme.c.bg }}>
          <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: 20 }}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

/** Zig-zag paper edge for receipt themes. */
export function TearEdge({ flip = false }: { flip?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={{ height: 8, overflow: 'hidden', flexDirection: 'row', backgroundColor: theme.c.bg }}>
      {Array.from({ length: 80 }, (_, i) => (
        <View
          key={i}
          style={{
            width: 11,
            height: 11,
            marginRight: 5,
            backgroundColor: theme.c.surface,
            transform: [{ rotate: '45deg' }],
            marginTop: flip ? -6 : 3,
          }}
        />
      ))}
    </View>
  );
}

export function Card({
  children,
  style,
  tear = false,
  padded = true,
}: {
  children: ReactNode;
  style?: ViewStyle;
  /** Receipt themes only: torn paper edges top and bottom. */
  tear?: boolean;
  padded?: boolean;
}) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  const body = (
    <View
      style={[
        {
          backgroundColor: theme.c.surface,
          borderRadius: theme.r.card,
          borderWidth: receipt ? 0 : 1,
          borderColor: theme.c.border,
          padding: padded ? 18 : 0,
          gap: 10,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!receipt || !tear) return body;
  return (
    <View>
      <TearEdge flip />
      {body}
      <TearEdge />
    </View>
  );
}

export function Divider() {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  return (
    <View
      style={{
        borderTopWidth: receipt ? 2 : 1,
        borderStyle: receipt ? 'dashed' : 'solid',
        borderColor: receipt ? theme.c.border : theme.c.border,
        marginVertical: 2,
      }}
    />
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  flex,
  size = 'lg',
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-text';
  icon?: ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
  flex?: number;
  size?: 'lg' | 'md' | 'sm';
}) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  const h = size === 'lg' ? 56 : size === 'md' ? 46 : 38;
  const primary = variant === 'primary';
  const filled = primary || variant === 'danger';
  const fg = primary ? theme.c.onPrimary : variant === 'danger' ? (theme.dark ? theme.c.bg : '#FFFFFF') : variant === 'danger-text' ? theme.c.owe : theme.c.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={(state) => [
        {
          height: h,
          paddingHorizontal: size === 'lg' ? 20 : 14,
          borderRadius: receipt ? 999 : size === 'sm' ? 11 : theme.r.button,
          backgroundColor: primary ? theme.c.primary : variant === 'danger' ? theme.c.owe : variant === 'secondary' && !receipt ? theme.c.surface : 'transparent',
          borderWidth: filled || variant === 'danger-text' ? 0 : receipt ? 2 : 1,
          borderColor: receipt ? theme.c.text : theme.c.borderStrong,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.4 : state.pressed ? 0.8 : isHovered(state) ? 0.9 : 1,
          flex,
        },
        primary && theme.glow ? ({ boxShadow: `0 6px 24px ${theme.glow}` } as ViewStyle) : null,
      ]}
    >
      {icon ? <Feather name={icon} size={size === 'sm' ? 16 : 20} color={fg} /> : null}
      <T size={size === 'lg' ? 16 : 14} weight="bold" color={fg} numberOfLines={1}>
        {title}
      </T>
    </Pressable>
  );
}

/** "Something new here": a small accent dot beside a group, an expense or a person. */
export function Dot({ size = 8, style }: { size?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  return <View accessibilityLabel="new" style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.c.primary }, style]} />;
}

export function IconButton({
  icon,
  onPress,
  label,
}: {
  icon: ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
      <Feather name={icon} size={22} color={theme.c.text} />
    </Pressable>
  );
}

/** Same person, same colour everywhere: the palette slot comes from the name, not the position in a list. */
function slotFor(name: string, n: number) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

export function Avatar({ name, size = 36, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const { theme } = useTheme();
  const pal = theme.avatars[slotFor(name, theme.avatars.length)]!;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: pal.bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 3 : 0,
        borderColor: theme.c.get,
      }}
    >
      <T size={size * 0.38} weight="bold" color={pal.fg}>
        {name.slice(0, 1).toUpperCase()}
      </T>
    </View>
  );
}

/** Text input that shows focus with the theme's primary colour. `line` is the receipt-style dashed underline. */
export function Field({ line = false, style, onFocus, onBlur, ...props }: TextInputProps & { line?: boolean }) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={theme.c.muted}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        {
          height: 50,
          borderRadius: line ? 0 : theme.r.input,
          borderWidth: line ? 0 : 1.5,
          borderBottomWidth: line ? 2 : 1.5,
          borderStyle: line && !focused ? 'dashed' : 'solid',
          borderColor: focused ? theme.c.primary : theme.c.borderStrong,
          paddingHorizontal: 14,
          fontSize: 16,
          color: theme.c.text,
          fontFamily: theme.f.medium,
          backgroundColor: line ? 'transparent' : theme.c.surface,
        },
        noOutline,
        style,
      ]}
    />
  );
}

/** "Needs you" note: a bordered callout in card themes, a tilted sticky note in receipt themes. */
export function Note({ children, tilt = -1.2, style }: { children: ReactNode; tilt?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  const receipt = theme.family === 'receipt';
  return (
    <View
      style={[
        {
          backgroundColor: theme.c.attnBg,
          borderWidth: receipt ? 0 : 1.5,
          borderColor: theme.c.attnBorder,
          borderRadius: receipt ? 2 : 16,
          padding: 14,
          gap: 8,
        },
        receipt ? ({ transform: [{ rotate: `${tilt}deg` }], boxShadow: '0 8px 18px rgba(0,0,0,0.16)' } as ViewStyle) : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={!!on}
      onPress={onPress}
      style={{
        height: 38,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: on ? theme.c.primary : theme.c.borderStrong,
        backgroundColor: on ? theme.c.tint : 'transparent',
        justifyContent: 'center',
      }}
    >
      <T size={14} weight="semibold">
        {label}
      </T>
    </Pressable>
  );
}

const ICONS: Record<ExpenseIcon, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  hotel: 'bed-outline',
  food: 'silverware-fork-knife',
  taxi: 'taxi',
  home: 'home-outline',
  wifi: 'wifi',
  cart: 'cart-outline',
  other: 'receipt-text-outline',
};

export function CategoryIcon({ icon, size = 44 }: { icon: ExpenseIcon; size?: number }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: theme.c.chip, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialCommunityIcons name={ICONS[icon]} size={size * 0.5} color={theme.dark ? theme.c.muted : theme.c.text} />
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
