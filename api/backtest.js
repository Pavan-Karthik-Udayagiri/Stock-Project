import { db } from "hatchable";
import { apiFetch } from "lib/upstox.js";
export const access="admin";
export const methods=["POST","GET"];
async function history(path,attempts=3){let last;for(let i=0;i<attempts;i++){try{return await apiFetch(path);}catch(e){last=e;if(e.status===429)throw e;const retry=e.status>=500||/timeout|network|temporar/i.test(e.message||"");if(!retry||i===attempts-1)throw e;await new Promise(r=>setTimeout(r,800*(i+1)));}}throw last;}
function ema(a,p){if(a.length<p)return null;let v=a.slice(0,p).reduce((s,x)=>s+x,0)/p;const k=2/(p+1);for(let i=p;i<a.length;i++)v=a[i]*k+v*(1-k);return v;}
function validCandles(raw){return (raw||[]).map(x=>({time:x[0],open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])||0})).filter(x=>x.time&&[x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.open>0&&x.close>0&&x.high>=Math.max(x.open,x.close,x.low)&&x.low<=Math.min(x.open,x.close)).sort((a,b)=>new Date(a.time)-new Date(b.time));}
function simulate(c,costBps,slippageBps){
 const trades=[];let pos=null;
 const closePosition=(bar,exit,reason)=>{
  const entryCost=pos.entry*(costBps+slippageBps)/10000,exitCost=exit*(costBps+slippageBps)/10000;
  const gross=exit-pos.entry,costs=entryCost+exitCost,net=gross-costs;
  trades.push({entrySignalDate:pos.signalDate,entryDate:pos.date,exitDate:bar.time,entry:pos.entry,exit,stop:pos.stop,target:pos.target,reason,grossPnlPerShare:gross,estimatedCostsPerShare:costs,netPnlPerShare:net,rMultiple:net/(pos.entry-pos.stop),entryGapPct:pos.entryGapPct});
  pos=null;
 };
 const exitForBar=(position,bar)=>{
  if(bar.open<=position.stop)return{price:bar.open,reason:"gap through stop; filled at open"};
  if(bar.open>=position.target)return{price:bar.open,reason:"gap through target; filled at open"};
  if(bar.low<=position.stop&&bar.high>=position.target)return{price:position.stop,reason:"stop (both levels touched; conservative)"};
  if(bar.low<=position.stop)return{price:position.stop,reason:"stop"};
  if(bar.high>=position.target)return{price:position.target,reason:"target"};
  return null;
 };
 for(let i=55;i<c.length;i++){
  const bar=c[i],hadPosition=!!pos;
  if(pos){
   const exit=exitForBar(pos,bar);
   if(exit)closePosition(bar,exit.price,exit.reason);
   else if(i-pos.entryIndex>=20)closePosition(bar,bar.close,"time exit");
  }
  if(!pos && !hadPosition && i>0){
   // Signal uses only the prior completed candle and prior history. Entry is next session open.
   const hist=c.slice(0,i), signal=hist[hist.length-1], closes=hist.map(x=>x.close),e20=ema(closes,20),e50=ema(closes,50);
   const high20=Math.max(...hist.slice(-20,-1).map(x=>x.high));
   const ranges=hist.slice(-15).map((x,j)=>Math.max(x.high-x.low,j?Math.abs(x.high-hist[hist.length-15+j-1].close):0,j?Math.abs(x.low-hist[hist.length-15+j-1].close):0));
   const atr=ranges.reduce((a,b)=>a+b,0)/ranges.length;
   if(e20&&e50&&e20>e50&&signal.close>high20&&atr>0&&bar.open>0){
    const entry=bar.open,stop=entry-1.5*atr;
    if(entry>stop){
     pos={entry,stop,target:entry+2*(entry-stop),signalDate:signal.time,date:bar.time,index:i,entryIndex:i,entryGapPct:(bar.open-signal.close)/signal.close*100};
     const sameDayExit=exitForBar(pos,bar);
     if(sameDayExit)closePosition(bar,sameDayExit.price,"entry-day "+sameDayExit.reason);
    }
   }
  }
 }
 if(pos){const bar=c[c.length-1],exit=bar.close,costs=(pos.entry+exit)*(costBps+slippageBps)/10000,gross=exit-pos.entry;trades.push({entrySignalDate:pos.signalDate,entryDate:pos.date,exitDate:bar.time,entry:pos.entry,exit,stop:pos.stop,target:pos.target,reason:"end of test",grossPnlPerShare:gross,estimatedCostsPerShare:costs,netPnlPerShare:gross-costs,rMultiple:(gross-costs)/(pos.entry-pos.stop),entryGapPct:pos.entryGapPct});}
 return trades;
}
async function benchmark(from,to){try{const d=await history("/v3/historical-candle/"+encodeURIComponent("NSE_INDEX|Nifty 50")+"/days/1/"+to+"/"+from,2);const c=validCandles(d.data?.candles||[]);if(c.length<2)return{available:false,note:"Insufficient Nifty 50 candles."};return{available:true,index:"Nifty 50",from:String(c[0].time).slice(0,10),to:String(c.at(-1).time).slice(0,10),returnPct:Number(((c.at(-1).close/c[0].close-1)*100).toFixed(2)),candles:c.length};}catch(e){return{available:false,note:"Nifty 50 benchmark unavailable: "+(e.message||"source error")};}}
function summarize(trades){const wins=trades.filter(t=>t.netPnlPerShare>0),loss=trades.filter(t=>t.netPnlPerShare<0),grossWin=wins.reduce((a,t)=>a+t.netPnlPerShare,0),grossLoss=Math.abs(loss.reduce((a,t)=>a+t.netPnlPerShare,0));let eq=0,peak=0,maxDD=0;for(const t of [...trades].sort((a,b)=>new Date(a.exitDate)-new Date(b.exitDate))){eq+=t.netPnlPerShare;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);}return{trades:trades.length,wins:wins.length,losses:loss.length,winRatePct:trades.length?Number((wins.length/trades.length*100).toFixed(2)):0,netPnlPerShare:Number(trades.reduce((a,t)=>a+t.netPnlPerShare,0).toFixed(3)),expectancyPerShare:trades.length?Number((trades.reduce((a,t)=>a+t.netPnlPerShare,0)/trades.length).toFixed(3)):0,expectancyR:trades.length?Number((trades.reduce((a,t)=>a+t.rMultiple,0)/trades.length).toFixed(3)):0,profitFactor:grossLoss?Number((grossWin/grossLoss).toFixed(3)):null,maxDrawdownPerShare:Number(maxDD.toFixed(3))};}
function portfolioEquity(trades,initialCapital=100000,riskPct=1,maxExposurePct=20,maxPositions=5,priceHistory={}){
 const ordered=[...trades].sort((a,b)=>new Date(a.entryDate)-new Date(b.entryDate)),active=[],closed=[];
 const marks=new Map(),pricesByDate=new Map(),events=new Set();
 for(const [symbol,candles] of Object.entries(priceHistory)){
  for(const candle of candles||[]){
   const date=String(candle[0]).slice(0,10),close=Number(candle[4]);
   if(!date||!Number.isFinite(close)||close<=0)continue;
   if(!pricesByDate.has(date))pricesByDate.set(date,[]);
   pricesByDate.get(date).push([symbol,close]);
   events.add(date);
  }
 }
 const entriesByDate=new Map();
 for(const trade of ordered){
  const entryDate=String(trade.entryDate).slice(0,10),exitDate=String(trade.exitDate).slice(0,10);
  if(!entriesByDate.has(entryDate))entriesByDate.set(entryDate,[]);
  entriesByDate.get(entryDate).push({...trade,entryDate,exitDate});
  events.add(entryDate);events.add(exitDate);
 }
 let cash=initialCapital,equity=initialCapital,peak=initialCapital,maxDD=0,skipped=0;
 const updateDrawdown=()=>{
  equity=cash+active.reduce((sum,position)=>{
   const mark=marks.get(position.symbol);
   return sum+position.qty*(mark??position.entry)-position.costs;
  },0);
  peak=Math.max(peak,equity);
  if(peak>0)maxDD=Math.max(maxDD,(peak-equity)/peak*100);
 };
 for(const date of [...events].sort()){
  for(const [symbol,close] of pricesByDate.get(date)||[])marks.set(symbol,close);
  for(let i=active.length-1;i>=0;i--){
   const position=active[i];
   if(position.exitDate<=date){
    cash+=position.qty*position.exit-position.costs;
    closed.push(position);
    active.splice(i,1);
   }
  }
  for(const trade of entriesByDate.get(date)||[]){
   updateDrawdown();
   if(active.length>=maxPositions){skipped++;continue;}
   const riskBudget=equity*riskPct/100;
   const qty=Math.floor(Math.min(
    riskBudget/Math.max(.01,trade.entry-trade.stop),
    equity*maxExposurePct/100/trade.entry,
    cash/trade.entry
   ));
   if(qty<1){skipped++;continue;}
   const costs=qty*(trade.entry+trade.exit)*(Number(trade.estimatedCostsPerShare||0)/Math.max(1,trade.entry+trade.exit));
   const position={...trade,qty,costs,symbol:trade.symbol||Object.keys(priceHistory)[0]||""};
   if(position.exitDate<=date){
    cash+=position.qty*(position.exit-position.entry)-position.costs;
    closed.push(position);
   }else{
    cash-=qty*trade.entry;
    active.push(position);
   }
  }
  updateDrawdown();
 }
 for(const position of active){
  cash+=position.qty*position.exit-position.costs;
  closed.push(position);
 }
 equity=cash;
 peak=Math.max(peak,equity);
 if(peak>0)maxDD=Math.max(maxDD,(peak-equity)/peak*100);
 return{initialCapital,endingEquity:Number(equity.toFixed(2)),netReturnPct:Number(((equity/initialCapital-1)*100).toFixed(2)),maxDrawdownPct:Number(maxDD.toFixed(2)),sizedTrades:closed.length,skippedForCashOrLimits:skipped,positionSizing:"1% equity risk per trade, 20% max notional per position, 5 concurrent positions; drawdown is marked to available daily closes and may differ from synchronized live execution."};
}
function walkForward(trades,from,to,segments=4){const start=new Date(from).getTime(),end=new Date(to).getTime(),width=(end-start)/segments;return Array.from({length:segments},(_,i)=>{const a=new Date(start+i*width),z=new Date(i===segments-1?end:start+(i+1)*width),subset=trades.filter(t=>new Date(t.entryDate)>=a&&new Date(t.entryDate)<z);return{from:a.toISOString().slice(0,10),to:z.toISOString().slice(0,10),metrics:summarize(subset)};});}
function corporateActionFlags(c){const out=[];for(let i=1;i<c.length;i++){const prev=c[i-1],cur=c[i],move=cur.open/prev.close-1;if(Math.abs(move)>.25)out.push({date:String(cur.time).slice(0,10),previousClose:prev.close,open:cur.open,overnightMovePct:Number((move*100).toFixed(2)),flag:"Possible corporate action or extreme gap; verify against official exchange/company records."});}return out.slice(0,20);}
export default async function(req,res){
 try{
  if(req.method==="GET"){const r=await db.query("SELECT id,strategy,symbols,params,results,created_at FROM backtest_runs WHERE owner_key='primary' ORDER BY created_at DESC LIMIT 20");return res.json({ok:true,runs:r.rows});}
  const b=req.body||{},symbols=Array.isArray(b.symbols)?b.symbols.slice(0,5):[],costBps=Math.min(100,Math.max(0,Number(b.costBps??15))),slippageBps=Math.min(100,Math.max(0,Number(b.slippageBps??10))),days=Math.min(730,Math.max(180,Number(b.days)||365));
  if(!symbols.length)return res.status(400).json({ok:false,error:"Choose at least one analyzed stock with its Upstox instrument key."});
  for(const s of symbols)if(!s||!/^NSE_EQ\|[A-Z0-9]{10,16}$/.test(String(s.instrumentKey||""))||!/^[A-Z0-9&.-]{1,24}$/.test(String(s.symbol||"")))return res.status(400).json({ok:false,error:"Invalid symbol or instrument key."});
  const now=new Date(Date.now()+330*60000),to=now.toISOString().slice(0,10),from=new Date(now.getTime()-days*86400000).toISOString().slice(0,10),results=[],priceHistory={};
  for(const s of symbols){
   const d=await history("/v3/historical-candle/"+encodeURIComponent(s.instrumentKey)+"/days/1/"+to+"/"+from,3);
   const raw=d.data?.candles||[],candles=validCandles(raw);priceHistory[s.symbol]=candles.map(c=>[c.time,c.open,c.high,c.low,c.close,c.volume]);
   if(candles.length<100)throw Object.assign(new Error(s.symbol+": only "+candles.length+" valid daily candles; at least 100 required."),{status:422});
   const dates=candles.map(x=>String(x.time).slice(0,10)),dupes=dates.length-new Set(dates).size,invalid=raw.length-candles.length,gaps=[];
   for(let i=1;i<dates.length;i++){const gap=(new Date(dates[i])-new Date(dates[i-1]))/86400000;if(gap>5)gaps.push({from:dates[i-1],to:dates[i],calendarDays:gap});}
   const split=Math.max(55,Math.floor(candles.length*.7)),splitDate=new Date(candles[split].time),trades=simulate(candles,costBps,slippageBps),train=trades.filter(t=>new Date(t.entryDate)<splitDate&&new Date(t.exitDate)<splitDate),test=trades.filter(t=>new Date(t.entryDate)>=splitDate),actionFlags=corporateActionFlags(candles);
   const m=summarize(trades),oosTrain=summarize(train),oosTest=summarize(test); results.push({symbol:s.symbol,name:s.name||s.symbol,source:"Upstox historical daily candle API",candleCount:candles.length,firstCandle:dates[0],lastCandle:dates.at(-1),invalidCandles:invalid,duplicateCandleDates:dupes,largeCalendarGaps:gaps.length,gapExamples:gaps.slice(0,5),possibleCorporateActionOrExtremeGapFlags:actionFlags,corporateActionAdjustmentVerified:false,metrics:m,tradeCount:m.trades,winRatePct:m.winRatePct,netPnlPerShare:m.netPnlPerShare,profitFactor:m.profitFactor,maxDrawdownPerShare:m.maxDrawdownPerShare,outOfSample:{splitDate:String(candles[split].time).slice(0,10),train:oosTrain,test:oosTest},walkForward:walkForward(trades,dates[0],dates.at(-1),4),portfolioSimulation:portfolioEquity(trades.map(t=>({...t,symbol:s.symbol})),100000,1,20,5,priceHistory),trades});
  }
  const all=results.flatMap(r=>r.trades.map(t=>({...t,symbol:r.symbol}))).sort((a,b)=>new Date(a.exitDate)-new Date(b.exitDate)),metrics=summarize(all),bm=await benchmark(from,to);
  const ps=portfolioEquity(all,100000,1,20,5,priceHistory),allTrain=results.flatMap(r=>r.trades.filter(t=>new Date(t.entryDate)<new Date(r.outOfSample.splitDate)&&new Date(t.exitDate)<new Date(r.outOfSample.splitDate))),allTest=results.flatMap(r=>r.trades.filter(t=>new Date(t.entryDate)>=new Date(r.outOfSample.splitDate))),oosMetrics=summarize(allTest),summary={strategy:"EMA20/EMA50 trend + prior 20-session breakout; 1.5 ATR stop, 2R target, 20-session time exit; next-session-open entry",from,to,days,costBps,slippageBps,stocks:results.length,metrics,totalTrades:metrics.trades,winRatePct:metrics.winRatePct,netPnlPerShareSum:metrics.netPnlPerShare,averageR:metrics.expectancyR,maxDrawdownR:metrics.maxDrawdownPerShare,profitFactor:metrics.profitFactor,portfolioSimulation:ps,portfolio:{returnPct:ps.netReturnPct,endingEquity:ps.endingEquity,maxDrawdownAmount:Number((ps.initialCapital*ps.maxDrawdownPct/100).toFixed(2)),maxDrawdownPct:ps.maxDrawdownPct},outOfSample:{testTrades:oosMetrics.trades,test:oosMetrics,train:summarize(allTrain)},benchmark:bm,results,validation:{lookAheadMitigation:"Signal is evaluated from completed prior candle; entry is next session open.",sameCandleStopTarget:"Stop-loss wins if both stop and target are touched within one candle, including the entry day.",gapHandling:"If a held position opens beyond stop or target, simulated fill is the open.",corporateActions:"Not independently verified. Results are only as reliable as the adjustment status of Upstox historical candles; split/dividend adjustment must be confirmed before interpreting returns.",charges:"Cost and slippage are configurable basis-point assumptions, not a broker-specific Indian charge calculation."},note:"Historical simulation, not a forecast. Trades crossing the train/test boundary are excluded from both segments; strategy parameters were not optimized on the test segment. Survivorship bias, corporate-action adjustment status, taxes/charges beyond configured estimates and real market impact remain limitations."};
  await db.query("INSERT INTO backtest_runs(owner_key,strategy,symbols,params,results) VALUES('primary',$1,$2::jsonb,$3::jsonb,$4::jsonb)",[summary.strategy,JSON.stringify(symbols.map(s=>s.symbol)),JSON.stringify({days,costBps,slippageBps}),JSON.stringify(summary)]);
  return res.json({ok:true,summary});
 }catch(e){return res.status(e.status||502).json({ok:false,error:e.message||"Backtest failed",rateLimited:e.status===429,note:"Upstox rate limits may block historical tests. No result is returned unless valid historical candles are retrieved."});}
}