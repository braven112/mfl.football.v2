package football.mfl.live;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * The score overlay: a see-through window over whatever the TV is playing,
 * holding the site's `/live/broadcast/overlay` page.
 *
 * Two views, and the window changes shape with them:
 *
 *  - BAR: a thin strip across the top. It never takes the remote, so the app
 *    underneath (YouTube TV) keeps every key.
 *  - PANEL: a column down the left with one game, both lineups and the NFL
 *    games the owner's starters are in. It takes the remote while it is up:
 *    Left/Right step through games, Up/Down pick a game to watch and OK opens
 *    it (the list's last row hides the overlay), Back drops to the bar. With
 *    no key for {@link #PANEL_IDLE_MS} it drops to the bar on its own, so the
 *    remote is never stuck here.
 *
 * Any other key while the panel is up also drops to the bar, so the next
 * press reaches the game. The overlay stops when the TV's screen goes off.
 */
public class OverlayService extends Service {

    static final String ACTION_SHOW = "football.mfl.live.overlay.SHOW";
    static final String ACTION_HIDE = "football.mfl.live.overlay.HIDE";

    private static final String CHANNEL_ID = "overlay";
    private static final int NOTIFICATION_ID = 1;
    private static final long PANEL_IDLE_MS = 30_000;
    private static final long RETRY_MS = 60_000;
    private static final String UA_SUFFIX = " MFLLiveTV/" + BuildConfig.VERSION_NAME;

    /** YouTube TV's Android TV package (not plain YouTube, which is com.google.android.youtube.tv). */
    private static final String YOUTUBE_TV = "com.google.android.youtube.tvunplugged";

    private static final String MODE_BAR = "bar";
    private static final String MODE_PANEL = "panel";

    private WindowManager windowManager;
    private KeyFrame root;
    private WebView webView;
    private String mode = MODE_BAR;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable idleToBar = () -> setMode(MODE_BAR);
    private final Runnable retry = () -> {
        if (webView != null) webView.reload();
    };

    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            stopSelf();
        }
    };

    static boolean canDraw(Context context) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenOff, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenOff, filter);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground();
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_HIDE.equals(action) || !canDraw(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (root == null) {
            // First launch: the bar, so starting the overlay from the home
            // screen never leaves the remote stuck on it.
            mode = MODE_BAR;
            attach();
        } else {
            // Launched again while running, typically over the game: the panel.
            setMode(MODE_PANEL);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try {
            unregisterReceiver(screenOff);
        } catch (IllegalArgumentException ignored) {
            // Never registered.
        }
        if (root != null) {
            try {
                windowManager.removeView(root);
            } catch (IllegalArgumentException ignored) {
                // Already gone with the window.
            }
            root = null;
        }
        if (webView != null) {
            CookieManager.getInstance().flush();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void goForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, getString(R.string.overlay_name), NotificationManager.IMPORTANCE_MIN));
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        Notification notification = builder
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(getString(R.string.overlay_name))
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void attach() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setFocusable(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + UA_SUFFIX);

        // The TV's watch-only pass is the cookie the main app's sign-in left;
        // CookieManager is one store for the whole app, so this window has it.
        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new Host(), "MflOverlayHost");
        webView.setWebViewClient(new OverlayClient());

        root = new KeyFrame(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        windowManager.addView(root, layoutFor(mode));
        webView.loadUrl(BuildConfig.OVERLAY_URL + "?mode=" + mode);
    }

    private void setMode(String next) {
        if (root == null) return;
        mode = next;
        handler.removeCallbacks(idleToBar);
        windowManager.updateViewLayout(root, layoutFor(next));
        pushModeToPage();
        if (MODE_PANEL.equals(next)) {
            root.requestFocus();
            handler.postDelayed(idleToBar, PANEL_IDLE_MS);
        }
    }

    private void pushModeToPage() {
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.__mflOverlay && window.__mflOverlay.setMode('" + mode + "')", null);
    }

    private void stepPage(int delta) {
        callPage("step(" + delta + ")");
    }

    private void callPage(String call) {
        if (webView == null) return;
        webView.evaluateJavascript("window.__mflOverlay && window.__mflOverlay." + call, null);
    }

    /**
     * Open an NFL game on the TV. Google does not publish a link straight to a
     * game in YouTube TV, so this asks the TV's own search for it ("Seattle
     * Seahawks vs San Francisco 49ers"), whose result offers the game in the
     * owner's apps, YouTube TV and Sunday Ticket included. A TV without that
     * search gets YouTube TV opened instead. The overlay drops to the bar
     * either way, so the remote goes to what just opened.
     */
    private void openGame(String query) {
        setMode(MODE_BAR);
        Intent search = new Intent("android.search.action.GLOBAL_SEARCH")
                .putExtra(SearchManager.QUERY, query);
        if (launch(search)) return;
        Intent app = getPackageManager().getLeanbackLaunchIntentForPackage(YOUTUBE_TV);
        if (app == null) app = getPackageManager().getLaunchIntentForPackage(YOUTUBE_TV);
        if (app != null) launch(app);
    }

    private boolean launch(Intent intent) {
        try {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private WindowManager.LayoutParams layoutFor(String forMode) {
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        Rect screen = screenBounds();
        boolean panel = MODE_PANEL.equals(forMode);

        int flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED;
        if (!panel) {
            // The bar is for looking at only; every key stays with the game.
            flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        }

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                panel ? Math.round(screen.width() * 0.45f) : ViewGroup.LayoutParams.MATCH_PARENT,
                panel ? ViewGroup.LayoutParams.MATCH_PARENT : Math.round(screen.height() * 0.09f),
                type, flags, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        return params;
    }

    @SuppressWarnings("deprecation")
    private Rect screenBounds() {
        if (Build.VERSION.SDK_INT >= 30) {
            return windowManager.getCurrentWindowMetrics().getBounds();
        }
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return new Rect(0, 0, metrics.widthPixels, metrics.heightPixels);
    }

    /** Holds the remote while the panel is up. */
    private final class KeyFrame extends FrameLayout {
        KeyFrame(Context context) {
            super(context);
            setFocusable(true);
            setFocusableInTouchMode(true);
        }

        @Override
        public boolean dispatchKeyEvent(KeyEvent event) {
            if (!MODE_PANEL.equals(mode)) return super.dispatchKeyEvent(event);
            if (event.getAction() != KeyEvent.ACTION_DOWN) return true;

            handler.removeCallbacks(idleToBar);
            handler.postDelayed(idleToBar, PANEL_IDLE_MS);
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    stepPage(-1);
                    return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    stepPage(1);
                    return true;
                case KeyEvent.KEYCODE_DPAD_UP:
                    callPage("move(-1)");
                    return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    callPage("move(1)");
                    return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                case KeyEvent.KEYCODE_NUMPAD_ENTER:
                    callPage("select()");
                    return true;
                default:
                    // Back, and anything meant for the game: hand the remote back.
                    setMode(MODE_BAR);
                    return true;
            }
        }
    }

    /**
     * What the page may ask of the app: the current view, to open a game, to
     * close. Only our own page is ever loaded here ({@link OverlayClient}).
     * Calls arrive on a WebView thread, so the work is posted to the main one.
     */
    private final class Host {
        @JavascriptInterface
        public String mode() {
            return mode;
        }

        @JavascriptInterface
        public void watch(String query) {
            if (query == null || query.trim().isEmpty()) return;
            String q = query.trim();
            handler.post(() -> openGame(q.length() > 120 ? q.substring(0, 120) : q));
        }

        @JavascriptInterface
        public void hide() {
            handler.post(OverlayService.this::stopSelf);
        }
    }

    private final class OverlayClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // The overlay never leaves its page; a link has nowhere useful to go.
            return !request.getUrl().toString().startsWith(BuildConfig.OVERLAY_URL);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                handler.removeCallbacks(retry);
                handler.postDelayed(retry, RETRY_MS);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pushModeToPage();
        }
    }
}
