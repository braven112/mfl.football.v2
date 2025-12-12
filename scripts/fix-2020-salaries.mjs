import fs from 'fs';
import path from 'path';

// Correct 2020 salaries from Google Doc
const correctSalaries = {
  // QBs
  'Rodgers, Aaron': 7837500,
  'Wilson, Russell': 7177500,
  'Carr, Derek': 5802500,
  'Newton, Cam': 5747500,
  'Brady, Tom': 5500000,
  'Ryan, Matt': 4870250,
  'Stafford, Matthew': 4794927,
  'Brees, Drew': 4550000,
  'Roethlisberger, Ben': 4427500,
  'Cousins, Kirk': 2750000,
  'Rivers, Philip': 2625000,
  'Dalton, Andy': 2600000,
  'Garoppolo, Jimmy': 2525000,
  'Keenum, Case': 2420000,
  'Tannehill, Ryan': 1600000,
  'Goff, Jared': 1207882,
  'Wentz, Carson': 1171280,
  'Allen, Kyle': 1100000,
  'Watson, Deshaun': 1098075,
  'Bridgewater, Teddy': 1072500,
  'Winston, Jameis': 1025000,
  'Mayfield, Baker': 786500,
  'Murray, Kyler': 770000,
  'Mahomes, Patrick': 765325,
  'Tagovailoa, Tua': 700000,
  'Burrow, Joe': 675000,
  'Prescott, Dak': 658845,
  'Trubisky, Mitchell': 632225,
  'Hill, Taysom': 600000,
  'Herbert, Justin': 575000,
  'Allen, Josh': 574750,
  'Darnold, Sam': 574750,

  // RBs
  'Gordon, Melvin': 9036317,
  'Gurley, Todd': 9036317,
  'Bell, Le\'Veon': 6800000,
  'Johnson, David': 6225000,
  'Freeman, Devonta': 5500000,
  'Ingram, Mark': 5025000,
  'Elliott, Ezekiel': 4977940,
  'Fournette, Leonard': 4525400,
  'McCaffrey, Christian': 4126100,
  'Barkley, Saquon': 4114000,
  'Montgomery, David': 3740000,
  'Cook, Dalvin': 3460600,
  'Edwards-Helaire, Clyde': 3400000,
  'Mostert, Raheem': 3225000,
  'Taylor, Jonathan': 3100000,
  'Mixon, Joe': 2928200,
  'Jacobs, Josh': 2860000,
  'Coleman, Tevin': 2850000,
  'Jones, Ronald': 2662000,
  'Carson, Chris': 2450250,
  'Henry, Derrick': 2049740,
  'Michel, Sony': 1936000,
  'Thompson, Chris': 1870000,
  'Dobbins, J.K.': 1800000,
  'Chubb, Nick': 1694000,
  'Peterson, Adrian': 1650000,
  'Swift, D\'Andre': 1600000,
  'Hunt, Kareem': 1597200,
  'Akers, Cam': 1400000,
  'Johnson, Kerryon': 1331000,
  'Kamara, Alvin': 1331000,
  'Murray, Latavius': 1150000,

  // WRs
  'Hopkins, DeAndre': 13525000,
  'Jones, Julio': 12500000,
  'Adams, Davante': 12100000,
  'Evans, Mike': 11550000,
  'Allen, Keenan': 11027500,
  'Beckham, Odell': 11000000,
  'Diggs, Stefon': 10775000,
  'Hilton, T.Y.': 10000000,
  'Cooper, Amari': 9000000,
  'Landry, Jarvis': 8250000,
  'Robinson, Allen': 7837500,
  'Cooks, Brandin': 6525000,
  'Lockett, Tyler': 6500000,
  'Green, A.J.': 6025000,
  'Parker, DeVante': 5000000,
  'Sanders, Emmanuel': 4647500,
  'Jones, Marvin': 4400000,
  'Edelman, Julian': 4000000,
  'Thielen, Adam': 3660250,
  'Harry, N\'Keal': 3520000,
  'Thomas, Michael': 3367430,
  'Davis, Corey': 3061300,
  'Brown, John': 3025000,
  'Lamb, CeeDee': 2900000,
  'Brown, A.J.': 2860000,
  'Ridley, Calvin': 2783000,
  'Jeudy, Jerry': 2600000,
  'Metcalf, DK': 2530000,
  'Williams, Mike': 2462350,
  'Campbell, Parris': 2035000,
  'Shepard, Sterling': 2000000,
  'Hardman, Mecole': 1842500,

  // TEs
  'Kelce, Travis': 12100000,
  'Ertz, Zach': 10250000,
  'Waller, Darren': 8500000,
  'Rudolph, Kyle': 5475250,
  'Higbee, Tyler': 4250000,
  'Cook, Jared': 4000000,
  'Burton, Trey': 3660250,
  'Doyle, Jack': 3625000,
  'Ebron, Eric': 3350000,
  'Fells, Darren': 2803196,
  'Olsen, Greg': 2475000,
  'Dissly, Will': 2337500,
  'Howard, O.J.': 1464100,
  'Hockenson, T.J.': 1210000,
  'Engram, Evan': 1031525,
  'Hooper, Austin': 951665,
  'Fant, Noah': 935000,
  'Smith, Jonnu': 931700,
  'Schultz, Dalton': 925000,
  'Njoku, David': 865150,
  'Gesicki, Mike': 816750,
  'Henry, Hunter': 805255,
  'Firkser, Anthony': 800000,
  'Brate, Cameron': 775000,
  'Graham, Jimmy': 750000,
  'Kroft, Tyler': 750000,
  'Smith Jr., Irv': 742500,
  'Hurst, Hayden': 726000,
  'Sternberger, Jace': 660000,
  'Goedert, Dallas': 635250,
  'Everett, Gerald': 632225,
  'Kittle, George': 598950,

  // PKs
  'Tucker, Justin': 900000,
  'Zuerlein, Greg': 848318,
  'Crosby, Mason': 770000,
  'Gould, Robbie': 673200,
  'Boswell, Chris': 625000,
  'Gonzalez, Zane': 625000,
  'McManus, Brandon': 625000,
  'Lutz, Wil': 622242,
  'Butker, Harrison': 565675,
  'Fairbairn, Ka\'imi': 540000,
  'Badgley, Mike': 540000,
  'Seibert, Austin': 529606,
  'Koo, Younghoe': 467500,
  'Slye, Joey': 467500,
  'Bailey, Dan': 450000,
  'Sanders, Jason': 450000,
  'Bass, Tyler': 425000,
  'Blankenship, Rodrigo': 425000,
  'Bullock, Randy': 425000,
  'Carlson, Daniel': 425000,
  'Folk, Nick': 425000,
  'Gano, Graham': 425000,
  'Gostkowski, Stephen': 425000,
  'Myers, Jason': 425000,
  'Parkey, Cody': 425000,
  'Prater, Matt': 425000,
  'Succop, Ryan': 425000,

  // Defenses
  'Bears, Chicago': 1225000,
  'Rams, Los Angeles': 1100000,
  'Ravens, Baltimore': 1100000,
  'Chargers, Los Angeles': 925000,
  'Saints, New Orleans': 900000,
  'Titans, Tennessee': 770000,
  'Cowboys, Dallas': 725000,
  'Jets, New York': 675000,
  'Seahawks, Seattle': 665500,
  'Eagles, Philadelphia': 658845,
  'Steelers, Pittsburgh': 622242,
  'Jaguars, Jacksonville': 622242,
  'Patriots, New England': 565675,
  'Browns, Cleveland': 565675,
  'Bills, Buffalo': 565675,
  'Chiefs, Kansas City': 544500,
  'Colts, Indianapolis': 514250,
  '49ers, San Francisco': 514250,
  'Bengals, Cincinnati': 500000,
  'Raiders, Las Vegas': 500000,
  'Giants, New York': 495000,
  'Broncos, Denver': 475000,
  'Dolphins, Miami': 467500,
  'Buccaneers, Tampa Bay': 467500,
  'FootballTeam, Washington': 467500,
  'Packers, Green Bay': 467500,
  'Falcons, Atlanta': 467500,
  'Cardinals, Arizona': 425000,
  'Panthers, Carolina': 425000,
  'Vikings, Minnesota': 425000,
  'Texans, Houston': 425000,
};

