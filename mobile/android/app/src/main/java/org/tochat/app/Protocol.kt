package org.tochat.app
import android.util.Base64
import org.json.JSONObject
import java.util.UUID
object Protocol {
    val types = setOf("chat","ack","hello","agent.request","agent.cancel","stream.begin","stream.chunk","stream.end","stream.error")
    fun envelope(t: String, b: JSONObject, id: String = UUID.randomUUID().toString()) = JSONObject().put("v",1).put("id",id).put("t",t).put("ts",System.currentTimeMillis()).put("body",b)
    fun validate(p: JSONObject): JSONObject {
        check(p.getInt("v")==1 && p.getString("t") in types && p.getString("id").length in 1..80) { "Invalid envelope" }
        p.getLong("ts"); val b=p.getJSONObject("body"); val t=p.getString("t")
        if(t=="chat"||t=="agent.request")check(b.getString("text").isNotBlank() && b.getString("text").toByteArray().size<=16384){"消息需在 1–16384 字节内"}
        if(t=="agent.request"&&b.has("session"))check(b.getString("session").matches(Regex("[A-Za-z0-9-]{1,80}"))){"Invalid session"}
        if(t=="agent.cancel")check(b.getString("stream").length in 1..80)
        if(t=="ack")check(b.getString("id").length in 1..80)
        if(t.startsWith("stream."))check(b.getString("stream").length in 1..80)
        if(t=="stream.chunk")check(b.getInt("seq") in 0..8192 && b.getString("text").toByteArray().size<=4096)
        if(t=="stream.end")check(b.getInt("total") in 0..8192)
        return p
    }
    fun packets(p: JSONObject): List<String> {
        validate(p);val raw=p.toString().toByteArray(Charsets.UTF_8);check(raw.size<=65536)
        if(raw.size<=1372)return listOf(raw.toString(Charsets.UTF_8))
        val n=(raw.size+749)/750
        return (0 until n).map { i -> JSONObject().put("v",1).put("t","fragment").put("id",p.getString("id")).put("i",i).put("n",n).put("data",Base64.encodeToString(raw.copyOfRange(i*750,minOf(raw.size,(i+1)*750)),Base64.NO_WRAP)).toString() }
    }
    fun address(input: String): String {
        val s=input.trim().replace(Regex("^tox:", RegexOption.IGNORE_CASE), "").uppercase()
        check(s.matches(Regex("[0-9A-F]{76}"))) { "请输入 76 位 Tox ID" }
        val b=s.chunked(2).map { it.toInt(16) };var even=0;var odd=0
        for(i in 0 until 36) if(i%2==0)even=even xor b[i] else odd=odd xor b[i]
        check(b[36]==even && b[37]==odd){"Tox ID 校验失败"};return s
    }
}
class Reassembler {
    data class Group(val time: Long, val n: Int, val parts: MutableMap<Int,ByteArray> = mutableMapOf())
    private val pending=mutableMapOf<String,Group>()
    fun read(peer: String, raw: String): JSONObject? {
        check(raw.toByteArray().size<=1372);val now=System.currentTimeMillis();pending.entries.removeAll { now-it.value.time>60000 }
        val p=JSONObject(raw);if(p.optString("t")!="fragment")return Protocol.validate(p)
        val id=p.getString("id");val i=p.getInt("i");val n=p.getInt("n");val data=p.getString("data")
        check(p.getInt("v")==1 && id.length in 1..80 && n in 2..88 && i in 0 until n && data.length<=1000 && data.matches(Regex("[A-Za-z0-9+/]*={0,2}")))
        val key="$peer:$id";val group=pending[key]?:run { check(pending.size<128);Group(now,n).also { pending[key]=it } };check(group.n==n)
        group.parts[i]=Base64.decode(data,Base64.NO_WRAP);if(group.parts.size!=n)return null
        pending.remove(key);val full=java.io.ByteArrayOutputStream();for(j in 0 until n)full.write(group.parts.getValue(j));check(full.size()<=65536)
        return Protocol.validate(JSONObject(full.toString("UTF-8"))).also { check(it.getString("id")==id) }
    }
}
