import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MflLiveAppTradeAsset } from '@mfl/shared-types/mfl-live-app-trades';
import { font, useTheme } from '../theme';

/** "QB · BUF", or nothing for a pick or blind bid. */
export function assetDetail(a: MflLiveAppTradeAsset): string {
  return [a.position, a.nflTeam].filter(Boolean).join(' · ');
}

/**
 * The assets on one side of a trade. With `selected` and `onToggle` each row
 * is a checkbox (the trade builder); without them it is a plain list.
 */
export function TradeAssetList({
  assets,
  empty,
  selected,
  onToggle,
}: {
  assets: MflLiveAppTradeAsset[];
  empty?: string;
  selected?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
}) {
  const t = useTheme();
  if (assets.length === 0) {
    return empty ? <Text style={[styles.empty, { color: t.muted }]}>{empty}</Text> : null;
  }
  return (
    <View>
      {assets.map((a) => {
        const on = selected?.has(a.id) ?? false;
        const detail = assetDetail(a);
        const body = (
          <>
            {onToggle ? (
              <View
                style={[
                  styles.box,
                  { borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : 'transparent' },
                ]}
              >
                {on ? <Text style={[styles.tick, { color: t.onAccent }]}>✓</Text> : null}
              </View>
            ) : null}
            <Text numberOfLines={1} style={[styles.label, { color: t.text }]}>
              {a.label}
            </Text>
            {detail ? <Text style={[styles.detail, { color: t.muted }]}>{detail}</Text> : null}
          </>
        );
        return onToggle ? (
          <Pressable
            key={a.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={detail ? `${a.label}, ${detail}` : a.label}
            onPress={() => onToggle(a.id)}
            style={styles.row}
          >
            {body}
          </Pressable>
        ) : (
          <View key={a.id} style={styles.row}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { fontFamily: font.bold, fontSize: 14, lineHeight: 16 },
  label: { flex: 1, fontFamily: font.medium, fontSize: 15 },
  detail: { fontFamily: font.regular, fontSize: 13 },
  empty: { fontFamily: font.regular, fontSize: 14, paddingVertical: 6 },
});
