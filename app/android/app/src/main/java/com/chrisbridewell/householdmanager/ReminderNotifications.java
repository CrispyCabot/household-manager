package com.chrisbridewell.householdmanager;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Map;

/** Draws reminders itself (rather than letting Firebase) so a reminder about one task can carry Mark complete and Dismiss. */
final class ReminderNotifications {

    private static final String OLD_SILENT_REMINDER_CHANNEL = "task-reminders";
    private static final long[] REMINDER_VIBRATION = { 0, 120, 80, 120, 80, 400 };
    private static final int SUMMARY_NOTIFICATION_ID = 1;

    private ReminderNotifications() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            context.getString(R.string.reminder_channel_id),
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

        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(channel);
        notifications.deleteNotificationChannel(OLD_SILENT_REMINDER_CHANNEL);
    }

    static void show(Context context, String messageId, Map<String, String> data) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }
        createChannel(context);

        String taskId = data.get("taskId");
        boolean aboutOneTask = taskId != null && data.get("householdId") != null && data.get("boardId") != null;
        int id = aboutOneTask ? taskId.hashCode() : SUMMARY_NOTIFICATION_ID;

        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, context.getString(R.string.reminder_channel_id))
            .setSmallIcon(R.drawable.ic_stat_task)
            .setContentTitle(data.get("title"))
            .setContentText(data.get("body"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(data.get("body")))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(REMINDER_VIBRATION)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id, messageId, data));

        if (aboutOneTask) {
            notification
                .addAction(R.drawable.ic_stat_task, context.getString(R.string.reminder_mark_complete), act(context, id, ReminderActionReceiver.COMPLETE, data))
                .addAction(R.drawable.ic_stat_task, context.getString(R.string.reminder_dismiss), act(context, id, ReminderActionReceiver.DISMISS, data));
        }

        NotificationManagerCompat.from(context).notify(id, notification.build());
    }

    static void cancel(Context context, int id) {
        NotificationManagerCompat.from(context).cancel(id);
    }

    /** Carries the message the way Firebase does, so the push plugin reports the tap to the web app, which opens `path`. */
    private static PendingIntent openApp(Context context, int id, String messageId, Map<String, String> data) {
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (Map.Entry<String, String> entry : data.entrySet()) intent.putExtra(entry.getKey(), entry.getValue());
        intent.putExtra("google.message_id", messageId != null ? messageId : String.valueOf(System.currentTimeMillis()));
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent act(Context context, int id, String action, Map<String, String> data) {
        Intent intent = new Intent(context, ReminderActionReceiver.class)
            .setAction(action)
            .putExtra(ReminderActionReceiver.EXTRA_NOTIFICATION_ID, id)
            .putExtra("householdId", data.get("householdId"))
            .putExtra("boardId", data.get("boardId"))
            .putExtra("taskId", data.get("taskId"));
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
