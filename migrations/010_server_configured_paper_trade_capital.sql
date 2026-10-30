CREATE OR REPLACE FUNCTION open_paper_trade_guarded(
 p_owner text,p_symbol text,p_name text,p_sector text,p_entry numeric,p_stop numeric,p_target numeric,p_quantity integer,p_capital numeric,p_notes text,p_costs numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 v_positions integer; v_exposure numeric; v_risk numeric; v_sector_exposure numeric;
 v_new_exposure numeric := p_entry*p_quantity; v_new_risk numeric := (p_entry-p_stop)*p_quantity;
 v_capital numeric := 100000;
 v_max_positions integer := 5; v_max_exposure_pct numeric := 20; v_max_risk_pct numeric := 2; v_max_sector_pct numeric := 35;
 v_trade paper_trades%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('paper-trades-risk:'||p_owner));
 SELECT COUNT(*),COALESCE(SUM(entry*quantity),0),COALESCE(SUM(GREATEST(0,entry-stop)*quantity),0)
 INTO v_positions,v_exposure,v_risk FROM paper_trades WHERE owner_key=p_owner AND status='OPEN';
 IF EXISTS(SELECT 1 FROM paper_trades WHERE owner_key=p_owner AND status='OPEN' AND upper(symbol)=upper(p_symbol)) THEN
  RETURN jsonb_build_object('ok',false,'status',409,'error','An open paper trade already exists for '||p_symbol||'.');
 END IF;
 IF v_positions>=v_max_positions THEN RETURN jsonb_build_object('ok',false,'status',409,'error','Portfolio limit: maximum '||v_max_positions||' open positions.'); END IF;
 IF v_exposure+v_new_exposure>v_capital*v_max_exposure_pct/100 THEN RETURN jsonb_build_object('ok',false,'status',409,'error','Portfolio exposure limit exceeded. Total exposure would exceed 20% of configured capital.','riskControls',jsonb_build_object('capital',v_capital,'existingExposure',v_exposure,'newExposure',v_new_exposure,'maxExposureINR',v_capital*v_max_exposure_pct/100)); END IF;
 IF v_risk+v_new_risk>v_capital*v_max_risk_pct/100 THEN RETURN jsonb_build_object('ok',false,'status',409,'error','Portfolio stop-risk limit exceeded. Total stop risk would exceed 2% of configured capital.','riskControls',jsonb_build_object('capital',v_capital,'existingStopRisk',v_risk,'newStopRisk',v_new_risk,'maxStopRiskINR',v_capital*v_max_risk_pct/100)); END IF;
 SELECT COALESCE(SUM(entry*quantity),0) INTO v_sector_exposure FROM paper_trades WHERE owner_key=p_owner AND status='OPEN' AND lower(COALESCE(sector,'Unknown'))=lower(COALESCE(p_sector,'Unknown'));
 IF v_sector_exposure+v_new_exposure>v_capital*v_max_sector_pct/100 THEN RETURN jsonb_build_object('ok',false,'status',409,'error','Sector concentration limit exceeded. Total sector exposure would exceed 35% of configured capital.','riskControls',jsonb_build_object('sector',p_sector,'sectorExposure',v_sector_exposure,'newExposure',v_new_exposure,'maxSectorExposureINR',v_capital*v_max_sector_pct/100)); END IF;
 INSERT INTO paper_trades(owner_key,symbol,company_name,side,entry,stop,target,quantity,costs,notes,sector)
 VALUES(p_owner,p_symbol,p_name,'LONG',p_entry,p_stop,p_target,p_quantity,p_costs,p_notes,p_sector) RETURNING * INTO v_trade;
 RETURN jsonb_build_object('ok',true,'trade',to_jsonb(v_trade),'riskControls',jsonb_build_object('openPositionsAfter',v_positions+1,'maxPositions',v_max_positions,'capital',v_capital,'existingExposure',v_exposure,'newExposure',v_new_exposure,'totalExposure',v_exposure+v_new_exposure,'maxExposureINR',v_capital*v_max_exposure_pct/100,'existingStopRisk',v_risk,'newStopRisk',v_new_risk,'totalStopRisk',v_risk+v_new_risk,'maxStopRiskINR',v_capital*v_max_risk_pct/100,'sector',p_sector,'sectorExposureAfter',v_sector_exposure+v_new_exposure,'maxSectorExposureINR',v_capital*v_max_sector_pct/100));
END;
$$;
