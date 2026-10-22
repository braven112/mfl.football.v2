$(document).ready(function () {
    var premierteams =
      "#franchiseicon_0002, #franchiseicon_0005, #franchiseicon_0006, #franchiseicon_0009, #franchiseicon_0010, #franchiseicon_0012, #franchiseicon_0017, #franchiseicon_0018, #franchiseicon_0019, #franchiseicon_0020, #franchiseicon_0021, #franchiseicon_0024";
    var dleagueteams =
      "#franchiseicon_0001, #franchiseicon_0003,#franchiseicon_0004, #franchiseicon_0007, #franchiseicon_0008, #franchiseicon_0011, #franchiseicon_0013, #franchiseicon_0014, #franchiseicon_0015, #franchiseicon_0016, #franchiseicon_0022, #franchiseicon_0023";
    //Check for this in the url -- MFL doesn't order it this way so standard power rank page works normally.
    if (window.location.href.indexOf("W=17&SORT=ALLPLAY&DISPLAY=LEAGUE") > -1) {
      $("body").addClass("pro-relpage");
      $(premierteams).closest("tr").removeClass().addClass("premierleague--row");
      $(dleagueteams).closest("tr").removeClass().addClass("dleague--row");
  
      $(".report-wrapper")
        .attr("id", "premierleague")
        .addClass("premierleague pro-rel")
        .clone()
        .removeClass()
        .attr("id", "dleague")
        .addClass("report-wrapper dleague pro-rel")
        .appendTo(".mobile-wrap");
  
      $(".premierleague caption span").text("Premier League");
      $(".dleague caption span").text("D-League");
      $(".dleague .premierleague--row, .premierleague .dleague--row").detach();
      generateRelegationPlayoff();
    }
  });
  
  function generateRelegationPlayoff() {
    //get all the all play pct of the 4 teams in question
    const pl9 = $(
      ".pro-relpage .premierleague .premierleague--row:nth-child(11) .all_play_pct"
    ).html();
    const pl10 = $(
      ".pro-relpage .premierleague .premierleague--row:nth-child(12) .all_play_pct"
    ).html();
    const dl3 = $(
      ".pro-relpage .dleague .dleague--row:nth-child(5) .all_play_pct"
    ).html();
    const dl4 = $(
      ".pro-relpage .dleague .dleague--row:nth-child(6) .all_play_pct"
    ).html();
  
    //get the 4 rows for each team
    const pl9Row = $(
      ".pro-relpage .premierleague .premierleague--row:nth-child(11)"
    )
      .addClass("relegation-playoff--row")
      .html();
    const pl10Row = $(
      ".pro-relpage .premierleague .premierleague--row:nth-child(12)"
    )
      .addClass("relegation-playoff--row")
      .html();
    const dl3Row = $(".pro-relpage .dleague .dleague--row:nth-child(5)")
      .addClass("relegation-playoff--row")
      .html();
    const dl4Row = $(".pro-relpage .dleague .dleague--row:nth-child(6)")
      .addClass("relegation-playoff--row")
      .html();
  
    const dleaguetable = document.createElement("div");
    dleaguetable.classList.add("report-wrapper", "pro-rel-playoffs", "pro-rel");
  
    var prorelteams = "";
    prorelteams += '<table align="center" cellspacing="1" class="report">';
    prorelteams +=
      "    <caption><span>Promotion/Relegation playoff standings</span></caption>";
    prorelteams += "    <tbody>";
    prorelteams += "        <tr>";
    prorelteams += '            <th class="franchisename">Franchise</th>';
    prorelteams += '            <th class="all_play_w">W</th>';
    prorelteams += '            <th class="all_play_l">L</th>';
    prorelteams += '            <th class="all_play_pct">Pct</th>';
    prorelteams += "        </tr>";
  
    //Generate Playoff standings
    if (pl9 < dl3 && pl9 < dl4) {
      console.log("dl3, dl4, pl9, pl10");
      //Add dl3 to 1st row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl3Row;
      prorelteams += "        </tr>";
      //Add dl4 to 2nd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl4Row;
      prorelteams += "        </tr>";
      //Add pl9 to 3rd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl9Row;
      prorelteams += "        </tr>";
      //Add pl10 to 4th row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl10Row;
      prorelteams += "        </tr>";
    }
    if (pl9 < dl3 && pl9 >= dl4) {
      console.log("dl3, pl9, dl4, pl10");
      //Add dl3 to 1st row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl3Row;
      prorelteams += "        </tr>";
      //Add pl9 to 2nd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl9Row;
      prorelteams += "        </tr>";
      //Add dl4 to 3rd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl4Row;
      prorelteams += "        </tr>";
  
      //Add pl10 to 4th row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl10Row;
      prorelteams += "        </tr>";
    }
    if (pl9 >= dl3 && pl10 >= dl3) {
      //Add pl9 to 1st row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl9Row;
      prorelteams += "        </tr>";
      //Add pl10 to 2nd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl10Row;
      prorelteams += "        </tr>";
      //Add dl3 to 3rd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl3Row;
      prorelteams += "        </tr>";
      //Add dl4 to 4th row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl4Row;
      prorelteams += "        </tr>";
    }
    if (pl9 >= dl3 && pl10 < dl3) {
      console.log("pl9, dl3, pl10, dl4");
      //Add pl9 to 1st row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl9Row;
      prorelteams += "        </tr>";
      //Add dl3 to 2nd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl3Row;
      prorelteams += "        </tr>";
      //Add pl10 to 3rd row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += pl10Row;
      prorelteams += "        </tr>";
      //Add dl4 to 4th row of playoff table
      prorelteams += '        <tr class="relegation-playoff--row">';
      prorelteams += dl4Row;
      prorelteams += "        </tr>";
    }
    //Close pro/rel table
    prorelteams += "    </tbody>";
    prorelteams += "</table>";
  
    //After creating the table insert it here
    dleaguetable.innerHTML = prorelteams;
    document.getElementById("dleague").after(dleaguetable);
  }