/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — homepage behaviour (scan widget wiring, results rendering,
   email capture, share/copy helpers, waitlist).

   This file is the former inline <script> block at the end of public/index.html,
   moved verbatim so that it and /js/scan-widget.js can load with `defer`
   instead of blocking the parser (Lighthouse "render-blocking resources").
   Deferred scripts run in document order, so /js/scan-widget.js (TDMScan) is
   always defined before this runs, exactly as before. Everything here still
   executes in the global scope, so the onclick="..." handlers in the markup
   and plan-cards.js keep finding the same functions.
   ────────────────────────────────────────────────────────────────────────── */
const ER = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
let _aid=null,_dn=null,_sc=null,_sp=null,_ct=null;

// ── SCAN WIDGET ────────────────────────────────────────────────────────────
// The scan flow (validate → /api/audit → selection / verify-fail / report)
// lives in /js/scan-widget.js so the dashboard "Add doctor" modal runs the
// SAME code instead of a second copy. Defaults = this page's element ids, so
// behaviour is unchanged. The markup calls these by name via onclick=.
var _scan = TDMScan.create();
window.runCheck    = function(){ _scan.run(); };
window.runURL      = function(){ _scan.runUrl(); };
window.resetTool   = function(){ _scan.reset(); };
window.noneOfThese = function(){ _scan.noneOfThese(); };
window.toggleURL   = function(btn){ _scan.toggleUrlPanel(btn); };

// No specialty notice is ever shown on the form — the box has been removed.
// The doctor's selected specialty is always primary and Google's category is
// NEVER surfaced before the report. Specialty matching still runs in the BACKEND
// (user_specialty + google_specialty are stored there for competitor analysis).
// Kept as a no-op so existing callers (autocomplete handlers) don't break.
window.__updateSpecialtyConflict=function(){ return false; };

// Plan cards — same four plans, same copy, as the pricing page.
document.addEventListener('DOMContentLoaded', function () {
  if (window.TDMPlans) window.TDMPlans.render('pricing-cards', 'compact');
});






