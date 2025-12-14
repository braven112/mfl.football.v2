#!/usr/bin/env node

// Quick test to see what MFL API returns
const leagueId = '13522';
const year = '2025';
const week = '15';

async function testMFLAPI() {
  const baseUrl = 'https://api.myfantasyleague.com';
  
  // Test different endpoints
  const endpoints = [
    `${baseUrl}/${year}/export?TYPE=startingLineups&L=${leagueId}&W=${week}&JSON=1`,
    `${baseUrl}/${year}/export?TYPE=rosters&L=${leagueId}&W=${week}&JSON=1`,
    `${baseUrl}/${year}/export?TYPE=rosters&L=${leagueId}&JSON=1`
  ];
  
  for (const url of endpoints) {
    console.log(`\n🔍 Testing: ${url}`);
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('Response keys:', Object.keys(data));
      if (data.error) {
        console.log('❌ Error:', data.error);
      } else {
        console.log('✅ Success - sample data:', JSON.stringify(data).substring(0, 100) + '...');
      }
    } catch (error) {
      console.log('❌ Fetch error:', error.message);
    }
  }
}

testMFLAPI();