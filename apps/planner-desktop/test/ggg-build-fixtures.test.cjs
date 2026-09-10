"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const directory=path.join(__dirname,"..","fixtures","ggg-build-v1"); const manifest=JSON.parse(fs.readFileSync(path.join(directory,"manifest.json"),"utf8"));
test("all 18 fixture hashes match checkout bytes exactly",()=>{assert.equal(manifest.fixtures.length,18);assert.equal(new Set(manifest.fixtures.map(x=>x[0])).size,18);for(const [file,expected] of manifest.fixtures){assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(directory,file))).digest("hex"),expected);}});
test("BOM and newline fixture bytes are explicit",()=>{const bom=fs.readFileSync(path.join(directory,"utf8-bom.build")), noBom=fs.readFileSync(path.join(directory,"utf8-no-bom-newline.build"));assert.deepEqual([...bom.slice(0,3)],[0xef,0xbb,0xbf]);assert.notDeepEqual([...noBom.slice(0,3)],[0xef,0xbb,0xbf]);assert.equal(noBom.at(-1),0x0a);});
