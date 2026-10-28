/**
 * TheLeague's rule proposals — one card each on /theleague/rule-proposals.
 *
 * Lives in data (not the route) because the vote API validates a proposal id
 * against this list: a ballot for an id nobody proposed is refused.
 * Add a new idea as a new entry; its vote stays in discussion until a
 * commissioner opens it from the page.
 */
import type { RuleProposal } from './types';

export const THELEAGUE_RULE_PROPOSALS: RuleProposal[] = [
  {
    id: 'draft-pick-tiers',
    title: 'Draft Pick Tiers',
    season: '2027 season',
    summary:
      'The top 7 still make the playoffs. The 9 teams that miss them split into three tiers and play for comp picks in Weeks 15 to 17, with the best pick going to the worst tier.',
    changes: [
      'Seeds 8-10, 11-13 and 14-16 each form a tier. Every team plays both tier-mates every week, so six games each.',
      'Bottom tier plays for 1.17, 2.19 and 3.18. Middle tier plays for 2.17 and 3.17. Top tier plays for 2.18.',
      'Tier ties go to total points, then to the worse regular-season seed.',
      'Comp picks go from 3 a year to 6.',
      'The 5th-place bracket becomes the three Week 15 playoff losers, with a Week 16 bye for the best seed.',
    ],
    replaces: 'the Play-in Game and the Toilet Bowl Challenge',
    href: 'https://claude.ai/artifact/X4q6gzN6TyGCtKPxP3HXTP',
    linkLabel: 'Read the full proposal',
  },
];
