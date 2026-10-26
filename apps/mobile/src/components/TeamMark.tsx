import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { MflLiveAppTeam } from '@mfl/shared-types/mfl-live-app';
import { absoluteUrl } from '../api';
import { useTheme } from '../theme';

/**
 * A franchise's own crest or uploaded logo, else its initials on a neutral
 * field. Never an NFL mark: the store board does not send one, and a
 * leftover 'nfl' rung is drawn as text here too.
 */
export function TeamMark({ team, size = 36 }: { team: MflLiveAppTeam; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = team.rung === 'nfl' ? '' : absoluteUrl(team.icon);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={team.iconAlt}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: team.rung === 'mfl' ? 6 : 0 }}
        resizeMode={team.rung === 'mfl' ? 'cover' : 'contain'}
      />
    );
  }
  return (
    <View style={[styles.field, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.field }]}>
      <Text style={[styles.initials, { color: t.muted, fontSize: size * 0.38 }]}>{team.initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '700' },
});
