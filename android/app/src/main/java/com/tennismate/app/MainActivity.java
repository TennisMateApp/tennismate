package com.tennismate.app;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String INSETS_LOG_TAG = "TennisMateInsets";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        boolean debugLogging = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null || !(webView.getParent() instanceof View)) {
            if (debugLogging) {
                Log.w(INSETS_LOG_TAG, "Unable to install IME inset handling: WebView parent unavailable");
            }
            return;
        }

        View webViewParent = (View) webView.getParent();
        int initialPaddingLeft = webViewParent.getPaddingLeft();
        int initialPaddingTop = webViewParent.getPaddingTop();
        int initialPaddingRight = webViewParent.getPaddingRight();
        int initialPaddingBottom = webViewParent.getPaddingBottom();

        ViewCompat.setOnApplyWindowInsetsListener(webViewParent, (view, windowInsets) -> {
            Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            Insets navigationBarInsets = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());

            // Both values are measured from the window edge, so they overlap. Taking the
            // larger inset avoids adding the navigation bar to an IME inset that includes it.
            int obscuredBottom = imeVisible ? Math.max(imeInsets.bottom, navigationBarInsets.bottom) : 0;
            int targetPaddingBottom = initialPaddingBottom + obscuredBottom;

            if (
                view.getPaddingLeft() != initialPaddingLeft ||
                view.getPaddingTop() != initialPaddingTop ||
                view.getPaddingRight() != initialPaddingRight ||
                view.getPaddingBottom() != targetPaddingBottom
            ) {
                view.setPadding(initialPaddingLeft, initialPaddingTop, initialPaddingRight, targetPaddingBottom);
            }

            if (debugLogging) {
                view.post(() -> {
                    Log.d(
                        INSETS_LOG_TAG,
                        "rootHeight=" + view.getHeight() +
                        " webViewHeight=" + webView.getHeight() +
                        " imeVisible=" + imeVisible +
                        " imeBottom=" + imeInsets.bottom +
                        " navigationBarBottom=" + navigationBarInsets.bottom +
                        " appliedBottomPadding=" + targetPaddingBottom
                    );
                    webView.evaluateJavascript(
                        "window.visualViewport ? String(Math.round(window.visualViewport.height)) : 'unavailable'",
                        value -> Log.d(INSETS_LOG_TAG, "visualViewportHeight=" + value)
                    );
                });
            }

            // Keep dispatching the original insets; plugins and descendants may need them.
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webViewParent);
    }
}
