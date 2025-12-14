# Implementation Plan

- [x] 1. Set up core infrastructure and data models
  - Create TypeScript interfaces for all new data models (Matchup, StartingLineup, LineupOptimization, AnalysisPrompt)
  - Set up MFL API integration utilities for starting lineups and player status
  - Create game state management utilities
  - _Requirements: 1.1, 8.1, 9.1_

- [x] 1.1 Write property test for data model validation
  - **Property 23: Starting lineup indication**
  - **Validates: Requirements 8.1**

- [x] 2. Implement matchup navigation and routing system
  - Create MatchupSelector component with dropdown/modal interface
  - Implement URL routing for different matchups with query parameters
  - Add matchup switching functionality with state management
  - _Requirements: 1.5, 7.1, 7.2, 7.5_

- [x] 2.1 Write property test for matchup navigation
  - **Property 4: Matchup navigation completeness**
  - **Validates: Requirements 1.5, 7.2**

- [x] 2.2 Write property test for URL shareability
  - **Property 22: URL shareability**
  - **Validates: Requirements 7.5**

- [x] 3. Create reusable Sunday Ticket Multi-View component
  - Extract existing multiview logic into standalone component
  - Implement tab interface for early/late time slots
  - Add support for different game count scenarios (1-4 games + RedZone)
  - Create responsive grid layout with proper fallbacks
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.1 Write property test for Sunday Ticket game count handling
  - **Property 7: Sunday Ticket game count handling**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 3.2 Write property test for time slot tab separation
  - **Property 8: Time slot tab separation**
  - **Validates: Requirements 3.5**

- [x] 4. Implement time zone handling and calendar icons
  - Update existing timezone conversion logic for multiple matchups
  - Replace clock icons with calendar icons throughout the interface
  - Add timezone-specific copy updates (10 AM PT vs 1 PM ET)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4.1 Write property test for time zone display accuracy
  - **Property 5: Time zone display accuracy**
  - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 4.2 Write property test for calendar icon usage
  - **Property 6: Calendar icon usage**
  - **Validates: Requirements 2.3**

- [x] 5. Build lineup accordion component
  - Create collapsible LineupAccordion component near scoreboard
  - Implement starting lineup display for both teams
  - Add minimal space usage when collapsed with full roster view when expanded
  - _Requirements: 8.4, 8.5_

- [x] 5.1 Write property test for lineup accordion functionality
  - **Property 25: Lineup accordion functionality**
  - **Validates: Requirements 8.4, 8.5**

- [x] 6. Implement player status indicators and optimization detection
  - Create PlayerStatusIndicator component with starting/bench badges
  - Implement LineupOptimizer for detecting bench upgrades
  - Add visual indicators for lineup optimization opportunities
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 6.1 Write property test for lineup optimization detection
  - **Property 24: Lineup optimization detection**
  - **Validates: Requirements 8.2, 8.3**

- [x] 7. Create injury management and warning system
  - Implement pulsating animation effects for injured starters (Out/Doubtful/IR)
  - Add InjuryManager component with IR eligibility detection
  - Create direct links to submit lineup page for corrections
  - Add one-click IR move functionality with MFL API integration
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ]* 7.1 Write property test for injury status visual alerts
  - **Property 28: Injury status visual alerts**
  - **Validates: Requirements 10.1**

- [ ]* 7.2 Write property test for IR eligibility detection
  - **Property 30: IR eligibility detection**
  - **Validates: Requirements 10.3**

- [ ]* 7.3 Write property test for one-click IR management
  - **Property 31: One-click IR management**
  - **Validates: Requirements 10.4, 10.5**

- [ ] 8. Implement real-time score updates with analysis stability
  - Create ScoreUpdater component for Sunday live updates and daily refreshes
  - Implement analysis generation stability (never regenerate existing analysis)
  - Add game state transition handling from pre-game to post-game
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ]* 8.1 Write property test for real-time score updates
  - **Property 26: Real-time score updates**
  - **Validates: Requirements 9.1, 9.2**

- [ ]* 8.2 Write property test for analysis generation stability
  - **Property 27: Analysis generation stability**
  - **Validates: Requirements 9.3, 9.4, 9.5**

- [ ] 9. Build intelligent matchup analysis generator
  - Create AnalysisGenerator component with lineup optimization focus
  - Implement analysis prompts that prioritize critical lineup decisions
  - Add logic to highlight injured starters and significant bench upgrades
  - Ensure 2-3 sentence limit with smart content prioritization
  - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8_

