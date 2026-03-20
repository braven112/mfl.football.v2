/**
 * Intel Digest Types
 *
 * Structured JSON schema for daily fantasy news digests produced by the
 * fantasy-news-scanner scheduled task and rendered on the Intel page.
 */

export interface IntelStrategicNote {
  text: string;
  sourceUrl?: string;      // Link to supporting source
  source?: string;         // Source name
}

export interface IntelDigest {
  date: string;                                     // YYYY-MM-DD
  scannedAt?: string;                               // ISO 8601 timestamp of when news was scanned
  alerts: IntelAlert[];                             // Actionable player alerts
  sleeperWatch: Record<string, IntelSleeper[]>;     // Keyed by draft year
  generalNews: IntelNewsItem[];                     // Broader NFL news
  strategicNotes: (string | IntelStrategicNote)[];  // Market observations (string for backward compat)
}

export interface IntelAlert {
  player: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  rspTier?: string;        // A-F
  rspValue?: string;       // "Under 14", "Par", etc.
  rspTypes?: string[];     // ["U", "↑"]
  news: string;            // What happened
  impact: string;          // Why it matters
  action: 'bid' | 'watch' | 'trade' | 'hold' | 'sell';
  leagueStatus: 'free-agent' | 'rostered' | 'taxi' | 'ir';
  sourceUrl?: string;      // Link to original news source
  source?: string;         // Source name (e.g. "ESPN", "Rotoworld")
}

export interface IntelSleeper {
  name: string;
  position: string;
  nflTeam: string;
  headshot?: string;
  tier: string;
  value: string;
  types: string[];
  news: string;            // "No updates" or latest intel
  leagueStatus: string;
  sourceUrl?: string;      // Link to original news source
  source?: string;         // Source name
}

export interface IntelNewsItem {
  headline: string;
  summary: string;
  source: string;          // "Rotoworld", "ESPN", etc.
  impact: 'low' | 'medium' | 'high';
  sourceUrl?: string;      // Link to original article
}
