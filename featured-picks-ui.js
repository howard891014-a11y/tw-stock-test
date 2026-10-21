'use strict';
/** UI-only adapter. It does not fetch or fabricate stock selections.
 * Explicit real, dated results can be passed using:
 * window.StockZoneFeatured.render(verifiedFivePlusFiveResult);
 * This is intentionally NOT a market-price data feed, nor an auto-trading API.
 */
(function(){
  const $ = id=>document.getElementById(id);
  const allowed=new Set(['OFF','WARNING','ON_BROAD','ON_NARROW']);
  const key = r=>`${String(r.market)}|${String(r.stock_code)}`;
  const reset=()=>{
    const b=$('szFeaturedBadge');if(b)b.textContent='尚未同步';
    for(const [id,text] of [['szFeaturedCoreCount','-- / 5'],['szFeaturedExtendedCount','-- / 5'],['szFeaturedDate','選股日期：--'],['szFeaturedState','市場狀態：--'],['szFeaturedVersion','研究模型：尚未接入']]){
      const el=$(id);if(el)el.textContent=text;
    }
  };
  function addText(tag,clazz,text){const e=document.createElement(tag);if(clazz)e.className=clazz;e.textContent=String(text);return e;}
  function draw(list,id,empty){const host=$(id);if(!host)return;host.replaceChildren();
    if(list.length===0){host.append(addText('p','sz-featured-empty',empty));return;}
    for(const item of list){
      const row=addText('div','sz-featured-stock','');
      row.append(addText('span','sz-featured-rank',String(item.rank||'—')));
      const title=addText('div','sz-featured-name','');
      title.append(addText('b','',item.stock_name||item.stock_code));
      title.append(addText('small','',`${item.stock_code} · ${item.market||'市場未載入'}`));
      row.append(title);
      if(Number.isFinite(Number(item.s2r3Score)))row.append(addText('span','sz-featured-score',Number(item.s2r3Score).toFixed(3)));
      host.append(row);
    }
  }
  function render(payload){
    if(!payload||!allowed.has(payload.scene)||!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.asOfDate||'')))
      throw Error('Expected verified asOfDate and frozen W3 four-state scene');
    const core=payload.core,extended=payload.extended;
    if(!Array.isArray(core)||!Array.isArray(extended)||core.length>5||extended.length>5||
       (payload.scene==='OFF'&&(core.length||extended.length)) || (core.length<5&&extended.length>0))
      throw Error('Invalid 5+5 payload; OFF must return 0+0 and EXTENDED follows full CORE');
    const keys=new Set();
    for(const r of [...core,...extended]){if(!r.stock_code||!r.market||keys.has(key(r)))throw Error('Missing or duplicate market+stock_code in 5+5 payload');keys.add(key(r));}
    $('szFeaturedBadge').textContent=payload.scene==='OFF'?'停止推薦':'研究候選';
    $('szFeaturedDate').textContent='選股日期：'+payload.asOfDate;
    $('szFeaturedState').textContent='市場狀態：'+({'OFF':'防禦','WARNING':'預警','ON_BROAD':'偏多・廣度強','ON_NARROW':'偏多・廣度弱'}[payload.scene]);
    $('szFeaturedVersion').textContent='模型：'+({'original_all':'V4-R1 基準','early_frozen_warn_up':'S2-R3 預警研究','posthoc_narrow_warning_up':'四狀態探索'}[payload.scenario]||'來源需確認');
    $('szFeaturedCoreCount').textContent=core.length+' / 5';
    $('szFeaturedExtendedCount').textContent=extended.length+' / 5';
    draw(core,'szFeaturedCoreList',payload.scene==='OFF'?'OFF防禦中，今天不推薦。':'今日無符合推薦名額的股票。');
    draw(extended,'szFeaturedExtendedList',payload.scene==='OFF'?'OFF防禦中，今天不延伸。':'無符合延伸品質門檻的股票。');
    $('szFeaturedNote').textContent='此區顯示T日研究訊號，不是當下即時股價；延伸只供觀察，不自動下單。模擬交易進出場、OFF隔日開盤清倉及手續費另行驗證。';
  }
  let pending=null;
  async function load(){
    if(pending)return pending;
    const badge=$('szFeaturedBadge');if(badge)badge.textContent='Neon 資料讀取中';
    pending=(async()=>{
      try{
        const response=await fetch('/api/capital-flow?view=featured',{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok||!payload.ok)throw Error(payload.error||'Neon 未傳回有效推薦資料');
        render(payload);
        if(badge)badge.textContent=payload.scene==='OFF'?'防禦期':'Neon 日線候選';
        if(payload.sourceQuality?.status==='NEON_RECONSTRUCTION_PARITY_MISMATCH_CONFIRMED'){
          const note=$('szFeaturedNote');if(note)note.textContent='來源：Neon · W3-D.1.2。已確認Neon產業特徵與歷史研究特徵存在差異，推薦名單僅為Neon資料重建的研究預覽，不能視為歷史原版公式的已驗證推薦；禁止自動買進。';
        }
        return payload;
      }catch(e){
        reset();
        if(badge)badge.textContent='資料尚未驗證';
        const note=$('szFeaturedNote');if(note)note.textContent='Neon/W3 資料暫不可用：'+String(e.message||e)+'；不使用舊資料偽裝當日推薦。';
        for(const id of ['szFeaturedCoreList','szFeaturedExtendedList']){
          const host=$(id);if(host)host.replaceChildren(addText('p','sz-featured-empty','資料未同步，暫不提供推薦。'));
        }
        return null;
      }finally{pending=null;}
    })();
    return pending;
  }
  window.StockZoneFeatured={render,reset,load};
  window.addEventListener('stockzone:featured-daily',e=>render(e.detail));
  reset();
}());