// ── RESULTS (from API data) ────────────────────────────────────────────────
function showRes(d,p){
  document.getElementById('ls').classList.remove('active');
  document.getElementById('rs').classList.add('active');
  var demoStrip=document.getElementById('demo-strip');
  if(demoStrip)demoStrip.style.display='none';

  var fn=p.fn||'Your',ln=p.ln||'Practice',sp=p.sp||'',ct=(p.ct||'').split(',')[0];
  var fullName='Dr. '+fn+' '+ln;

  // ── Phone mockup ──────────────────────────────────────────────────────────
  document.getElementById('ri').textContent=(fn[0]+ln[0]).toUpperCase();
  document.getElementById('rn').textContent=fullName;
  document.getElementById('rsp').textContent=sp+(ct?' · '+ct:'');
  document.getElementById('sq').textContent=fullName+' '+sp.toLowerCase();
  var rat=d.rating||0,rct=d.reviewCount||0;
  document.getElementById('rrt').textContent=rat.toFixed(1);
  document.getElementById('rrc').textContent='('+rct+' reviews)';
  document.getElementById('rst').textContent=stars(rat);
  var hr=document.getElementById('hr');
  document.getElementById('rhr').textContent=d.hasHours?(d.hoursText||'Hours listed'):'Hours not listed';
  hr.classList.toggle('issue',!d.hasHours);
  document.getElementById('rph').textContent=d.phone||'No phone number';
  document.getElementById('pr').classList.toggle('issue',!d.phone);
  document.getElementById('rpho').textContent=(d.photoCount||0)+' photo'+(d.photoCount===1?'':'s');
  document.getElementById('por').classList.toggle('issue',!d.photoCount);
  var cb=document.getElementById('cb');
  var cnLocked=document.getElementById('cn-locked');
  if(d.topCompetitor){
    document.getElementById('cn').textContent=d.topCompetitor.name;
    cb.style.display='block';
    var isPaidUser=d.plan==='report'||d.plan==='monitor';
    if(cnLocked)cnLocked.style.display=isPaidUser?'none':'inline';
  } else cb.style.display='none';

  // ── Overall score ─────────────────────────────────────────────────────────
  var sc=d.score||0;
  document.getElementById('sn').textContent=sc;
  var scoreLbl=document.getElementById('score-lbl-text');
  if(scoreLbl)scoreLbl.textContent=sp?sp+' Doctor Visibility Score':'Doctor Visibility Score';
  var sv=document.getElementById('sv');
  if(sc<50){sv.textContent='Critical \u2014 patients are finding competitors';sv.className='score-verdict vc';}
  else if(sc<70){sv.textContent='Needs attention';sv.className='score-verdict vw';}
  else if(sc<85){sv.textContent='Moderate \u2014 some gaps to close';sv.className='score-verdict vw';}
  else{sv.textContent='Strong visibility';sv.className='score-verdict vg';}

  // ── Flags ─────────────────────────────────────────────────────────────────
  var issues=d.issues||[],cnt=Math.min(issues.length,3);
  document.getElementById('fc').textContent=cnt+(cnt===1?' issue':' issues')+' found'+(sp?' for your '+sp+' listing':'');
  issues.slice(0,3).forEach(function(iss,i){
    var fl=document.getElementById('fl'+(i+1)),dot=fl.querySelector('.flag-dot'),txt=document.getElementById('ft'+(i+1));
    fl.className='flag '+(iss.severity==='critical'?'flag-c':'flag-w');
    dot.className='flag-dot '+(iss.severity==='critical'?'dot-r':'dot-a');
    var t=iss.text;
    if(sp&&t.indexOf(sp)<0){t=t.replace('your listing','your '+sp.toLowerCase()+' listing');t=t.replace('practices with',sp+'s with');}
    txt.textContent=t;fl.style.display='flex';
  });
  for(var i=cnt+1;i<=3;i++)document.getElementById('fl'+i).style.display='none';

  // ── 5-Pillar breakdown ────────────────────────────────────────────────────
  var pillars=d.pillars||{gmb:18,rating:14,reviews:4,photos:0,rank:10};
  setPillar('gmb',pillars.gmb,30);
  setPillar('rating',pillars.rating,20);
  setPillar('reviews',pillars.reviews,15);
  setPillar('photos',pillars.photos,15);
  setPillar('rank',pillars.rank,20);

  // ── AI Fix engine — populate from API ────────────────────────────────────
  var fixes=d.fixes||[];
  fixes.slice(0,3).forEach(function(fix,i){
    var n=i+1;
    var titleEl=document.getElementById('fix-title-'+n);
    var textEl=document.getElementById('fix-text-'+n);
    var headEl=titleEl?titleEl.closest('.fix-item-head'):null;
    if(titleEl)titleEl.textContent=fix.title||titleEl.textContent;
    if(textEl)textEl.textContent=fix.steps||textEl.textContent;
    if(headEl){
      var badge=headEl.querySelector('.fix-priority');
      if(badge){
        var impact=fix.impact||'medium';
        badge.className='fix-priority '+(impact==='high'?'fp-high':impact==='low'?'fp-low':'fp-med');
        badge.textContent=impact==='high'?'High impact':impact==='low'?'Low impact':'Medium impact';
      }
    }
  });

  // ── Sentiment heatmap ─────────────────────────────────────────────────────
  var sentiment=d.sentiment||null;
  if(sentiment&&sentiment.positive&&sentiment.negative){
    populateSentiment(sentiment.positive,'pos-tags','s-tag-pos');
    populateSentiment(sentiment.negative,'neg-tags','s-tag-neg');
  }

  // ── Paid-report sections ───────────────────────────────────────────────────
  populateBrandSearch(d.brandSearch||null);
  populateYoutube(d.youtube||null);
  populateAISnapshot(d.aiVisibility||null);
  populateAIRecs(d.aiCompetitors||null,d.aiQuery||null);
  populateSocialAudit(d.social||null);
  populateCompNarrative(d.competitorNarrative||null);
  populateSEOKeywords(d.seoKeywords||null);
  populateContentStrategy(d.contentStrategy||null);
  populatePatientJourney(d.patientJourney||null);
  populate90DayPlan(d.ninetyDayPlan||null,sc);

  // Gate new sections for free users — hide behind the paid-report prompt
  var isPaid=d.plan==='report'||d.plan==='monitor';
  var newSections=['brand-search-section','youtube-section','social-audit-section',
    'comp-narrative-section','seo-section','content-strategy-section',
    'patient-journey-section','plan-section'];
  newSections.forEach(function(id){
    var el=document.getElementById(id);if(!el)return;
    if(!isPaid){
      // Add lock overlay if not paid
      if(!el.querySelector('.section-lock-overlay')){
        var overlay=document.createElement('div');
        overlay.className='section-lock-overlay';
        overlay.innerHTML='<div style="text-align:center;padding:1.5rem">'
          +'<div style="font-size:24px;margin-bottom:8px">🔒</div>'
          +'<p style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:4px">Included in the Full Report</p>'
          +'<p style="font-size:12px;color:var(--slate-light);margin-bottom:12px">Get all 10 insights for <span data-price="report">-</span> - emailed as a PDF in 60 seconds</p>'
          +'<button onclick="doOneTime()" style="background:var(--green);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif" type="button">Get full report - <span data-price="report">-</span> &rarr;</button></div>';
        el.style.position='relative';
        el.style.overflow='hidden';
        overlay.style.cssText='position:absolute;inset:0;background:rgba(247,246,243,.92);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;border-radius:12px;z-index:5';
        el.appendChild(overlay);
        // Injected after boot — fill its [data-price] spans once prices are in.
        if (window.TDMPricing) {
          var fill = function () { window.TDMPricing.refresh(overlay); };
          window.TDMPricing.ready ? window.TDMPricing.ready.then(fill) : fill();
        }
      }
    }
  });

  // ── Rank tracker — Monitor only ───────────────────────────────────────────
  var isMonitor=d.plan==='monitor';
  if(isMonitor&&d.rankData){
    document.getElementById('rank-tracker-content').style.display='block';
    document.getElementById('rank-gate').style.display='none';
    var ranks=d.rankData;
    ranks.slice(0,3).forEach(function(r,i){
      var n=i+1;
      var qel=document.getElementById('rq'+n),pel=document.getElementById('rp'+n),cel=document.getElementById('rc'+n);
      if(qel)qel.textContent=r.query;
      if(pel){
        pel.textContent='#'+r.position;
        pel.className='rank-pos '+(r.position<=3?'top3':r.position<=5?'mid':'low');
      }
      if(cel){
        var diff=r.change||0;
        if(diff>0){cel.textContent='+'+diff+' this week';cel.className='rank-change rc-up';}
        else if(diff<0){cel.textContent=diff+' this week';cel.className='rank-change rc-down';}
        else{cel.textContent='unchanged';cel.className='rank-change rc-same';}
      }
    });
  } else {
    document.getElementById('rank-tracker-content').style.display='none';
    document.getElementById('rank-gate').style.display='block';
  }

  // ── Competitor deep compare — Monitor only ────────────────────────────────
  if(isMonitor&&d.competitors){
    document.getElementById('comp-content').style.display='block';
    document.getElementById('comp-gate').style.display='none';
    document.getElementById('comp-you-name').textContent=fullName;
    document.getElementById('comp-you-score').innerHTML='<span class="comp-badge cb-you">'+sc+'</span>';
    document.getElementById('comp-you-rating').textContent=rat.toFixed(1);
    document.getElementById('comp-you-reviews').textContent=rct;
    document.getElementById('comp-you-photos').textContent=d.photoCount||0;
    document.getElementById('comp-you-rank').textContent='#'+(d.localRank||'?');
    var tbody=document.getElementById('comp-tbody');
    // Remove old competitor rows (keep first you-row)
    var rows=tbody.querySelectorAll('tr:not(.you-row)');
    rows.forEach(function(r){r.remove();});
    d.competitors.slice(0,3).forEach(function(comp){
      var tr=document.createElement('tr');
      var betterScore=comp.score>sc,betterRat=comp.rating>rat,betterRev=comp.reviewCount>rct,betterPhotos=comp.photoCount>d.photoCount,betterRank=comp.localRank<(d.localRank||99);
      tr.innerHTML='<td>'+escH(comp.name)+'</td>'
        +'<td><span class="comp-badge cb-them">'+comp.score+'</span></td>'
        +'<td class="'+(betterRat?'comp-lose':'comp-win')+'">'+comp.rating.toFixed(1)+'</td>'
        +'<td class="'+(betterRev?'comp-lose':'comp-win')+'">'+comp.reviewCount+'</td>'
        +'<td class="'+(betterPhotos?'comp-lose':'comp-win')+'">'+comp.photoCount+'</td>'
        +'<td class="'+(betterRank?'comp-lose':'comp-win')+'">#'+comp.localRank+'</td>';
      tbody.appendChild(tr);
    });
  } else {
    document.getElementById('comp-content').style.display='none';
    document.getElementById('comp-gate').style.display='block';
  }

  // ── Score trend tease ──────────────────────────────────────────────────────
  var trendEl=document.getElementById('score-trend-content');
  var isPaidUser=d.plan==='report'||d.plan==='monitor';
  if(trendEl){
    if((d.plan==='monitor')&&d.scorePrev!=null){
      var delta=sc-d.scorePrev;
      var arrow=delta>0?'\u2191':delta<0?'\u2193':'\u2192';
      var col=delta>0?'#085041':delta<0?'#DC2626':'#6B7A8D';
      trendEl.innerHTML='<span style="color:'+col+';font-weight:600">'+arrow+' '+(delta>0?'+':'')+delta+' from last week</span> &middot; <span style="color:var(--slate-muted)">Score was '+d.scorePrev+' last Monday</span>';
      document.getElementById('score-trend-tease').style.cursor='default';
    } else {
      trendEl.innerHTML='\uD83D\uDCC8 <span style="color:var(--slate-muted)">Is your score going up or down this week?</span> <span style="color:var(--green);font-weight:600">Track weekly \u2192</span>';
    }
  }
  _aid=d.auditId||null;_dn=fullName;_sc=sc;_sp=sp;_ct=ct;
  var ecSub=document.getElementById('ec-sub-text');
  if(ecSub&&sp)ecSub.textContent='We\u2019ll send you the exact steps to fix each issue \u2014 written specifically for '+sp+'s in '+ct+'.';
  document.getElementById('rs').scrollIntoView({behavior:'smooth',block:'start'});
}

