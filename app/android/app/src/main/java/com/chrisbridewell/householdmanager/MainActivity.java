package com.chrisbridewell.householdmanager;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReminderActionsPlugin.class);
        super.onCreate(savedInstanceState);
        ReminderNotifications.createChannel(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null && ReminderNotifications.SNOOZE.equals(intent.getAction())) {
            ReminderNotifications.cancel(this, intent.getIntExtra(ReminderNotifications.EXTRA_NOTIFICATION_ID, 0));
        }
        super.onNewIntent(intent);
    }
}
