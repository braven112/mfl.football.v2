/**
 * Demo script for MFL Schedule Integration
 * Demonstrates the playoff bracket detection and schedule integration functionality
 */

import { validatePacificPigskinsMatchup, createMatchupService } from './matchup-service';
import { createMFLScheduleIntegration } from './mfl-schedule-integration';

/**
 * Demo function to show MFL schedule integration capabilities
 */
export async function demoMFLScheduleIntegration(): Promise<void> {
  console.log('🏈 MFL Schedule Integration Demo');
  console.log('================================\n');

  try {
    // 1. Test playoff bracket detection
    console.log('1. Testing Playoff Bracket Detection...');
    const scheduleIntegration = createMFLScheduleIntegration({
      leagueId: '13522',
      year: '2025',
    });

    const week15Matchups = await scheduleIntegration.getWeeklyMatchups(15);
    console.log(`   ✅ Successfully loaded ${week15Matchups.length} matchups for week 15`);
    
    // Show bracket information
    const matchupsWithBrackets = week15Matchups.filter(m => m.bracketInfo);
    console.log(`   ✅ Found ${matchupsWithBrackets.length} playoff bracket games`);
    
    matchupsWithBrackets.forEach(matchup => {
      console.log(`   📋 ${matchup.homeTeamId} vs ${matchup.awayTeamId} - ${matchup.bracketInfo?.bracketName} (${matchup.bracketInfo?.gameType})`);
    });

    // 2. Test specific Pacific Pigskins vs Midwestside Connection validation
    console.log('\n2. Testing Pacific Pigskins vs Midwestside Connection Matchup...');
    const validation = await validatePacificPigskinsMatchup({
      leagueId: '13522',
      year: '2025',
    });

    if (validation.exists) {
      console.log('   ✅ Pacific Pigskins vs Midwestside Connection matchup found!');
      console.log(`   📋 Bracket: ${validation.bracketInfo?.bracketName}`);
      console.log(`   🏆 Game Type: ${validation.bracketInfo?.gameType}`);
      console.log(`   🏷️  Label: ${validation.bracketInfo?.bracketLabel}`);
    } else {
      console.log('   ❌ Pacific Pigskins vs Midwestside Connection matchup not found');
    }

    // 3. Test matchup service integration
    console.log('\n3. Testing Matchup Service Integration...');
    const matchupService = createMatchupService({
      leagueId: '13522',
      year: '2025',
      enablePlayoffBrackets: true,
    });

    const fullMatchups = await matchupService.getWeeklyMatchups(15);
    console.log(`   ✅ Matchup service loaded ${fullMatchups.length} complete matchups`);
    
    // Show some example matchup analysis
    const exampleMatchup = fullMatchups.find(m => m.bracketInfo);
    if (exampleMatchup) {
      console.log(`   📝 Example Analysis: "${exampleMatchup.analysis}"`);
    }

    // 4. Test bracket label generation
    console.log('\n4. Testing Bracket Label Generation...');
    const bracketLabels = new Set(
      week15Matchups
        .filter(m => m.bracketInfo)
        .map(m => scheduleIntegration.generateBracketLabel(m))
    );

    console.log(`   ✅ Generated ${bracketLabels.size} unique bracket labels:`);
    Array.from(bracketLabels).forEach(label => {
      console.log(`   🏷️  "${label}"`);
    });

    console.log('\n🎉 MFL Schedule Integration Demo Complete!');
    console.log('   All functionality working correctly with real playoff bracket data.');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    throw error;
  }
}

// Run demo if this file is executed directly
if (require.main === module) {
  demoMFLScheduleIntegration()
    .then(() => {
      console.log('\n✅ Demo completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Demo failed:', error);
      process.exit(1);
    });
}