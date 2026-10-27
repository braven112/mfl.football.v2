import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  MflLiveAppMatchup,
  MflLiveAppPlayerMeta,
  MflLiveAppPlayerRow,
  MflLiveAppTeam,
} from '@mfl/shared-types/mfl-live-app';
import { percent, points } from '../format';
import { font, useTheme, type Theme } from '../theme';
import { TeamMark } from './TeamMark';

interface Props {
  matchup: MflLiveAppMatchup;
  playerMeta: Record<string, MflLiveAppPlayerMeta>;
}

/** One matchup: a compact row of both scores that expands into the starters. */
export function MatchupCard({ matchup, playerMeta }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { mine, opponent, noProjections } = matchup;
  const winning = mine.live >= opponent.live;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <TeamLine team={mine} t={t} bold={winning} showProjection={!noProjections} />
      <TeamLine team={opponent} t={t} bold={!winning} showProjection={!noProjections} />

      {noProjections ? null : <WinBar p={matchup.winProbability} t={t} />}

      {open ? (
        <View style={styles.detail}>
          <Lineup title={mine.nameShort} rows={mine.players} meta={playerMeta} t={t} />
          <Lineup title={opponent.nameShort} rows={opponent.players} meta={playerMeta} t={t} />
        </View>
      ) : (
        <Text style={[styles.hint, { color: t.muted }]}>Tap for starters</Text>
      )}
    </Pressable>
  );
}

function TeamLine({
  team,
  t,
  bold,
  showProjection,
}: {
  team: MflLiveAppTeam;
  t: Theme;
  bold: boolean;
  showProjection: boolean;
}) {
  return (
    <View style={styles.teamLine}>
      <TeamMark team={team} />
      <View style={styles.teamText}>
        <Text numberOfLines={1} style={[styles.teamName, { color: t.text }]}>
          {team.name}
        </Text>
        <Text style={[styles.sub, { color: t.muted }]}>
          {team.yetToPlay > 0 ? `${team.yetToPlay} yet to play` : 'All played'}
          {showProjection ? `  ·  proj ${points(team.projectedFinal)}` : ''}
        </Text>
      </View>
      <Text style={[styles.score, { color: t.text, fontFamily: bold ? font.bold : font.medium }]}>{points(team.live)}</Text>
    </View>
  );
}

function WinBar({ p, t }: { p: number; t: Theme }) {
  const mine = Math.min(1, Math.max(0, p));
  return (
    <View style={styles.winWrap} accessibilityLabel={`Win probability ${percent(mine)}`}>
      <View style={[styles.winTrack, { backgroundColor: t.field }]}>
        <View style={[styles.winFill, { width: `${mine * 100}%`, backgroundColor: t.accent }]} />
      </View>
      <Text style={[styles.winText, { color: t.muted }]}>Win {percent(mine)}</Text>
    </View>
  );
}

function rowState(row: MflLiveAppPlayerRow): string {
  if (row.secondsRemaining <= 0) return 'Final';
  if (row.secondsRemaining >= 3600) return 'Yet to play';
  const left = Math.ceil(row.secondsRemaining / 60);
  return `${left} min left`;
}

function Lineup({
  title,
  rows,
  meta,
  t,
}: {
  title: string;
  rows: MflLiveAppPlayerRow[];
  meta: Record<string, MflLiveAppPlayerMeta>;
  t: Theme;
}) {
  return (
    <View style={styles.lineup}>
      <Text style={[styles.lineupTitle, { color: t.accentText }]}>{title}</Text>
      {rows.map((row) => {
        const who = meta[row.id];
        return (
          <View key={row.id} style={[styles.playerRow, { borderTopColor: t.border }]}>
            <Text style={[styles.pos, { color: t.muted }]}>{who?.position ?? ''}</Text>
            <View style={styles.playerText}>
              <Text numberOfLines={1} style={[styles.playerName, { color: t.text }]}>
                {who?.name ?? `Player ${row.id}`}
              </Text>
              <Text style={[styles.sub, { color: t.muted }]}>
                {who?.nflTeam ? `${who.nflTeam}  ·  ` : ''}
                {rowState(row)}
              </Text>
            </View>
            <Text style={[styles.playerPts, { color: t.text }]}>{points(row.live)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12, gap: 10 },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamText: { flex: 1 },
  teamName: { fontSize: 16, fontFamily: font.semibold },
  sub: { fontFamily: font.regular, fontSize: 12, marginTop: 2 },
  score: { fontFamily: font.regular, fontSize: 24, fontVariant: ['tabular-nums'] },
  winWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  winTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  winFill: { height: 6 },
  winText: { fontFamily: font.regular, fontSize: 12, fontVariant: ['tabular-nums'] },
  hint: { fontFamily: font.regular, fontSize: 12, textAlign: 'center' },
  detail: { gap: 16, marginTop: 4 },
  lineup: {},
  lineupTitle: { fontSize: 13, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  pos: { width: 32, fontSize: 12, fontFamily: font.bold },
  playerText: { flex: 1 },
  playerName: { fontFamily: font.regular, fontSize: 15 },
  playerPts: { fontSize: 15, fontFamily: font.semibold, fontVariant: ['tabular-nums'] },
});
