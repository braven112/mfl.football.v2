# Requirements Document

## Introduction

This feature improves the player list display in fantasy football matchup previews by organizing players into clear sections and displaying injury status information more prominently. The current system uses confusing badges that clutter the interface and doesn't clearly show injury status.

## Glossary

- **Player_List**: The display component showing all players for a team in a matchup preview
- **Starter**: A player currently in the starting lineup
- **Bench_Player**: A player currently on the bench
- **Injury_Status**: NFL injury designation (Q=Questionable, D=Doubtful, O=Out, IR=Injured Reserve, etc.)
- **Section_Header**: A subtle visual separator that groups related players

## Requirements

### Requirement 1

**User Story:** As a fantasy football manager, I want players organized by their lineup status, so that I can quickly see who is starting versus who is on the bench.

#### Acceptance Criteria

1. WHEN displaying a player list THEN the system SHALL show all starting players first
2. WHEN displaying starting players THEN the system SHALL include a subtle "Starters" section header
3. WHEN displaying bench players THEN the system SHALL show them after all starters with a subtle "Bench" section header
4. WHEN organizing players THEN the system SHALL maintain position order within each section (QB, RB, WR, TE, K, DEF)
5. WHEN displaying section headers THEN the system SHALL use subtle styling that doesn't compete with player information

### Requirement 2

**User Story:** As a fantasy football manager, I want to see injury status clearly displayed, so that I can make informed lineup decisions.

#### Acceptance Criteria

1. WHEN a player has an injury status THEN the system SHALL display the status letter in parentheses next to the player name
2. WHEN displaying injury status THEN the system SHALL use standard NFL injury designations (Q, D, O, IR, etc.)
3. WHEN a player has no injury status THEN the system SHALL not display any injury indicator
4. WHEN displaying injury status THEN the system SHALL use consistent formatting across all players
5. WHEN injury status changes THEN the system SHALL update the display immediately

### Requirement 3

**User Story:** As a fantasy football manager, I want a clean interface without excessive badges, so that I can focus on the important information.

#### Acceptance Criteria

1. WHEN displaying players THEN the system SHALL remove START and BENCH badges
2. WHEN displaying players THEN the system SHALL remove UPGRADE badges
3. WHEN organizing the layout THEN the system SHALL rely on section grouping instead of individual badges
4. WHEN displaying player information THEN the system SHALL maintain all essential data (name, position, team)
5. WHEN removing badges THEN the system SHALL preserve any functional actions they provided through alternative means