- [ ]* 9.1 Write property test for critical lineup issue prioritization
  - **Property 32: Critical lineup issue prioritization**
  - **Validates: Requirements 4.6**

- [ ]* 9.2 Write property test for bench upgrade analysis inclusion
  - **Property 33: Bench upgrade analysis inclusion**
  - **Validates: Requirements 4.7**

- [ ]* 9.3 Write property test for analysis focus hierarchy
  - **Property 34: Analysis focus hierarchy**
  - **Validates: Requirements 4.8**

- [ ] 10. Implement multiple matchup support and display
  - Extend existing single matchup page to handle 8-16 matchups per week
  - Add chronological ordering logic for matchups
  - Implement consistent layout across all matchup previews
  - Add support for doubleheader weeks (16 matchups)
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ]* 10.1 Write property test for matchup display completeness
  - **Property 1: Matchup display completeness**
  - **Validates: Requirements 1.2, 1.3**

- [ ]* 10.2 Write property test for chronological matchup ordering
  - **Property 2: Chronological matchup ordering**
  - **Validates: Requirements 1.1**

- [ ]* 10.3 Write property test for matchup layout consistency
  - **Property 3: Matchup layout consistency**
  - **Validates: Requirements 1.4**

- [ ] 11. Integrate all components and implement game state management
  - Wire together all components in the main matchup preview page
  - Implement GameStateManager for handling pre-game, in-progress, and completed states
  - Add dynamic content switching based on game states
  - Implement completed game reordering (move to bottom, maintain chronological order)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 11.1 Write property test for game state content switching
  - **Property 14: Game state content switching**
  - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ]* 11.2 Write property test for completed game reordering
  - **Property 15: Completed game reordering**
  - **Validates: Requirements 5.4, 5.5**

- [ ] 12. Implement news integration and player updates
  - Add news update propagation system for injury reports
  - Implement chronological news ordering with most recent first
  - Add analysis updates when player injury status changes
  - Ensure news affects all relevant matchups independently
  - _Requirements: 6.1, 6.3, 6.4, 6.5_

- [ ]* 12.1 Write property test for news update propagation
  - **Property 16: News update propagation**
  - **Validates: Requirements 6.1, 6.5**

- [ ]* 12.2 Write property test for news chronological ordering
  - **Property 17: News chronological ordering**
  - **Validates: Requirements 6.3**

- [ ]* 12.3 Write property test for analysis injury status reflection
  - **Property 18: Analysis injury status reflection**
  - **Validates: Requirements 6.4**

- [ ] 13. Add remaining game features and polish
  - Implement "Game of the Week" designation for highest projected points
  - Add player count displays with roster icons
  - Ensure all remaining analysis and display requirements are met
  - _Requirements: 4.4, 4.5_

- [ ]* 13.1 Write property test for Game of the Week designation
  - **Property 12: Game of the Week designation**
  - **Validates: Requirements 4.4**

- [ ]* 13.2 Write property test for player count display accuracy
  - **Property 13: Player count display accuracy**
  - **Validates: Requirements 4.5**

- [ ] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Add comprehensive error handling and fallbacks
  - Implement MFL API error handling for all integration points
  - Add graceful degradation for component failures
  - Create fallback content for missing data scenarios
  - Add retry mechanisms for failed API calls

- [ ]* 15.1 Write unit tests for error handling scenarios
  - Test MFL API failures, component rendering errors, and data unavailability
  - Verify graceful degradation and fallback mechanisms

- [ ] 16. Performance optimization and final integration
  - Optimize real-time update performance for Sunday game days
  - Implement efficient caching for lineup and player data
  - Add loading states and skeleton screens for better UX
  - Ensure responsive design works across all device sizes

- [ ]* 16.1 Write integration tests for complete user workflows
  - Test full matchup navigation, lineup optimization, and injury management flows
  - Verify cross-component interactions and state management

- [x] 16.2 Clean up NFL Schedule player list layout
  - Sort players by starters first, then bench players in NFL games section
  - Remove individual START/BENCH badges since grouping makes status clear
  - Add section headers for "Starters (N)" and "Bench (N)" groups
  - Implement visual distinction with color-coded borders and backgrounds
  - Create compact-clean status indicators that hide redundant badges
  - _Requirements: Visual clarity, reduced clutter, better user scanning_

- [x] 16.3 Simplify player group headers styling
  - Remove background color and border from starters/bench headers
  - Keep only colored text (green for starters, grey for bench)
  - Remove left padding/indentation from player lists
  - Create cleaner, more minimal section headers
  - _Requirements: Further visual simplification_