function stars(r){var f=Math.floor(r),h=r%1>=.5?1:0;return'\u2605'.repeat(f)+(h?'\u00bd':'')+'\u2606'.repeat(5-f-h);}

function setPillar(name,score,max){
  var pct=Math.round((score/max)*100);
  var bar=document.getElementById('bar-'+name);
  var lbl=document.getElementById('score-'+name);
  if(bar){
    bar.style.width=pct+'%';
    bar.className='pillar-bar '+(pct>=70?'pb-strong':pct>=40?'pb-moderate':'pb-weak');
  }
  if(lbl)lbl.innerHTML=score+'<span class="pillar-max">/'+max+'</span>';
}

function populateSentiment(words,containerId,cls){
  var container=document.getElementById(containerId);
  if(!container||!words)return;
  container.innerHTML='';
  var sizes=['l','m','m','s','s','s'];
  words.slice(0,6).forEach(function(w,i){
    var span=document.createElement('span');
    span.className='s-tag '+cls+' s-tag-size-'+(sizes[i]||'s');
    span.textContent=w;
    container.appendChild(span);
  });
}

function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── AI SEARCH VISIBILITY SNAPSHOT ──────────────────────────────────────────
function populateAISnapshot(ai){
  if(!ai)return;
  var platforms=['google','chatgpt','gemini','claude'];
  platforms.forEach(function(p){
    var score=ai[p]||0;
    var scoreEl=document.getElementById('ai-'+p+'-score');
    var barEl=document.getElementById('ai-'+p+'-bar');
    if(scoreEl){
      scoreEl.textContent=score;
      scoreEl.className='ai-plat-score '+(score>=70?'score-strong':score>=40?'score-mid':'score-weak');
    }
    if(barEl){
      barEl.style.width=score+'%';
      barEl.className='ai-plat-fill '+(score>=70?'fill-strong':score>=40?'fill-mid':'fill-weak');
    }
  });
}

