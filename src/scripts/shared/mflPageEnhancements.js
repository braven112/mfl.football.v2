/**
 * MFL page enhancements — migrated from global.js (mfl.football)
 * Requires jQuery (loaded by MFL before league tools).
 */

export function initMflPageEnhancements() {
  const $ = window.jQuery;
  if (!$) return;

  // Rename table headers
  $("th.divpct").text("Div %");
  $("th.all_play_wlt").text("All-Play");
  $("th.h2hpct").text("%");

  // Hamburger menu icon spans
  $(".myfantasyleague_menu > label span").html(
    '<span class="top-bun"></span><span class="burger"></span><span class="double-burger"></span><span class="bottom-bun"></span>'
  );

  // Style hints and hide injury color note
  $(".reportnavigation:contains('Hint:')").removeClass().addClass("alert alert-info");
  $(".reportnavigation:contains('Weekly NFL Injury Status is in this color.')").hide();

  // Message board formatting
  $("#body_board_show .page-wrapper").wrapInner(
    '<div class="mobile-wrap"><table class="report addCaption" cellspacing="1" align="center"><tbody><tr><td></td></tr></tbody></table></div>'
  );
  $("#body_board_show .page-wrapper .addCaption").prepend(
    "<caption><span>Message Board Topics</span></caption>"
  );
  $("#body_board_show table span.nav").appendTo(
    "#body_board_show #container-wrap .addCaption caption:first"
  );
  $("#body_board_show table th.messageboardbar").eq(1).remove();
  $("#body_board_show table caption").eq(1).remove();

  // Report wrapper logic
  $(".playoffbracket").addClass("report");
  if ($("#body_options_45").length === 0) {
    $(".report").wrap("<div class='report-wrapper'></div>");
  }
  $(
    "#outerMFLScoreboardDiv .report-wrapper .report," +
    "#lineup-form .report-wrapper .report," +
    "#body_board_show .report-wrapper .report-wrapper .report"
  ).unwrap();
  $(".report-wrapper .report-wrapper .report").unwrap();

  // Caption text
  $("#message_board_summary caption span").text("Message Board Summary");
  $("#owner_activity caption span").text("Owner Activity");
  $("#next_weeks_fantasy_schedule caption span").text("H2H Matchups");
  $("#last_weeks_fantasy_results caption span").text("H2H Results");
  $("#fantasy_recap caption span").text("Game Of The Week Recap");
  $("#fantasy_preview caption span").text("Game Of The Week Preview");

  // Commish link
  $('.commish-link[href*="0000"]').text("Commish");

  // Trades pulsate (requires jQuery UI)
  if (
    $(".homepagemodule#trades").length &&
    $(".homepagemodule#trades").text().match([-8]) &&
    $.fn.effect
  ) {
    $(".homepagemodule#trades").effect("pulsate", { times: 3 }, 5000);
  }

  // Add report-wrapper class
  $(
    ".leaguehistorymodule," +
    "#Customdraft_makepick," +
    "#Customdraft_messages," +
    "#Customdraft_draftpicks," +
    "#Customdraft_profile," +
    "#Customdraft_rostertable"
  ).addClass("report-wrapper");

  // Tabbed reports
  $(".tabbed-reports li").on("click", function (e) {
    $(".reports-content>." + e.target.classList[0]).show().siblings().hide();
  });
  $(".tabbed-reports li").on("click", function () {
    $(this).parent().find("li").removeClass("active").removeClass("current");
    $(this).addClass("active");
  });
}
