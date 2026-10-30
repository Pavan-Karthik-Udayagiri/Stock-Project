import { db } from "hatchable";
export const access = "admin";
export const methods = ["GET","POST","PUT"];
function estimateDeliveryCharges(entry,qty,brokeragePerOrder=20,dpCharge=15.93,orderType="delivery",brokerName="Custom estimate"){
 const buy=entry*qty,sell=buy,turnover=buy+sell,isDelivery=orderType==="delivery",exchange=turnover*0.0000307,sebi=turnover*0.000001,stt=isDelivery?turnover*0.001:sell*0.00025,stamp=buy*0.00015,dp=isDelivery?dpCharge:0,gst=(brokeragePerOrder*2+exchange+sebi)*0.18;
 return {brokerName,orderType,brokeragePerOrder,dpCharge:dp,estimatedRoundTripINR:Number((brokeragePerOrder*2+dp+exchange+sebi+stt+stamp+gst).toFixed(2)),assumptions:"Indicative NSE cash-equity estimate using user-configured brokerage/DP charges. "+(isDelivery?"Delivery assumption: STT 0.1% of buy+sell turnover and DP charge on sell.":"Intraday assumption: STT 0.025% on sell side; no delivery DP charge.")+" Exchange/SEBI fees and GST are approximations; verify current broker tariff and statutory rates. Excludes spread, slippage and taxes on DP charge."};
}
export default async function(req,res) {
 const owner="primary";
 if(req.method==="GET"){const r=await db.query("SELECT id,symbol,company_name,sector,side,entry,stop,target,quantity,status,exit_price,gross_pnl,costs,net_pnl,notes,opened_at,closed_at FROM paper_trades WHERE owner_key=$1 ORDER BY opened_at DESC LIMIT 500",[owner]);return res.json({ok:true,trades:r.rows});}
 const b=req.body||{};
 if(req.method==="POST"){
  const symbol=String(b.symbol||"").trim().toUpperCase(),entry=Number(b.entry),stop=Number(b.stop),target=Number(b.target),quantity=Math.floor(Number(b.quantity)),sector=String(b.sector||"Unknown").slice(0,80),capital=100000;
  if(!/^[A-Z0-9&.-]{1,24}$/.test(symbol)||![entry,stop,target,quantity].every(Number.isFinite)||entry<=0||stop<=0||target<=entry||stop>=entry||quantity<1||quantity>10000000)return res.status(400).json({ok:false,error:"Valid symbol, long entry/stop/target and quantity are required."});
  const orderType=b.orderType==="intraday"?"intraday":"delivery",brokerName=String(b.brokerName||"Custom estimate").slice(0,60),costsInfo=estimateDeliveryCharges(entry,quantity,Math.max(0,Number(b.brokeragePerOrder??20)),Math.max(0,Number(b.dpCharge??15.93)),orderType,brokerName),costs=Math.max(0,Number(b.costs)||costsInfo.estimatedRoundTripINR);
  const correlationWarning=sector==="Unknown"?"Sector unknown: sector and correlation checks may miss related holdings.":"Same-sector holdings are treated as a concentration proxy; pairwise price correlation is calculated separately where historical data is available.";
  const notes=[String(b.notes||"").slice(0,350),"Server-enforced risk controls: maximum 5 positions, 20% total exposure, 2% total stop risk, 35% sector exposure.",correlationWarning,costsInfo.assumptions].join(" ");
  const guarded=await db.query("SELECT open_paper_trade_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result",[owner,symbol,String(b.name||"").slice(0,120),sector,entry,stop,target,quantity,capital,notes,costs]);
  const result=guarded.rows[0]?.result||{};
  if(!result.ok)return res.status(Number(result.status)||409).json(result);
  return res.status(201).json({...result,costEstimate:costsInfo,correlationWarning});
 }
 const id=Number(b.id),exit=Number(b.exitPrice),costs=Math.max(0,Number(b.costs)||0);
 if(!Number.isInteger(id)||id<1||!Number.isFinite(exit)||exit<=0)return res.status(400).json({ok:false,error:"Trade ID and valid exit price are required."});
 const existing=await db.query("SELECT id,entry,quantity,status,costs FROM paper_trades WHERE id=$1 AND owner_key=$2",[id,owner]);
 if(!existing.rows.length)return res.status(404).json({ok:false,error:"Paper trade not found."});
 if(existing.rows[0].status!=="OPEN")return res.status(409).json({ok:false,error:"This paper trade is already closed."});
 const totalCosts=Math.max(0,Number(existing.rows[0].costs)||0)+costs,gross=(exit-Number(existing.rows[0].entry))*Number(existing.rows[0].quantity),net=gross-totalCosts;
 const r=await db.query("UPDATE paper_trades SET status='CLOSED',exit_price=$1,gross_pnl=$2,costs=$3,net_pnl=$4,closed_at=now(),updated_at=now() WHERE id=$5 AND owner_key=$6 RETURNING id,symbol,entry,stop,target,quantity,status,exit_price,gross_pnl,costs,net_pnl,opened_at,closed_at",[exit,gross,totalCosts,net,id,owner]);
 return res.json({ok:true,trade:r.rows[0]});
}