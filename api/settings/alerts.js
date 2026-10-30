import { db } from "hatchable";
export const access = "admin";
export const methods = ["GET","POST"];
export default async function(req,res){
  if(req.method==="GET"){
    const r=await db.query("SELECT email,enabled,updated_at FROM dashboard_alert_settings WHERE owner_key='primary' LIMIT 1");
    return res.json({ok:true,settings:r.rows[0]||{email:"",enabled:false}});
  }
  const b=req.body||{},email=String(b.email||"").trim().toLowerCase(),enabled=b.enabled!==false;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:"Enter a valid email address to receive scan alerts."});
  const r=await db.query("INSERT INTO dashboard_alert_settings(owner_key,email,enabled,updated_at) VALUES('primary',$1,$2,now()) ON CONFLICT(owner_key) DO UPDATE SET email=EXCLUDED.email,enabled=EXCLUDED.enabled,updated_at=now() RETURNING email,enabled,updated_at",[email,enabled]);
  return res.json({ok:true,settings:r.rows[0]});
}