- [x] 16.4 Fix projected scores accuracy with MFL API
  - Investigate discrepancy between displayed projections and MFL livescoring API
  - Compare current projection source with MFL submit lineup API data
  - Update projection data source to match official MFL scoring
  - Ensure projected scores align with what users see in MFL interface
  - Set projected points to 0 for players on IR or Out (they can't play)
  - _Requirements: Data accuracy, user trust_

- [x] 16.5 Move upgrade suggestions to matchup analysis
  - Remove upgrade indicator buttons from individual player displays
  - Integrate lineup optimization suggestions into game-level "Matchup Analysis" section
  - Generate intelligent talking points about potential lineup improvements
  - Include bench upgrade recommendations in analysis text
  - _Requirements: Cleaner player display, contextual optimization advice_

- [x] 17. Implement MFL API schedule integration for accurate playoff brackets
  - Replace algorithmic matchup generation with real MFL API schedule data
  - Add MFL API schedule endpoint integration for week 15 playoff bracket
  - Implement playoff bracket detection and labeling (e.g., "Bracket 3 Playoff Game")
  - Validate that Pacific Pigskins vs Midwestside Connection appears as expected playoff matchup
  - Add error handling for MFL API schedule failures with fallback to current algorithm
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ]* 17.1 Write property test for MFL schedule data validation
  - **Property 35: MFL schedule data validation**
  - **Validates: Requirements 11.1, 11.3**

- [ ]* 17.2 Write property test for playoff bracket identification
  - **Property 36: Playoff bracket identification**
  - **Validates: Requirements 11.2, 11.4**

- [ ]* 17.3 Write unit test for specific playoff matchup validation
  - Test that Pacific Pigskins (0001) vs Midwestside Connection (0011) appears as Bracket 3 playoff game in week 15
  - **Validates: Requirements 11.2**

- [ ] 18. Enhance player headshot system with universal model
  - Create Universal Player Model with standardized headshot handling
  - Implement intelligent headshot fallback system (ESPN → MFL → placeholder)
  - Update all player components to use the universal model
  - Audit existing players using "no photo available" and find better sources
  - Add headshot quality detection and optimization
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ]* 18.1 Write property test for headshot fallback logic
  - **Property 37: Headshot fallback logic**
  - **Validates: Requirements 12.2, 12.3**

- [ ]* 18.2 Write property test for universal player model consistency
  - **Property 38: Universal player model consistency**
  - **Validates: Requirements 12.1, 12.5**

- [ ] 19. Implement Universal Player Model with MFL Injury Data
  - Create scalable player data service architecture for multi-league support
  - Integrate MFL as authoritative source for injury status across all leagues
  - Replace existing Sleeper injury data with MFL data in rosters page
  - Create reusable injury status display component with league-specific rules
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 19.1 Create Universal Player Service Architecture
  - Create `src/services/player/` directory structure
  - Implement `UniversalPlayerModel.ts` with shared player properties
  - Create `PlayerDataService.ts` for MFL data fetching and caching
  - Add build-time MFL injury data fetching for all leagues
  - _Requirements: 13.1, 13.2_

- [x] 19.2 Integrate MFL Injury Data as Primary Source
  - Replace Sleeper injury data with MFL injury data in rosters page
  - Update `buildSeasonPayload` function to use MFL injury status
  - Add fallback to Sleeper data only when MFL fetch fails
  - Ensure injury status is fetched once and shared across all league implementations
  - _Requirements: 13.2, 13.3_

- [ ] 19.3 Create Reusable Injury Status Display Component
  - Create base `InjuryStatusDisplay` component using universal player model
  - Implement consistent visual format: parentheses + letter (e.g., "(Q)", "(O)", "(IR)")
  - Create league-specific wrappers for IR eligibility rules (The League vs AFL Fantasy)
  - Update all existing injury status displays to use new component
  - _Requirements: 13.4, 13.5_

- [ ] 19.4 Update Existing Implementations
  - Update matchup preview page to use universal player model
  - Update rosters page to use new MFL injury data integration
  - Update all player status indicators to use reusable component
  - Ensure consistent injury status display across entire application
  - _Requirements: 13.3, 13.4, 13.5_

- [ ]* 19.5 Write property test for universal player model consistency
  - **Property 39: Universal player model consistency**
  - **Validates: Requirements 13.1, 13.5**

- [ ]* 19.6 Write property test for MFL injury data integration
  - **Property 40: MFL injury data integration**
  - **Validates: Requirements 13.2, 13.3**

- [ ] 20. Final Checkpoint - Complete system validation
  - Ensure all tests pass, ask the user if questions arise.