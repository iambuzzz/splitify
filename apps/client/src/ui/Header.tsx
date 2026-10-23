import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { IconButton, T } from './kit';

export function Header({ title, back = '/', right }: { title?: string; back?: string | false; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -10, minHeight: 44 }}>
      {back !== false ? (
        <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(back as never))} />
      ) : (
        <View style={{ width: 44 }} />
      )}
      <T size={17} weight="bold" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {title ?? ''}
      </T>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
