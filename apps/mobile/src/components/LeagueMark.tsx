import { useState } from 'react';
import { Image } from 'react-native';
import { absoluteUrl } from '../api';

/**
 * A league's own logo beside its name — only for the leagues this site runs,
 * whose logos the server renders to PNG. Any other league draws nothing: MFL
 * publishes no league logo, and an invented badge would pass for one.
 */
export function LeagueMark({ logo, name, size = 22 }: { logo?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = absoluteUrl(logo ?? '');
  if (!uri || failed) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={`${name} logo`}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
