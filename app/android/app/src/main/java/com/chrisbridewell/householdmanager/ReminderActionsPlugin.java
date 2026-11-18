package com.chrisbridewell.householdmanager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReminderActions")
public class ReminderActionsPlugin extends Plugin {

    @PluginMethod
    public void remember(PluginCall call) {
        String apiUrl = call.getString("apiUrl");
        String sub = call.getString("sub");
        if (apiUrl == null || sub == null) {
            call.reject("apiUrl and sub are required");
            return;
        }
        ReminderAccount.save(getContext(), apiUrl, sub);
        call.resolve();
    }

    @PluginMethod
    public void forget(PluginCall call) {
        ReminderAccount.clear(getContext());
        call.resolve();
    }
}