// Read the players.json to get player IDs and names
const playersFile = 'data/theleague/mfl-feeds/2020/players.json';
const rostersFile = 'data/theleague/mfl-feeds/2020/rosters.json';

console.log('Loading player data...');
const playersData = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
const rostersData = JSON.parse(fs.readFileSync(rostersFile, 'utf8'));

// Build a map of player names to IDs
const playerNameToId = new Map();
const players = Array.isArray(playersData.players?.player)
  ? playersData.players.player
  : [playersData.players?.player].filter(Boolean);

players.forEach(player => {
  if (player?.name && player?.id) {
    playerNameToId.set(player.name, player.id);
  }
});

console.log(`Loaded ${playerNameToId.size} players`);

// Update roster salaries
let updateCount = 0;
let notFoundCount = 0;
const notFound = [];

rostersData.rosters.franchise.forEach(franchise => {
  if (!franchise.player) return;
  const playerList = Array.isArray(franchise.player) ? franchise.player : [franchise.player];

  playerList.forEach(rosterPlayer => {
    // Find player details
    const player = players.find(p => p.id === rosterPlayer.id);
    if (!player) return;

    const playerName = player.name;
    const correctSalary = correctSalaries[playerName];

    if (correctSalary !== undefined) {
      const oldSalary = rosterPlayer.salary;
      rosterPlayer.salary = correctSalary.toFixed(2);
      if (oldSalary !== rosterPlayer.salary) {
        updateCount++;
        console.log(`Updated ${playerName}: $${oldSalary} -> $${rosterPlayer.salary}`);
      }
    } else if (parseFloat(rosterPlayer.salary) === 425000 || parseFloat(rosterPlayer.salary) < 500000) {
      // Track players that might need correction but weren't in our list
      notFound.push(playerName);
      notFoundCount++;
    }
  });
});

// Write updated rosters
fs.writeFileSync(rostersFile, JSON.stringify(rostersData, null, 2));
console.log(`\n✓ Updated ${updateCount} player salaries`);
console.log(`✓ Saved to ${rostersFile}`);

if (notFoundCount > 0) {
  console.log(`\n⚠ ${notFoundCount} players at low salaries not in correction list:`);
  console.log(notFound.slice(0, 20).join(', '));
  if (notFound.length > 20) {
    console.log(`  ... and ${notFound.length - 20} more`);
  }
}
