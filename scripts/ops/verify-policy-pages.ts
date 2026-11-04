import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base=process.env.NYNZ_VERIFY_BASE_URL||"https://www.nynz.in";
const canonicalBase=process.env.NYNZ_CANONICAL_BASE||"https://www.nynz.in";
const out=process.env.NYNZ_EVIDENCE_DIR;
const pages=["about","privacy","terms","refund-policy","delivery-policy","acceptable-use","cookies","security","contact","legal"];
let count=0;
const check=(name:string,ok:boolean)=>{if(!ok)throw new Error(name);console.log(`PASS ${name}`);count++;};
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
try{
  if(out)mkdirSync(out,{recursive:true});
  const page=await browser.newPage();
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  for(const [label,width,height] of [["desktop",1366,900],["phone",390,844]] as const){
    await page.setViewportSize({width,height});
    for(const slug of pages){
      const response=await page.goto(`${base}/${slug}`,{waitUntil:"domcontentloaded"});
      check(`${label} /${slug} loads and has one page heading`,response?.status()===200&&await page.locator("h1").count()===1);
      check(`${label} /${slug} fits the viewport`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      check(`${label} /${slug} has its own canonical URL`,await page.locator('link[rel="canonical"]').getAttribute("href")===`${canonicalBase}/${slug}`);
      if(out&&(slug==="contact"||slug==="privacy"))await page.screenshot({path:`${out}/${label}-${slug}.png`,fullPage:true});
    }
  }
  await page.goto(`${base}/contact`);
  for(const name of ["hello","billing","partners","sales","support"])check(`contact ${name}@nynz.in`,await page.locator(`a[href="mailto:${name}@nynz.in"]`).first().isVisible());
  await page.goto(`${base}/refund-policy`);const refund=await page.locator("main").innerText();
  check("no-refund rule preserves mandatory legal remedies",/generally non-refundable/.test(refund)&&/required by applicable law/.test(refund));
  await page.goto(`${base}/`);
  check("homepage links every policy and contact page",await page.getByRole("navigation",{name:"Policies and contact"}).locator("a").count()===9);
  check("customer footer has no raw version-endpoint link",await page.locator('a[href="/version"]').count()===0);
  const version=await (await page.request.get(`${base}/version`)).json();
  check("public version endpoint omits commit hashes and deployment timestamps",Boolean(version.version)&&!("commit" in version)&&!("builtAt" in version));
  await page.goto(`${base}/login`);await page.getByRole("button",{name:"Create one",exact:true}).click();
  check("signup displays terms and privacy links",await page.locator('a[href="/terms"]').isVisible()&&await page.locator('a[href="/privacy"]').isVisible());
  check("no page errors",errors.length===0);
  console.log(`${count}/${count} public policy checks passed; no authentication or paid requests.`);
}finally{await browser.close();}