// ── WHO AI RECOMMENDS INSTEAD ──────────────────────────────────────────────
function populateAIRecs(recs,query){
  var qEl=document.getElementById('ar-query-text');
  if(qEl&&query)qEl.textContent='"'+query+'"';
  if(!recs||!recs.length)return;
  recs.slice(0,3).forEach(function(name,i){
    var el=document.getElementById('ar-'+(i+1));
    if(el)el.textContent=name;
  });
}

// ── NEW SECTION POPULATORS ─────────────────────────────────────────────────
function formatNum(n){
  if(!n&&n!==0)return'0';
  if(n>=1000000)return(n/1000000).toFixed(1)+'M';
  if(n>=1000)return(n/1000).toFixed(1)+'k';
  return String(n);
}

function populateBrandSearch(bs){
  if(!bs)return;
  var mon=document.getElementById('bs-monthly');
  var chg=document.getElementById('bs-change');
  var yoy=document.getElementById('bs-yoy');
  var pk=document.getElementById('bs-peak');
  if(mon)mon.textContent=bs.avgMonthlySearches>0?bs.avgMonthlySearches+'+':'N/A';
  if(chg){var c=bs.threeMonthChange||0;chg.textContent=(c>=0?'\u2191 +':'\u2193 ')+c+'% (3 months)';chg.className='bm-change '+(c>=0?'bmc-up':'bmc-dn');}
  if(yoy){var y=bs.yoyChange||0;yoy.textContent=(y>=0?'+':'')+y+'%';}
  if(pk&&bs.peakMonth)pk.textContent=bs.peakMonth;
}

