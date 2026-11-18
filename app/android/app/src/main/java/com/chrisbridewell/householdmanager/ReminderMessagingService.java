package com.chrisbridewell.householdmanager;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Takes over from the push plugin's service so data-only reminders get drawn with their buttons. */
public class ReminderMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        if (message.getNotification() == null && message.getData().containsKey("title")) {
            ReminderNotifications.show(this, message.getMessageId(), message.getData());
        }
        super.onMessageReceived(message);
    }
}
