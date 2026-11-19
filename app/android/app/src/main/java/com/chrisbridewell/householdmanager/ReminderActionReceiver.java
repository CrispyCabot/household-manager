package com.chrisbridewell.householdmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/** Completes a task straight from its reminder, as the signed-in member, without opening the app. Dismiss only clears the notification. */
public class ReminderActionReceiver extends BroadcastReceiver {

    static final String COMPLETE = "com.chrisbridewell.householdmanager.COMPLETE_TASK";
    static final String DISMISS = "com.chrisbridewell.householdmanager.DISMISS_TASK";

    private static final String TAG = "ReminderAction";
    private static final int TIMEOUT_MS = 8000;
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        int notificationId = intent.getIntExtra(ReminderNotifications.EXTRA_NOTIFICATION_ID, 0);
        if (DISMISS.equals(intent.getAction())) {
            ReminderNotifications.cancel(context, notificationId);
            return;
        }
        if (!COMPLETE.equals(intent.getAction())) return;

        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        FirebaseMessaging.getInstance()
            .getToken()
            .addOnCompleteListener(worker, token -> {
                try {
                    if (token.isSuccessful() && complete(app, intent, token.getResult())) {
                        ReminderNotifications.cancel(app, notificationId);
                    } else {
                        tell(app, R.string.reminder_complete_failed);
                    }
                } finally {
                    pending.finish();
                }
            });
    }

    private static boolean complete(Context context, Intent intent, String firebaseToken) {
        ReminderAccount account = ReminderAccount.load(context);
        if (account == null) return false;

        String path =
            "/v1/households/" + Uri.encode(intent.getStringExtra("householdId")) +
            "/boards/" + Uri.encode(intent.getStringExtra("boardId")) +
            "/tasks/" + Uri.encode(intent.getStringExtra("taskId")) +
            "/complete";
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(account.apiUrl + path).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Authorization", "Bearer " + phoneCredential(account.sub, firebaseToken));
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(0);
            connection.getOutputStream().close();
            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) return true;
            if (status == 404) return true;
            Log.w(TAG, "complete failed with HTTP " + status);
            return false;
        } catch (IOException | JSONException e) {
            Log.w(TAG, "complete failed", e);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Matches api/src/phoneCredential.ts. */
    private static String phoneCredential(String sub, String firebaseToken) throws JSONException {
        String json = new JSONObject().put("sub", sub).put("token", firebaseToken).toString();
        return "phone_" + Base64.encodeToString(json.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static void tell(Context context, int message) {
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(context, message, Toast.LENGTH_LONG).show());
    }
}
