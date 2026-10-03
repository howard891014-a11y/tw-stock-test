const fs=require('fs');
const vm=require('vm');
const assert=require('assert');
const source=fs.readFileSync('app.js','utf8');

function extractFunction(name){
  const marker=`function ${name}(`,start=source.indexOf(marker);assert(start>=0,`${name} missing`);
  const brace=source.indexOf('{',start);let depth=0,inString=null,escape=false;
  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    if(inString){if(escape){escape=false;continue}if(ch==='\\'){escape=true;continue}if(ch===inString)inString=null;continue}
    if(ch==='"'||ch==="'"||ch==='`'){inString=ch;continue}
    if(ch==='{')depth++;else if(ch==='}'){depth--;if(depth===0)return source.slice(start,i+1)}
  }
  throw new Error(`${name} unterminated`);
}
const names=['fundflowPointQuadrant','fundflowQuadrantShort','fundflowProjectionScenarios','fundflowPathVector','fundflowPathAngle','fundflowFutureOpposed','fundflowPathState'];
const code=names.map(extractFunction).join('\n')+'\n;globalThis.classify=fundflowPathState;';
const ctx={console};vm.createContext(ctx);vm.runInContext(code,ctx);const classify=ctx.classify;
function sc(id,share,dx,dy,x,y){return {id,confidence:share,routeShare:share,points:[{horizon:5,dx,dy,x,y}]}}
function g({x,y,dx3=0,dy3=0,a,b}){return {x,y,dx3,dy3,projection:{pathGap:(a?.routeShare||0)-(b?.routeShare||0),scenarios:[a,b].filter(Boolean)}}}
function key(v){return classify(v).key}

assert.equal(key(g({x:-8,y:-2,a:sc('A',25,0,0,-8,-2),b:sc('B',10,1,0,-7,-2)})),'cold');
assert.equal(key(g({x:0,y:0,a:sc('A',20,10,2,10,2),b:sc('B',15,-10,-2,-10,-2)})),'direction-unclear');
assert.equal(key(g({x:-10,y:8,dx3:1,dy3:1,a:sc('A',22,1,.5,-9,8.5),b:sc('B',10,2,.2,-8,8.2)})),'early-reaction');
assert.equal(key(g({x:12,y:.5,dx3:1,dy3:.1,a:sc('A',25,2,.4,14,.9),b:sc('B',10,1,.2,13,.7)})),'institutional-layout');
assert.equal(key(g({x:-2,y:2,dx3:3,dy3:1,a:sc('A',25,3,1,1,3),b:sc('B',10,2,.5,0,2.5)})),'main-rise-confirmation');
assert.equal(key(g({x:5,y:4,dx3:2,dy3:1,a:sc('A',25,2,1,7,5),b:sc('B',10,1,.5,6,4.5)})),'strong-continuation');
assert.equal(key(g({x:5,y:3,dx3:-5,dy3:.2,a:sc('A',25,-3,.2,2,3.2),b:sc('B',10,-2,.1,3,3.1)})),'weakening');
assert.equal(key(g({x:6,y:-2,dx3:0,dy3:-2,a:sc('A',25,1,-.5,7,-2.5),b:sc('B',10,.5,-.2,6.5,-2.2)})),'pullback');

const opposed=classify(g({x:0,y:0,a:sc('A',20,10,2,10,2),b:sc('B',15,-10,-2,-10,-2)}));
assert(opposed.oppositionAngle>=179,'opposition angle should be near 180°');
assert(opposed.secondaryShareRatio>=.60,'secondary route must be meaningful');
const weakSecondary=classify(g({x:-2,y:2,dx3:3,dy3:1,a:sc('A',30,10,2,8,4),b:sc('B',10,-10,-2,-12,0)}));
assert.notEqual(weakSecondary.key,'direction-unclear','tiny reverse route must not override the main path');
console.log('Fundflow route classification v2.6.6.3 PASS — 8 states + opposed-path gate verified');
