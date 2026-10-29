package football.mfl.live;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The "Score overlay" tile. It has no screen of its own: it tells
 * {@link OverlayService} to show (first launch: the score ticker; while
 * running: the ticker opened up with both lineups) and gets out of the way, so whatever was playing underneath
 * stays in front. Launched by voice ("open Score overlay") or a remote's app
 * button while YouTube TV plays, the lineups open over the game.
 *
 * The one time it does show something is when the TV has not allowed the app
 * to draw over other apps yet; it says how, since some Google TV builds have
 * the switch in Settings and some only take it from a computer.
 */
public class OverlayActivity extends Activity {

    private boolean explaining;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (OverlayService.canDraw(this)) {
            startOverlay();
        } else {
            explain();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Settings with the switch turned on.
        if (explaining && OverlayService.canDraw(this)) startOverlay();
    }

    private void startOverlay() {
        Intent intent = new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_SHOW);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        finish();
        overridePendingTransition(0, 0);
    }

    private void explain() {
        explaining = true;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(getColor(R.color.board_ground));
        int pad = (int) (48 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.overlay_permission_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText(getString(R.string.overlay_permission_body, getPackageName()));
        body.setTextColor(0xFFB8C0CC);
        body.setTextSize(19);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, pad / 3, 0, 0);

        box.addView(title);
        box.addView(body);
        setContentView(box);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (explaining && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
            openOverlaySettings();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    private void openOverlaySettings() {
        if (Build.VERSION.SDK_INT < 23) return;
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName()));
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // This TV has no such screen; the text already gives the other way.
        }
    }
}
