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
    draw(core,'szFeaturedCoreList',payload.scene==='OFF'?'空頭環境防禦中，今天不推薦。':'今日無符合推薦名額的股票。');
    draw(extended,'szFeaturedExtendedList',payload.scene==='OFF'?'OFF防禦中，今天不延伸。':'無符合延伸品質門檻的股票。');
    $('szFeaturedNote').textContent='此區顯示T日研究訊號，不是當下即時股價；延伸只供觀察，不自動下單。模擬交易進出場、OFF隔日開盤清倉及手續費另行驗證。';
  }
  let pending=null;
  async function load(){
    void loadHistory();
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

  let historyData=null,historyPending=null;
  const historyHorizon=()=>String($('szFeaturedHistoryHorizon')?.value||'10');
  function renderHistory(){
    const summary=$('szFeaturedHistorySummary'),body=$('szFeaturedHistoryRows'),note=$('szFeaturedHistoryNote');
    if(!summary||!body)return;
    const payload=historyData,h=historyHorizon(),scene=String($('szFeaturedHistoryScene')?.value||'ALL');
    if(!payload){summary.textContent='歷史紀錄尚未載入';body.replaceChildren(addText('tr','', ''));return;}
    const all=Array.isArray(payload.rows)?payload.rows:[],rows=scene==='ALL'?all:all.filter(r=>r.scene===scene),
       counts=(scene==='ALL'?payload.summaries?.[h]:payload.summariesByScene?.[scene]?.[h])||{};
    const fmt=c=>c?.eligible?`${c.success}／${c.eligible}（${(c.success/c.eligible*100).toFixed(1)}%）`:'尚無成熟樣本';
    summary.textContent=`${h} 日雙重成功｜推薦 ${fmt(counts.core)} · 延伸 ${fmt(counts.extended)} · 合計 ${fmt(counts.all)}。成熟樣本不足時不顯示勝率。`;
    if(note)note.textContent='自部署後，每個交易日夜間自動封存實際推薦（包含 OFF 0+0）。T+1 收盤進場，H 個交易日後收盤比較；如期間轉 OFF，於 OFF 下一交易日收盤結束追蹤。股票與大盤使用同時點收盤價，不含費稅。Neon 重建特徵與早期研究版不一致，績效僅代表此版已保存訊號。';
    body.replaceChildren();
    if(!rows.length){const tr=document.createElement('tr'),td=addText('td','','部署後尚無成功封存的日選股；不以歷史重算填補。');td.colSpan=4;tr.append(td);body.append(tr);return;}
    for(const r of rows){
      const tr=document.createElement('tr'),items=r.performance?.items||[],completed=items.filter(x=>x.horizons?.[h]?.status==='complete'),winners=completed.filter(x=>x.horizons[h].doubleSuccess);
      const off=r.scene==='OFF',label={OFF:'防禦',WARNING:'預警',ON_BROAD:'偏多・廣度強',ON_NARROW:'偏多・廣度弱'}[r.scene]||'未知';
      const col1=addText('td','',r.trade_date),small=addText('small','',label);col1.append(small);tr.append(col1);
      const col2=addText('td','',`${r.core?.length||0}／${r.extended?.length||0}`);
      const names=[...(r.core||[]),...(r.extended||[])].map(x=>x.stock_name||x.stock_code);
      if(names.length){
        const detail=document.createElement('details'),trigger=addText('summary','',names.join('、'));
        detail.append(trigger);
        for(const item of items){
          const hResult=item.horizons?.[h],original=[...(r.core||[]),...(r.extended||[])].find(x=>x.stock_code===item.stock_code&&x.market===item.market);
          const label=(original?.stock_name||item.stock_code)+` (${item.tier==='core'?'推薦':'延伸'})`;
          let performance='待觀察';
          if(hResult?.status==='complete')performance=`${hResult.returnPct>=0?'+':''}${hResult.returnPct}%／大盤 ${hResult.marketPct>=0?'+':''}${hResult.marketPct}%${hResult.offExit?'｜OFF提前結束':''}`;
          else if(hResult?.status==='missing_price')performance='缺少有效行情，不納入統計';
          detail.append(addText('small','',label+'：'+performance));
        }
        col2.append(detail);
      }else col2.append(addText('small','',off?'OFF：當日不推薦':'未達篩選門檻'));
      tr.append(col2);
      tr.append(addText('td','',off?'—':`${completed.length}／${items.length}`));
      tr.append(addText('td','',off?'—':completed.length?`${winners.length}／${completed.length}（${(winners.length/completed.length*100).toFixed(0)}%）`:'待觀察'));
      body.append(tr);
    }
  }
  async function loadHistory(){
    if(historyPending)return historyPending;
    historyPending=(async()=>{
      try{
        const response=await fetch('/api/capital-flow?view=featured-history',{cache:'no-store'}),data=await response.json();
        if(!response.ok||!data.ok)throw Error(data.error||'歷史資料尚未接通');
        historyData=data;renderHistory();return data;
      }catch(e){
        const summary=$('szFeaturedHistorySummary');if(summary)summary.textContent='歷史追蹤讀取失敗：'+String(e.message||e);
        return null;
      }finally{historyPending=null;}
    })();
    return historyPending;
  }
  $('szFeaturedHistoryHorizon')?.addEventListener('change',renderHistory);
  $('szFeaturedHistoryScene')?.addEventListener('change',renderHistory);
  window.StockZoneFeatured={render,reset,load,loadHistory};
  window.addEventListener('stockzone:featured-daily',e=>render(e.detail));
  reset();
}());
