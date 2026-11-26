const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:+(process.argv[2]||1)});
await p.goto('file://'+__dirname+'/cycle.html');await p.waitForSelector('body[data-ready]');
await p.locator('.page').screenshot({path:process.argv[3]||'cycle.png'});await b.close();})();