function populateYoutube(yt){
  var found=document.getElementById('yt-found-content');
  var notFound=document.getElementById('yt-not-found');
  if(!yt||!yt.channelFound){if(found)found.style.display='none';if(notFound)notFound.style.display='block';return;}
  if(found)found.style.display='flex';if(notFound)notFound.style.display='none';
  var set=function(id,val){var el=document.getElementById(id);if(el)el.textContent=val;};
  set('yt-views',formatNum(yt.totalViews||0));
  set('yt-subs',formatNum(yt.subscriberCount||0));
  set('yt-videos',yt.videoCount||0);
  set('yt-ctr',yt.avgCTR?yt.avgCTR.toFixed(1)+'%':'N/A');
  var sr=Math.round((yt.shortsRatio||0)*100),lr=100-sr;
  set('yt-shorts-pct',sr+'% Shorts');set('yt-long-pct',lr+'% Long-form');
  var sb=document.getElementById('yt-shorts-bar'),lb=document.getElementById('yt-long-bar');
  if(sb)sb.style.width=sr+'%';if(lb)lb.style.width=lr+'%';
  var lu=document.getElementById('yt-last-upload');
  if(lu&&yt.lastUploadDaysAgo!=null){
    var days=yt.lastUploadDaysAgo;
    var ago=days===0?'today':days===1?'yesterday':days+' days ago';
    lu.innerHTML='Last upload: <strong>'+ago+'</strong>'+(yt.topVideo?' &middot; Top: &ldquo;'+escH(yt.topVideo.title)+'&rdquo; ('+formatNum(yt.topVideo.views)+' views)':'');
  }
}

function populateSocialAudit(social){
  if(!social)return;
  function setRow(statusId,detailId,found,detail,inactive){
    var st=document.getElementById(statusId),dt=document.getElementById(detailId);
    if(st){if(!found){st.textContent='Not found';st.className='social-status ss-missing';}else if(inactive){st.textContent='Inactive';st.className='social-status ss-inactive';}else{st.textContent='Found';st.className='social-status ss-found';}}
    if(dt)dt.textContent=detail||'';
  }
  setRow('soc-ig-status','soc-ig-detail',social.instagramFound,social.instagramHandle||'',false);
  setRow('soc-li-status','soc-li-detail',social.linkedinFound,social.linkedinActive?'Active':'Last post unknown',social.linkedinFound&&!social.linkedinActive);
  setRow('soc-hg-status','soc-hg-detail',social.healthgradesFound,'',false);
  setRow('soc-zd-status','soc-zd-detail',social.zocdocFound||social.practoFound,'',false);
}

function populateCompNarrative(narrative){
  if(!narrative)return;
  var el=document.getElementById('comp-narrative-text');if(!el)return;
  var sentences=narrative.split(/(?<=[.!?])\s+/).filter(function(s){return s.trim().length>5;});
  el.innerHTML=sentences.map(function(s){return'<span class="cn-sentence">'+escH(s.trim())+'</span>';}).join('');
}

function populateSEOKeywords(kw){
  if(!kw)return;
  function buildTags(cid,words,cls){var c=document.getElementById(cid);if(!c)return;c.innerHTML=(words||[]).map(function(w){return'<span class="kw-tag '+cls+'">'+escH(w)+'</span>';}).join('');}
  buildTags('kw-primary',kw.primary,'kw-primary');
  buildTags('kw-secondary',kw.secondary,'kw-secondary');
  buildTags('kw-longtail',kw.longTail,'kw-longtail');
}

