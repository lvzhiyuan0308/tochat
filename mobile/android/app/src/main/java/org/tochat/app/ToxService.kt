package org.tochat.app
import android.app.*
import android.content.*
import android.net.*
import android.os.IBinder
import android.os.Build
import android.content.pm.ServiceInfo

class ToxService : Service() {
    companion object { @Volatile var runtime: Runtime? = null }
    private lateinit var network: ConnectivityManager
    private val callback=object: ConnectivityManager.NetworkCallback(){override fun onAvailable(n:Network){runtime?.reconnect()};override fun onLost(n:Network){runtime?.reconnect()}}
    override fun onCreate(){super.onCreate();network=getSystemService(ConnectivityManager::class.java);network.registerDefaultNetworkCallback(callback);runtime=Runtime(applicationContext)}
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        val realtime=getSharedPreferences("tochat",MODE_PRIVATE).getBoolean("realtime",true)
        if(realtime){
            val manager=getSystemService(NotificationManager::class.java);manager.createNotificationChannel(NotificationChannel("tochat-online","ToChat 实时连接",NotificationManager.IMPORTANCE_LOW))
            val launch=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification=Notification.Builder(this,"tochat-online").setContentTitle("ToChat 实时模式").setContentText("Tox 节点保持在线 · 点击打开聊天").setSmallIcon(org.tochat.app.R.drawable.ic_tochat).setContentIntent(launch).setOngoing(true).build()
            if(Build.VERSION.SDK_INT>=34)startForeground(1,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)else startForeground(1,notification)
        }else stopForeground(STOP_FOREGROUND_REMOVE)
        return if(realtime)START_STICKY else START_NOT_STICKY
    }
    override fun onBind(intent: Intent?): IBinder?=null
    override fun onDestroy(){network.unregisterNetworkCallback(callback);runtime?.close();runtime=null;super.onDestroy()}
}
