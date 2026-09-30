import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,truncate,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imageMime } from '../desktop/src/file-preview.js';
test('previews only bounded raster images using byte signatures, regardless of extension',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'tochat-preview-'));try{
    const f=path.join(dir,'image.bin');for(const [header,mime] of [[Buffer.from([137,80,78,71,13,10,26,10]),'image/png'],[Buffer.from([255,216,255]),'image/jpeg'],[Buffer.from('GIF89a'),'image/gif'],[Buffer.from('RIFF0000WEBP'),'image/webp']]){await writeFile(f,header);assert.equal(await imageMime(f),mime);}
    await writeFile(f,'<svg onload="evil()"></svg>');await assert.rejects(imageMime(f),/不支持/);await truncate(f,8*1024*1024+1);await assert.rejects(imageMime(f),/8 MB/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
