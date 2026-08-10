import net from "node:net";
import { writeFileSync } from "node:fs";
const [configuration,readyFile]=process.argv.slice(2);
if(!configuration||!readyFile)throw new Error("proxy configuration and ready file required");
const mappings=JSON.parse(configuration);
if(!Array.isArray(mappings)||mappings.length!==4)throw new Error("exactly four proxy mappings required");
const servers=[];
for(const mapping of mappings){
  if(mapping.host!=="127.0.0.1"||!Number.isSafeInteger(mapping.listen)||!mapping.targetHost||!Number.isSafeInteger(mapping.targetPort))throw new Error("invalid proxy mapping");
  const server=net.createServer((client)=>{
    const upstream=net.connect(mapping.targetPort,mapping.targetHost);
    client.on("error",()=>upstream.destroy());upstream.on("error",()=>client.destroy());
    client.pipe(upstream);upstream.pipe(client);
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(mapping.listen,mapping.host,resolve);});
  servers.push(server);
}
writeFileSync(readyFile,"ready\n",{mode:0o600});
const close=()=>Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>{close().finally(()=>process.exit(0));});
