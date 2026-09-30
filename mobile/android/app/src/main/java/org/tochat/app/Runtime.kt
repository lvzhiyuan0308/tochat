package org.tochat.app
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class Runtime(private val context: Context) {
    private val executor=Executors.newSingleThreadScheduledExecutor()
    private var node=0L
    private lateinit var db: History
    private var name="我的 Android"
    private var info=JSONObject()
    private val connections=mutableMapOf<String,Int>()
    private val errors=mutableListOf<JSONObject>()
    private val fragments=Reassembler()
    private var lastBootstrap=0L
    private val prefs=context.getSharedPreferences("tochat",Context.MODE_PRIVATE)
    init {
        executor.execute {
            try {
                name=prefs.getString("name",name)!!
                node=Native.create(JSONObject().put("name",name).put("profile",File(context.filesDir,"identity.tox").path).put("password",ProfileKey.get(context)).toString())
                check(node!=0L){Native.error()}
                db=History(context);db.run("UPDATE transfers SET status='interrupted' WHERE status IN ('offered','transferring')")
                refresh();bootstrap()
            }catch(e: Exception){error(e)}
        }
        executor.scheduleWithFixedDelay({if(node!=0L && ::db.isInitialized)try{tick()}catch(e:Exception){error(e)}},100,100,TimeUnit.MILLISECONDS)
    }
    private fun error(e: Exception){errors.add(JSONObject().put("time",System.currentTimeMillis()).put("message",e.message?:"节点错误"));if(errors.size>10)errors.removeAt(0)}
    private fun call(c: JSONObject): JSONObject { check(node!=0L){errors.lastOrNull()?.optString("message")?:"节点尚未启动"};val r=JSONObject(Native.call(node,c.toString()));check(!r.has("error")){r.optString("error")};return r }
    private fun command(op: String, peer: String = "")=JSONObject().put("op",op).put("peer",peer)
    private fun refresh(){info=call(command("info"));val friends=info.getJSONArray("friends");for(i in 0 until friends.length()){val f=friends.getJSONObject(i);connections[f.getString("peer")]=f.getInt("connection");db.peer(f.getString("peer"),f.getString("name"))}}
    private fun bootstrap(){lastBootstrap=System.currentTimeMillis();val nodes=JSONArray(context.assets.open("bootstrap.json").bufferedReader().readText());for(i in 0 until nodes.length()){val n=nodes.getJSONObject(i);try{call(JSONObject().put("op","bootstrap").put("host",n.getString("host")).put("key",n.getString("key")).put("port",n.getInt("port")));val ports=n.optJSONArray("tcpPorts")?:JSONArray();for(j in 0 until ports.length())call(JSONObject().put("op","bootstrap").put("host",n.getString("host")).put("key",n.getString("key")).put("port",ports.getInt(j)).put("tcp",true))}catch(e:Exception){error(e)}}}
    private fun send(peer: String,p: JSONObject){for(packet in Protocol.packets(p))call(command("send",peer).put("data",packet))}
    private fun flush(){val now=System.currentTimeMillis();for(row in db.rows("SELECT * FROM outbox WHERE last_attempt<? ORDER BY rowid LIMIT 128",now-5000)){
        val peer=row.getString("peer");if((connections[peer]?:0)==0)continue
        try{send(peer,JSONObject(row.getString("packet")));db.run("UPDATE outbox SET last_attempt=?,attempts=attempts+1 WHERE id=? AND peer=?",now,row.getString("id"),peer);db.run("UPDATE messages SET status='sending' WHERE id=? AND peer=? AND status='queued'",row.getString("id"),peer)}catch(_:Exception){break}
    }}
    private fun tick(){val events=JSONArray(Native.poll(node));for(i in 0 until events.length())try{event(events.getJSONObject(i))}catch(e:Exception){error(e)};if(info.optInt("connection")==0&&System.currentTimeMillis()-lastBootstrap>60000)bootstrap();flush()}
    private fun event(e: JSONObject){val type=e.getString("type");val peer=e.optString("peer")
        when(type){
            "selfConnection" -> info.put("connection",e.getInt("connection"))
            "connection" -> {connections[peer]=e.getInt("connection");if(e.getInt("connection")!=0){db.run("UPDATE outbox SET last_attempt=0 WHERE peer=?",peer);send(peer,Protocol.envelope("hello",JSONObject().put("name",name).put("capabilities",JSONArray(listOf("chat","file")))))}else db.run("UPDATE transfers SET status='interrupted' WHERE peer=? AND status IN ('offered','transferring')",peer)}
            "friendRequest" -> db.run("INSERT OR REPLACE INTO requests(peer,message) VALUES(?,?)",peer,e.getString("message"))
            "name" -> db.peer(peer,e.getString("name"))
            "packet" -> fragments.read(peer,e.getString("data"))?.let { receive(peer,it) }
            "fileOffer" -> db.run("INSERT INTO transfers(id,peer,number,name,size,inbound,status) VALUES(?,?,?,?,?,?,?)",UUID.randomUUID().toString(),peer,e.getInt("number"),e.getString("name"),e.getLong("size"),1,"offered")
            "fileProgress" -> db.run("UPDATE transfers SET done=?,status='transferring' WHERE peer=? AND number=? AND status IN ('offered','transferring')",e.getLong("done"),peer,e.getInt("number"))
            "fileDone" -> db.run("UPDATE transfers SET done=size,status='complete',path=? WHERE peer=? AND number=? AND status IN ('offered','transferring')",e.getString("path"),peer,e.getInt("number"))
            "fileCancelled" -> db.run("UPDATE transfers SET status='cancelled' WHERE peer=? AND number=? AND status IN ('offered','transferring')",peer,e.getInt("number"))
            "error" -> error(Exception(e.optString("message")))
        }
    }
    private fun receive(peer: String,p: JSONObject){
        check(db.first("SELECT peer FROM peers WHERE peer=?",peer)!=null){"Unknown sender"};val b=p.getJSONObject("body");val t=p.getString("t");val id=p.getString("id")
        if(t=="ack"){db.transaction{db.run("DELETE FROM outbox WHERE id=? AND peer=?",b.getString("id"),peer);db.run("UPDATE messages SET status='delivered' WHERE id=? AND peer=? AND direction='out' AND status IN ('queued','sending')",b.getString("id"),peer)};return}
        if(t=="hello"){db.peer(peer,b.optString("name").take(128));val caps=b.optJSONArray("capabilities")?:JSONArray();val allowed=JSONArray();for(i in 0 until caps.length())if(caps.optString(i) in listOf("chat","file","agent","llm"))allowed.put(caps.getString(i));db.run("UPDATE peers SET capabilities=? WHERE peer=?",allowed.toString(),peer);return}
        val duplicate=db.first("SELECT id FROM received WHERE id=? AND peer=?",id,peer)!=null
        if(!duplicate)db.transaction {
            db.run("INSERT INTO received VALUES(?,?,?)",id,peer,System.currentTimeMillis())
            if(t=="chat"||t=="agent.request")db.run("INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)",id,peer,"in",t,b.getString("text"),"stored",p.getLong("ts"))
            if(t.startsWith("stream.")){
                val stream=b.getString("stream");check(db.first("SELECT id FROM messages WHERE id=? AND peer=? AND direction='out' AND kind='agent.request'",stream,peer)!=null){"Unsolicited AI stream"}
                val reply="$stream-reply";db.run("INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)",reply,peer,"in","stream","","streaming",p.getLong("ts"))
                if(t=="stream.chunk"){
                    val size=db.first("SELECT COALESCE(SUM(length(text)),0) AS n FROM chunks WHERE stream=? AND peer=?",stream,peer)!!.getInt("n");check(size+b.getString("text").length<=256000)
                    db.run("INSERT OR IGNORE INTO chunks VALUES(?,?,?,?)",stream,peer,b.getInt("seq"),b.getString("text"));val text=db.rows("SELECT text FROM chunks WHERE stream=? AND peer=? ORDER BY seq",stream,peer).joinToString(""){it.getString("text")};db.run("UPDATE messages SET text=? WHERE id=? AND peer=?",text,reply,peer)
                }
                if(t=="stream.end")db.run("UPDATE messages SET total=? WHERE id=? AND peer=?",b.getInt("total"),reply,peer)
                if(t=="stream.error")db.run("UPDATE messages SET status='error',text=text || ? WHERE id=? AND peer=?","\n"+b.optString("text","AI 请求失败").take(1000),reply,peer)
                val m=db.first("SELECT total,status FROM messages WHERE id=? AND peer=?",reply,peer)!!;val chunks=db.first("SELECT COUNT(*) AS n,MIN(seq) AS lo,MAX(seq) AS hi FROM chunks WHERE stream=? AND peer=?",stream,peer)!!
                if(m.getString("status")!="error"&&!m.isNull("total")&&m.getInt("total")==chunks.getInt("n")&&(m.getInt("total")==0||(chunks.getInt("lo")==0&&chunks.getInt("hi")==m.getInt("total")-1)))db.run("UPDATE messages SET status='stored' WHERE id=? AND peer=?",reply,peer)
            }
            if(t=="agent.request")db.queue(peer,Protocol.envelope("stream.error",JSONObject().put("stream",id).put("text","此 Android 节点未提供 AI 服务")),false)
        }
        try{send(peer,Protocol.envelope("ack",JSONObject().put("id",id)))}catch(e:Exception){error(e)}
    }
    fun request(c: JSONObject): JSONObject = executor.submit<JSONObject>{ action(c) }.get(15,TimeUnit.SECONDS)
    private fun action(c: JSONObject): JSONObject {
        val op=c.getString("op");val peer=c.optString("peer")
        if(op=="snapshot"){
            check(::db.isInitialized && node!=0L){errors.lastOrNull()?.optString("message")?:"正在启动 Tox 节点"}
            val peers=JSONArray();for(p in db.rows("SELECT * FROM peers ORDER BY name")){val key=p.getString("peer");p.put("connection",connections[key]?:0).put("capabilities",JSONArray(p.getString("capabilities")));db.first("SELECT text AS preview,ts FROM messages WHERE peer=? ORDER BY ts DESC LIMIT 1",key)?.let{p.put("preview",it.getString("preview")).put("ts",it.getLong("ts"))};peers.put(p)}
            return JSONObject().put("platform","android").put("name",name).put("address",info.getString("address")).put("connection",info.optInt("connection")).put("aiConfigured",false).put("realtime",prefs.getBoolean("realtime",true)).put("peers",peers).put("requests",JSONArray(db.rows("SELECT * FROM requests"))).put("messages",if(peer.isEmpty())JSONArray() else JSONArray(db.rows("SELECT * FROM (SELECT rowid AS sort,* FROM messages WHERE peer=? ORDER BY ts DESC,rowid DESC LIMIT 300) ORDER BY ts,sort",peer))).put("transfers",if(peer.isEmpty())JSONArray() else JSONArray(db.rows("SELECT * FROM transfers WHERE peer=? ORDER BY rowid DESC LIMIT 100",peer))).put("outbox",db.first("SELECT COUNT(*) AS n FROM outbox")!!.getInt("n")).put("errors",JSONArray(errors))
        }
        if(op=="add"){val r=call(command("add").put("address",Protocol.address(c.getString("address"))));db.peer(r.getString("peer"),c.optString("name"));refresh();return r}
        if(op=="accept"){val r=call(command("accept",peer));db.peer(peer);db.run("DELETE FROM requests WHERE peer=?",peer);refresh();return r}
        if(op=="reject"){db.run("DELETE FROM requests WHERE peer=?",peer);return JSONObject().put("ok",true)}
        if(op=="name"){val n=c.getString("name").trim();check(n.isNotEmpty()&&n.toByteArray().size<=128){"名称需在 1–128 字节内"};call(command("name").put("name",n));name=n;prefs.edit().putString("name",name).commit();return JSONObject().put("ok",true)}
        check(db.first("SELECT peer FROM peers WHERE peer=?",peer)!=null){"未找到联系人"}
        if(op=="filePath"){val t=db.first("SELECT * FROM transfers WHERE id=? AND peer=? AND inbound=1 AND status='complete'",c.getString("id"),peer)?:error("文件不存在");return JSONObject().put("path",t.getString("path")).put("name",t.getString("name"))}
        if(op=="chat"||op=="agent.request"){val p=Protocol.validate(Protocol.envelope(op,JSONObject().put("text",c.getString("text"))));db.queue(peer,p);flush();return JSONObject().put("id",p.getString("id"))}
        if(op=="sendFile"){val r=call(c);db.run("INSERT INTO transfers(id,peer,number,name,size,inbound,status,path) VALUES(?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),peer,r.getInt("number"),r.getString("name"),r.getLong("size"),0,"offered",c.getString("path"));return r}
        if(op=="acceptFile"||op=="cancelFile"){
            val t=db.first("SELECT * FROM transfers WHERE id=? AND peer=?",c.getString("id"),peer)?:error("传输不存在");check(t.getString("status") in listOf("offered","transferring")){"传输已结束"}
            val dest=File(File(context.filesDir,"downloads"),t.getString("id")+"-"+File(t.getString("name")).name.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"),"_"))
            val r=call(command(op,peer).put("number",t.getInt("number")).put("path",dest.path));db.run("UPDATE transfers SET status=?,path=? WHERE id=?",if(op=="acceptFile")"transferring" else "cancelled",dest.path,t.getString("id"));return r
        }
        error("未知操作")
    }
    fun reconnect(){executor.execute { if(node!=0L)try{bootstrap()}catch(e:Exception){error(e)} }}
    fun close(){executor.submit {if(node!=0L){Native.destroy(node);node=0};if(::db.isInitialized)db.close()}.get(15,TimeUnit.SECONDS);executor.shutdownNow()}
}
