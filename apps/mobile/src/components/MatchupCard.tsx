import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MflLiveAppPlayerMeta } from '@mfl/shared-types/mfl-live-app';
import type {
  MflLiveAppLiveMatchup,
  MflLiveAppLiveRow,
  MflLiveAppLiveTeam,
} from '@mfl/shared-types/mfl-live-app-a';
import { gameStateLabel, gameStateOf, isFinal, points, winSplit } from '../format';
import { font, useTheme, type Theme } from '../theme';
import { TeamMark } from './TeamMark';

interface Props {
  matchup: MflLiveAppLiveMatchup;
  playerMeta: Record<string, MflLiveAppPlayerMeta>;
  /** Decimal places for this league's scores; /live's default when omitted. */
  precision?: number;
}

/**
 * One matchup, as the web board's card shows it: Live or Final, both scores
 * with projected finals, starters yet to play per team, and the win split.
 * Tapping opens both lineups, starters then bench.
 */
export function MatchupCard({ matchup, playerMeta, precision }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { mine, opponent, noProjections } = matchup;
  const final = isFinal(matchup);
  const mineLeads = mine.live >= opponent.live;
  const showYtp = !final && mine.yetToPlay + opponent.yetToPlay > 0;
  const fmt = (n: number) => points(n, precision);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={
        `${mine.name} ${fmt(mine.live)}, ${opponent.name} ${fmt(opponent.live)}` +
        (final ? ', final' : '') +
        (showYtp ? `. ${mine.yetToPlay} and ${opponent.yetToPlay} to play` : '')
      }
      onPress={() => setOpen((v) => !v)}
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <View style={styles.head}>
        <Text style={[styles.badge, { color: final ? t.muted : t.accentText }]}>{final ? 'FINAL' : '● LIVE'}</Text>
        {showYtp ? (
          <Text style={[styles.headText, { color: t.muted }]}>
            {mine.yetToPlay} · {opponent.yetToPlay} to play
          </Text>
        ) : null}
      </View>

      <TeamLine team={mine} t={t} lead={mineLeads} showProjection={!noProjections} fmt={fmt} />
      <TeamLine team={opponent} t={t} lead={!mineLeads} showProjection={!noProjections} fmt={fmt} />

      {final || noProjections ? null : <WinBar p={matchup.winProbability} t={t} />}

      {open ? (
        <View style={styles.detail}>
          <Lineup team={mine} meta={playerMeta} t={t} fmt={fmt} showProjection={!noProjections} />
          <Lineup team={opponent} meta={playerMeta} t={t} fmt={fmt} showProjection={!noProjections} />
        </View>
      ) : (
        <Text style={[styles.hint, { color: t.muted }]}>Tap for lineups</Text>
      )}
    </Pressable>
  );
}

function TeamLine({
  team,
  t,
  lead,
  showProjection,
  fmt,
}: {
  team: MflLiveAppLiveTeam;
  t: Theme;
  lead: boolean;
  showProjection: boolean;
  fmt: (n: number) => string;
}) {
  return (
    <View style={styles.teamLine}>
      <TeamMark team={team} />
      <View style={styles.teamText}>
        <Text numberOfLines={1} style={[styles.teamName, { color: t.text }]}>
          {team.nameShort || team.name}
        </Text>
        {showProjection ? (
          <Text style={[styles.sub, { color: t.muted }]}>Proj {fmt(team.projectedFinal)}</Text>
        ) : null}
      </View>
      <Text style={[styles.score, { color: lead ? t.text : t.muted, fontFamily: lead ? font.bold : font.medium }]}>
        {fmt(team.live)}
      </Text>
    </View>
  );
}

function WinBar({ p, t }: { p: number; t: Theme }) {
  const [mine, theirs] = winSplit(p);
  return (
    <View style={styles.winWrap} accessibilityLabel={`Win probability: you ${mine}%, them ${theirs}%`}>
      <Text style={[styles.winText, { color: t.text }]}>{mine}%</Text>
      <View style={[styles.winTrack, { backgroundColor: t.field }]}>
        <View style={[styles.winFill, { width: `${mine}%`, backgroundColor: t.accent }]} />
      </View>
      <Text style={[styles.winText, { color: t.muted }]}>{theirs}%</Text>
    </View>
  );
}

function Lineup({
  team,
  meta,
  t,
  fmt,
  showProjection,
}: {
  team: MflLiveAppLiveTeam;
  meta: Record<string, MflLiveAppPlayerMeta>;
  t: Theme;
  fmt: (n: number) => string;
  showProjection: boolean;
}) {
  return (
    <View>
      <Text style={[styles.lineupTitle, { color: t.accentText }]}>{team.nameShort || team.name}</Text>
      {team.players.map((row) => (
        <PlayerRow key={row.id} row={row} who={meta[row.id]} t={t} fmt={fmt} showProjection={showProjection} />
      ))}
      {team.bench.length > 0 ? (
        <>
          <Text style={[styles.benchTitle, { color: t.muted }]}>Bench</Text>
          {team.bench.map((row) => (
            <PlayerRow
              key={row.id}
              row={row}
              who={meta[row.id]}
              t={t}
              fmt={fmt}
              showProjection={showProjection}
              bench
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function PlayerRow({
  row,
  who,
  t,
  fmt,
  showProjection,
  bench = false,
}: {
  row: MflLiveAppLiveRow;
  who: MflLiveAppPlayerMeta | undefined;
  t: Theme;
  fmt: (n: number) => string;
  showProjection: boolean;
  bench?: boolean;
}) {
  const state = gameStateOf(row);
  const isDef = who?.position === 'DEF';
  return (
    <View style={[styles.playerRow, { borderTopColor: t.border }]}>
      <View style={styles.playerText}>
        <Text numberOfLines={1} style={[styles.playerName, { color: bench ? t.muted : t.text }]}>
          {who?.name ?? `Player ${row.id}`}
        </Text>
        <Text style={[styles.sub, { color: state === 'in-progress' ? t.accentText : t.muted }]}>
          {who?.position || '—'}
          {who?.nflTeam && !isDef ? ` · ${who.nflTeam}` : ''}
          {`  ·  ${gameStateLabel(state)}`}
        </Text>
      </View>
      <View style={styles.playerScore}>
        <Text style={[styles.playerPts, { color: state === 'not-started' ? t.muted : t.text }]}>{fmt(row.live)}</Text>
        {showProjection && row.projectedFinal !== undefined ? (
          <Text style={[styles.sub, { color: t.muted }]}>proj {fmt(row.projectedFinal)}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.6 },
  headText: { fontFamily: font.regular, fontSize: 12, fontVariant: ['tabular-nums'] },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamText: { flex: 1 },
  teamName: { fontSize: 16, fontFamily: font.semibold },
  sub: { fontFamily: font.regular, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  score: { fontSize: 24, fontVariant: ['tabular-nums'] },
  winWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  winFill: { height: 6 },
  winText: { fontFamily: font.medium, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'center' },
  hint: { fontFamily: font.regular, fontSize: 12, textAlign: 'center' },
  detail: { gap: 16, marginTop: 4 },
  lineupTitle: { fontSize: 13, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  benchTitle: { fontSize: 12, fontFamily: font.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 2 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  playerText: { flex: 1 },
  playerName: { fontFamily: font.regular, fontSize: 15 },
  playerScore: { alignItems: 'flex-end' },
  playerPts: { fontSize: 15, fontFamily: font.semibold, fontVariant: ['tabular-nums'] },
});
