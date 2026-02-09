# Implementation Plan

- [ ] 1. Create core player organization utilities
  - Implement PlayerListOrganizer class with sorting and grouping logic
  - Create InjuryStatusFormatter utility for consistent status display
  - Set up TypeScript interfaces for Player, InjuryStatus, and PlayerSection
  - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [ ]* 1.1 Write property test for player organization
  - **Property 1: Starters appear before bench players**
  - **Validates: Requirements 1.1, 1.3**

- [ ]* 1.2 Write property test for position ordering
  - **Property 3: Position order maintained within sections**
  - **Validates: Requirements 1.4**

- [ ] 2. Implement injury status formatting
  - Create injury status validation and formatting functions
  - Handle edge cases for missing or invalid injury data
  - Ensure consistent parentheses formatting for status display
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ]* 2.1 Write property test for injury status formatting
  - **Property 4: Injury status formatting**
  - **Validates: Requirements 2.1, 2.4**

- [ ]* 2.2 Write property test for valid injury designations
  - **Property 5: Valid injury designations only**
  - **Validates: Requirements 2.2**

- [ ]* 2.3 Write property test for no injury indicator when absent
  - **Property 6: No injury indicator when status absent**
  - **Validates: Requirements 2.3**

- [ ] 3. Create section header component
  - Implement SectionHeader component with subtle styling
  - Support for "Starters" and "Bench" section titles
  - Ensure headers only appear when relevant players exist
  - _Requirements: 1.2, 1.3_

- [ ]* 3.1 Write property test for section headers
  - **Property 2: Section headers appear with appropriate players**
  - **Validates: Requirements 1.2, 1.3**

- [ ] 4. Update player card component
  - Remove START, BENCH, and UPGRADE badge elements
  - Integrate injury status display into player name
  - Preserve essential player information (name, position, team)
  - _Requirements: 3.1, 3.2, 3.4_

- [ ]* 4.1 Write property test for badge removal
  - **Property 7: Badge removal**
  - **Validates: Requirements 3.1, 3.2**

- [ ]* 4.2 Write property test for essential data preservation
  - **Property 8: Essential data preservation**
  - **Validates: Requirements 3.4**

- [ ] 5. Integrate organized layout into matchup preview
  - Update matchup preview component to use new player organization
  - Replace existing player list with organized sections
  - Ensure proper data flow from existing player data sources
  - _Requirements: 1.1, 1.2, 1.3_

- [ ]* 5.1 Write unit tests for matchup preview integration
  - Test integration between player organization and display components
  - Verify data flows correctly from source to organized display
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Update existing components to remove badge dependencies
  - Remove badge-related code from existing player components
  - Clean up unused badge styling and logic
  - Ensure no broken references to removed badge functionality
  - _Requirements: 3.1, 3.2, 3.5_

- [ ]* 7.1 Write unit tests for cleanup verification
  - Verify no badge-related code remains in components
  - Test that all functionality is preserved after badge removal
  - _Requirements: 3.1, 3.2, 3.5_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.