function populateContentStrategy(cs){
  if(!cs)return;
  (cs.pillars||[]).slice(0,4).forEach(function(p,i){var el=document.getElementById('cs-p'+(i+1));if(el)el.textContent=p;});
  (cs.reelIdeas||[]).slice(0,3).forEach(function(r,i){var el=document.getElementById('cs-r'+(i+1));if(el)el.textContent=r.hook||r;});
  (cs.blogTitles||[]).slice(0,2).forEach(function(b,i){var el=document.getElementById('cs-b'+(i+1));if(el)el.textContent=b;});
  var cad=document.getElementById('cs-cadence');if(cad&&cs.postingCadence)cad.textContent='Recommended cadence: '+cs.postingCadence;
}

function populatePatientJourney(pj){
  if(!pj||!pj.stages)return;
  var container=document.getElementById('pj-stages');
  var summary=document.getElementById('pj-summary');
  if(summary)summary.textContent=(pj.stagesWinning||0)+' stages winning \u00b7 '+(pj.stagesLosing||0)+' stages losing \u00b7 Critical gap: '+(pj.criticalStage||'');
  if(!container)return;
  container.innerHTML=pj.stages.map(function(s){
    var cls=s.status==='winning'?'winning':s.status==='losing'?'losing':'neutral';
    var numCls=cls==='winning'?'pjn-win':cls==='losing'?'pjn-lose':'pjn-neutral';
    var badgeCls=cls==='winning'?'psb-win':cls==='losing'?'psb-lose':'psb-neutral';
    var badgeTxt=cls==='winning'?'Winning':cls==='losing'?'Losing':'Partial';
    return'<div class="pj-stage '+cls+'">'
      +'<div class="pj-num '+numCls+'">'+s.stage+'</div>'
      +'<div class="pj-body"><div class="pj-name">'+escH(s.name)+'</div>'
      +'<div class="pj-touchpoint">'+escH(s.touchpoint)+'</div>'
      +(s.currentGap?'<div class="pj-gap">\u2717 '+escH(s.currentGap)+'</div>':'')
      +'<div class="pj-win-action">'+(cls==='winning'?'\u2713 ':'\u2192 ')+escH(s.winAction)+'</div></div>'
      +'<span class="pj-status-badge '+badgeCls+'">'+badgeTxt+'</span></div>';
  }).join('');
}

function populate90DayPlan(plan,currentScore){
  if(!plan)return;
  var cs=document.getElementById('plan-current-score');
  var ps=document.getElementById('plan-projected-score');
  if(cs)cs.textContent=currentScore||'?';
  if(ps)ps.textContent=plan.projectedScoreAt90Days||'?';
  function fillPhase(n,phase){
    if(!phase)return;
    var set=function(id,val){var el=document.getElementById(id);if(el)el.textContent=val;};
    set('plan-p'+n+'-focus',phase.focus||'');
    set('plan-p'+n+'-gain','+'+(phase.estimatedScoreGain||0)+' pts expected');
    var body=document.getElementById('plan-p'+n+'-body');if(!body)return;
    body.innerHTML='<div class="pp-section"><h6>Actions</h6>'
      +(phase.actions||[]).map(function(a){return'<div class="pp-action">'+escH(a)+'</div>';}).join('')
      +'</div><div class="pp-section"><h6>KPIs</h6>'
      +(phase.kpis||[]).map(function(k){return'<div class="pp-kpi">'+escH(k)+'</div>';}).join('')
      +'</div>';
  }
  fillPhase(1,plan.phase1);fillPhase(2,plan.phase2);fillPhase(3,plan.phase3);
}

function togPhase(head){
  var body=head.nextElementSibling;
  var isOpen=body.classList.contains('open');
  document.querySelectorAll('.pp-body').forEach(function(b){b.classList.remove('open');});
  if(!isOpen)body.classList.add('open');
}

// ── UNLOCK FIX 2 (email gate) ──────────────────────────────────────────────
function unlockFix2(){
  var email=document.getElementById('fix2-email').value.trim();
  var err=document.getElementById('fix2-err');
  if(!ER.test(email)){err.style.display='block';return;}
  err.style.display='none';
  // Save email capture
  fetch('/api/email-capture',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email,auditId:_aid,score:_sc,source:'fix2_gate'})
  }).catch(function(){});
  // Reveal fix 2
  var gate=document.getElementById('fix-2-gate');
  var copy=document.getElementById('fix-copy-2');
  var item=document.getElementById('fix-item-2');
  if(gate)gate.style.display='none';
  if(copy){copy.style.display='block';copy.classList.add('open');}
  if(item)item.style.opacity='1';
  // Also mark email as captured so the main email capture box can show different copy
  _emailCaptured=true;
}
var _emailCaptured=false;
function togFix(head){
  var wrap=head.nextElementSibling;
  var isOpen=wrap.classList.contains('open');
  document.querySelectorAll('.fix-copy-wrap').forEach(function(w){w.classList.remove('open');});
  if(!isOpen)wrap.classList.add('open');
}

