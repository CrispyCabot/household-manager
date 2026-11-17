package com.chrisbridewell.householdmanager;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String OLD_SILENT_REMINDER_CHANNEL = "task-reminders";
    private static final long[] REMINDER_VIBRATION = { 0, 120, 80, 120, 80, 400 };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createReminderChannel();
    }

    private void createReminderChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            getString(R.string.reminder_channel_id),
            "Task reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.enableVibration(true);
        channel.setVibrationPattern(REMINDER_VIBRATION);
        channel.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build()
        );

        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(channel);
        notifications.deleteNotificationChannel(OLD_SILENT_REMINDER_CHANNEL);
    }
}
