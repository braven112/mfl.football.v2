# Clean Player List Layout Design

## Overview

This design replaces the current badge-heavy player display with a clean, organized layout that groups players by their lineup status and clearly shows injury information. The new approach uses visual hierarchy and grouping instead of cluttering badges to communicate player status.

## Architecture

The player list component will be restructured to:
1. Sort players by lineup status (starters first, then bench)
2. Group players under subtle section headers
3. Display injury status inline with player names
4. Remove redundant badge elements

## Components and Interfaces

### PlayerListOrganizer
- **Purpose**: Sorts and groups players by lineup status
- **Input**: Array of players with lineup status
- **Output**: Organized player groups with section metadata

### SectionHeader
- **Purpose**: Displays subtle section dividers
- **Props**: section title, player count (optional)
- **Styling**: Minimal, non-competing visual design

### PlayerCard (Enhanced)
- **Purpose**: Displays individual player information
- **Enhancements**: Injury status integration, badge removal
- **Props**: player data, injury status, position, team

### InjuryStatusFormatter
- **Purpose**: Formats injury status for display
- **Input**: Raw injury status data
- **Output**: Formatted status string with parentheses

## Data Models

```typescript
interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  isStarter: boolean;
  injuryStatus?: InjuryStatus;
}

interface InjuryStatus {
  designation: 'Q' | 'D' | 'O' | 'IR' | 'PUP' | 'COV';
  description?: string;
}

interface PlayerSection {
  title: string;
  players: Player[];
  isStarters: boolean;
}

interface OrganizedPlayerList {
  starters: PlayerSection;
  bench: PlayerSection;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property 1: Starters appear before bench players**
*For any* player list containing both starters and bench players, all starter players should appear before all bench players in the organized output
**Validates: Requirements 1.1, 1.3**

**Property 2: Section headers appear with appropriate players**
*For any* player list, if starters exist then a "Starters" header should be present, and if bench players exist then a "Bench" header should be present
**Validates: Requirements 1.2, 1.3**

**Property 3: Position order maintained within sections**
*For any* group of players within a section, they should be ordered by position priority (QB, RB, WR, TE, K, DEF) regardless of their original order
**Validates: Requirements 1.4**

**Property 4: Injury status formatting**
*For any* player with an injury status, the displayed name should include the status letter in parentheses immediately following the name
**Validates: Requirements 2.1, 2.4**

**Property 5: Valid injury designations only**
*For any* displayed injury status, it should be one of the standard NFL designations (Q, D, O, IR, PUP, COV)
**Validates: Requirements 2.2**

**Property 6: No injury indicator when status absent**
*For any* player without an injury status, the displayed name should not contain parentheses or injury indicators
**Validates: Requirements 2.3**

**Property 7: Badge removal**
*For any* rendered player list, it should not contain START, BENCH, or UPGRADE badge elements
**Validates: Requirements 3.1, 3.2**

**Property 8: Essential data preservation**
*For any* player in the rendered list, the display should include the player's name, position, and team information
**Validates: Requirements 3.4**

## Error Handling

- **Invalid injury status**: Log warning and display player without injury indicator
- **Missing player data**: Skip incomplete players and log error
- **Empty player lists**: Display appropriate empty state message
- **Malformed position data**: Use fallback position ordering

## Testing Strategy

### Unit Testing Approach
- Test individual components (PlayerListOrganizer, SectionHeader, InjuryStatusFormatter)
- Test specific examples of player organization and formatting
- Test edge cases like empty lists, players with missing data
- Test injury status formatting with various valid and invalid inputs

### Property-Based Testing Approach
- Use **fast-check** library for TypeScript property-based testing
- Configure each property test to run minimum 100 iterations
- Generate random player lists with varying starter/bench ratios
- Generate random injury statuses and verify formatting consistency
- Test ordering properties across different list compositions

Each property-based test will be tagged with: **Feature: clean-player-list-layout, Property {number}: {property_text}**

Property tests verify universal behaviors while unit tests catch specific edge cases and integration points. Together they provide comprehensive coverage of the player list organization functionality.