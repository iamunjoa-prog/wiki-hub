const { chromium } = require('playwright');
(async()=>{
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1200,height:900},deviceScaleFactor:+(process.argv[2]||1)});
  await p.goto('file://'+__dirname+'/guide.html'); await p.waitForSelector('body[data-ready]',{timeout:20000});
  await p.screenshot({path:'out/full.png',fullPage:true});
  for (const id of ['s0','s1','s2','s3','s4','s5','s6']) await p.locator('#'+id).screenshot({path:`out/${id}.png`});
  await b.close();
})();
