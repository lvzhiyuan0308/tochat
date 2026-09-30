package org.tochat.app
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
class History(context: Context) : SQLiteOpenHelper(context, "history.sqlite", null, 2) {
    init { setWriteAheadLoggingEnabled(true) }
    override fun onConfigure(db: SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE peers(peer TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',capabilities TEXT NOT NULL DEFAULT '[]',allow_ai INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE requests(peer TEXT PRIMARY KEY,message TEXT NOT NULL)")
        db.execSQL("CREATE TABLE messages(id TEXT NOT NULL,peer TEXT NOT NULL,direction TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,ts INTEGER NOT NULL,total INTEGER,PRIMARY KEY(id,peer))")
        db.execSQL("CREATE TABLE outbox(id TEXT NOT NULL,peer TEXT NOT NULL,packet TEXT NOT NULL,last_attempt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(id,peer))")
        db.execSQL("CREATE TABLE received(id TEXT NOT NULL,peer TEXT NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(id,peer))")
        db.execSQL("CREATE TABLE chunks(stream TEXT NOT NULL,peer TEXT NOT NULL,seq INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(stream,peer,seq))")
        db.execSQL("CREATE TABLE transfers(id TEXT PRIMARY KEY,peer TEXT NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,inbound INTEGER NOT NULL,status TEXT NOT NULL,path TEXT NOT NULL DEFAULT '')")
        upgradeV2(db)
    }
    private fun upgradeV2(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE peers ADD COLUMN ai_session TEXT NOT NULL DEFAULT 'legacy'")
        db.execSQL("ALTER TABLE messages ADD COLUMN session TEXT NOT NULL DEFAULT 'legacy'")
        db.execSQL("ALTER TABLE transfers ADD COLUMN ts INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE transfers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) { if(old<2)upgradeV2(db) }
    fun run(sql: String, vararg args: Any?) { writableDatabase.execSQL(sql, args) }
    fun rows(sql: String, vararg args: Any?): List<JSONObject> {
        readableDatabase.rawQuery(sql, args.map { it.toString() }.toTypedArray()).use { c ->
            val result = mutableListOf<JSONObject>()
            while(c.moveToNext()) { val row = JSONObject(); for(i in 0 until c.columnCount) row.put(c.getColumnName(i), when(c.getType(i)){ android.database.Cursor.FIELD_TYPE_NULL -> JSONObject.NULL; android.database.Cursor.FIELD_TYPE_INTEGER -> c.getLong(i); else -> c.getString(i) }); result.add(row) }
            return result
        }
    }
    fun first(sql: String, vararg args: Any?) = rows(sql, *args).firstOrNull()
    fun <T> transaction(fn: () -> T): T { writableDatabase.beginTransaction();try { val r=fn();writableDatabase.setTransactionSuccessful();return r }finally{writableDatabase.endTransaction()} }
    fun peer(peer: String, name: String = "") { run("INSERT OR IGNORE INTO peers(peer,name) VALUES(?,?)", peer, name);if(name.isNotEmpty())run("UPDATE peers SET name=? WHERE peer=?",name,peer) }
    fun queue(peer: String, p: JSONObject, show: Boolean = true) { transaction {
        run("INSERT OR IGNORE INTO outbox(id,peer,packet) VALUES(?,?,?)",p.getString("id"),peer,p.toString())
        if(show)run("INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts,session) VALUES(?,?,?,?,?,?,?,?)",p.getString("id"),peer,"out",p.getString("t"),p.getJSONObject("body").getString("text"),"queued",p.getLong("ts"),p.getJSONObject("body").optString("session","legacy"))
    } }
}
