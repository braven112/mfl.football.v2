#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const logosDir = path.join(projectRoot, 'public', 'assets', 'nfl-logos');

// All 32 NFL team codes
const teamCodes = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
];

// MFLscripts source with team code mappings
const getMflscriptsUrl = (teamCode) => {
  const mflCodeMap = {
    GB: 'GBP',
    KC: 'KCC',
    NE: 'NEP',
    NO: 'NOS',
    LV: 'LVR',
    SF: 'SFO',
    TB: 'TBB',
    JAX: 'JAC',
  };
  const mflCode = mflCodeMap[teamCode] || teamCode;
  return `https://www.mflscripts.com/ImageDirectory/script-images/nflTeamsvg_2/${mflCode}.svg`;
};

const downloadLogo = async (teamCode) => {
  try {
    const url = getMflscriptsUrl(teamCode);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NFLLogoDownloader/1.0)',
      },
    });

    if (!response.ok) {
      console.warn(`⚠️  Failed to download ${teamCode}: ${response.status}`);
      return false;
    }

    const content = await response.text();
    const filePath = path.join(logosDir, `${teamCode}.svg`);
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`✓ Downloaded ${teamCode}`);
    return true;
  } catch (error) {
    console.error(`✗ Error downloading ${teamCode}:`, error.message);
    return false;
  }
};

const run = async () => {
  try {
    // Create logos directory
    await fs.mkdir(logosDir, { recursive: true });
    console.log(`📁 Logos directory: ${logosDir}\n`);

    let successCount = 0;
    let failureCount = 0;

    // Download all logos
    for (const teamCode of teamCodes) {
      const success = await downloadLogo(teamCode);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    console.log(`\n📊 Summary: ${successCount} downloaded, ${failureCount} failed`);

    if (failureCount === 0) {
      console.log('✅ All NFL team logos downloaded successfully!');
    } else {
      console.log(`⚠️  ${failureCount} logo(s) failed to download`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Failed to download NFL logos:', error.message);
    process.exitCode = 1;
  }
};

run();
