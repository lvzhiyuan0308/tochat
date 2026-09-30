package org.tochat.app
import android.app.Activity
import android.content.*
import android.net.Uri
import android.os.*
import android.webkit.*
import android.content.pm.PackageManager
import android.widget.FrameLayout
import android.view.WindowInsets
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var chooser: ValueCallback<Array<Uri>>?=null
    private var filePeer=""
    private var exportPath=""
    private var picking=false
    private val io=Executors.newSingleThreadExecutor()
    private val prefs by lazy {getSharedPreferences("tochat",MODE_PRIVATE)}
    private fun service(){val intent=Intent(this,ToxService::class.java);if(prefs.getBoolean("realtime",true))startForegroundService(intent)else startService(intent)}
    override fun onCreate(savedInstanceState: Bundle?){
        super.onCreate(savedInstanceState);window.statusBarColor=android.graphics.Color.rgb(234,240,248);window.navigationBarColor=android.graphics.Color.rgb(234,240,248)
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),20)
        web=WebView(this);val container=FrameLayout(this);container.addView(web,FrameLayout.LayoutParams(-1,-1));setContentView(container)
        if(Build.VERSION.SDK_INT>=35)container.setOnApplyWindowInsetsListener {view,insets->val bars=insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);insets}
        web.settings.javaScriptEnabled=true;web.settings.domStorageEnabled=false;web.settings.allowFileAccess=false;web.settings.allowContentAccess=false;web.settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        web.addJavascriptInterface(Bridge(),"ToChat")
        web.webViewClient=object:WebViewClient(){
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                val u=request.url;val p=if(u.path=="/")"index.html" else u.path?.removePrefix("/")?:""
                if(u.scheme=="https"&&u.host=="tochat.local"&&p=="preview"){
                    try{val t=(ToxService.runtime?:error("节点未启动")).request(JSONObject().put("op","filePreview").put("id",u.getQueryParameter("id")?:"").put("peer",u.getQueryParameter("peer")?:""));return WebResourceResponse(t.getString("mime"),null,200,"OK",mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),File(t.getString("path")).inputStream())}
                    catch(_:Exception){return WebResourceResponse("text/plain","UTF-8",404,"Not Found",emptyMap(),"No preview".byteInputStream())}
                }
                if(u.scheme!="https"||u.host!="tochat.local"||p !in listOf("index.html","style.css","app.js","markdown.js","qrcode.js","jsQR.js"))return WebResourceResponse("text/plain","UTF-8",403,"Forbidden",emptyMap(),"Blocked".byteInputStream())
                val type=if(p.endsWith(".html"))"text/html" else if(p.endsWith(".css"))"text/css" else "application/javascript"
                return WebResourceResponse(type,"UTF-8",200,"OK",mapOf("Cache-Control" to "no-store","Content-Security-Policy" to "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'"),assets.open(p))
            }
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
            override fun onPageFinished(view:WebView,url:String){handleToxLink(intent)}
        }
        web.webChromeClient=object:WebChromeClient(){override fun onShowFileChooser(view:WebView,callback:ValueCallback<Array<Uri>>,params:FileChooserParams):Boolean {chooser?.onReceiveValue(null);chooser=callback;picking=true;try{startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE),11)}catch(_:Exception){picking=false;chooser=null;callback.onReceiveValue(null)};return true}}
        web.loadUrl("https://tochat.local/")
    }
    override fun onStart(){super.onStart();service()}
    override fun onStop(){super.onStop();if(!picking&&!prefs.getBoolean("realtime",true))stopService(Intent(this,ToxService::class.java))}
    override fun onDestroy(){chooser?.onReceiveValue(null);web.removeJavascriptInterface("ToChat");web.destroy();io.shutdown();super.onDestroy()}
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);handleToxLink(intent)}
    @Deprecated("Platform back navigation")
    override fun onBackPressed(){web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}var w=document.querySelector('.workspace');if(w.classList.contains('selected')){w.classList.remove('selected');return true;}return false;})()") {handled->if(handled!="true")finish()}}
    private fun handleToxLink(intent:Intent?){val address=intent?.data?.takeIf{it.scheme=="tox"}?.toString()?:return;web.evaluateJavascript("document.getElementById('tox-address').value="+JSONObject.quote(address)+";document.getElementById('add-dialog').showModal();",null);intent.data=null}
    @Deprecated("Platform activity result")
    override fun onActivityResult(request:Int,result:Int,data:Intent?){super.onActivityResult(request,result,data);picking=false
        if(request==11){chooser?.onReceiveValue(if(result==RESULT_OK&&data?.data!=null)arrayOf(data.data!!)else null);chooser=null;return}
        if(request==13&&result==RESULT_OK&&data?.data!=null){val source=exportPath;val uri=data.data!!;io.execute{try{File(source).inputStream().use {input->contentResolver.openOutputStream(uri)!!.use {out->input.copyTo(out)}};fileResult("文件副本已保存")}catch(e:Exception){fileResult(e.message?:"保存失败")}};return}
        if(request==12&&result==RESULT_OK&&data?.data!=null){val peer=filePeer;val runtime=ToxService.runtime;io.execute {
            try {
                val uri=data.data!!;var name="file";contentResolver.query(uri,null,null,null,null)?.use {if(it.moveToFirst()){val index=it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);if(index>=0)name=it.getString(index)}}
                val dir=File(filesDir,"uploads").apply{mkdirs()};val dest=File(dir,UUID.randomUUID().toString()+"-"+File(name).name)
                contentResolver.openInputStream(uri)!!.use {input->dest.outputStream().use {out->val b=ByteArray(65536);var size=0L;while(true){val n=input.read(b);if(n<0)break;size+=n;check(size<=1024L*1024*1024){"文件超过 1 GiB"};out.write(b,0,n)}}}
                check(runtime!=null){"节点已离线"};runtime.request(JSONObject().put("op","sendFile").put("peer",peer).put("path",dest.path).put("name",File(name).name));fileResult("文件已准备，等待对方接收")
            }catch(e:Exception){fileResult(e.message?:"文件发送失败")}
        }}
    }
    private fun fileResult(text:String){runOnUiThread {if(!isDestroyed)web.evaluateJavascript("window.tochatFileResult("+JSONObject.quote(text)+")",null)}}
    inner class Bridge {
        @JavascriptInterface fun request(raw:String):String {try{
            val c=JSONObject(raw);when(c.getString("op")){
                "copy"->{getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Tox ID",c.getString("text")));return "{\"ok\":true}"}
                "mode"->{check(prefs.edit().putBoolean("realtime",c.getBoolean("realtime")).commit());runOnUiThread{service()};return "{\"ok\":true}"}
                "pickFile"->{filePeer=c.getString("peer");runOnUiThread{picking=true;startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE),12)};return "{\"ok\":true}"}
                "saveFile"->{val t=(ToxService.runtime?:error("节点未启动")).request(JSONObject(c.toString()).put("op","filePath"));exportPath=t.getString("path");runOnUiThread{picking=true;startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,t.getString("name")),13)};return "{\"ok\":true}"}
            }
            check(c.getString("op") in listOf("snapshot","add","accept","reject","name","chat","agent.request","acceptFile","cancelFile")){"Unknown UI operation"}
            return (ToxService.runtime?:error("正在启动节点，请稍候")).request(c).toString()
        }catch(e:Exception){return JSONObject().put("error",e.cause?.message?:e.message?:"节点错误").toString()}}
    }
}
