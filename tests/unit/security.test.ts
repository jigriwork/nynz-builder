import { describe,expect,it } from "vitest";
import { assertPublicHttpUrl,filesAreSafe,safeProjectPath } from "@/lib/platform/security";

describe("generated file safety",()=>{
 it("accepts normal project paths",()=>expect(safeProjectPath("src/components/Card.tsx")).toBe("src/components/Card.tsx"));
 it.each(["../secret","src/../../secret","/etc/passwd",".env","src//App.tsx"])("rejects unsafe path %s",path=>expect(()=>safeProjectPath(path)).toThrow());
 it("enforces file count",()=>expect(()=>filesAreSafe(Array.from({length:121},(_,i)=>({path:`src/${i}.ts`,content:""})))).toThrow(/limit/));
});
describe("import URL safety",()=>{
 it.each(["http://127.0.0.1/a","http://10.0.0.1","http://192.168.1.2","http://localhost:3000","file:///etc/passwd"])("blocks %s",url=>expect(()=>assertPublicHttpUrl(url)).toThrow());
 it("accepts a public HTTPS URL",()=>expect(assertPublicHttpUrl("https://example.com/page").hostname).toBe("example.com"));
});
