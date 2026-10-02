package com.vaultonotemobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Home-screen widget with the three things people open Vaulto for: record a
 * voice note, write a note, ask about notes. Each button is a deep link the app
 * routes (see src/navigation/deepLinks.ts).
 */
class VaultoWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        widgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.vaulto_widget).apply {
                setOnClickPendingIntent(R.id.widget_record, deepLink(context, "record", 1))
                setOnClickPendingIntent(R.id.widget_new, deepLink(context, "new", 2))
                setOnClickPendingIntent(R.id.widget_ask, deepLink(context, "ask", 3))
                setOnClickPendingIntent(R.id.widget_title, deepLink(context, "home", 4))
            }
            manager.updateAppWidget(id, views)
        }
    }

    private fun deepLink(context: Context, path: String, requestCode: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("vaultonote://$path")).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }
}