function copyFix(textId,btn){
  var text=document.getElementById(textId);
  if(!text)return;
  var ok=btn.querySelector('.fix-copy-ok');
  if(navigator.clipboard){
    navigator.clipboard.writeText(text.textContent).then(function(){
      if(ok){ok.classList.add('on');setTimeout(function(){ok.classList.remove('on');},2000);}
    });
  } else {
    var ta=document.createElement('textarea');
    ta.value=text.textContent;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');if(ok){ok.classList.add('on');setTimeout(function(){ok.classList.remove('on');},2000);}}
    catch(e){}document.body.removeChild(ta);
  }
}

// ── NOT FOUND ──────────────────────────────────────────────────────────────
function showNF(p){
  document.getElementById('ls').classList.remove('active');
  document.getElementById('nf').classList.add('active');
  _sc=0;_dn='Dr. '+(p.fn||'')+' '+(p.ln||'');
  document.getElementById('nf').scrollIntoView({behavior:'smooth',block:'start'});
}
function showWL(){
  document.getElementById('nf').classList.remove('active');
  document.getElementById('inp').style.display='none';
  document.getElementById('wl').classList.add('on');
  document.getElementById('wl').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── WAITLIST (pre-launch mode) ─────────────────────────────────────────────
function joinWL(){
  var email=document.getElementById('wle').value.trim();
  if(!ER.test(email)){document.getElementById('wlerr').classList.add('on');document.getElementById('wle').focus();return;}
  document.getElementById('wlerr').classList.remove('on');
  fetch('/api/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})}).catch(function(){});
  document.getElementById('wlok').classList.add('on');
  document.getElementById('wle').disabled=true;
  document.querySelector('.wl-form button').disabled=true;
}

// ── EMAIL CAPTURE ──────────────────────────────────────────────────────────
function submitEmail(){
  var email=document.getElementById('em').value.trim(),ee=document.getElementById('ee'),ei=document.getElementById('em');
  if(!ER.test(email)){ee.classList.add('on');ei.classList.add('err');ei.focus();return;}
  ee.classList.remove('on');ei.classList.remove('err');
  fetch('/api/email-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,auditId:_aid,score:_sc})}).catch(function(){});
  document.getElementById('ecf').style.display='none';
  document.getElementById('eok').classList.add('on');
}

// ── SHARE ──────────────────────────────────────────────────────────────────
function shareWA(){
  var name=_dn||'my Google listing',sc=_sc||0;
  var url=_aid?'https://thedocmirror.com/share/'+_aid:'https://thedocmirror.com';
  var txt='I just checked '+name+' on The Doc Mirror - Doctor Visibility Score: '+sc+'/100. Check yours free: '+url;
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank','noopener');
}
function copyLnk(){
  var url=_aid?'https://thedocmirror.com/share/'+_aid:'https://thedocmirror.com';
  var ok=function(){var c=document.getElementById('cok');c.classList.add('on');setTimeout(function(){c.classList.remove('on');},2500);};
  if(navigator.clipboard){navigator.clipboard.writeText(url).then(ok).catch(function(){fb(url,ok);});}else fb(url,ok);
}
function fb(url,cb){var ta=document.createElement('textarea');ta.value=url;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');cb();}catch(e){}document.body.removeChild(ta);}

// ── UPGRADE ────────────────────────────────────────────────────────────────
function doUpgrade(plan){
  plan=plan||'monitor';
  // Doctor must run the free check first so we have their details for the report/dashboard.
  if(!_aid){
    document.getElementById('tool').scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  // Go straight to checkout — NO account is created before payment.
  // The Monitor account is created on successful subscription payment.
  window.location.href='/pages/checkout-subscription.html';
}
function doOneTime(){
  if(!_aid){
    document.getElementById('tool').scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  // The one-time report is anonymous — pay and the PDF is emailed. No account created.
  window.location.href='/pages/checkout.html';
}



