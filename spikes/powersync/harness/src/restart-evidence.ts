import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { assertPrivateRegularFile, openSpikeClient, readSpikeClientOffline, writePrivateJsonAtomically, type SpikeClient } from "./client.js";
import { ids } from "./fixtures.js";

function required(name:string):string { const value=process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
const mode=process.argv[2];
if(!["setup","verify","offline","cached"].includes(String(mode))) throw new Error("restart-evidence mode must be setup|verify|offline|cached");
const runId=required("PS8_RUN_ID");
const runtimeDirectory=required("PS8_RUNTIME_DIR");
const clientName=`r4-restart-${runId}`;
const metadataPath=path.join(path.dirname(runtimeDirectory),"restart-fixture.json");

type SourceInvariant={payload:string;version:number;mutations:number;receipts:number;events:number};
type Metadata={
  version:2; clientName:string; principalId:string; replicaId:string; replicaEpoch:number;
  applied:{resourceId:string;incarnationId:string;commandId:string;receiptDigest:string};
  pending:{resourceId:string;incarnationId:string;commandId:string;baseline:SourceInvariant};
  retainedFloor:number; replicaCount:number; rateRows:number;
  restartVerified?:boolean; crossProcessResetResumed?:boolean;
  later?:{commandId:string;resultCode:string;resultingVersion:number}; cachedLater?:{commandId:string;resultCode:string};
};
async function readMetadata():Promise<Metadata>{
  if (!await assertPrivateRegularFile(metadataPath)) throw new Error("restart_fixture_missing_or_not_private");
  const value=JSON.parse(await readFile(metadataPath,"utf8")) as Metadata;
  if (value.version!==2||value.clientName!==clientName||value.principalId!==ids.users.eve||!value.replicaId) throw new Error("invalid_restart_fixture");
  return value;
}
function networkConfiguration(){
  const tokenUrl=required("PS8_TOKEN_URL");
  const commandEndpoint=required("PS8_COMMAND_URL");
  const powerSyncEndpoint=required("PS8_POWERSYNC_URL");
  const databaseUrl=required("PS8_DATABASE_URL");
  const faultSecret=required("PS8_POST_COMMIT_FAULT_SECRET");
  const credentials=JSON.parse(required("PS8_TOKEN_CREDENTIALS_JSON")) as Record<string,string>;
  return {tokenUrl,commandEndpoint,powerSyncEndpoint,databaseUrl,faultSecret,credentials};
}
async function token(configuration:ReturnType<typeof networkConfiguration>):Promise<string>{
  const basic=Buffer.from(`eve:${configuration.credentials.eve}`).toString("base64");
  const response=await fetch(`${configuration.tokenUrl}/token`,{headers:{authorization:`Basic ${basic}`},signal:AbortSignal.timeout(5000)});
  const body=await response.json() as {token?:unknown};
  assert.equal(response.status,200); assert.equal(typeof body.token,"string"); return body.token as string;
}
async function poll<T>(label:string,read:()=>Promise<T>,accept:(value:T)=>boolean,timeout=15000):Promise<T>{
  const deadline=Date.now()+timeout;
  for(;;){ const value=await read(); if(accept(value)) return value; if(Date.now()>=deadline) throw new Error(`${label} timed out`); await new Promise(r=>setTimeout(r,50)); }
}
async function waitResult(client:SpikeClient,id:string){ return poll("command result",async()=>client.readCommandResults(),rows=>rows.some(row=>row.id===id)).then(rows=>rows.find(row=>row.id===id)!); }
async function waitAttempt(commandId:string,configuration:ReturnType<typeof networkConfiguration>):Promise<void>{
  await poll("command attempt",async()=>{
    const response=await fetch(`${configuration.commandEndpoint}/spike/test/attempts/${commandId}`,{headers:{"x-ps8-fault-secret":configuration.faultSecret},signal:AbortSignal.timeout(5000)});
    return response.ok ? Number((await response.json() as {attempts:number}).attempts) : 0;
  },count=>count>=1);
}
async function sourceInvariant(pool:pg.Pool,metadata:{resourceId:string;commandId:string}):Promise<SourceInvariant>{
  const result=await pool.query<{payload:string;version:string;mutations:string;receipts:string;events:string}>(`SELECT resource.payload,resource.version,
    resource.version-1 AS mutations,
    (SELECT count(*) FROM ps8_command_receipts WHERE command_id=$2) receipts,
    (SELECT count(*) FROM ps8_command_change_events WHERE command_id=$2) events
    FROM resources AS resource WHERE resource.id=$1`,[metadata.resourceId,metadata.commandId]);
  const row=result.rows[0];if(!row)throw new Error("restart_pending_resource_missing");
  return {payload:row.payload,version:Number(row.version),mutations:Number(row.mutations),
    receipts:Number(row.receipts),events:Number(row.events)};
}

async function setup():Promise<void>{
  const configuration=networkConfiguration();
  const pool=new pg.Pool({connectionString:configuration.databaseUrl,max:2}); let client:SpikeClient|undefined;
  try{
    const applied={resourceId:randomUUID(),incarnationId:randomUUID(),commandId:randomUUID()};
    const pending={resourceId:randomUUID(),incarnationId:randomUUID(),commandId:randomUUID()};
    for(const [resourceId,incarnation,payload] of [[applied.resourceId,applied.incarnationId,"R4_APPLIED_ORIGINAL"],[pending.resourceId,pending.incarnationId,"R4_PENDING_ORIGINAL"]]){
      await pool.query(`INSERT INTO resources(id,resource_incarnation_id,workspace_id,journey_id,audience,party_id,payload,version)
        VALUES($1,$2,$3,$4,'journey',NULL,$5,1)`,[resourceId,incarnation,ids.workspaces.two,ids.journeys.two,payload]);
    }
    client=await openSpikeClient({name:clientName,runtimeDirectory,endpoint:configuration.powerSyncEndpoint,
      commandEndpoint:configuration.commandEndpoint,token:await token(configuration),principalId:ids.users.eve});
    await client.queueCommands([{commandId:applied.commandId,type:"ps8.resource.update.v1",resourceId:applied.resourceId,
      resourceIncarnationId:applied.incarnationId,expectedRecordVersion:1,payload:"R4_APPLIED_COMMITTED"}]);
    assert.equal((await waitResult(client,applied.commandId)).result_code,"applied");
    client.setUploadFault({mode:"pre-commit-hold",secret:configuration.faultSecret});
    await client.queueCommands([{commandId:pending.commandId,type:"ps8.resource.update.v1",resourceId:pending.resourceId,
      resourceIncarnationId:pending.incarnationId,expectedRecordVersion:1,payload:"R4_PENDING_REVIEW"}]);
    await waitAttempt(pending.commandId,configuration);
    const baseline=await sourceInvariant(pool,pending);
    assert.deepEqual(baseline,{payload:"R4_PENDING_ORIGINAL",version:1,mutations:0,receipts:0,events:0});
    const secret=client.testReplicaSecret(); if(!secret) throw new Error("missing replica session");
    await pool.query("SELECT ps8_test_set_time((SELECT last_client_observed_ack_at FROM ps8_replicas WHERE replica_id=$1)+interval '90 days 1 microsecond')",[secret.replicaId]);
    client.setUploadFault(undefined);
    await poll("reset required",async()=>client!.resetRequired(),Boolean);
    await assert.rejects(client.performReplicaReset({afterResetStateWrittenBeforeApplicationSession:async()=>{
      throw new Error("r4_reset_json_before_application_session");
    }}),/r4_reset_json_before_application_session/);
    assert.deepEqual(await sourceInvariant(pool,pending),baseline);
    const view=await client.replicaSession(); if(!view) throw new Error("missing persisted replica view");
    assert.equal(view.replicaEpoch,secret.replicaEpoch,"application session must remain old at injected cross-file boundary");
    const receipt=await pool.query<{digest:string}>("SELECT digest FROM ps8_command_receipts WHERE command_id=$1",[applied.commandId]);
    const counts=await pool.query<{replicas:string;rate_rows:string;floor:string}>(`SELECT
      (SELECT count(*) FROM ps8_replicas WHERE user_id=$1) replicas,
      (SELECT count(*) FROM ps8_command_rate_windows WHERE replica_id=$2) rate_rows,
      (SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton) floor`,[ids.users.eve,view.replicaId]);
    assert.equal(await client.uploadQueueCount(),1); assert.equal((await client.readOptimisticResources()).length,1);
    await writePrivateJsonAtomically(metadataPath,{version:2,clientName,principalId:ids.users.eve,replicaId:view.replicaId,replicaEpoch:view.replicaEpoch,
      applied:{...applied,receiptDigest:receipt.rows[0]!.digest},pending:{...pending,baseline},retainedFloor:Number(counts.rows[0]!.floor),
      replicaCount:Number(counts.rows[0]!.replicas),rateRows:Number(counts.rows[0]!.rate_rows)} satisfies Metadata);
  }finally{await client?.close();await pool.end();}
  console.log("R4 restart setup retained old app session plus staged reset JSON");
}

async function verifyRestart():Promise<void>{
  const configuration=networkConfiguration();
  const metadata=await readMetadata(); const pool=new pg.Pool({connectionString:configuration.databaseUrl,max:2}); let client:SpikeClient|undefined;
  try{
    assert.deepEqual(await sourceInvariant(pool,metadata.pending),metadata.pending.baseline);
    client=await openSpikeClient({name:clientName,runtimeDirectory,endpoint:configuration.powerSyncEndpoint,
      commandEndpoint:configuration.commandEndpoint,token:await token(configuration),principalId:ids.users.eve,resumeExisting:true});
    assert.deepEqual(await sourceInvariant(pool,metadata.pending),metadata.pending.baseline);
    const session=await client.replicaSession(); assert.equal(session?.replicaId,metadata.replicaId);
    assert.equal(session?.replicaEpoch,metadata.replicaEpoch+1);
    assert.equal(await client.uploadQueueCount(),0);
    assert.equal((await client.readOptimisticResources()).length,0);
    assert.ok((await client.readCommandResults()).some(row=>row.id===metadata.applied.commandId&&row.result_code==="applied"));
    const quarantine=await client.readQuarantinedCommands();
    assert.ok(quarantine.some(row=>row.id===metadata.pending.commandId&&row.state==="pending_review"&&row.exportable===1));
    const db=await pool.query<{replicas:string;receipts:string;rate_rows:string;floor:string}>(`SELECT
      (SELECT count(*) FROM ps8_replicas WHERE user_id=$1) replicas,
      (SELECT count(*) FROM ps8_command_receipts WHERE command_id=$2 AND digest=$3) receipts,
      (SELECT count(*) FROM ps8_command_rate_windows WHERE replica_id=$4) rate_rows,
      (SELECT retained_graveyard_floor FROM ps8_retention_state WHERE singleton) floor`,
      [ids.users.eve,metadata.applied.commandId,metadata.applied.receiptDigest,metadata.replicaId]);
    assert.equal(Number(db.rows[0]!.replicas),metadata.replicaCount); assert.equal(Number(db.rows[0]!.receipts),1);
    assert.ok(Number(db.rows[0]!.rate_rows)>=metadata.rateRows); assert.ok(Number(db.rows[0]!.floor)>=metadata.retainedFloor);
    const laterId=randomUUID();
    await client.queueCommands([{commandId:laterId,type:"ps8.resource.update.v1",resourceId:metadata.applied.resourceId,
      resourceIncarnationId:metadata.applied.incarnationId,expectedRecordVersion:2,payload:"R4_AFTER_RESTART"}]);
    const laterResult=await waitResult(client,laterId);
    assert.equal(laterResult.result_code,"applied");
    await poll("SDK completion before explicit result acknowledgement",async()=>client!.acknowledgeCommandResult(laterId),Boolean);
    await client.queueCommands([{commandId:laterId,type:"ps8.resource.update.v1",resourceId:metadata.applied.resourceId,
      resourceIncarnationId:metadata.applied.incarnationId,expectedRecordVersion:2,payload:"R4_AFTER_RESTART"}]);
    assert.equal((await waitResult(client,laterId)).result_code,"already_applied");
    await writePrivateJsonAtomically(metadataPath,{...metadata,restartVerified:true,crossProcessResetResumed:true,
      later:{commandId:laterId,resultCode:"already_applied",resultingVersion:laterResult.current_version}} satisfies Metadata);
  }finally{await client?.close();await pool.end();}
  console.log("R4 resume-before-connect and four-service restart verification passed");
}

async function offlineRead():Promise<void>{
  // This mode deliberately requires no URL, token, database, fault or evidence
  // environment. The wrapper runs it in a network-none, read-only container.
  const metadata=await readMetadata();
  const snapshot=await readSpikeClientOffline({name:clientName,runtimeDirectory,principalId:ids.users.eve});
  assert.ok(snapshot.resources.some(row=>row.id===metadata.applied.resourceId));
  assert.ok(snapshot.results.some(row=>row.id===metadata.applied.commandId));
  assert.ok(snapshot.quarantine.some(row=>row.id===metadata.pending.commandId));
  assert.equal(snapshot.resetPhase,null);
  process.stdout.write(`${JSON.stringify({offlineRead:true,resourceIds:snapshot.resources.map(row=>row.id).sort(),
    resultIds:snapshot.results.map(row=>row.id).sort(),quarantineIds:snapshot.quarantine.map(row=>row.id).sort(),
    replicaId:snapshot.session.replicaId,replicaEpoch:snapshot.session.replicaEpoch,resetPhase:snapshot.resetPhase})}\n`);
}

async function cachedReconnect():Promise<void>{
  const configuration=networkConfiguration();
  const metadata=await readMetadata(); let client:SpikeClient|undefined;
  try{
    client=await openSpikeClient({name:clientName,runtimeDirectory,endpoint:configuration.powerSyncEndpoint,
      commandEndpoint:configuration.commandEndpoint,token:await token(configuration),principalId:ids.users.eve,resumeExisting:true});
    if(!metadata.later)throw new Error("restart verification metadata missing");
    const resource=await poll("cached replica catches up to post-restart version",async()=>
      (await client!.readRawResources()).find(row=>row.id===metadata.applied.resourceId),
      row=>row?.version===metadata.later!.resultingVersion);
    if(!resource) throw new Error("cached resource missing");
    const commandId=randomUUID();
    await client.queueCommands([{commandId,type:"ps8.resource.update.v1",resourceId:resource.id,
      resourceIncarnationId:resource.resource_incarnation_id,expectedRecordVersion:resource.version,payload:"R4_CACHED_LATER_PROGRESS"}]);
    assert.equal((await waitResult(client,commandId)).result_code,"applied");
    assert.equal(required("PS8_R4_IMAGE_IDS_UNCHANGED"),"1");
    assert.equal(required("PS8_R4_NETWORK_INTERNAL"),"1");
    assert.equal(required("PS8_R4_OFFLINE_READ_VERIFIED"),"1");
    await writePrivateJsonAtomically(metadataPath,{...metadata,cachedLater:{commandId,resultCode:"applied"}} satisfies Metadata);
    const observationPath=path.join(required("PS8_EVIDENCE_DIR"),"restart-offline-observations.json");
    await writePrivateJsonAtomically(observationPath,{experimentalM3bR4:{status:"executed-uncommitted",processRestart:true,
      sourceVolumePreserved:true,crossProcessResetResumed:true,resumeCompletedBeforeConnector:true,offlineRead:true,
      offlineReaderNetworkMode:"none",offlineRuntimeMount:"read-only",cachedPullPolicy:"never",cachedBuild:false,
      containerNetworkInternal:true,imageIdsUnchanged:true,laterProgress:"applied",outcomes:{
        replicaIdPreserved:true,replicaCountUnchanged:true,digestBoundReceiptPreserved:true,rateAndRetentionStatePreserved:true,
        stagedResetJsonWithOldAppSessionRecovered:true,pendingResourceMutationCount:0,pendingReceiptCount:0,pendingEventCount:0,
        quarantinePreserved:true,unresolvedResultPreserved:true,uploadQueueAfterReset:0,automaticResetRequeues:0,
        postRestartIdempotentReplay:"already_applied",offlineResourcesReadable:true,offlineResultsReadable:true,
        offlineQuarantineReadable:true,automaticOfflineWrites:0,offlineContainerReadonly:true,
        processLocalSemaphoreRestarted:true},unvalidated:["node-or-volume-loss","total-host-egress-isolation",
        "crash-consistency-and-physical-power-loss","ha-and-multi-node","encryption-and-native-runtime",
        "server-attested-powersync-checkpoint-completion"],sanitized:true}});
  }finally{await client?.close();}
  console.log("R4 cached no-pull/no-build reconnect passed");
}

if(mode==="setup")await setup();
else if(mode==="verify")await verifyRestart();
else if(mode==="offline")await offlineRead();
else await cachedReconnect();
