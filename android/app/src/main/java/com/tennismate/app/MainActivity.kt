package com.tennismate.app

import android.os.Build
import android.os.Bundle
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    createNotificationChannel()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channelId = "messages"
      val name = "Messages"
      val descriptionText = "New messages and match updates"
      val importance = NotificationManager.IMPORTANCE_HIGH
      val channel = NotificationChannel(channelId, name, importance).apply {
        description = descriptionText
      }
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      notificationManager.createNotificationChannel(channel)
    }
  }
}
