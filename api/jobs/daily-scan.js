import { db, email, scheduler } from "hatchable";
import runScan from "lib/scan.js";
export const methods = ["POST"];
export const access = "scheduler";
async function notifyFailure(subject,message){
 try{
  const q=await db.query("SELECT email FROM dashboard_alert_settings WHERE owner_key='primary' AND enabled=true LIMIT 1");
  const to=q.rows[0]?.email;if(!to)return{sent:false,reason:"No enabled alert email configured"};
  const safe=String(message||"Scan failed").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  await email.send({to,subject,html:"<h2>India Swing Desk scan alert</h2><p>"+safe+"</p><p>Open the private dashboard to review scan health and freshness.</p>",text:"India Swing Desk scan alert\n\n"+String(message||"Scan failed")+"\n\nOpen your private dashboard to review scan health and freshness."});
  return{sent:true};
 }catch(e){return{sent:false,reason:e.message||"Email send failed"};}
}
async function scheduleNext(offset,delayMs=60000,retryCount=0){
 try{const task=await scheduler.at(new Date(Date.now()+delayMs),"/api/jobs/daily-scan",{payload:{offset,retryCount},name:"nifty500-scan-resume"});return{scheduled:true,offset,retryCount,nextFireAt:task.next_fire_at||null};}
 catch(e){return{scheduled:false,offset,error:e.message||"Could not schedule next batch"};}
}
export default async function(req,res){
 const started=Date.now(),retryCount=Math.max(0,Number(req.body?.retryCount)||0),offset=Math.max(0,Math.floor((Number(req.body?.offset)||0)/25)*25);
 try{
  let priorRows=[],priorState=null;
  if(offset>0||retryCount>0){
   const prev=await db.query("SELECT payload FROM daily_scan_snapshots WHERE mode='partial' AND payload->>'batchState'='nifty500' ORDER BY generated_at DESC LIMIT 1");
   priorState=prev.rows[0]?.payload||null;
   if(priorState)priorRows=Array.isArray(priorState.stocks)?priorState.stocks.filter(s=>s.analyzed):[];
  }
  let payload=null,statusCode=200;
  const scanResponse={status(code){statusCode=code;return this;},json(value){payload=value;return value;}};
  const cacheParam=Number(priorState?.quoteCacheId)||0;
  await runScan({url:"https://india-swing-trading.hatchable.site/api/upstox/scan?offset="+offset+"&batchSize=25"+(cacheParam?"&quoteCacheId="+cacheParam:"")},scanResponse);
  if(statusCode>=400||!payload||payload.mode!=="live"){
   const message=payload?.error||"Daily scan batch failed";
   await db.query("INSERT INTO daily_scan_snapshots(mode,error_text,payload) VALUES('error',$1,$2::jsonb)",[message,JSON.stringify(payload||{})]).catch(()=>{});
   await db.query("INSERT INTO scan_run_health(status,finished_at,failure_count,details,error_text) VALUES('error',now(),1,$1::jsonb,$2)",[JSON.stringify({route:"/api/jobs/daily-scan",offset}),message]).catch(()=>{});
   const alert=await notifyFailure("India Swing Desk: scan failed",message);
   return res.status(200).json({ok:false,message,alert,durationMs:Date.now()-started});
  }
  const analyzed=new Map(priorRows.map(s=>[s.symbol,s]));
  for(const s of payload.stocks||[])if(s.analyzed)analyzed.set(s.symbol,s);
  const analyzedCount=analyzed.size,quotedCount=Number(payload.quotedCount)||0;
  const batchComplete=!payload.rateLimited;
  const nextOffset=batchComplete?(payload.hasMoreBatches?Number(payload.nextOffset):null):offset;
  const isFinal=nextOffset===null;
  const partial=!isFinal||analyzedCount<quotedCount||Number(payload.quoteFailureBatchCount||0)>0;
  const mergedMap=new Map((payload.stocks||[]).map(s=>[s.symbol,s]));for(const [symbol,s] of analyzed)mergedMap.set(symbol,s);
  const merged={...payload,stocks:[...mergedMap.values()],batchState:"nifty500",batchOffset:offset,analyzedCount,qualifiedCount:[...analyzed.values()].filter(s=>s.qualified).length,coveragePct:quotedCount?Math.round(analyzedCount/quotedCount*1000)/10:0,partialScan:partial,hasMoreBatches:!isFinal,rateLimited:!!payload.rateLimited,note:!isFinal?(payload.rateLimited?"Upstox rate limit reached. This batch will retry after a cooldown; previously analyzed stocks are retained.":"Batch "+(Math.floor(offset/100)+1)+" completed. The next batch is scheduled automatically; previous results are retained and the snapshot remains marked partial."):(analyzedCount===quotedCount?"Full scan completed across all batches.":"Scan batches finished with incomplete technical history: "+analyzedCount+" of "+quotedCount+" quoted stocks analyzed. Failed or insufficient-history rows remain unqualified.")};
  if(!isFinal){
   await db.query("INSERT INTO daily_scan_snapshots(mode,universe_count,quoted_count,analyzed_count,qualified_count,payload,error_text) VALUES('partial',$1,$2,$3,$4,$5::jsonb,$6)",[merged.universeCount||0,quotedCount,analyzedCount,merged.qualifiedCount,JSON.stringify(merged),merged.note]);
   await db.query("INSERT INTO scan_run_health(status,finished_at,universe_count,quoted_count,analyzed_count,qualified_count,failure_count,details,error_text) VALUES('partial',now(),$1,$2,$3,$4,$5,$6::jsonb,$7)",[merged.universeCount||0,quotedCount,analyzedCount,merged.qualifiedCount,Number(payload.failedAnalysisCount||0)+Number(payload.quoteFailureBatchCount||0),JSON.stringify({offset,nextOffset,rateLimited:!!payload.rateLimited,coveragePct:merged.coveragePct}),merged.note]);
   const retryDelay=payload.rateLimited?Math.min(900000,120000*Math.pow(2,Math.min(retryCount,3))):60000;
   const task=await scheduleNext(nextOffset,retryDelay,payload.rateLimited?retryCount+1:0);
   return res.status(200).json({ok:false,partial:true,inProgress:true,message:merged.note,offset,nextOffset,analyzedCount,quotedCount,coveragePct:merged.coveragePct,scheduled:task,durationMs:Date.now()-started});
  }
  const matchedCount=Number(payload.matchedInstruments??payload.universeCount)||0;
  merged.partialScan=!!payload.partialScan||analyzedCount<quotedCount||quotedCount<matchedCount||Number(payload.quoteFailureBatchCount||0)>0;
  merged.note=merged.partialScan?(quotedCount<matchedCount?"Quote coverage incomplete: "+quotedCount+" of "+matchedCount+" matched instruments returned quotes; "+analyzedCount+" received technical analysis.":"All batches attempted, but only "+analyzedCount+" of "+quotedCount+" quoted stocks have usable technical analysis."):"All "+analyzedCount+" quoted stocks received technical analysis across batches.";
  const mode=merged.partialScan?"partial":"live";
  await db.query("INSERT INTO daily_scan_snapshots(mode,universe_count,quoted_count,analyzed_count,qualified_count,payload,error_text) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[mode,merged.universeCount||0,quotedCount,analyzedCount,merged.qualifiedCount,JSON.stringify(merged),merged.partialScan?merged.note:null]);
  await db.query("INSERT INTO scan_run_health(status,finished_at,universe_count,quoted_count,analyzed_count,qualified_count,failure_count,details,error_text) VALUES($1,now(),$2,$3,$4,$5,$6,$7::jsonb,$8)",[mode,merged.universeCount||0,quotedCount,analyzedCount,merged.qualifiedCount,Number(payload.failedAnalysisCount||0)+Number(payload.quoteFailureBatchCount||0),JSON.stringify({offset,coveragePct:merged.coveragePct,rateLimited:!!payload.rateLimited}),merged.partialScan?merged.note:null]);
  const alert=merged.partialScan?await notifyFailure("India Swing Desk: scan incomplete",merged.note):{sent:false,reason:"Full scan completed; no alert needed"};
  return res.status(200).json({ok:!merged.partialScan,partial:merged.partialScan,inProgress:false,generatedAt:merged.generatedAt,universeCount:merged.universeCount,quotedCount,analyzedCount,coveragePct:merged.coveragePct,qualifiedCount:merged.qualifiedCount,alert,durationMs:Date.now()-started});
 }catch(e){
  const message=e.message||"Daily scan failed";
  await db.query("INSERT INTO daily_scan_snapshots(mode,error_text) VALUES('error',$1)",[message]).catch(()=>{});
  await db.query("INSERT INTO scan_run_health(status,finished_at,failure_count,details,error_text) VALUES('error',now(),1,$1::jsonb,$2)",[JSON.stringify({route:"/api/jobs/daily-scan",offset}),message]).catch(()=>{});
  const alert=await notifyFailure("India Swing Desk: scan error",message);
  return res.status(200).json({ok:false,message,alert,durationMs:Date.now()-started});
 }
}