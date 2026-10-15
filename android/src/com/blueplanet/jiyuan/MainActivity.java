package com.blueplanet.jiyuan;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

/**
 * 蓝星纪元 — a single fullscreen WebView that runs the bundled offline page
 * (assets/index.html). No permissions, no network, no JS bridge object.
 *
 * Page contract (all optional on the page side, every call is guarded):
 *   window.__appBack()   -> boolean  close the topmost open thing; false if nothing was open
 *   window.__appPause()  -> void     save now and pause time flow
 *   window.__appResume() -> void     undo __appPause
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/index.html";
    private static final int BG = 0xFF060A14;
    private static final long EXIT_WINDOW_MS = 2000L;

    private static final String JS_PAUSE =
            "try{window.__appPause&&window.__appPause()}catch(e){}";
    private static final String JS_RESUME =
            "try{window.__appResume&&window.__appResume()}catch(e){}";
    private static final String JS_BACK =
            "(function(){try{return (window.__appBack&&window.__appBack())?1:0}catch(e){return 0}})()";

    /** Renderer crash-loop guard: give up after this many deaths inside the window. */
    private static final int MAX_RENDERER_DEATHS = 3;
    private static final long RENDERER_DEATH_WINDOW_MS = 30000L;

    private FrameLayout root;
    private WebView webView;
    private boolean resumed;
    private long lastBackAt;
    private Toast exitToast;
    private int rendererDeaths;
    private long firstRendererDeathAt;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            try {
                WebView.setWebContentsDebuggingEnabled(true);
            } catch (RuntimeException ignored) {
                // WebView provider missing; createWebView() reports it.
            }
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        createWebView();
        applyImmersive();
    }

    // ---------------------------------------------------------------- WebView

    @SuppressWarnings("deprecation")
    private void createWebView() {
        final WebView v;
        try {
            v = new WebView(this);
        } catch (RuntimeException e) {
            // No usable WebView provider (being updated, disabled or missing).
            showWebViewMissing();
            return;
        }
        v.setBackgroundColor(BG);
        v.setOverScrollMode(View.OVER_SCROLL_NEVER);
        v.setVerticalScrollBarEnabled(false);
        v.setHorizontalScrollBarEnabled(false);
        v.setHapticFeedbackEnabled(false);
        // Swallow the native long-press (text selection / context menu); page touch events still fire.
        v.setOnLongClickListener(new NoLongPress());

        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);                       // system font scaling must not break the layout
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);               // honour <meta name="viewport">
        s.setLoadWithOverviewMode(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        v.setWebChromeClient(new WebChromeClient());
        v.setWebViewClient(new ShellClient(this));

        root.addView(v, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView = v;
        v.loadUrl(START_URL);
    }

    /** @param rendererAlive false after onRenderProcessGone: then only detach + destroy are allowed. */
    private void destroyWebView(WebView v, boolean rendererAlive) {
        if (v == null) return;
        try {
            ViewGroup parent = (ViewGroup) v.getParent();
            if (parent != null) parent.removeView(v);
            if (rendererAlive) {
                v.stopLoading();
                v.setWebViewClient(new WebViewClient());
                v.setWebChromeClient(null);
            }
            v.destroy();
        } catch (RuntimeException ignored) {
            // Best effort: the renderer may already be gone.
        }
    }

    private void showWebViewMissing() {
        TextView t = new TextView(this);
        t.setText(R.string.webview_missing);
        t.setTextColor(0xFFE9EEF8);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        t.setGravity(Gravity.CENTER);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad, pad, pad);
        root.removeAllViews();
        root.addView(t, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Called when the renderer process crashed or was killed to reclaim memory (API 26+). */
    private void onRendererGone(WebView dead) {
        boolean wasCurrent = dead == webView;
        destroyWebView(dead, false);
        if (!wasCurrent) return;
        webView = null;

        long now = SystemClock.elapsedRealtime();
        if (firstRendererDeathAt == 0L || now - firstRendererDeathAt > RENDERER_DEATH_WINDOW_MS) {
            firstRendererDeathAt = now;
            rendererDeaths = 0;
        }
        rendererDeaths++;
        if (rendererDeaths > MAX_RENDERER_DEATHS) {
            finish();
            return;
        }
        // Recreate now if we are in front; otherwise onResume() recreates it,
        // so a renderer killed in the background does not respawn in the background.
        if (resumed) root.post(new RecreateTask(this));
    }

    /** @return true when the WebView must NOT load the URL itself. */
    private boolean handleNavigation(String url) {
        if (url == null) return false;
        String u = url.trim().toLowerCase(Locale.ROOT);
        if (u.startsWith("file:") || u.startsWith("about:") || u.startsWith("data:")
                || u.startsWith("blob:") || u.startsWith("javascript:")) {
            return false; // stays in the WebView
        }
        if (u.startsWith("http:") || u.startsWith("https:") || u.startsWith("mailto:")) {
            openExternal(url);
        }
        return true; // anything else (intent:, custom schemes...) is ignored
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }

    // -------------------------------------------------------------- lifecycle

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        if (webView != null) {
            webView.evaluateJavascript(JS_PAUSE, null);
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        applyImmersive();
        if (webView == null) {
            // The renderer died while we were away, or no WebView provider was usable
            // (the user may have just installed/updated it): try again.
            root.removeAllViews();
            createWebView();
        } else {
            webView.onResume();
            webView.evaluateJavascript(JS_RESUME, null);
        }
    }

    @Override
    protected void onDestroy() {
        if (exitToast != null) exitToast.cancel();
        destroyWebView(webView, true);
        webView = null;
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyImmersive();
    }

    // ------------------------------------------------------------------- back

    @Override
    @SuppressWarnings({"deprecation", "unchecked"})
    public void onBackPressed() {
        WebView v = webView;
        if (v == null) {
            exitOrHint();
            return;
        }
        v.evaluateJavascript(JS_BACK, new BackResult(this));
    }

    private void onBackResult(String result) {
        if (isFinishing()) return;
        if ("1".equals(result)) {
            lastBackAt = 0L; // the page closed something; restart the exit window
            return;
        }
        exitOrHint();
    }

    private void exitOrHint() {
        long now = SystemClock.elapsedRealtime();
        if (lastBackAt != 0L && now - lastBackAt < EXIT_WINDOW_MS) {
            if (exitToast != null) exitToast.cancel();
            finish();
            return;
        }
        lastBackAt = now;
        if (exitToast != null) exitToast.cancel();
        exitToast = Toast.makeText(this, R.string.press_again_exit, Toast.LENGTH_SHORT);
        exitToast.show();
    }

    // ------------------------------------------------------------- immersive

    @SuppressWarnings("deprecation")
    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    // ------------------------------------------------------- helper classes
    // Static nested classes with explicit constructors only: no anonymous or
    // inner classes and no generic interface implementations. javac 21 writes a
    // nameless MethodParameters entry for the hidden outer-instance parameter
    // of inner-class constructors and for generic bridge methods, and the d8
    // shipped in build-tools 34 crashes on that (NullPointerException).

    private static final class NoLongPress implements View.OnLongClickListener {
        NoLongPress() {
        }

        @Override
        public boolean onLongClick(View view) {
            return true;
        }
    }

    private static final class RecreateTask implements Runnable {
        private final MainActivity a;

        RecreateTask(MainActivity a) {
            this.a = a;
        }

        @Override
        public void run() {
            if (!a.isFinishing() && a.webView == null && a.resumed) a.createWebView();
        }
    }

    @SuppressWarnings("rawtypes") // raw on purpose: a typed ValueCallback<String> needs a bridge method
    private static final class BackResult implements ValueCallback {
        private final MainActivity a;

        BackResult(MainActivity a) {
            this.a = a;
        }

        @Override
        public void onReceiveValue(Object result) {
            a.onBackResult(result instanceof String ? (String) result : null);
        }
    }

    private static final class ShellClient extends WebViewClient {
        private final MainActivity a;

        ShellClient(MainActivity a) {
            this.a = a;
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return a.handleNavigation(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            return a.handleNavigation(u == null ? null : u.toString());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            a.onRendererGone(view);
            return true; // handled: do not crash the app
        }
    }
}
