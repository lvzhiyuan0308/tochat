import koffi from 'koffi';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export class ToxNode {
  constructor(config) {
    const dll=process.env.TOCHAT_BRIDGE||path.join(root,'dist/windows/toxbridge.dll');
    this.lib=koffi.load(dll);
    this.create=this.lib.func('void* tc_create(const char*)');
    this.error=this.lib.func('const char* tc_last_error()');
    this.callFn=this.lib.func('void* tc_call(void*, const char*)');
    this.pollFn=this.lib.func('void* tc_poll(void*)');
    this.free=this.lib.func('void tc_free(void*)');
    this.destroy=this.lib.func('void tc_destroy(void*)');
    this.handle=this.create(JSON.stringify(config));if(!this.handle)throw new Error(this.error());
  }
  decode(ptr){try{return JSON.parse(koffi.decode(ptr,'char',-1));}finally{this.free(ptr);}}
  call(command){const r=this.decode(this.callFn(this.handle,JSON.stringify(command)));if(r.error)throw new Error(r.error);return r;}
  poll(){return this.decode(this.pollFn(this.handle));}
  close(){if(this.handle){this.destroy(this.handle);this.handle=null;}}
}
