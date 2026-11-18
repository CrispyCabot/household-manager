package com.chrisbridewell.householdmanager;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ReminderActionsPlugin.class);
        super.onCreate(savedInstanceState);
        ReminderNotifications.createChannel(this);
    }
}
