import test from 'node:test';
import assert from 'node:assert/strict';
import { finishDictation } from '../src/lib/finish-dictation.js';
test('Done waits for delayed final result after stop, stopping only once', async () => {
 let done, stops=0; const task=new Promise(resolve => done=resolve);
 const session={stop(){stops++;setTimeout(()=>done(true),60);}};
 assert.equal(await finishDictation({task,session:()=>session}),true);
 assert.equal(stops,1);
});
test('Done waits for the recognition session to start', async () => {
 let s, done;const task=new Promise(resolve=>done=resolve);
 setTimeout(()=>{s={stop(){done(true)}}},40);
 assert.equal(await finishDictation({task,session:()=>s}),true);
});
test('no speech does not become a successful save',async()=>{
 assert.equal(await finishDictation({task:Promise.resolve(false),session:()=>null}),false);
});
test('timeout aborts without using interim text',async()=>{
 let aborts=0;
 await assert.rejects(finishDictation({task:new Promise(()=>{}),session:()=>({stop(){},abort(){aborts++}}),timeoutMs:35}),/не сохранено/);
 await new Promise(r=>setTimeout(r,5));assert.equal(aborts,1);
});
