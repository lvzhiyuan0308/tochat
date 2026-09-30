import { DatabaseSync } from 'node:sqlite';
export class Store {
  constructor(path) {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS peers(peer TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',capabilities TEXT NOT NULL DEFAULT '[]',allow_ai INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS requests(peer TEXT PRIMARY KEY,message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(id TEXT NOT NULL,peer TEXT NOT NULL,direction TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,ts INTEGER NOT NULL,total INTEGER,PRIMARY KEY(id,peer));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT NOT NULL,peer TEXT NOT NULL,packet TEXT NOT NULL,last_attempt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(id,peer));
      CREATE TABLE IF NOT EXISTS received(id TEXT NOT NULL,peer TEXT NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(id,peer));
      CREATE TABLE IF NOT EXISTS chunks(stream TEXT NOT NULL,peer TEXT NOT NULL,seq INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(stream,peer,seq));
      CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,peer TEXT NOT NULL,number INTEGER NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,inbound INTEGER NOT NULL,status TEXT NOT NULL,path TEXT NOT NULL DEFAULT '');
      PRAGMA user_version=1;`);
    this.db.exec("UPDATE transfers SET status='interrupted' WHERE status IN ('offered','transferring');");
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  run(sql,...args){return this.db.prepare(sql).run(...args);}
  all(sql,...args){return this.db.prepare(sql).all(...args);}
  get(sql,...args){return this.db.prepare(sql).get(...args);}
  peer(peer,name=''){this.run("INSERT INTO peers(peer,name) VALUES(?,?) ON CONFLICT(peer) DO UPDATE SET name=CASE WHEN excluded.name='' THEN peers.name ELSE excluded.name END",peer,name);}
  queue(peer,p,show=true){
    this.transaction(()=>{
      this.run('INSERT OR IGNORE INTO outbox(id,peer,packet) VALUES(?,?,?)',p.id,peer,JSON.stringify(p));
      if(show)this.run('INSERT OR IGNORE INTO messages(id,peer,direction,kind,text,status,ts) VALUES(?,?,?,?,?,?,?)',p.id,peer,'out',p.t,p.body.text,'queued',p.ts);
    });
  }
  ack(peer,id){this.transaction(()=>{this.run('DELETE FROM outbox WHERE peer=? AND id=?',peer,id);this.run("UPDATE messages SET status='delivered' WHERE peer=? AND id=? AND direction='out' AND status IN ('queued','sending')",peer,id);});}
  close(){this.db.close();}
}
