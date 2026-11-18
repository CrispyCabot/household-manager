package com.chrisbridewell.householdmanager;

import android.content.Context;
import android.content.SharedPreferences;

/** Who is signed in and where the API is, handed over by the web app so a reminder's buttons can act while the app is closed. */
final class ReminderAccount {

    private static final String PREFS = "reminder-actions";

    final String apiUrl;
    final String sub;

    private ReminderAccount(String apiUrl, String sub) {
        this.apiUrl = apiUrl;
        this.sub = sub;
    }

    static ReminderAccount load(Context context) {
        SharedPreferences prefs = prefs(context);
        String apiUrl = prefs.getString("apiUrl", null);
        String sub = prefs.getString("sub", null);
        return apiUrl == null || sub == null ? null : new ReminderAccount(apiUrl, sub);
    }

    static void save(Context context, String apiUrl, String sub) {
        prefs(context).edit().putString("apiUrl", apiUrl).putString("sub", sub).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
