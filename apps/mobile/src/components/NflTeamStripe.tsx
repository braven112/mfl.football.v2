import { Fragment } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { findNflTeamColors } from '@mfl/shared-utils/nfl-team-colors';

/**
 * A player's NFL club, marked the way a broadcast lower-third does: a thin
 * two-color vertical stripe (the club's primary, then its secondary) beside
 * the abbreviation. Colors only, never a logo: club marks are trademarks the
 * store rules keep out of the app, colors and abbreviations are not.
 *
 * A free agent, or a code that names no current club, gets the plain text.
 */
export function NflTeamStripe({ team, height = 12 }: { team: string | null | undefined; height?: number }) {
  const colors = team ? findNflTeamColors(team) : null;
  if (!colors) return null;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.stripe, { height }]}
    >
      <View style={[styles.bar, { backgroundColor: colors.primary }]} />
      <View style={[styles.bar, { backgroundColor: colors.secondary }]} />
    </View>
  );
}

/**
 * One piece of a meta line: plain text, text in its own style (an injury flag
 * in red), or the player's NFL club, optionally followed by more text on the
 * same piece ("BUF @MIA").
 */
export type MetaPart =
  | string
  | { team: string; suffix?: string }
  | { text: string; style?: StyleProp<TextStyle> }
  | null
  | undefined
  | false;

type ShownPart = Exclude<MetaPart, null | undefined | false>;

function isShown(p: MetaPart): p is ShownPart {
  if (!p) return false;
  if (typeof p === 'string') return true;
  return 'team' in p ? !!p.team : !!p.text;
}

/**
 * "RB · [stripe] ATL · Bye 5": the dot-separated detail line under a player's
 * name, with the club's stripe in front of its abbreviation. Empty parts are
 * dropped, as the old `filter(Boolean).join(' · ')` did.
 */
export function PlayerMetaLine({
  parts,
  style,
  separator = ' · ',
}: {
  parts: MetaPart[];
  style?: StyleProp<TextStyle>;
  separator?: string;
}) {
  const shown = parts.filter(isShown);
  if (shown.length === 0) return null;
  const fontSize = StyleSheet.flatten(style)?.fontSize ?? 12;
  return (
    <View style={styles.line}>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <Text style={style}>{separator}</Text> : null}
          {typeof p === 'string' ? (
            <Text style={style}>{p}</Text>
          ) : 'team' in p ? (
            <>
              <NflTeamStripe team={p.team} height={Math.round(fontSize * 0.95)} />
              <Text style={style}>
                {p.team}
                {p.suffix ?? ''}
              </Text>
            </>
          ) : (
            <Text style={[style, p.style]}>{p.text}</Text>
          )}
        </Fragment>
      ))}
    </View>
  );
}

/** The same line as plain words, for an accessibility label. */
export function metaText(parts: MetaPart[], separator = ' · '): string {
  return parts
    .filter(isShown)
    .map((p) => (typeof p === 'string' ? p : 'team' in p ? p.team + (p.suffix ?? '') : p.text))
    .join(separator);
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' },
  stripe: {
    flexDirection: 'row',
    marginRight: 5,
    borderRadius: 1.5,
    overflow: 'hidden',
    // A hairline so a near-black club color (Steelers, Raiders, Bears navy)
    // still reads against the app's dark card.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  // Each color 9 wide, on the owner's call (2026-11-08: "around 8 to 10 pixels").
  bar: { width: 9 },
});
