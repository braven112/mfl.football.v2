/**
 * The league's score precision, for every number on a live board.
 *
 * A context rather than a prop: the precision belongs to the PANEL (one league
 * on a cross-league board shows two decimals, another may show one), and the
 * player rows sit three components below the matchup that knows its panel.
 */
import { createContext, useContext } from 'react';
import { DEFAULT_SCORE_PRECISION, formatScore } from '../../../utils/live/score-precision';

export const ScorePrecisionContext = createContext<number>(DEFAULT_SCORE_PRECISION);

export function useScoreFormat(): (points: number) => string {
  const precision = useContext(ScorePrecisionContext);
  return (points: number) => formatScore(points, precision);
}
