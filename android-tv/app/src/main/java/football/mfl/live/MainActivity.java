package football.mfl.live;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * MFL Football for Google TV: the web broadcast board, full screen, nothing else.
 *
 * The board is the product; this app only supplies what a browser tab on a TV
 * can't: a home-screen tile, a screen that never sleeps mid-game, a session
 * that survives the TV going to standby, and a way back in when the network
 * drops. Everything visible is the web page, so a push to the site changes
 * the TV without a new app release.
 */
public class MainActivity extends Activity {

    /** Appended to the WebView's user agent so the site can tell it's on a TV. */
    private static final String UA_SUFFIX = " MFLLiveTV/" + BuildConfig.VERSION_NAME;

    private FrameLayout root;
    private WebView webView;
    private View offlineView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private boolean pageFailed;
    /** The host of the page on screen, for the Where to watch bridge; written on the UI thread. */
    private volatile String pageHost;
    private static final String HOME_HOST = Uri.parse(BuildConfig.START_URL).getHost();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // A TV that dims or starts its screensaver during a live slate is the
        // one failure a browser tab can't avoid; the app's whole reason to exist.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.board_ground));

        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.board_ground));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setUserAgentString(settings.getUserAgentString() + UA_SUFFIX);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new BoardClient());
        webView.setWebChromeClient(new BoardChrome());
        webView.addJavascriptInterface(new TvHost(), "MflTvHost");

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offlineView = buildOfflineView();
        offlineView.setVisibility(View.GONE);
        root.addView(offlineView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        hideSystemBars();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BuildConfig.START_URL);
        }
        webView.requestFocus();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        // Write the session cookie to disk now: a TV going to standby can kill
        // the process without another callback, and losing the cookie means
        // signing in again with an on-screen keyboard.
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (pageFailed && event.getAction() == KeyEvent.ACTION_UP && isSelectKey(event.getKeyCode())) {
            retry();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            exitCustomView();
        } else if (!pageFailed && webView.canGoBack()) {
            webView.goBack();
        } else {
            showExitMenu();
        }
    }

    /**
     * Leaving the board is when the owner goes off to watch, so that is where
     * the score overlay is offered. It is also the only way in on most TVs:
     * the Google TV home screen shows one tile per app, which hides the
     * separate Score overlay tile.
     */
    private void showExitMenu() {
        boolean showing = OverlayService.isShowing();
        String other = OverlayService.EDGE_TOP.equals(OverlayService.savedEdge(this))
                ? OverlayService.EDGE_BOTTOM : OverlayService.EDGE_TOP;
        String[] labels;
        Runnable[] actions;
        if (showing) {
            labels = new String[] {
                    getString(R.string.exit_keep),
                    getString(OverlayService.EDGE_TOP.equals(other) ? R.string.exit_move_top : R.string.exit_move_bottom),
                    getString(R.string.exit_hide),
            };
            actions = new Runnable[] {
                    this::finish,
                    () -> showOverlayAndLeave(other),
                    () -> {
                        startService(new Intent(this, OverlayService.class).setAction(OverlayService.ACTION_HIDE));
                        finish();
                    },
            };
        } else {
            labels = new String[] {
                    getString(R.string.exit_show_top),
                    getString(R.string.exit_show_bottom),
                    getString(R.string.exit_leave),
            };
            actions = new Runnable[] {
                    () -> showOverlayAndLeave(OverlayService.EDGE_TOP),
                    () -> showOverlayAndLeave(OverlayService.EDGE_BOTTOM),
                    this::finish,
            };
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(R.string.exit_title)
                .setItems(labels, (dialog, which) -> actions[which].run())
                .show();
    }

    /** Through the tile's activity, which asks for the overlay permission if the TV hasn't given it. */
    private void showOverlayAndLeave(String edge) {
        startActivity(new Intent(this, OverlayActivity.class).putExtra(OverlayService.EXTRA_EDGE, edge));
        finish();
    }

    private static boolean isSelectKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                || keyCode == KeyEvent.KEYCODE_BUTTON_A;
    }

    private void retry() {
        pageFailed = false;
        offlineView.setVisibility(View.GONE);
        String current = webView.getUrl();
        if (current == null || current.startsWith("about:")) {
            webView.loadUrl(BuildConfig.START_URL);
        } else {
            webView.reload();
        }
        webView.requestFocus();
    }

    private void showOffline() {
        pageFailed = true;
        offlineView.setVisibility(View.VISIBLE);
    }

    private View buildOfflineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(getColor(R.color.board_ground));
        int pad = (int) (48 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(32);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText(R.string.offline_body);
        body.setTextColor(0xFFB8C0CC);
        body.setTextSize(20);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, pad / 3, 0, 0);

        box.addView(title);
        box.addView(body);
        return box;
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    private void exitCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
        webView.setVisibility(View.VISIBLE);
        webView.requestFocus();
    }

    /**
     * Every web link stays inside the app. Most TVs have no browser to hand a
     * link to, and the sign-in round trip hops between the board's own hosts
     * (staging, the league domains, MFL), so an allowlist here would be one
     * more copy of the league registry to keep in step. Non-web schemes go to
     * whatever app claims them, if any.
     */
    private final class BoardClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // Nothing on the TV handles it; staying on the board beats crashing.
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // Only the page itself failing is "offline"; one slow headshot is not.
            if (request.isForMainFrame()) showOffline();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            pageHost = url == null ? null : Uri.parse(url).getHost();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            pageHost = url == null ? null : Uri.parse(url).getHost();
        }
    }

    /**
     * Where to watch (`/live/broadcast/watch`): the page asks which apps the
     * TV has and opens the one carrying a game. Answers only the board's own
     * host, since every link stays inside this WebView and the app list is
     * nobody else's business. It reaches nothing but apps the TV's own home
     * screen already shows (the launcher queries in the manifest).
     */
    private final class TvHost {
        @JavascriptInterface
        public String apps() {
            if (!onHome()) return "[]";
            JSONArray out = new JSONArray();
            for (Map.Entry<String, String> app : launchableApps().entrySet()) {
                try {
                    out.put(new JSONObject().put("pkg", app.getKey()).put("label", app.getValue()));
                } catch (Exception ignored) {
                    // A label JSON can't hold; that app is left off the list.
                }
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean open(String pkg) {
            if (!onHome() || pkg == null || !launchableApps().containsKey(pkg)) return false;
            Intent intent = launchIntentFor(pkg);
            return intent != null && launchOnUi(intent);
        }

        /** The TV's own search for a game, as the overlay does; else `fallback` opened. */
        @JavascriptInterface
        public boolean search(String query, String fallback) {
            if (!onHome() || query == null || query.trim().isEmpty()) return false;
            String q = query.trim();
            Intent search = new Intent("android.search.action.GLOBAL_SEARCH")
                    .putExtra(SearchManager.QUERY, q.length() > 120 ? q.substring(0, 120) : q);
            if (search.resolveActivity(getPackageManager()) != null && launchOnUi(search)) return true;
            return fallback != null && !fallback.isEmpty() && open(fallback);
        }

        private boolean onHome() {
            String host = pageHost;
            return host != null && host.equalsIgnoreCase(HOME_HOST);
        }
    }

    /** Package → label of every app the TV's launcher shows (leanback first, then phone-style launchers, as on Fire TV). */
    private Map<String, String> launchableApps() {
        PackageManager pm = getPackageManager();
        Map<String, String> apps = new LinkedHashMap<>();
        String[] categories = {Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER};
        for (String category : categories) {
            List<ResolveInfo> found = pm.queryIntentActivities(
                    new Intent(Intent.ACTION_MAIN).addCategory(category), 0);
            for (ResolveInfo info : found) {
                String pkg = info.activityInfo.packageName;
                if (pkg.equals(getPackageName()) || apps.containsKey(pkg)) continue;
                apps.put(pkg, String.valueOf(info.loadLabel(pm)));
            }
        }
        return apps;
    }

    private Intent launchIntentFor(String pkg) {
        PackageManager pm = getPackageManager();
        Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
        return intent != null ? intent : pm.getLaunchIntentForPackage(pkg);
    }

    private boolean launchOnUi(Intent intent) {
        runOnUiThread(() -> {
            try {
                startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // The TV refused; the page has already been told it was asked.
            }
        });
        return true;
    }

    /** Lets the board's fullscreen button work inside the WebView. */
    private final class BoardChrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setVisibility(View.GONE);
            hideSystemBars();
        }

        @Override
        public void onHideCustomView() {
            exitCustomView();
        }
    }
}
